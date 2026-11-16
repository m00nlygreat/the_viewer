import type {
  CsvFileIdentity, CsvFileRecord, CsvProfileChange, CsvSaveResult, CsvSessionRecord, CsvStoredProfile,
  CsvStorageError, CsvViewBackup, CsvViewDefinition, CsvViewSelectionRecord
} from '../../domain/csv-views/model'
import { nextRevisions } from '../../domain/csv-views/model'
import { validateProfile, validateViewDefinition } from '../../domain/csv-views/validate'
import { getViewerDatabase } from '../storage'

export interface CsvViewStorage {
  loadProfile(fileId: string): Promise<CsvStoredProfile | null>
  listIdentities(): Promise<{ fileId: string; identity: CsvFileIdentity; handle: FileSystemFileHandle | null }[]>
  createProfile(record: CsvFileRecord, views: CsvViewDefinition[]): Promise<CsvSaveResult>
  commit(fileId: string, expectedProfileRevision: number, change: CsvProfileChange): Promise<CsvSaveResult>
  touch(fileId: string, identity: CsvFileIdentity, handle: FileSystemFileHandle | null): Promise<void>
  deleteProfile(fileId: string): Promise<void>
  loadSelection(documentId: string): Promise<CsvViewSelectionRecord | null>
  saveSelection(record: CsvViewSelectionRecord): Promise<void>
  deleteSelection(documentId: string): Promise<void>
  exportBackup(): Promise<CsvViewBackup>
}

export class IndexedDbCsvViewStorage implements CsvViewStorage {
  async loadProfile(fileId: string): Promise<CsvStoredProfile | null> {
    const db = await getViewerDatabase()
    const tx = db.transaction(['csvFiles', 'csvViews'], 'readonly')
    const record = await tx.objectStore('csvFiles').get(fileId)
    const storedViews = await tx.objectStore('csvViews').index('by-file').getAll(fileId)
    await tx.done
    if (!record) return null
    const viewsById = new Map(storedViews.map((entry) => [entry.viewId, entry.view]))
    const order = record.profile.viewOrder.filter((id) => viewsById.has(id))
    const missing = storedViews.filter((entry) => !order.includes(entry.viewId)).map((entry) => entry.viewId)
    if (missing.length || order.length !== record.profile.viewOrder.length) {
      console.warn(`CSV 보기 순서를 복구했습니다: ${fileId}`, { removed: record.profile.viewOrder.filter((id) => !viewsById.has(id)), appended: missing })
      order.push(...missing)
    }
    const normalized = { ...record, profile: { ...record.profile, viewOrder: order } }
    const views = order.flatMap((id) => { const view = viewsById.get(id); return view ? [view] : [] })
    return { record: normalized, views }
  }

  async listIdentities(): Promise<{ fileId: string; identity: CsvFileIdentity; handle: FileSystemFileHandle | null }[]> {
    const records = await (await getViewerDatabase()).getAll('csvFiles')
    return records.map(({ fileId, identity, handle }) => ({ fileId, identity, handle }))
  }

  async createProfile(record: CsvFileRecord, views: CsvViewDefinition[]): Promise<CsvSaveResult> {
    const validation = validateStoredProfile(record.profile, views)
    if (!validation.ok) return { ok: false, reason: 'invalid', issues: validation.issues }
    try {
      const db = await getViewerDatabase()
      const tx = db.transaction(['csvFiles', 'csvViews'], 'readwrite')
      const existing = await tx.objectStore('csvFiles').get(record.fileId)
      if (existing) {
        const current = await this.readFromTransaction(tx, record.fileId)
        await tx.done
        return current ? { ok: false, reason: 'conflict', current } : { ok: false, reason: 'storage', error: storageError(new Error('저장된 파일 설정을 읽지 못했습니다.')) }
      }
      await tx.objectStore('csvFiles').add(record)
      for (const view of views) await tx.objectStore('csvViews').add({ fileId: record.fileId, viewId: view.id, view })
      await tx.done
      return { ok: true, profileRevision: record.profile.profileRevision, schemaRevision: record.profile.schemaRevision }
    } catch (error) { return { ok: false, reason: 'storage', error: storageError(error) } }
  }

  async commit(fileId: string, expectedProfileRevision: number, change: CsvProfileChange): Promise<CsvSaveResult> {
    const candidateViews = await this.composeCandidateViews(fileId, change)
    const validation = validateStoredProfile(change.profile, candidateViews)
    if (!validation.ok) return { ok: false, reason: 'invalid', issues: validation.issues }
    try {
      const db = await getViewerDatabase()
      const tx = db.transaction(['csvFiles', 'csvViews'], 'readwrite')
      const files = tx.objectStore('csvFiles')
      const currentRecord = await files.get(fileId)
      const currentViews = await tx.objectStore('csvViews').index('by-file').getAll(fileId)
      if (!currentRecord) { await tx.done; return { ok: false, reason: 'storage', error: storageError(new Error('저장된 CSV 설정을 찾을 수 없습니다.')) } }
      if (currentRecord.profile.profileRevision !== expectedProfileRevision) {
        const current = orderStored(currentRecord, currentViews)
        await tx.done
        return { ok: false, reason: 'conflict', current }
      }
      if (change.profile.fileId !== fileId || change.profile.profileRevision !== expectedProfileRevision + 1) {
        await tx.done
        return { ok: false, reason: 'invalid', issues: [{ path: '/profileRevision', code: 'type', detail: 'revision이 현재 저장본에서 정확히 1 증가해야 합니다.' }] }
      }
      for (const viewId of change.deleteViewIds) await tx.objectStore('csvViews').delete([fileId, viewId])
      for (const view of change.putViews) await tx.objectStore('csvViews').put({ fileId, viewId: view.id, view })
      await files.put({ ...currentRecord, profile: change.profile, lastOpenedAt: currentRecord.lastOpenedAt })
      await tx.done
      return { ok: true, profileRevision: change.profile.profileRevision, schemaRevision: change.profile.schemaRevision }
    } catch (error) { return { ok: false, reason: 'storage', error: storageError(error) } }
  }

  async touch(fileId: string, identity: CsvFileIdentity, handle: FileSystemFileHandle | null): Promise<void> {
    const db = await getViewerDatabase()
    const tx = db.transaction('csvFiles', 'readwrite')
    const store = tx.objectStore('csvFiles')
    const record = await store.get(fileId)
    if (record) await store.put({ ...record, identity, handle, lastOpenedAt: new Date().toISOString() })
    await tx.done
  }

  async deleteProfile(fileId: string): Promise<void> {
    const db = await getViewerDatabase()
    const tx = db.transaction(['csvFiles', 'csvViews', 'csvSessions', 'csvViewSelections'], 'readwrite')
    const views = await tx.objectStore('csvViews').index('by-file').getAll(fileId)
    const sessions = await tx.objectStore('csvSessions').getAll()
    const selections = await tx.objectStore('csvViewSelections').getAll()
    await tx.objectStore('csvFiles').delete(fileId)
    for (const view of views) await tx.objectStore('csvViews').delete([fileId, view.viewId])
    for (const session of sessions) if (session.fileId === fileId) await tx.objectStore('csvSessions').delete(session.documentId)
    for (const selection of selections) if (selection.fileId === fileId) await tx.objectStore('csvViewSelections').delete(selection.documentId)
    await tx.done
  }

  async loadSelection(documentId: string): Promise<CsvViewSelectionRecord | null> {
    return await (await getViewerDatabase()).get('csvViewSelections', documentId) ?? null
  }

  async saveSelection(record: CsvViewSelectionRecord): Promise<void> {
    await (await getViewerDatabase()).put('csvViewSelections', record)
  }

  async deleteSelection(documentId: string): Promise<void> { await (await getViewerDatabase()).delete('csvViewSelections', documentId) }

  async exportBackup(): Promise<CsvViewBackup> {
    const fileRecords = await (await getViewerDatabase()).getAll('csvFiles')
    const profiles: CsvViewBackup['profiles'] = []
    for (const record of fileRecords) {
      const stored = await this.loadProfile(record.fileId)
      if (!stored) continue
      const { viewOrder: _order, ...profile } = stored.record.profile
      profiles.push({
        source: { fileName: record.identity.name, headers: profile.columns.map((column) => column.sourceHeader), columnCount: profile.columns.length },
        profile, viewOrder: [...stored.record.profile.viewOrder], views: stored.views
      })
    }
    return { kind: 'csv-view-backup', schemaVersion: 1, exportedAt: new Date().toISOString(), appVersion: __APP_VERSION__, profiles }
  }

  private async composeCandidateViews(fileId: string, change: CsvProfileChange): Promise<CsvViewDefinition[]> {
    const existing = await (await getViewerDatabase()).getAllFromIndex('csvViews', 'by-file', fileId)
    const views = new Map(existing.map((entry) => [entry.viewId, entry.view]))
    for (const id of change.deleteViewIds) views.delete(id)
    for (const view of change.putViews) views.set(view.id, view)
    return change.profile.viewOrder.flatMap((id) => { const view = views.get(id); return view ? [view] : [] })
  }

  private async readFromTransaction(tx: import('idb').IDBPTransaction<import('../storage').ViewerDatabase, ['csvFiles', 'csvViews'], 'readwrite'>, fileId: string): Promise<CsvStoredProfile | null> {
    const record = await tx.objectStore('csvFiles').get(fileId)
    if (!record) return null
    const views = await tx.objectStore('csvViews').index('by-file').getAll(fileId)
    return orderStored(record, views)
  }
}

function orderStored(record: CsvFileRecord, storedViews: { viewId: string; view: CsvViewDefinition }[]): CsvStoredProfile {
  const byId = new Map(storedViews.map((entry) => [entry.viewId, entry.view]))
  const order = record.profile.viewOrder.filter((id) => byId.has(id))
  for (const entry of storedViews) if (!order.includes(entry.viewId)) order.push(entry.viewId)
  const normalized = { ...record, profile: { ...record.profile, viewOrder: order } }
  return { record: normalized, views: order.flatMap((id) => { const view = byId.get(id); return view ? [view] : [] }) }
}

function validateStoredProfile(profile: CsvFileRecord['profile'], views: CsvViewDefinition[]): { ok: true } | { ok: false; issues: NonNullable<Extract<CsvSaveResult, { ok: false; reason: 'invalid' }>['issues']> } {
  const profileCheck = validateProfile(profile)
  const issues = profileCheck.ok ? [] : profileCheck.issues
  const viewIds = views.map((view) => view.id)
  if (new Set(viewIds).size !== viewIds.length) issues.push({ path: '/views', code: 'duplicate-id', detail: null })
  if (profile.viewOrder.length !== views.length || profile.viewOrder.some((id) => !viewIds.includes(id))) issues.push({ path: '/viewOrder', code: 'unknown-column', detail: '뷰 순서가 저장할 뷰와 일치하지 않습니다.' })
  for (const view of views) {
    const checked = validateViewDefinition(view, profile.columns)
    if (!checked.ok) issues.push(...checked.issues.map((item) => ({ ...item, path: `/views/${view.id}${item.path}` })))
  }
  return issues.length ? { ok: false, issues } : { ok: true }
}

function storageError(error: unknown): CsvStorageError {
  const message = error instanceof Error ? error.message : 'CSV 설정을 저장하지 못했습니다.'
  const name = error instanceof DOMException ? error.name : ''
  const code: CsvStorageError['code'] = name === 'QuotaExceededError' ? 'quota' : name === 'BlockedError' ? 'blocked' : name === 'DataError' ? 'corrupt' : name === 'NotSupportedError' ? 'unavailable' : 'unknown'
  return { code, message }
}

export const csvViewStorage: CsvViewStorage = new IndexedDbCsvViewStorage()

export function createCsvFileRecord(fileId: string, profile: CsvFileRecord['profile'], identity: CsvFileIdentity, handle: FileSystemFileHandle | null): CsvFileRecord {
  const now = new Date().toISOString()
  return { fileId, profile: { ...profile, fileId, ...nextRevisions(null, { schemaChanged: true }) }, identity, handle, createdAt: now, lastOpenedAt: now }
}

export function defaultCsvSession(documentId: string, fileId: string, sourceRevision: string, name: string, mimeType: string, size: number, folderRef: CsvSessionRecord['folderRef']): CsvSessionRecord {
  const now = new Date().toISOString()
  return { documentId, fileId, sourceRevision, name, mimeType, size, mode: 'view', openedAt: now, lastEditedAt: now, folderRef }
}

export async function saveCsvSession(record: CsvSessionRecord): Promise<void> {
  await (await getViewerDatabase()).put('csvSessions', record)
}

export async function loadCsvSessions(): Promise<CsvSessionRecord[]> {
  return (await getViewerDatabase()).getAll('csvSessions').then((items) => items.sort((left, right) => Date.parse(right.lastEditedAt) - Date.parse(left.lastEditedAt)))
}

export async function removeCsvSession(documentId: string): Promise<void> {
  const db = await getViewerDatabase()
  const tx = db.transaction(['csvSessions', 'csvViewSelections'], 'readwrite')
  await tx.objectStore('csvSessions').delete(documentId)
  await tx.objectStore('csvViewSelections').delete(documentId)
  await tx.done
}

export async function updateCsvSessionMode(documentId: string, mode: 'view' | 'source'): Promise<void> {
  const db = await getViewerDatabase()
  const tx = db.transaction('csvSessions', 'readwrite')
  const store = tx.objectStore('csvSessions')
  const record = await store.get(documentId)
  if (record) await store.put({ ...record, mode, lastEditedAt: new Date().toISOString() })
  await tx.done
}
