import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'
import type { FileBackedCsvDocument, ViewerDocument } from '../../domain/types'
import { CSV_POLICY } from '../../domain/csv-views/policy'
import { CsvQueryError, defaultView, isFileBackedCsvDocument, type CsvImportPreview, type CsvSaveResult, type CsvViewBackup, type CsvViewBundle, type CsvViewDefinition } from '../../domain/csv-views/model'
import { validateBackup } from '../../domain/csv-views/validate'
import { resolveMemoryCsvProfile } from '../../app/csvViewBootstrap'
import { DefaultCsvViewController, type CsvControllerDataSource, type CsvViewController, type CsvViewControllerState } from '../../app/csvViewController'
import { csvViewStorage } from '../../platform/csv/viewStorage'
import { MemoryCsvDataSource } from '../../platform/csv/MemoryCsvDataSource'
import { DuckDbCsvDataSource } from '../../platform/csv/DuckDbCsvDataSource'
import { getCsvFileSource } from '../../platform/csv/fileRegistry'
import { CsvColumnTypeEditor } from './CsvColumnTypeEditor'
import { CsvImportReviewDialog } from './CsvImportReviewDialog'
import { CsvBackupProfileDialog } from './CsvBackupProfileDialog'
import { CsvViewBuilder } from './CsvViewBuilder'
import { CsvViewHost } from './CsvViewHost'
import { CsvViewManager } from './CsvViewManager'
import { CsvViewTabs } from './CsvViewTabs'
import type { CsvViewSelection as Selection } from '../../domain/csv-views/model'

type CsvDocument = Extract<ViewerDocument, { format: 'csv' }> | FileBackedCsvDocument
interface Props { document: CsvDocument; defaultContent: ReactNode; onModeChange(mode: 'view' | 'source'): void; onError(message: string): void; onReconnect(): void; cacheEnabled?: boolean }

export function CsvViewWorkspace({ document, defaultContent, onModeChange, onError, onReconnect, cacheEnabled = false }: Props) {
  const [controller, setController] = useState<CsvViewController | null>(null)
  const [resolution, setResolution] = useState<Awaited<ReturnType<typeof resolveMemoryCsvProfile>> | null>(null)
  const [starting, setStarting] = useState(true)
  const [startupError, setStartupError] = useState('')
  const [builder, setBuilder] = useState<CsvViewDefinition | null>(null)
  const [builderMode, setBuilderMode] = useState<'create' | 'edit'>('create')
  const [manager, setManager] = useState(false)
  const [typeColumnId, setTypeColumnId] = useState<string | null>(null)
  const [importPreview, setImportPreview] = useState<CsvImportPreview | null>(null)
  const [backupImport, setBackupImport] = useState<CsvViewBackup | null>(null)
  const [importMessage, setImportMessage] = useState('')
  const [tabTargets, setTabTargets] = useState<{ desktop: HTMLElement | null; mobile: HTMLElement | null }>({ desktop: null, mobile: null })
  const documentRef = useRef(document)
  documentRef.current = document
  const sourceSessionKey = isFileBackedCsvDocument(document) ? `${document.sourceRevision}:${document.sourceState.status}` : document.format

  useEffect(() => {
    setTabTargets({ desktop: window.document.getElementById('csv-view-tabs-desktop-slot'), mobile: window.document.getElementById('csv-view-tabs-mobile-slot') })
  }, [document.id])

  useEffect(() => {
    let cancelled = false
    let activeController: CsvViewController | null = null
    setController(null); setResolution(null); setStartupError(''); setStarting(true)
    const start = async () => {
      let dataSource: CsvControllerDataSource
      let stored
      let header: (string | null)[]
      let records: string[][]
      let sourceRevision: string
      let sourceName = document.name
      const fileBacked = isFileBackedCsvDocument(document)
      if (fileBacked) {
        const entry = getCsvFileSource(document.id)
        stored = await csvViewStorage.loadProfile(document.fileId)
        if (!stored) throw new Error('저장된 CSV 설정을 찾을 수 없습니다.')
        sourceRevision = document.sourceRevision
        if (entry) {
          header = entry.sample.header; records = entry.sample.records
          dataSource = new DuckDbCsvDataSource(entry.file, entry.handle, entry.sample, stored.record.profile, document.id, document.fileId, document.sourceRevision, cacheEnabled, entry.queryFile, entry.retainQueryFile())
        } else {
          header = stored.record.profile.columns.map((column) => column.sourceHeader); records = []
          dataSource = unavailableCsvDataSource()
        }
      } else {
        const memoryDocument = document as Extract<ViewerDocument, { format: 'csv' }>
        const linked = await resolveMemoryCsvProfile(memoryDocument)
        if (cancelled) return
        if (linked.status === 'choose' || linked.status === 'recover') { setResolution(linked); setStarting(false); return }
        stored = linked.stored
        const model = memoryDocument.model
        const width = Math.max(model.headers.length, ...model.rows.map((row) => row.length), 0)
        header = model.hasHeader ? model.headers : Array.from({ length: width }, () => null)
        records = model.rows
        sourceRevision = `${memoryDocument.id}:${memoryDocument.revision}`
        dataSource = new MemoryCsvDataSource()
      }
      activeController = new DefaultCsvViewController({
        documentId: document.id, sourceRevision, stored, header, records, dataSource, storage: csvViewStorage, sourceName,
        defaultViewQuery: fileBacked && Boolean(getCsvFileSource(document.id)), queriesEnabled: !fileBacked || Boolean(getCsvFileSource(document.id))
      })
      await activeController.initialize()
      if (cancelled) { activeController.dispose(); return }
      const selection = activeController.getState().selection
      if (selection.kind === 'builtin' && selection.mode !== document.mode) activeController.select({ kind: 'builtin', mode: document.mode })
      setController(activeController); setStarting(false)
    }
    void start().catch((error: unknown) => {
      if (cancelled) return
      setStartupError(error instanceof Error ? error.message : 'CSV 보기를 준비하지 못했습니다.')
      setStarting(false)
    })
    return () => { cancelled = true; activeController?.dispose() }
  }, [cacheEnabled, document.id, sourceSessionKey])

  useEffect(() => {
    if (!controller || isFileBackedCsvDocument(document)) return
    const memoryDocument = document as Extract<ViewerDocument, { format: 'csv' }>
    if (memoryDocument.parseState !== 'ready' || memoryDocument.modelRevision !== memoryDocument.revision) return
    const header = memoryDocument.model.hasHeader ? memoryDocument.model.headers : Array.from({ length: Math.max(memoryDocument.model.headers.length, ...memoryDocument.model.rows.map((row) => row.length), 0) }, () => null)
    void controller.updateSnapshot(`${memoryDocument.id}:${memoryDocument.revision}`, header, memoryDocument.model.rows).catch((error: unknown) => onError(error instanceof Error ? error.message : 'CSV 작업본을 갱신하지 못했습니다.'))
  }, [controller, document, onError])

  const subscribe = useCallback((listener: () => void) => controller?.subscribe(listener) ?? (() => undefined), [controller])
  const getSnapshot = useCallback((): CsvViewControllerState | null => controller?.getState() ?? null, [controller])
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const stored = state?.profile.status === 'ready' ? state.profile.stored : null
  const sample = state?.sample.status === 'ready' ? state.sample.sample : null
  const views = useMemo(() => stored?.views.map((view) => ({ id: view.id, name: view.name, layout: view.layout.kind })) ?? [], [stored])

  const chooseIdentity = async (fileId: string | 'new') => {
    if (isFileBackedCsvDocument(document)) return
    const memoryDocument = document as Extract<ViewerDocument, { format: 'csv' }>
    try {
      const linked = await resolveMemoryCsvProfile(memoryDocument, fileId)
      setResolution(null)
      if (linked.status !== 'linked') return
      const source = new MemoryCsvDataSource()
      const currentDocument = documentRef.current
      if (isFileBackedCsvDocument(currentDocument)) return
      const model = currentDocument as Extract<ViewerDocument, { format: 'csv' }>
      const width = Math.max(model.model.headers.length, ...model.model.rows.map((row) => row.length), 0)
      const header = model.model.hasHeader ? model.model.headers : Array.from({ length: width }, () => null)
      const next = new DefaultCsvViewController({ documentId: model.id, sourceRevision: `${model.id}:${model.revision}`, stored: linked.stored, header, records: model.model.rows, dataSource: source, storage: csvViewStorage, sourceName: model.name })
      await next.initialize(); setController(next); setStarting(false)
    } catch (error) { setStartupError(error instanceof Error ? error.message : 'CSV 설정을 연결하지 못했습니다.'); setStarting(false) }
  }

  const select = (selection: Selection) => {
    if (!controller) return
    controller.select(selection)
    if (selection.kind === 'builtin') onModeChange(selection.mode)
    else onModeChange('view')
  }
  const addView = () => {
    if (!stored) return
    setBuilderMode('create')
    setBuilder(defaultView(crypto.randomUUID(), '새 보기', stored.record.profile.columns.map((column) => column.id)))
  }
  const applyView = async (draft: CsvViewDefinition): Promise<CsvSaveResult> => {
    if (!controller) return { ok: false, reason: 'storage', error: { code: 'unavailable', message: 'CSV controller가 준비되지 않았습니다.' } }
    const result = await controller.saveView(draft)
    if (result.ok) { setBuilder(null); controller.select({ kind: 'custom', viewId: draft.id }) }
    return result
  }
  const downloadBundle = (ids: string[] | 'all') => {
    if (!controller) return
    const bundle = controller.exportViews(ids)
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = Object.assign(window.document.createElement('a'), { href: url, download: `${document.name.replace(/\.[^.]+$/u, '')}.views.json` })
    anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1800)
  }
  const previewBundleImport = async (input: unknown) => {
    if (!controller) return
    const preview = await controller.previewImport(input)
    if (!preview.ok) setImportMessage(preview.issues.map((issue) => issue.detail ?? issue.code).join(' · '))
    else { setImportMessage(''); setImportPreview(preview.value) }
  }
  const readImport = async (file: File) => {
    if (!controller) return
    if (file.size > CSV_POLICY.maxImportBytes) { setImportMessage('가져오기 JSON은 5 MiB 이하여야 합니다.'); return }
    try {
      const input: unknown = JSON.parse(await file.text())
      if (typeof input === 'object' && input !== null && 'kind' in input && input.kind === 'csv-view-backup') {
        const checked = validateBackup(input)
        if (!checked.ok) { setImportMessage(checked.issues.map((issue) => issue.detail ?? issue.code).join(' · ')); return }
        if (!checked.value.profiles.length) { setImportMessage('백업에 복원할 CSV 프로필이 없습니다.'); return }
        setImportMessage('')
        setBackupImport(checked.value)
        return
      }
      await previewBundleImport(input)
    } catch (error) { setImportMessage(error instanceof Error ? error.message : 'JSON 파일을 읽지 못했습니다.') }
  }
  const selectBackupProfile = (index: number) => {
    const backup = backupImport
    const selected = backup?.profiles[index]
    setBackupImport(null)
    if (!selected) return
    const bundle: CsvViewBundle = {
      kind: 'csv-view-bundle', schemaVersion: 1, exportedAt: backup?.exportedAt ?? new Date().toISOString(), appVersion: backup?.appVersion ?? __APP_VERSION__,
      source: selected.source, profile: selected.profile, viewOrder: selected.viewOrder, views: selected.views
    }
    void previewBundleImport(bundle)
  }
  const applyImport = async (decisions: import('../../domain/csv-views/model').CsvImportDecisions) => {
    if (!controller || !importPreview) return
    const result = await controller.applyImport(importPreview, decisions)
    if (result.ok) setImportPreview(null)
    else setImportMessage(result.reason === 'storage' ? result.error.message : result.reason === 'invalid' ? result.issues.map((issue) => issue.detail ?? issue.code).join(' · ') : '다른 탭에서 설정이 변경되었습니다.')
  }

  if (resolution?.status === 'choose') return <div className="csv-view-workspace"><section className="csv-link-choice" role="status"><h2>기존 CSV 설정을 연결할까요?</h2><p>같은 이름과 크기의 파일이 있어 내용을 확인한 뒤 연결해야 합니다.</p>{resolution.candidates.map((candidate) => <button className="secondary-button" type="button" key={candidate.fileId} onClick={() => { void chooseIdentity(candidate.fileId) }}>기존 보기 연결 · {candidate.basis}</button>)}<button className="secondary-button" type="button" onClick={() => { void chooseIdentity('new') }}>새 CSV 설정 만들기</button></section><div id="csv-view-panel" role="tabpanel" aria-label="CSV 보기">{defaultContent}</div></div>
  if (resolution?.status === 'recover') return <div className="csv-view-workspace"><section className="csv-link-choice" role="status"><h2>기존 CSV 설정 연결을 복구할까요?</h2><p>저장된 프로필의 원본 지문이 없습니다. 머리글이 같은 프로필을 확인한 뒤 연결하면 원본 지문을 다시 저장합니다.</p>{resolution.candidates.map((candidate) => <button className="secondary-button csv-recovery-candidate" type="button" key={candidate.fileId} onClick={() => { void chooseIdentity(candidate.fileId) }}><strong>기존 설정 연결</strong><small>{candidate.headers.map((header) => header ?? '(빈 머리글)').join(' · ')}</small></button>)}<button className="secondary-button" type="button" onClick={() => { void chooseIdentity('new') }}>새 CSV 설정 만들기</button></section><div id="csv-view-panel" role="tabpanel" aria-label="CSV 보기">{defaultContent}</div></div>
  if (starting) return 'storageKind' in document && document.storageKind === 'file-csv'
    ? <div className="csv-view-state" role="status">CSV 보기 설정을 준비하고 있습니다.</div>
    : <div className="csv-view-workspace"><div className="csv-view-state" role="status">CSV 보기 설정을 준비하고 있습니다.</div><div id="csv-view-panel" role="tabpanel" aria-label="CSV 보기">{defaultContent}</div></div>
  if (startupError) return 'storageKind' in document && document.storageKind === 'file-csv'
    ? <section className="csv-view-state" role="alert"><p>{startupError}</p><button className="secondary-button" type="button" onClick={onReconnect}>CSV 다시 열기</button></section>
    : <div className="csv-view-workspace"><section className="csv-view-state" role="alert"><p>{startupError}</p><p>기존 CSV 보기는 계속 사용할 수 있습니다.</p></section><div id="csv-view-panel" role="tabpanel" aria-label="CSV 보기">{defaultContent}</div></div>
  if (!controller || !state || !stored) return <div className="csv-view-state" role="status">CSV 보기 설정을 불러오는 중입니다.</div>
  const selection = state.selection
  const builtin = selection.kind === 'builtin'
  const selectedView = selection.kind === 'custom' ? stored.views.find((view) => view.id === selection.viewId) : null
  const defaultFileView = selection.kind === 'builtin' && 'storageKind' in document && document.storageKind === 'file-csv' && selection.mode === 'view'
    ? defaultView('csv-default', '표', stored.record.profile.columns.map((column) => column.id)) : null
  const cacheToken = 'storageKind' in document && document.storageKind === 'file-csv'
    ? `${document.id}:${document.fileId}:${document.sourceRevision}:${stored.record.profile.schemaRevision}` : null
  const selectedQuery = state.query
  const editorSample = sample ?? (document.format === 'csv' && 'model' in document ? memorySample(document) : null)
  return <div className="csv-view-workspace">
    {tabTargets.desktop && createPortal(<CsvViewTabs views={views} selection={state.selection} canAddView={state.link.status === 'linked'} placement="desktop" onSelect={select} onAddView={addView} />, tabTargets.desktop)}
    {tabTargets.mobile && createPortal(<CsvViewTabs views={views} selection={state.selection} canAddView={state.link.status === 'linked'} placement="mobile" onSelect={select} onAddView={addView} />, tabTargets.mobile)}
    {selection.kind === 'builtin' && selection.mode === 'view' && !defaultFileView && <div id="csv-view-panel" role="tabpanel" aria-label="CSV 보기">{defaultContent}</div>}
    {selection.kind === 'builtin' && selection.mode === 'source' && !defaultFileView && <div id="csv-view-panel" role="tabpanel" aria-label="CSV 원본">{defaultContent ?? <MissingCsvSource onReconnect={onReconnect} onManageViews={() => setManager(true)} />}</div>}
    {selection.kind === 'builtin' && selection.mode === 'view' && defaultFileView && <CsvViewHost view={defaultFileView} columns={stored.record.profile.columns} query={selectedQuery} onLoadMore={() => controller.loadMore()} onRetry={() => controller.retry()} onEditView={addView} onEditColumnType={setTypeColumnId} onManageViews={() => setManager(true)} onReconnect={onReconnect} onShowTable={() => select({ kind: 'builtin', mode: 'view' })} onChangeView={() => undefined} onDuplicateView={() => undefined} onDeleteView={() => undefined} onExportView={() => undefined} editable={false} fileBacked sourceAvailable={Boolean(getCsvFileSource(document.id))} controller={controller} sample={sample} cacheToken={cacheToken} tabId="csv-view-builtin-view-tab" />}
    {!builtin && selectedView && <CsvViewHost view={selectedView} columns={stored.record.profile.columns} query={state.query} onLoadMore={() => controller.loadMore()} onRetry={() => controller.retry()} onEditView={() => { setBuilderMode('edit'); setBuilder(selectedView) }} onEditColumnType={setTypeColumnId} onManageViews={() => setManager(true)} onReconnect={onReconnect} onShowTable={() => select({ kind: 'builtin', mode: 'view' })} onChangeView={(draft) => { void controller.saveView(draft) }} onDuplicateView={() => { void controller.duplicateView(selectedView.id) }} onDeleteView={() => { if (window.confirm(`“${selectedView.name}” 보기를 삭제할까요?`)) void controller.deleteView(selectedView.id) }} onExportView={() => downloadBundle([selectedView.id])} editable fileBacked={isFileBackedCsvDocument(document)} sourceAvailable={!isFileBackedCsvDocument(document) || Boolean(getCsvFileSource(document.id))} controller={controller} sample={sample} cacheToken={cacheToken} />}
    {state.link.status === 'choose' && <p className="inline-warning">보기 설정을 연결할 대상을 선택해야 새 사용자 보기를 추가할 수 있습니다.</p>}
    {state.sample.status === 'error' && <p className="inline-warning" role="status">표본 추천을 준비하지 못했습니다. 기존 설정과 기본 보기는 계속 사용할 수 있습니다.</p>}
    {builder && <CsvViewBuilder profile={stored.record.profile} sourceName={document.name} initial={builder} mode={builderMode} preview={state.query} sourceAvailable={!isFileBackedCsvDocument(document) || Boolean(getCsvFileSource(document.id))} onDraftChange={(draft) => controller.previewDraft(draft)} onApply={applyView} onCancel={() => { setBuilder(null); controller.endPreview() }} onEditColumnType={setTypeColumnId} />}
    {typeColumnId && <CsvColumnTypeEditor column={stored.record.profile.columns.find((column) => column.id === typeColumnId)!} profile={stored.record.profile} views={stored.views} sample={editorSample} onApply={(draft) => controller.applyColumns(stored.record.profile.columns.map((column) => column.id === draft.id ? draft : column))} onCancel={() => setTypeColumnId(null)} />}
    {manager && <CsvViewManager fileName={document.name} views={stored.views} activeViewId={selection.kind === 'custom' ? selection.viewId : null} onAdd={() => { setManager(false); addView() }} onClose={() => setManager(false)} onRename={async (id, name) => { const view = stored.views.find((item) => item.id === id); return view ? controller.saveView({ ...view, name, updatedAt: new Date().toISOString() }) : { ok: false, reason: 'invalid', issues: [{ path: '/viewId', code: 'required', detail: '보기를 찾을 수 없습니다.' }] } }} onDuplicate={(id) => controller.duplicateView(id)} onDelete={(id) => controller.deleteView(id)} onReorder={(order) => controller.reorderViews(order)} onExport={downloadBundle} onImport={(file) => { void readImport(file) }} />}
    {backupImport && <CsvBackupProfileDialog profiles={backupImport.profiles} onSelect={selectBackupProfile} onCancel={() => setBackupImport(null)} />}
    {importMessage && <p className="csv-view-error" role="alert">{importMessage}<button type="button" className="icon-button" aria-label="가져오기 오류 닫기" onClick={() => setImportMessage('')}>×</button></p>}
    {importPreview && <CsvImportReviewDialog preview={importPreview} columns={stored.record.profile.columns} onCancel={() => setImportPreview(null)} onApply={(decisions) => { void applyImport(decisions) }} />}
  </div>
}

function memorySample(document: Extract<ViewerDocument, { format: 'csv' }>): import('../../domain/csv-views/model').CsvSample {
  const model = document.model
  const width = Math.max(model.headers.length, ...model.rows.map((row) => row.length), 0)
  const header = model.hasHeader ? model.headers : Array.from({ length: width }, () => null)
  const records: string[][] = []
  let bytesRead = 0
  let stoppedBy: import('../../domain/csv-views/model').CsvSample['stoppedBy'] = 'eof'
  const encoder = new TextEncoder()
  for (const row of model.rows) {
    if (records.length >= CSV_POLICY.sampleRecords) { stoppedBy = 'records'; break }
    const rowBytes = row.reduce((sum, value) => sum + encoder.encode(value).byteLength, 0)
    if (bytesRead + rowBytes > CSV_POLICY.sampleBytes) { stoppedBy = 'bytes'; break }
    records.push(row)
    bytesRead += rowBytes
  }
  const reachedEof = records.length === model.rows.length
  return { header, records, firstRecordNo: 1, reachedEof, bytesRead, stoppedBy: reachedEof ? 'eof' : stoppedBy }
}

function unavailableCsvDataSource(): CsvControllerDataSource {
  return {
    async query() { throw new CsvQueryError('source-unavailable', '원본 CSV를 다시 연결하면 조회할 수 있습니다.') },
    async cancel() {},
    async dispose() {},
    async registerSnapshot() {},
    async setSchema() {}
  }
}

function MissingCsvSource({ onReconnect, onManageViews }: { onReconnect(): void; onManageViews(): void }) {
  return <section className="csv-view-state" role="status"><strong>원본 CSV 파일을 다시 연결해 주세요.</strong><p>보기 설정은 보관되어 있습니다. 원본 연결 전에는 조회와 미리보기를 사용할 수 없습니다.</p><div><button className="secondary-button" type="button" onClick={onReconnect}>CSV 다시 열기</button><button className="subtle-button" type="button" onClick={onManageViews}>보기 관리</button></div></section>
}
