import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { EmailModel, PersistedViewerDocument, ThemePreference, ViewerDocument } from '../domain/types'
import { normalizeEmailAttachmentBytes } from '../domain/emailAttachmentBytes'
import { isFolderPath, type FolderWorkspace } from '../domain/workspace'

interface ViewerDatabase extends DBSchema {
  documents: { key: string; value: PersistedViewerDocument; indexes: { 'by-opened': number } }
  settings: { key: string; value: { key: string; value: unknown } }
  shares: { key: string; value: { id: string; files: Array<{ name: string; type: string; bytes: ArrayBuffer }>; completed?: boolean[]; createdAt: number } }
}

let database: Promise<IDBPDatabase<ViewerDatabase>> | null = null
function getDatabase(): Promise<IDBPDatabase<ViewerDatabase>> {
  if (!database) {
    const opening = openDB<ViewerDatabase>(`the-viewer:${__APP_BASE__}`, 1, {
      upgrade(db) {
        const documents = db.createObjectStore('documents', { keyPath: 'id' })
        documents.createIndex('by-opened', 'openedAt')
        db.createObjectStore('settings', { keyPath: 'key' })
        db.createObjectStore('shares', { keyPath: 'id' })
      }
    })
    database = opening.catch((error: unknown) => { database = null; throw error })
  }
  return database
}

export async function loadDocuments(): Promise<ViewerDocument[]> {
  const db = await getDatabase()
  return (await db.getAll('documents')).map(normalizeStoredDocument).sort((a, b) => b.openedAt - a.openedAt)
}

export interface PersistedFolderWorkspace {
  schemaVersion: 1
  folder: FolderWorkspace
  rootHandle?: FileSystemDirectoryHandle
}

export async function loadWorkspace(): Promise<{ documents: ViewerDocument[]; folder: PersistedFolderWorkspace | null }> {
  const db = await getDatabase()
  const tx = db.transaction(['documents', 'settings'], 'readonly')
  const documentsRequest = tx.objectStore('documents').getAll()
  const folderRequest = tx.objectStore('settings').get('workspace')
  const [storedDocuments, storedFolder] = await Promise.all([documentsRequest, folderRequest])
  await tx.done
  const documents = storedDocuments.map(normalizeStoredDocument).sort((a, b) => b.openedAt - a.openedAt)
  return { documents, folder: normalizeStoredFolder(storedFolder?.value) }
}

export async function replaceWorkspace(next: PersistedFolderWorkspace | null, recoveryEnabled: boolean): Promise<void> {
  const db = await getDatabase()
  const tx = db.transaction(['documents', 'settings'], 'readwrite')
  const documents = tx.objectStore('documents')
  const settings = tx.objectStore('settings')
  await documents.clear()
  if (recoveryEnabled && next) await settings.put({ key: 'workspace', value: next })
  else await settings.delete('workspace')
  await tx.done
}
export async function saveDocument(document: ViewerDocument): Promise<void> { await (await getDatabase()).put('documents', serializeStoredDocument(document)) }
export async function removeDocument(id: string): Promise<void> { await (await getDatabase()).delete('documents', id) }
export async function clearDocuments(): Promise<void> {
  const db = await getDatabase()
  const tx = db.transaction(['documents', 'shares'], 'readwrite')
  await Promise.all([tx.objectStore('documents').clear(), tx.objectStore('shares').clear(), tx.done])
}
export async function clearAllData(): Promise<void> {
  const db = await getDatabase()
  const tx = db.transaction(['documents', 'settings', 'shares'], 'readwrite')
  await Promise.all([
    tx.objectStore('documents').clear(), tx.objectStore('settings').clear(), tx.objectStore('shares').clear(), tx.done
  ])
}
export async function readSetting<T>(key: string, fallback: T): Promise<T> {
  const record = await (await getDatabase()).get('settings', key)
  return (record?.value as T | undefined) ?? fallback
}
export async function writeSetting<T>(key: string, value: T): Promise<void> {
  await (await getDatabase()).put('settings', { key, value })
}

export async function clearWorkspace(): Promise<void> { await (await getDatabase()).delete('settings', 'workspace') }
export async function readShareTicket(id: string): Promise<{ files: Array<{ name: string; type: string; bytes: ArrayBuffer }>; completed: boolean[] } | null> {
  const db = await getDatabase()
  const ticket = await db.get('shares', id)
  if (!ticket || Date.now() - ticket.createdAt > 30 * 60 * 1000) { await db.delete('shares', id); return null }
  return { files: ticket.files, completed: ticket.files.map((_, index) => Boolean(ticket.completed?.[index])) }
}
export async function completeShareTicketFile(id: string, index: number): Promise<void> {
  const db = await getDatabase()
  const tx = db.transaction('shares', 'readwrite')
  const store = tx.objectStore('shares')
  const ticket = await store.get(id)
  if (ticket && index >= 0 && index < ticket.files.length) {
    const completed = ticket.files.map((_, fileIndex) => Boolean(ticket.completed?.[fileIndex]))
    completed[index] = true
    if (completed.every(Boolean)) await store.delete(id)
    else await store.put({ ...ticket, completed })
  }
  await tx.done
}
export async function loadTheme(): Promise<ThemePreference> { return readSetting('theme', 'system') }

export function serializeStoredDocument(document: ViewerDocument): PersistedViewerDocument {
  return { ...document, model: document.format === 'eml' ? normalizeEmailModel(document.model) : document.model, schemaVersion: 3 } as PersistedViewerDocument
}

export function normalizeStoredDocument(value: unknown): ViewerDocument {
  if (!isRecord(value)) throw new Error('저장된 문서 형식이 올바르지 않습니다.')
  if (value.schemaVersion !== undefined && value.schemaVersion !== 1 && value.schemaVersion !== 2 && value.schemaVersion !== 3) {
    throw new Error(`지원하지 않는 문서 저장 버전입니다: ${String(value.schemaVersion)}`)
  }
  const stored = value as unknown as ViewerDocument & { sourceBytes?: ArrayBuffer; schemaVersion?: number }
  const revision = Number.isSafeInteger(stored.revision) ? stored.revision : 0
  const legacyBytes = stored.sourceBytes instanceof ArrayBuffer ? stored.sourceBytes : new ArrayBuffer(0)
  const savedBytes = stored.savedBytes instanceof ArrayBuffer ? stored.savedBytes : legacyBytes
  const parseState = stored.parseState === 'ready' || stored.parseState === 'error' || stored.parseState === 'pending' ? stored.parseState : 'pending'
  const diagnostics = Array.isArray(stored.diagnostics) ? stored.diagnostics.filter((item) => item && typeof item.message === 'string' && ['error', 'warning', 'info'].includes(item.severity)) : []
  const mode = stored.mode === 'source' ? 'source' : 'view'
  const document = { ...stored }
  if (stored.format === 'eml') document.model = normalizeEmailModel(stored.model)
  delete document.sourceBytes
  delete document.schemaVersion
  return {
    ...document,
    mode,
    revision,
    modelRevision: Number.isSafeInteger(stored.modelRevision) ? stored.modelRevision : -1,
    textRevision: Number.isSafeInteger(stored.textRevision) ? stored.textRevision : revision,
    parseState: stored.modelRevision === undefined ? 'pending' : parseState,
    diagnostics,
    initialBytes: stored.initialBytes instanceof ArrayBuffer ? stored.initialBytes : undefined,
    savedBytes,
    sourceText: typeof stored.sourceText === 'string' ? stored.sourceText : stored.text,
    encoding: typeof stored.encoding === 'string' ? stored.encoding : 'UTF-8',
    bom: typeof stored.bom === 'boolean' ? stored.bom : Boolean(stored.format === 'csv' && stored.model && 'bom' in stored.model && stored.model.bom),
    isDirty: typeof stored.isDirty === 'boolean' ? stored.isDirty : stored.text !== stored.savedText,
    ...(isValidFolderRef(stored.folderRef) ? { folderRef: stored.folderRef } : { folderRef: undefined })
  }
}

function normalizeStoredFolder(value: unknown): PersistedFolderWorkspace | null {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.folder)) return null
  const folder = value.folder
  if (typeof folder.id !== 'string' || !folder.id || typeof folder.name !== 'string' || !folder.name || (folder.access !== 'handle' && folder.access !== 'input')) return null
  const expandedPaths = Array.isArray(folder.expandedPaths) ? folder.expandedPaths.filter((path): path is string => isFolderPath(path)) : ['']
  const activePath = folder.activePath === null || isFolderPath(folder.activePath, false) ? folder.activePath as string | null : null
  const normalized: PersistedFolderWorkspace = {
    schemaVersion: 1,
    folder: { id: folder.id, name: folder.name, access: folder.access, expandedPaths: expandedPaths.length ? [...new Set(['', ...expandedPaths])] : [''], activePath }
  }
  if (folder.access === 'handle' && isRecord(value.rootHandle) && value.rootHandle.kind === 'directory') {
    normalized.rootHandle = value.rootHandle as unknown as FileSystemDirectoryHandle
  }
  return normalized
}

function isValidFolderRef(value: unknown): value is { folderId: string; path: string } {
  return isRecord(value) && typeof value.folderId === 'string' && value.folderId.length > 0 && isFolderPath(value.path, false)
}

function normalizeEmailModel(model: unknown): EmailModel {
  if (!isRecord(model) || !Array.isArray(model.attachments)) throw new Error('저장된 이메일 모델이 올바르지 않습니다.')
  return {
    ...model,
    attachments: model.attachments.map((attachment) => {
      if (!isRecord(attachment)) throw new Error('저장된 이메일 첨부가 올바르지 않습니다.')
      return { ...attachment, content: normalizeEmailAttachmentBytes(attachment.content) }
    })
  } as EmailModel
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
