import { CSV_POLICY } from '../domain/csv-views/policy'
import type {
  CsvColumnDefinition, CsvFileProfile, CsvImportDecisions, CsvImportPreview, CsvQueryError, CsvQueryPage,
  CsvQueryRequest, CsvSaveResult, CsvSample, CsvStoredProfile, CsvStorageError,
  CsvValidationIssue, CsvValidationResult, CsvViewBundle, CsvViewDefinition,
  CsvViewSelection, CsvViewSelectionRecord
} from '../domain/csv-views/model'
import { CsvQueryError as QueryError, nextRevisions } from '../domain/csv-views/model'
import { effectiveSort, projectColumns } from '../domain/csv-views/query'
import { defaultView } from '../domain/csv-views/model'
import { validateViewBundle, validateViewDefinition } from '../domain/csv-views/validate'
import type { CsvViewStorage } from '../platform/csv/viewStorage'

export type CsvQueryState =
  | { status: 'idle' }
  | { status: 'loading'; queryId: string }
  | { status: 'ready'; queryId: string; rows: CsvQueryPage['rows']; nextCursor: string | null; hasMore: boolean; total: CsvQueryPage['total']; diagnostics: CsvQueryPage['diagnostics']; loadingMore: boolean; loadMoreError: CsvQueryError | null }
  | { status: 'error'; queryId: string; error: CsvQueryError }

export interface CsvViewControllerState {
  documentId: string
  selection: CsvViewSelection
  link: { status: 'resolving' } | { status: 'linked'; fileId: string } | { status: 'choose'; candidates: { fileId: string; basis: 'digest' | 'name-size' }[] } | { status: 'error'; error: CsvStorageError }
  profile: { status: 'loading' } | { status: 'ready'; stored: CsvStoredProfile } | { status: 'error'; error: CsvStorageError }
  sample: { status: 'idle' | 'loading' } | { status: 'ready'; sample: CsvSample } | { status: 'error'; error: CsvQueryError }
  query: CsvQueryState
  save: { status: 'idle' } | { status: 'saving' } | { status: 'conflict'; current: CsvStoredProfile } | { status: 'error'; error: CsvStorageError; issues: CsvValidationIssue[] }
}

export interface CsvControllerDataSource {
  query(request: CsvQueryRequest, signal: AbortSignal): Promise<CsvQueryPage>
  cancel(queryId: string): Promise<void>
  dispose(): Promise<void>
  release?(documentId: string): Promise<void>
  registerSnapshot?(documentId: string, sourceRevision: string, header: (string | null)[], records: string[][]): Promise<void>
  setSchema?(documentId: string, schemaRevision: number, columns: CsvColumnDefinition[]): Promise<void>
  sample?(documentId: string, sourceRevision: string, maxRecords: number): Promise<CsvSample>
  discoverGroups?(request: { requestId: string; queryId: string; dataset: CsvQueryRequest['dataset']; columnId: string; filter: CsvQueryRequest['filter']; limit: number }, signal: AbortSignal): Promise<{ keys: string[]; complete: boolean }>
}

export interface CsvViewController {
  initialize(): Promise<void>
  updateSnapshot(sourceRevision: string, header: (string | null)[], records: string[][]): Promise<void>
  getState(): CsvViewControllerState
  subscribe(listener: () => void): () => void
  select(selection: CsvViewSelection): void
  chooseLink(choice: { fileId: string } | 'new'): Promise<void>
  loadMore(): void
  queryScoped(view: CsvViewDefinition, scope: CsvQueryRequest['scope'], cursor: string | null, queryId: string, signal: AbortSignal): Promise<CsvQueryPage>
  discoverGroups(view: CsvViewDefinition, columnId: string, limit: number, signal: AbortSignal): Promise<{ keys: string[]; complete: boolean }>
  retry(): void
  previewDraft(draft: CsvViewDefinition): void
  endPreview(): void
  saveView(draft: CsvViewDefinition): Promise<CsvSaveResult>
  duplicateView(viewId: string): Promise<CsvSaveResult>
  deleteView(viewId: string): Promise<CsvSaveResult>
  reorderViews(viewOrder: string[]): Promise<CsvSaveResult>
  applyColumns(columns: CsvColumnDefinition[]): Promise<CsvSaveResult>
  exportViews(viewIds: string[] | 'all'): CsvViewBundle
  previewImport(json: unknown): Promise<CsvValidationResult<CsvImportPreview>>
  applyImport(preview: CsvImportPreview, decisions: CsvImportDecisions): Promise<CsvSaveResult>
  dispose(): void
}

interface Options {
  documentId: string
  sourceRevision: string
  stored: CsvStoredProfile
  header: (string | null)[]
  records: string[][]
  dataSource: CsvControllerDataSource
  storage: CsvViewStorage
  sourceName: string
  defaultViewQuery?: boolean
  queriesEnabled?: boolean
}

export class DefaultCsvViewController implements CsvViewController {
  private state: CsvViewControllerState
  private readonly listeners = new Set<() => void>()
  private readonly storage: CsvViewStorage
  private readonly source: CsvControllerDataSource
  private readonly header: (string | null)[]
  private readonly records: string[][]
  private readonly sourceName: string
  private stored: CsvStoredProfile
  private sourceRevision: string
  private readonly defaultViewQuery: boolean
  private readonly queriesEnabled: boolean
  private currentQueryView: CsvViewDefinition | null = null
  private currentQuery: { queryId: string; requestId: string; abort: AbortController } | null = null
  private previewTimer: number | null = null
  private preview: CsvViewDefinition | null = null
  private disposed = false
  private scopedQueue: Promise<void> = Promise.resolve()

  constructor(options: Options) {
    this.storage = options.storage
    this.source = options.dataSource
    this.stored = options.stored
    this.header = options.header
    this.records = options.records
    this.sourceName = options.sourceName
    this.sourceRevision = options.sourceRevision
    this.defaultViewQuery = options.defaultViewQuery ?? false
    this.queriesEnabled = options.queriesEnabled ?? true
    this.state = {
      documentId: options.documentId,
      selection: { kind: 'builtin', mode: 'view' },
      link: { status: 'linked', fileId: options.stored.record.fileId },
      profile: { status: 'ready', stored: options.stored },
      sample: { status: 'idle' }, query: { status: 'idle' }, save: { status: 'idle' }
    }
  }

  async initialize(): Promise<void> {
    const stored = this.getStored()
    const savedSelection = await this.storage.loadSelection(this.state.documentId).catch(() => null)
    if (savedSelection?.fileId === stored.record.fileId) this.state = { ...this.state, selection: validSelection(savedSelection.selection, stored.views) ? savedSelection.selection : { kind: 'builtin', mode: 'view' } }
    await this.replaceSnapshot()
    if (this.source.sample) {
      this.state = { ...this.state, sample: { status: 'loading' } }; this.emit()
      try { this.state = { ...this.state, sample: { status: 'ready', sample: await this.source.sample(this.state.documentId, this.sourceRevision, CSV_POLICY.sampleRecords) } } }
      catch (error) { this.state = { ...this.state, sample: { status: 'error', error: asQueryError(error) } } }
    }
    this.emit()
    const activeSelection = this.state.selection
    if (activeSelection.kind === 'custom' && !usesScopedQueries(this.activeView())) this.startQuery()
    else if (this.defaultViewQuery && activeSelection.kind === 'builtin' && activeSelection.mode === 'view') this.startQuery(this.defaultView())
  }

  getState = (): CsvViewControllerState => this.state
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener) }

  select(selection: CsvViewSelection): void {
    if (selection.kind === 'custom') {
      const viewId = selection.viewId
      if (!this.getStored().views.some((view) => view.id === viewId)) selection = { kind: 'builtin', mode: 'view' }
    }
    this.state = { ...this.state, selection }
    this.saveSelection(selection)
    this.cancelCurrent()
    this.preview = null
    if (!this.queriesEnabled) {
      this.currentQueryView = null
      this.state = { ...this.state, query: { status: 'idle' } }
      this.emit()
      return
    }
    if (selection.kind === 'builtin') {
      if (this.defaultViewQuery && selection.mode === 'view') this.startQuery(this.defaultView())
      else { this.currentQueryView = null; this.state = { ...this.state, query: { status: 'idle' } }; this.emit() }
      return
    }
    const selected = this.activeView()
    if (usesScopedQueries(selected)) { this.currentQueryView = null; this.state = { ...this.state, query: { status: 'idle' } }; this.emit() }
    else this.startQuery()
  }

  async chooseLink(choice: { fileId: string } | 'new'): Promise<void> {
    if (choice === 'new') { this.state = { ...this.state, link: { status: 'error', error: { code: 'unavailable', message: '새 파일 연결에는 원본 프로필 준비가 필요합니다.' } } }; this.emit(); return }
    const stored = await this.storage.loadProfile(choice.fileId)
    if (!stored) { this.state = { ...this.state, link: { status: 'error', error: { code: 'corrupt', message: '선택한 파일 설정을 찾을 수 없습니다.' } } }; this.emit(); return }
    this.stored = stored
    this.state = { ...this.state, profile: { status: 'ready', stored }, link: { status: 'linked', fileId: choice.fileId } }
    await this.replaceSnapshot(); this.emit()
  }

  async updateSnapshot(sourceRevision: string, header: (string | null)[], records: string[][]): Promise<void> {
    if (this.disposed || sourceRevision === this.sourceRevision) return
    this.cancelCurrent()
    this.sourceRevision = sourceRevision
    await this.source.release?.(this.state.documentId).catch(() => undefined)
    if (this.source.registerSnapshot) await this.source.registerSnapshot(this.state.documentId, sourceRevision, header, records)
    if (this.source.setSchema) await this.source.setSchema(this.state.documentId, this.stored.record.profile.schemaRevision, this.stored.record.profile.columns)
    if (this.state.selection.kind === 'custom') this.startQuery()
  }

  loadMore(): void {
    if (!this.queriesEnabled) return
    if (this.state.query.status !== 'ready' || !this.state.query.hasMore || !this.state.query.nextCursor || this.state.query.loadingMore) return
    const current = this.state.query
    this.state = { ...this.state, query: { ...current, loadingMore: true, loadMoreError: null } }; this.emit()
    const view = this.currentQueryView ?? this.activeView()
    if (!view) return
    const request = this.requestFor(view, current.queryId, crypto.randomUUID(), current.nextCursor)
    const abort = new AbortController(); this.currentQuery = { queryId: current.queryId, requestId: request.requestId, abort }
    void this.source.query(request, abort.signal).then((page) => {
      if (this.disposed || this.state.query.status !== 'ready' || this.state.query.queryId !== current.queryId) return
      this.state = { ...this.state, query: { ...this.state.query, rows: [...this.state.query.rows, ...page.rows], nextCursor: page.nextCursor, hasMore: page.hasMore, total: page.total, diagnostics: [...this.state.query.diagnostics, ...page.diagnostics], loadingMore: false } }
      this.emit()
    }).catch((error: unknown) => {
      if (isCancelled(error)) return
      if (this.state.query.status === 'ready' && this.state.query.queryId === current.queryId) this.state = { ...this.state, query: { ...this.state.query, loadingMore: false, loadMoreError: asQueryError(error) } }
      this.emit()
    })
  }

  queryScoped = async (view: CsvViewDefinition, scope: CsvQueryRequest['scope'], cursor: string | null, queryId: string, signal: AbortSignal): Promise<CsvQueryPage> => {
    if (!this.queriesEnabled) throw new QueryError('source-unavailable', '원본 CSV를 다시 연결하면 조회할 수 있습니다.')
    const task = async () => {
      if (signal.aborted) throw new QueryError('cancelled', '범위 조회가 취소되었습니다.')
      if (this.disposed) throw new QueryError('engine-restarted', 'CSV 조회 세션이 종료되었습니다.')
      const request = this.requestFor(view, queryId, crypto.randomUUID(), cursor, scope)
      const page = await this.source.query(request, signal)
      if (signal.aborted) throw new QueryError('cancelled', '범위 조회가 취소되었습니다.')
      if (page.dataset.documentId !== request.dataset.documentId || page.dataset.fileId !== request.dataset.fileId || page.dataset.sourceRevision !== request.dataset.sourceRevision || page.dataset.schemaRevision !== request.dataset.schemaRevision) throw new QueryError('stale-dataset', '범위 조회 원본이 변경되었습니다.')
      return page
    }
    const next = this.scopedQueue.then(task, task)
    this.scopedQueue = next.then(() => undefined, () => undefined)
    return next
  }

  discoverGroups = async (view: CsvViewDefinition, columnId: string, limit: number, signal: AbortSignal): Promise<{ keys: string[]; complete: boolean }> => {
    if (!this.queriesEnabled) throw new QueryError('source-unavailable', '원본 CSV를 다시 연결하면 그룹을 확인할 수 있습니다.')
    if (!this.source.discoverGroups) throw new QueryError('source-unavailable', '이 CSV 원본에서는 그룹 목록을 조회할 수 없습니다.')
    const task = async () => {
      if (signal.aborted) throw new QueryError('cancelled', '그룹 조회가 취소되었습니다.')
      if (this.disposed) throw new QueryError('engine-restarted', 'CSV 조회 세션이 종료되었습니다.')
      const stored = this.getStored()
      return this.source.discoverGroups!({
        requestId: crypto.randomUUID(), queryId: crypto.randomUUID(),
        dataset: { documentId: this.state.documentId, fileId: stored.record.fileId, sourceRevision: this.sourceRevision, schemaRevision: stored.record.profile.schemaRevision },
        columnId, filter: view.filter, limit: Math.min(CSV_POLICY.maxGroupCount, Math.max(1, Math.floor(limit)))
      }, signal)
    }
    const next = this.scopedQueue.then(task, task)
    this.scopedQueue = next.then(() => undefined, () => undefined)
    return next
  }

  retry(): void { if (this.queriesEnabled && this.state.selection.kind === 'custom' && !usesScopedQueries(this.activeView())) this.startQuery() }

  previewDraft(draft: CsvViewDefinition): void {
    if (!this.queriesEnabled) return
    this.preview = draft
    if (this.previewTimer !== null) window.clearTimeout(this.previewTimer)
    this.previewTimer = window.setTimeout(() => { this.previewTimer = null; this.startQuery(draft) }, CSV_POLICY.queryDebounceMs)
  }

  endPreview(): void {
    if (this.previewTimer !== null) { window.clearTimeout(this.previewTimer); this.previewTimer = null }
    this.preview = null
    if (!this.queriesEnabled) { this.cancelCurrent(); this.currentQueryView = null; this.state = { ...this.state, query: { status: 'idle' } }; this.emit() }
    else if (this.state.selection.kind === 'custom') this.startQuery()
    else if (this.defaultViewQuery && this.state.selection.mode === 'view') this.startQuery(this.defaultView())
    else { this.cancelCurrent(); this.currentQueryView = null; this.state = { ...this.state, query: { status: 'idle' } }; this.emit() }
  }

  async saveView(draft: CsvViewDefinition): Promise<CsvSaveResult> {
    const stored = this.getStored()
    const checked = validateViewDefinition(draft, stored.record.profile.columns)
    if (!checked.ok) return { ok: false, reason: 'invalid', issues: checked.issues }
    const views = stored.views.some((view) => view.id === draft.id) ? stored.views.map((view) => view.id === draft.id ? checked.value : view) : [...stored.views, checked.value]
    const order = stored.views.some((view) => view.id === draft.id) ? stored.record.profile.viewOrder : [...stored.record.profile.viewOrder, draft.id]
    return this.commit({ profile: this.profileWith({ viewOrder: order }, false), putViews: [checked.value], deleteViewIds: [] }, views)
  }

  async duplicateView(viewId: string): Promise<CsvSaveResult> {
    const original = this.getStored().views.find((view) => view.id === viewId)
    if (!original) return invalidResult('/viewId', '뷰를 찾을 수 없습니다.')
    if (this.getStored().views.length >= CSV_POLICY.maxViewsPerFile) return invalidResult('/views', '파일당 뷰는 100개까지 저장할 수 있습니다.', 'limit')
    const copy = { ...structuredClone(original), id: crypto.randomUUID(), name: `${original.name} 복사`, updatedAt: new Date().toISOString() }
    return this.saveView(copy)
  }

  async deleteView(viewId: string): Promise<CsvSaveResult> {
    const stored = this.getStored()
    if (!stored.views.some((view) => view.id === viewId)) return invalidResult('/viewId', '뷰를 찾을 수 없습니다.')
    const views = stored.views.filter((view) => view.id !== viewId)
    const order = stored.record.profile.viewOrder.filter((id) => id !== viewId)
    const result = await this.commit({ profile: this.profileWith({ viewOrder: order }, false), putViews: [], deleteViewIds: [viewId] }, views)
    if (result.ok && this.state.selection.kind === 'custom' && this.state.selection.viewId === viewId) this.select({ kind: 'builtin', mode: 'view' })
    return result
  }

  async reorderViews(viewOrder: string[]): Promise<CsvSaveResult> {
    const stored = this.getStored()
    if (viewOrder.length !== stored.views.length || new Set(viewOrder).size !== viewOrder.length || viewOrder.some((id) => !stored.views.some((view) => view.id === id))) return invalidResult('/viewOrder', '뷰 순서가 현재 뷰와 일치하지 않습니다.')
    return this.commit({ profile: this.profileWith({ viewOrder }, false), putViews: [], deleteViewIds: [] }, stored.views)
  }

  async applyColumns(columns: CsvColumnDefinition[]): Promise<CsvSaveResult> {
    const profile = this.profileWith({ columns }, true)
    return this.commit({ profile, putViews: [], deleteViewIds: [] }, this.getStored().views)
  }

  exportViews(viewIds: string[] | 'all'): CsvViewBundle {
    const stored = this.getStored()
    const selected = viewIds === 'all' ? stored.views : stored.views.filter((view) => viewIds.includes(view.id))
    const ordered = stored.record.profile.viewOrder.flatMap((id) => selected.some((view) => view.id === id) ? [id] : [])
    const { viewOrder: _order, ...profile } = stored.record.profile
    return { kind: 'csv-view-bundle', schemaVersion: 1, exportedAt: new Date().toISOString(), appVersion: __APP_VERSION__, source: { fileName: this.sourceName, headers: profile.columns.map((column) => column.sourceHeader), columnCount: profile.columns.length }, profile, viewOrder: ordered, views: selected }
  }

  async previewImport(json: unknown): Promise<CsvValidationResult<CsvImportPreview>> {
    const bundle = validateViewBundle(json)
    if (!bundle.ok) return bundle
    const stored = this.getStored()
    const columnMatches = bundle.value.profile.columns.map((column) => {
      const sameHeader = stored.record.profile.columns.filter((candidate) => candidate.sourceHeader === column.sourceHeader && candidate.sourceHeader !== null)
      const positioned = stored.record.profile.columns[column.sourceIndex]
      if (positioned?.sourceHeader === column.sourceHeader && sameHeader.length === 1) return { importedColumnId: column.id, sourceIndex: positioned.sourceIndex, basis: 'header-and-position' as const }
      if (sameHeader.length === 1) return { importedColumnId: column.id, sourceIndex: sameHeader[0]!.sourceIndex, basis: 'header' as const }
      if (positioned) return { importedColumnId: column.id, sourceIndex: positioned.sourceIndex, basis: 'position' as const }
      return { importedColumnId: column.id, sourceIndex: null, basis: 'none' as const }
    })
    const typeConflicts = columnMatches.flatMap((match) => {
      if (match.sourceIndex === null) return []
      const existing = stored.record.profile.columns[match.sourceIndex]
      const imported = bundle.value.profile.columns.find((column) => column.id === match.importedColumnId)
      return existing && imported && existing.type !== imported.type ? [{ columnId: existing.id, existing: existing.type, imported: imported.type }] : []
    })
    const preview: CsvImportPreview = { bundle: bundle.value, filledDefaults: bundle.filledDefaults, columnMatches, typeConflicts, idConflicts: bundle.value.views.filter((view) => stored.views.some((existing) => existing.id === view.id)).map((view) => view.id) }
    return { ok: true, value: preview, filledDefaults: bundle.filledDefaults }
  }

  async applyImport(preview: CsvImportPreview, decisions: CsvImportDecisions): Promise<CsvSaveResult> {
    const stored = this.getStored()
    const mapping = new Map<string, string>()
    const columns = [...stored.record.profile.columns]
    const imported = preview.bundle.profile.columns
    for (const source of imported) {
      const targetIndex = decisions.columnMap[source.id]
      if (targetIndex === undefined || targetIndex === 'skip') continue
      const target = columns[targetIndex]
      if (!target) return invalidResult(`/columnMap/${source.id}`, '컬럼 연결 위치가 올바르지 않습니다.')
      mapping.set(source.id, target.id)
      if (decisions.typeResolution[target.id] === 'use-imported') columns[targetIndex] = { ...source, id: target.id, sourceIndex: target.sourceIndex, sourceHeader: target.sourceHeader, label: target.label }
    }
    const importedViews = preview.bundle.views.filter((view) => decisions.viewIds.includes(view.id))
    const remapped: CsvViewDefinition[] = []
    for (const view of importedViews) {
      const mapped = remapView(view, mapping)
      if (!mapped) return invalidResult(`/views/${view.id}`, '건너뛴 컬럼을 참조하는 뷰는 가져올 수 없습니다.')
      const id = stored.views.some((existing) => existing.id === view.id) ? crypto.randomUUID() : view.id
      const checked = validateViewDefinition({ ...mapped, id, updatedAt: new Date().toISOString() }, columns)
      if (!checked.ok) return { ok: false, reason: 'invalid', issues: checked.issues }
      remapped.push(checked.value)
    }
    const views = [...stored.views, ...remapped]
    const order = [...stored.record.profile.viewOrder, ...remapped.map((view) => view.id)]
    const schemaChanged = JSON.stringify(columns.map(schemaPart)) !== JSON.stringify(stored.record.profile.columns.map(schemaPart))
    return this.commit({ profile: this.profileWith({ columns, viewOrder: order }, schemaChanged), putViews: remapped, deleteViewIds: [] }, views)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.previewTimer !== null) window.clearTimeout(this.previewTimer)
    this.cancelCurrent()
    void this.source.dispose()
    this.listeners.clear()
  }

  private async replaceSnapshot(): Promise<void> {
    const stored = this.getStored()
    if (this.source.registerSnapshot) await this.source.registerSnapshot(this.state.documentId, this.sourceRevision, this.header, this.records)
    if (this.source.setSchema) await this.source.setSchema(this.state.documentId, stored.record.profile.schemaRevision, stored.record.profile.columns)
  }

  private requestFor(view: CsvViewDefinition, queryId: string, requestId: string, cursor: string | null, scope: CsvQueryRequest['scope'] = { kind: 'rows' }): CsvQueryRequest {
    const stored = this.getStored()
    return {
      dataset: { documentId: this.state.documentId, fileId: stored.record.fileId, sourceRevision: this.sourceRevision, schemaRevision: stored.record.profile.schemaRevision },
      queryId, requestId, columnIds: projectColumns(view), filter: view.filter, sort: effectiveSort(view),
      scope, cursor, limit: CSV_POLICY.pageSize, maxResultBytes: 2 * 1024 * 1024
    }
  }

  private startQuery(draft?: CsvViewDefinition): void {
    if (!this.queriesEnabled) {
      this.cancelCurrent(); this.currentQueryView = null
      this.state = { ...this.state, query: { status: 'idle' } }; this.emit()
      return
    }
    const view = draft ?? this.activeView()
    if (!view || this.disposed) { this.state = { ...this.state, query: { status: 'idle' } }; this.emit(); return }
    if (!draft && usesScopedQueries(view)) { this.currentQueryView = null; this.state = { ...this.state, query: { status: 'idle' } }; this.emit(); return }
    this.cancelCurrent()
    this.currentQueryView = view
    const queryId = crypto.randomUUID(), requestId = crypto.randomUUID(), abort = new AbortController()
    const request = this.requestFor(view, queryId, requestId, null)
    this.currentQuery = { queryId, requestId, abort }
    this.state = { ...this.state, query: { status: 'loading', queryId } }; this.emit()
    void this.source.query(request, abort.signal).then((page) => {
      if (!this.isCurrent(page, queryId, requestId)) return
      this.state = { ...this.state, query: { status: 'ready', queryId, rows: page.rows, nextCursor: page.nextCursor, hasMore: page.hasMore, total: page.total, diagnostics: page.diagnostics, loadingMore: false, loadMoreError: null } }
      this.emit()
    }).catch((error: unknown) => {
      if (isCancelled(error) || this.disposed || this.currentQuery?.queryId !== queryId) return
      this.state = { ...this.state, query: { status: 'error', queryId, error: asQueryError(error) } }; this.emit()
    })
  }

  private isCurrent(page: CsvQueryPage, queryId: string, requestId: string): boolean {
    const stored = this.getStored()
    const expected = { documentId: this.state.documentId, fileId: stored.record.fileId, sourceRevision: this.sourceRevision, schemaRevision: stored.record.profile.schemaRevision }
    return !this.disposed && this.currentQuery?.queryId === queryId && this.currentQuery.requestId === requestId && page.queryId === queryId && page.requestId === requestId &&
      page.dataset.documentId === expected.documentId && page.dataset.fileId === expected.fileId && page.dataset.sourceRevision === expected.sourceRevision && page.dataset.schemaRevision === expected.schemaRevision
  }

  private cancelCurrent(): void {
    const current = this.currentQuery
    this.currentQuery = null
    if (current) { current.abort.abort(); void this.source.cancel(current.queryId) }
  }

  private async commit(change: { profile: CsvFileProfile; putViews: CsvViewDefinition[]; deleteViewIds: string[] }, views: CsvViewDefinition[]): Promise<CsvSaveResult> {
    const current = this.getStored()
    this.state = { ...this.state, save: { status: 'saving' } }; this.emit()
    const result = await this.storage.commit(current.record.fileId, current.record.profile.profileRevision, change)
    if (!result.ok) {
      if (result.reason === 'conflict') this.state = { ...this.state, save: { status: 'conflict', current: result.current } }
      else if (result.reason === 'storage') this.state = { ...this.state, save: { status: 'error', error: result.error, issues: [] } }
      else this.state = { ...this.state, save: { status: 'error', error: { code: 'corrupt', message: '설정이 올바르지 않습니다.' }, issues: result.issues } }
      this.emit(); return result
    }
    this.stored = { record: { ...current.record, profile: change.profile }, views: change.profile.viewOrder.flatMap((id) => { const view = views.find((item) => item.id === id); return view ? [view] : [] }) }
    this.state = { ...this.state, profile: { status: 'ready', stored: this.stored }, save: { status: 'idle' } }
    if (this.source.setSchema && change.profile.schemaRevision !== current.record.profile.schemaRevision) await this.source.setSchema(this.state.documentId, change.profile.schemaRevision, change.profile.columns)
    this.emit()
    if (this.state.selection.kind === 'custom') this.startQuery()
    return result
  }

  private profileWith(change: Partial<Pick<CsvFileProfile, 'columns' | 'viewOrder'>>, schemaChanged: boolean): CsvFileProfile {
    const current = this.getStored().record.profile
    return { ...current, ...change, ...nextRevisions(current, { schemaChanged }), updatedAt: new Date().toISOString() }
  }

  private getStored(): CsvStoredProfile { return this.stored }
  private activeView(): CsvViewDefinition | null {
    if (this.preview) return this.preview
    const selection = this.state.selection
    if (selection.kind !== 'custom' || this.state.profile.status !== 'ready') return null
    return this.state.profile.stored.views.find((view) => view.id === selection.viewId) ?? null
  }
  private defaultView(): CsvViewDefinition {
    return defaultView('csv-default' as string, '표', this.getStored().record.profile.columns.map((column) => column.id))
  }
  private saveSelection(selection: CsvViewSelection): void {
    const stored = this.getStored()
    const record: CsvViewSelectionRecord = { documentId: this.state.documentId, fileId: stored.record.fileId, selection, updatedAt: new Date().toISOString() }
    void this.storage.saveSelection(record).catch(() => undefined)
  }
  private emit(): void { for (const listener of this.listeners) listener() }
}

function usesScopedQueries(view: CsvViewDefinition | null): boolean { return view?.layout.kind === 'kanban' || view?.layout.kind === 'calendar' }

function validSelection(selection: CsvViewSelection, views: CsvViewDefinition[]): boolean { return selection.kind === 'builtin' ? selection.mode === 'view' || selection.mode === 'source' : views.some((view) => view.id === selection.viewId) }
function asQueryError(error: unknown): CsvQueryError { return error instanceof QueryError ? error : new QueryError('internal', error instanceof Error ? error.message : 'CSV 조회에 실패했습니다.') }
function isCancelled(error: unknown): boolean { return error instanceof QueryError && error.code === 'cancelled' }
function invalidResult(path: string, detail: string, code: CsvValidationIssue['code'] = 'required'): CsvSaveResult { return { ok: false, reason: 'invalid', issues: [{ path, code, detail }] } }
function schemaPart(column: CsvColumnDefinition): unknown { return { id: column.id, sourceIndex: column.sourceIndex, sourceHeader: column.sourceHeader, type: column.type, parse: column.parse, nullMarkers: column.nullMarkers, allowSurroundingSpace: column.allowSurroundingSpace } }
function remapView(view: CsvViewDefinition, mapping: Map<string, string>): CsvViewDefinition | null {
  const mapId = (id: string | null): string | null => id === null ? null : mapping.get(id) ?? null
  const columnIds = view.columnIds.map(mapId)
  if (columnIds.some((id) => id === null)) return null
  const layout = view.layout.kind === 'grid' ? view.layout
    : view.layout.kind === 'list' ? { ...view.layout, titleColumnId: mapId(view.layout.titleColumnId), subtitleColumnId: mapId(view.layout.subtitleColumnId), trailingColumnId: mapId(view.layout.trailingColumnId), colorColumnId: mapId(view.layout.colorColumnId), groupColumnId: mapId(view.layout.groupColumnId) }
      : view.layout.kind === 'gallery' ? { ...view.layout, titleColumnId: mapId(view.layout.titleColumnId), coverColumnId: mapId(view.layout.coverColumnId) }
        : view.layout.kind === 'kanban' ? { ...view.layout, groupColumnId: mapId(view.layout.groupColumnId) }
          : { ...view.layout, dateColumnId: mapId(view.layout.dateColumnId) }
  if (JSON.stringify(layout).includes('null')) return null
  const filter = remapFilter(view.filter, mapping)
  if (view.filter && !filter) return null
  const sort = view.sort.map((item) => ({ ...item, columnId: mapping.get(item.columnId) ?? '' }))
  if (sort.some((item) => !item.columnId)) return null
  const displayOverrides: CsvViewDefinition['displayOverrides'] = {}
  for (const [id, override] of Object.entries(view.displayOverrides)) {
    const target = mapping.get(id); if (!target) return null; displayOverrides[target] = override
  }
  return { ...view, layout: layout as CsvViewDefinition['layout'], columnIds: columnIds as string[], filter, sort, displayOverrides }
}
function remapFilter(filter: CsvViewDefinition['filter'], mapping: Map<string, string>): CsvViewDefinition['filter'] {
  if (!filter) return null
  if (filter.op === 'and' || filter.op === 'or') { const children = filter.children.map((child) => remapFilter(child, mapping)); return children.some((child) => child === null) ? null : { ...filter, children: children as NonNullable<typeof filter.children> } }
  if (filter.op === 'not') { const child = remapFilter(filter.child, mapping); return child ? { ...filter, child } : null }
  if (!('columnId' in filter)) return null
  const columnId = mapping.get(filter.columnId); return columnId ? { ...filter, columnId } : null
}
