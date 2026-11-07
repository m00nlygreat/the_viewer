import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { FORMATS, type CalendarModel, type ContactModel, type CsvModel, type DocumentModel, type DocumentModelByFormat, type EmailAttachment, type EmailModel, type Format, type PersistedViewerDocument, type PersistedViewerDocumentBlobs, type PersistedViewerDocumentPayload, type PersistedViewerDocumentSummary, type ThemePreference, type ViewerDocument } from '../domain/types'
import { normalizeEmailAttachmentBytes } from '../domain/emailAttachmentBytes'
import { isFolderPath, type FolderWorkspace } from '../domain/workspace'
import { isStructuredModel } from '../domain/structured/validate'
import { emptyEnvModel } from '../domain/env/sourcePatch'
import { isEnvModel } from '../domain/env/validate'
import { parseDiff } from '../domain/diff/parse'
import { isDiffModel } from '../domain/diff/validate'

interface ViewerDatabase extends DBSchema {
  documents: { key: string; value: PersistedViewerDocument | PersistedViewerDocumentSummary; indexes: { 'by-opened': number } }
  documentPayloads: { key: string; value: PersistedViewerDocumentPayload }
  documentBlobs: { key: string; value: PersistedViewerDocumentBlobs }
  settings: { key: string; value: { key: string; value: unknown } }
  shares: { key: string; value: ShareTicketRecord | SharePayloadRecord | LegacyShareTicketRecord }
}

interface ShareTicketFile { name: string; type: string }
interface ShareTicketRecord { id: string; kind: 'ticket'; files: ShareTicketFile[]; completed: boolean[]; createdAt: number }
interface SharePayloadRecord { id: string; kind: 'payload'; ticketId: string; index: number; bytes: ArrayBuffer }
interface LegacyShareTicketRecord { id: string; kind?: undefined; files: Array<ShareTicketFile & { bytes: ArrayBuffer }>; completed?: boolean[]; createdAt: number }
export interface ShareTicketFilePayload extends ShareTicketFile { bytes: ArrayBuffer }

let database: Promise<IDBPDatabase<ViewerDatabase>> | null = null
interface DocumentBlobSignature { savedBytes: ArrayBuffer; initialBytes?: ArrayBuffer; attachments: Uint8Array[] }
const documentBlobSignatures = new Map<string, DocumentBlobSignature>()
function getDatabase(): Promise<IDBPDatabase<ViewerDatabase>> {
  if (!database) {
    const opening = openDB<ViewerDatabase>(`the-viewer:${__APP_BASE__}`, 3, {
      upgrade(db, oldVersion, _newVersion, transaction) {
        if (!db.objectStoreNames.contains('documents')) {
          const documents = db.createObjectStore('documents', { keyPath: 'id' })
          documents.createIndex('by-opened', 'openedAt')
        }
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' })
        if (!db.objectStoreNames.contains('shares')) db.createObjectStore('shares', { keyPath: 'id' })
        const payloads = db.objectStoreNames.contains('documentPayloads')
          ? transaction.objectStore('documentPayloads')
          : db.createObjectStore('documentPayloads', { keyPath: 'id' })
        const blobs = db.objectStoreNames.contains('documentBlobs')
          ? transaction.objectStore('documentBlobs')
          : db.createObjectStore('documentBlobs', { keyPath: 'id' })
        if (oldVersion < 2) {
          void (async () => {
            let cursor = await transaction.objectStore('documents').openCursor()
            while (cursor) {
              const split = splitStoredDocumentRecord(cursor.value)
              if (split) {
                await cursor.update(split.summary)
                await payloads.put(split.payload)
                await blobs.put(split.blobs)
              }
              cursor = await cursor.continue()
            }
          })().catch(() => transaction.abort())
        } else if (oldVersion < 3) {
          void (async () => {
            let cursor = await payloads.openCursor()
            while (cursor) {
              const split = splitStoredPayloadRecord(cursor.value)
              if (split) {
                await cursor.update(split.payload)
                await blobs.put(split.blobs)
              }
              cursor = await cursor.continue()
            }
          })().catch(() => transaction.abort())
        }
      },
      blocking() {
        const active = database
        database = null
        void active?.then((db) => db.close()).catch(() => undefined)
      }
    })
    database = opening.catch((error: unknown) => { database = null; throw error })
  }
  return database
}

export interface PersistedFolderWorkspace {
  schemaVersion: 1
  folder: FolderWorkspace
  rootHandle?: FileSystemDirectoryHandle
}

export interface WorkspaceLoadIssue { id: string | null; message: string }

export async function loadWorkspace(): Promise<{ documents: ViewerDocument[]; folder: PersistedFolderWorkspace | null; issues?: WorkspaceLoadIssue[] }> {
  const db = await getDatabase()
  const tx = db.transaction(['documents', 'settings'], 'readonly')
  const documentsRequest = tx.objectStore('documents').getAll()
  const folderRequest = tx.objectStore('settings').get('workspace')
  const modesRequest = tx.objectStore('settings').get('documentModes')
  const [storedDocuments, storedFolder, storedModes] = await Promise.all([documentsRequest, folderRequest, modesRequest])
  await tx.done
  const modes = isRecord(storedModes?.value) ? storedModes.value : {}
  const documents: ViewerDocument[] = []
  const issues: WorkspaceLoadIssue[] = []
  for (const value of storedDocuments) {
    try {
      const document = normalizeStoredSummary(value)
      const mode = modes[document.id]
      if (mode === 'view' || mode === 'source') document.mode = mode
      documents.push(document)
    }
    catch (error) { issues.push({ id: isRecord(value) && typeof value.id === 'string' ? value.id : null, message: error instanceof Error ? error.message : '저장된 문서를 해석하지 못했습니다.' }) }
  }
  documents.sort((a, b) => b.openedAt - a.openedAt)
  const folder = normalizeStoredFolder(storedFolder?.value)
  return issues.length ? { documents, folder, issues } : { documents, folder }
}

export async function retryLoadWorkspaceDocument(id: string): Promise<ViewerDocument> {
  return readWorkspaceDocumentPayload(id)
}

export async function readRawWorkspaceDocument(id: string): Promise<unknown> {
  const db = await getDatabase()
  const [value, payload, blobs] = await Promise.all([db.get('documents', id), db.get('documentPayloads', id), db.get('documentBlobs', id)])
  if (!value) throw new Error('저장된 문서를 찾을 수 없습니다.')
  if (!isRecord(value) || value.payloadRef !== true) return value
  return { metadata: value, payload: payload ?? null, blobs: blobs ?? null }
}

export async function readWorkspaceDocumentPayload(id: string): Promise<ViewerDocument> {
  const db = await getDatabase()
  const [value, payload, blobs] = await Promise.all([db.get('documents', id), db.get('documentPayloads', id), db.get('documentBlobs', id)])
  if (!value) throw new Error('저장된 문서를 찾을 수 없습니다.')
  if (isRecord(value) && value.payloadRef === true) {
    if (!payload || !blobs) throw new Error('저장된 문서 본문을 찾을 수 없습니다.')
    const summary = omitObjectKeys(value, ['payloadRef'])
    const document = { ...normalizeStoredDocument({ ...summary, ...payload, ...blobs, model: restoreStoredPayloadModel(payload.format, payload.model, blobs) }), payloadLoaded: true }
    rememberDocumentBlobSignature(document)
    return document
  }
  const document = { ...normalizeStoredDocument(value), payloadLoaded: true }
  rememberDocumentBlobSignature(document)
  return document
}

export async function saveDocumentMode(id: string, mode: 'view' | 'source'): Promise<void> {
  const db = await getDatabase()
  const tx = db.transaction('settings', 'readwrite')
  const store = tx.objectStore('settings')
  const record = await store.get('documentModes')
  const modes = isRecord(record?.value) ? { ...record.value } : {}
  modes[id] = mode
  await store.put({ key: 'documentModes', value: modes })
  await tx.done
}

export async function replaceWorkspace(next: PersistedFolderWorkspace | null, recoveryEnabled: boolean): Promise<void> {
  const db = await getDatabase()
  const tx = db.transaction(['documents', 'documentPayloads', 'documentBlobs', 'settings'], 'readwrite')
  const documents = tx.objectStore('documents')
  const payloads = tx.objectStore('documentPayloads')
  const blobs = tx.objectStore('documentBlobs')
  const settings = tx.objectStore('settings')
  await documents.clear()
  await payloads.clear()
  await blobs.clear()
  documentBlobSignatures.clear()
  await settings.delete('documentModes')
  if (recoveryEnabled && next) await settings.put({ key: 'workspace', value: next })
  else await settings.delete('workspace')
  await tx.done
}
export async function saveDocument(document: ViewerDocument): Promise<void> {
  if (document.payloadLoaded === false) throw new Error('본문이 복원되지 않은 문서는 저장할 수 없습니다.')
  const db = await getDatabase()
  const tx = db.transaction(['documents', 'documentPayloads', 'documentBlobs'], 'readwrite')
  const blobs = tx.objectStore('documentBlobs')
  const signature = documentBlobSignature(document)
  const previousSignature = documentBlobSignatures.get(document.id)
  const hasSameBytes = previousSignature ? sameDocumentBlobSignature(previousSignature, signature) : false
  const storedBlobs = hasSameBytes ? undefined : await blobs.get(document.id)
  const shouldWriteBlobs = !hasSameBytes && !documentBlobsMatch(storedBlobs, document)
  await Promise.all([
    tx.objectStore('documents').put(serializeStoredDocumentSummary(document)),
    tx.objectStore('documentPayloads').put(serializeStoredDocumentPayload(document)),
    ...(shouldWriteBlobs ? [blobs.put(serializeStoredDocumentBlobs(document))] : []),
    tx.done
  ])
  documentBlobSignatures.set(document.id, signature)
}
export async function removeDocument(id: string): Promise<void> {
  const db = await getDatabase()
  const tx = db.transaction(['documents', 'documentPayloads', 'documentBlobs', 'settings'], 'readwrite')
  const documents = tx.objectStore('documents')
  const payloads = tx.objectStore('documentPayloads')
  const blobs = tx.objectStore('documentBlobs')
  const settings = tx.objectStore('settings')
  const record = await settings.get('documentModes')
  const modes = isRecord(record?.value) ? { ...record.value } : {}
  delete modes[id]
  documentBlobSignatures.delete(id)
  await Promise.all([documents.delete(id), payloads.delete(id), blobs.delete(id), settings.put({ key: 'documentModes', value: modes }), tx.done])
}
export async function clearDocuments(): Promise<void> {
  const db = await getDatabase()
  const tx = db.transaction(['documents', 'documentPayloads', 'documentBlobs', 'shares', 'settings'], 'readwrite')
  const settings = tx.objectStore('settings')
  documentBlobSignatures.clear()
  await Promise.all([tx.objectStore('documents').clear(), tx.objectStore('documentPayloads').clear(), tx.objectStore('documentBlobs').clear(), tx.objectStore('shares').clear(), settings.delete('documentModes'), tx.done])
}
export async function clearAllData(): Promise<void> {
  const db = await getDatabase()
  const tx = db.transaction(['documents', 'documentPayloads', 'documentBlobs', 'settings', 'shares'], 'readwrite')
  documentBlobSignatures.clear()
  await Promise.all([
    tx.objectStore('documents').clear(), tx.objectStore('documentPayloads').clear(), tx.objectStore('documentBlobs').clear(), tx.objectStore('settings').clear(), tx.objectStore('shares').clear(), tx.done
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
export async function readShareTicket(id: string): Promise<{ files: ShareTicketFile[]; completed: boolean[] } | null> {
  const db = await getDatabase()
  const ticket = await db.get('shares', id)
  if (!ticket || ticket.kind === 'payload' || Date.now() - ticket.createdAt > 30 * 60 * 1000) {
    if (ticket && ticket.kind !== 'payload') await discardShareTicket(id, ticket.files.length)
    return null
  }
  return { files: ticket.files.map(({ name, type }) => ({ name, type })), completed: ticket.files.map((_, index) => Boolean(ticket.completed?.[index])) }
}
export async function readShareTicketFile(id: string, index: number): Promise<ShareTicketFilePayload | null> {
  const db = await getDatabase()
  const ticket = await db.get('shares', id)
  if (!ticket || ticket.kind === 'payload') return null
  if (Date.now() - ticket.createdAt > 30 * 60 * 1000) { await discardShareTicket(id, ticket.files.length); return null }
  if (index < 0 || index >= ticket.files.length || ticket.completed?.[index]) return null
  if (ticket.kind === 'ticket') {
    const file = ticket.files[index]
    if (!file) return null
    const payload = await db.get('shares', sharePayloadKey(id, index))
    return payload?.kind === 'payload' && payload.ticketId === id && payload.index === index
      ? { name: file.name, type: file.type, bytes: payload.bytes }
      : null
  }
  const file = ticket.files[index]
  return file ? { name: file.name, type: file.type, bytes: file.bytes } : null
}
export async function completeShareTicketFile(id: string, index: number): Promise<void> {
  const db = await getDatabase()
  const tx = db.transaction('shares', 'readwrite')
  const store = tx.objectStore('shares')
  const ticket = await store.get(id)
  if (ticket && ticket.kind !== 'payload' && index >= 0 && index < ticket.files.length) {
    const completed = ticket.files.map((_, fileIndex) => Boolean(ticket.completed?.[fileIndex]))
    completed[index] = true
    if (ticket.kind === 'ticket') await store.delete(sharePayloadKey(id, index))
    if (completed.every(Boolean)) {
      for (let fileIndex = 0; fileIndex < ticket.files.length; fileIndex += 1) await store.delete(sharePayloadKey(id, fileIndex))
      await store.delete(id)
    }
    else await store.put({ ...ticket, completed })
  }
  await tx.done
}

async function discardShareTicket(id: string, fileCount: number): Promise<void> {
  const db = await getDatabase()
  const tx = db.transaction('shares', 'readwrite')
  const store = tx.objectStore('shares')
  await store.delete(id)
  for (let index = 0; index < fileCount; index += 1) await store.delete(sharePayloadKey(id, index))
  await tx.done
}

function sharePayloadKey(id: string, index: number): string { return `${id}:file:${index}` }
export async function loadTheme(): Promise<ThemePreference> { return readSetting('theme', 'system') }

export function serializeStoredDocument(document: ViewerDocument): PersistedViewerDocument {
  const stored = omitObjectKeys(document, ['payloadLoaded'])
  return { ...stored, model: document.format === 'eml' ? normalizeEmailModel(document.model) : document.model, schemaVersion: 3 } as PersistedViewerDocument
}

export function serializeStoredDocumentSummary(document: ViewerDocument): PersistedViewerDocumentSummary {
  const summary = omitObjectKeys(document, ['model', 'text', 'sourceText', 'savedText', 'savedBytes', 'initialBytes', 'sourceBytes', 'payloadLoaded'])
  return { ...summary, schemaVersion: 3, payloadRef: true } as PersistedViewerDocumentSummary
}

export function serializeStoredDocumentPayload(document: ViewerDocument): PersistedViewerDocumentPayload {
  const model = document.format === 'eml' ? stripEmailAttachmentContents(normalizeEmailModel(document.model)).model : document.model
  return {
    id: document.id,
    format: document.format,
    model,
    text: document.text,
    sourceText: document.sourceText,
    savedText: document.savedText
  } as PersistedViewerDocumentPayload
}

export function serializeStoredDocumentBlobs(document: ViewerDocument): PersistedViewerDocumentBlobs {
  const attachments = document.format === 'eml' ? normalizeEmailModel(document.model).attachments.map((attachment) => exactArrayBuffer(attachment.content)) : []
  return {
    id: document.id,
    savedBytes: document.savedBytes,
    ...(document.initialBytes ? { initialBytes: document.initialBytes } : {}),
    ...(attachments.length ? { emailAttachmentContents: attachments } : {})
  }
}

export function splitStoredDocumentRecord(value: unknown): { summary: PersistedViewerDocumentSummary; payload: PersistedViewerDocumentPayload; blobs: PersistedViewerDocumentBlobs } | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id || typeof value.format !== 'string' || !FORMATS.includes(value.format as Format) || !isRecord(value.model) || typeof value.text !== 'string') return null
  if (value.schemaVersion !== undefined && value.schemaVersion !== 1 && value.schemaVersion !== 2 && value.schemaVersion !== 3) return null
  try {
    const metadata = omitObjectKeys(value, ['model', 'text', 'sourceText', 'savedText', 'savedBytes', 'initialBytes', 'sourceBytes', 'payloadLoaded'])
    const document = normalizeStoredDocument(value)
    return {
      summary: { ...metadata, schemaVersion: 3, payloadRef: true } as PersistedViewerDocumentSummary,
      payload: serializeStoredDocumentPayload(document),
      blobs: serializeStoredDocumentBlobs({ ...document, savedBytes: document.savedBytes instanceof ArrayBuffer ? document.savedBytes : new ArrayBuffer(0) })
    }
  } catch { return null }
}

export function splitStoredPayloadRecord(value: unknown): { payload: PersistedViewerDocumentPayload; blobs: PersistedViewerDocumentBlobs } | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id || typeof value.format !== 'string' || !FORMATS.includes(value.format as Format) || !isRecord(value.model) || typeof value.text !== 'string') return null
  try {
    const { savedBytes, initialBytes, sourceBytes, ...rest } = value
    const legacyBytes = sourceBytes instanceof ArrayBuffer ? sourceBytes : undefined
    const document = normalizeStoredDocument({
      ...rest,
      savedBytes: savedBytes instanceof ArrayBuffer ? savedBytes : legacyBytes ?? new ArrayBuffer(0),
      ...(initialBytes instanceof ArrayBuffer ? { initialBytes } : {})
    })
    return {
      payload: serializeStoredDocumentPayload(document),
      blobs: serializeStoredDocumentBlobs(document)
    }
  } catch { return null }
}

function stripEmailAttachmentContents(model: EmailModel): { model: Omit<EmailModel, 'attachments'> & { attachments: Array<Omit<EmailAttachment, 'content'>> }; contents: ArrayBuffer[] } {
  const contents = model.attachments.map((attachment) => exactArrayBuffer(attachment.content))
  const attachments = model.attachments.map((attachment) => omitObjectKeys(attachment, ['content']) as Omit<EmailAttachment, 'content'>)
  return { model: { ...model, attachments }, contents }
}

function omitObjectKeys(value: object, omitted: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) if (!omitted.includes(key)) result[key] = item
  return result
}

function restoreStoredPayloadModel(format: unknown, model: unknown, blobs: unknown): DocumentModel {
  if (format !== 'eml') return model as DocumentModel
  if (!isRecord(model) || !Array.isArray(model.attachments) || !isRecord(blobs)) {
    throw new Error('저장된 이메일 첨부 본문이 올바르지 않습니다.')
  }
  const contents = Array.isArray(blobs.emailAttachmentContents) ? blobs.emailAttachmentContents : []
  if (contents.length !== model.attachments.length) throw new Error('저장된 이메일 첨부 본문이 올바르지 않습니다.')
  return {
    ...model,
    attachments: model.attachments.map((attachment, index) => {
      if (!isRecord(attachment)) throw new Error('저장된 이메일 첨부 정보가 올바르지 않습니다.')
      const content = contents[index]
      if (!(content instanceof ArrayBuffer)) throw new Error('저장된 이메일 첨부 바이트 형식이 올바르지 않습니다.')
      return { ...attachment, content: new Uint8Array(content.slice(0)) }
    })
  } as EmailModel
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function documentBlobSignature(document: ViewerDocument): DocumentBlobSignature {
  return { savedBytes: document.savedBytes, initialBytes: document.initialBytes, attachments: document.format === 'eml' ? document.model.attachments.map((attachment) => attachment.content) : [] }
}

function rememberDocumentBlobSignature(document: ViewerDocument): void { documentBlobSignatures.set(document.id, documentBlobSignature(document)) }

function sameDocumentBlobSignature(left: DocumentBlobSignature, right: DocumentBlobSignature): boolean {
  return left.savedBytes === right.savedBytes && left.initialBytes === right.initialBytes && left.attachments.length === right.attachments.length && left.attachments.every((bytes, index) => bytes === right.attachments[index])
}

function documentBlobsMatch(value: unknown, document: ViewerDocument): boolean {
  if (!isRecord(value) || !(value.savedBytes instanceof ArrayBuffer) || !sameBytes(value.savedBytes, document.savedBytes)) return false
  const storedInitial = value.initialBytes instanceof ArrayBuffer ? value.initialBytes : undefined
  if ((storedInitial === undefined) !== (document.initialBytes === undefined) || (storedInitial && document.initialBytes && !sameBytes(storedInitial, document.initialBytes))) return false
  const attachmentBytes = document.format === 'eml' ? document.model.attachments.map((attachment) => attachment.content) : []
  const storedAttachments = Array.isArray(value.emailAttachmentContents) ? value.emailAttachmentContents : []
  return storedAttachments.length === attachmentBytes.length && storedAttachments.every((bytes, index) => bytes instanceof ArrayBuffer && sameBytes(bytes, attachmentBytes[index]!))
}

function sameBytes(left: ArrayBuffer, right: ArrayBuffer | Uint8Array): boolean {
  const a = new Uint8Array(left)
  const b = right instanceof Uint8Array ? right : new Uint8Array(right)
  if (a.byteLength !== b.byteLength) return false
  for (let index = 0; index < a.byteLength; index += 1) if (a[index] !== b[index]) return false
  return true
}

function normalizeStoredSummary(value: unknown): ViewerDocument {
  if (!isRecord(value) || value.payloadRef !== true) return { ...normalizeStoredDocument(value), payloadLoaded: false }
  if (typeof value.format !== 'string' || !FORMATS.includes(value.format as Format)) throw new Error('저장된 문서 형식이 올바르지 않습니다.')
  const format = value.format as Format
  const metadata = { ...value }
  delete metadata.payloadRef
  const document = normalizeStoredDocument({
    ...metadata,
    model: emptyModelForFormat(format),
    text: '', sourceText: '', savedText: '', savedBytes: new ArrayBuffer(0),
    modelRevision: -1, parseState: 'pending'
  })
  return { ...document, payloadLoaded: false }
}

function emptyModelForFormat(format: Format): DocumentModel {
  switch (format) {
    case 'csv': return { headers: [], headerRow: [], rows: [], hasHeader: true, delimiter: ',', newline: '\n', bom: false, encoding: 'UTF-8', errors: [] }
    case 'eml': return { subject: '', from: [], to: [], cc: [], date: '', text: '', html: '', attachments: [], headers: [] }
    case 'md': return { text: '' }
    case 'ics': return { events: [], jcal: ['vcalendar', [], []], diagnostics: [] }
    case 'vcf': return { cards: [], diagnostics: [] }
    case 'json': case 'yaml': case 'toml': return { root: null, loose: [] }
    case 'diff': return parseDiff('')
    case 'env': return emptyEnvModel()
  }
}

export function normalizeStoredDocument(value: unknown): ViewerDocument {
  if (!isRecord(value)) throw new Error('저장된 문서 형식이 올바르지 않습니다.')
  if (value.schemaVersion !== undefined && value.schemaVersion !== 1 && value.schemaVersion !== 2 && value.schemaVersion !== 3) {
    throw new Error(`지원하지 않는 문서 저장 버전입니다: ${String(value.schemaVersion)}`)
  }
  const stored = value as unknown as ViewerDocument & { sourceBytes?: ArrayBuffer; schemaVersion?: number }
  if (typeof stored.format !== 'string' || !FORMATS.includes(stored.format as Format)) throw new Error('저장된 문서 형식이 올바르지 않습니다.')
  const format = stored.format as Format
  if (stored.contentKind !== undefined && (format !== 'md' || (stored.contentKind !== 'plain-text' && stored.contentKind !== 'unsupported'))) throw new Error('저장된 파일 종류가 올바르지 않습니다.')
  const model = normalizeStoredModel(format, stored.model)
  const revision = Number.isSafeInteger(stored.revision) ? stored.revision : 0
  const legacyBytes = stored.sourceBytes instanceof ArrayBuffer ? stored.sourceBytes : new ArrayBuffer(0)
  const savedBytes = stored.savedBytes instanceof ArrayBuffer ? stored.savedBytes : legacyBytes
  const parseState = stored.parseState === 'ready' || stored.parseState === 'error' || stored.parseState === 'pending' ? stored.parseState : 'pending'
  const diagnostics = Array.isArray(stored.diagnostics) ? stored.diagnostics.filter((item) => item && typeof item.message === 'string' && ['error', 'warning', 'info'].includes(item.severity)) : []
  const mode = stored.mode === 'source' ? 'source' : 'view'
  const document = { ...stored, format, model }
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
  } as ViewerDocument
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
  if (!isRecord(model) || typeof model.subject !== 'string' || typeof model.date !== 'string' || typeof model.text !== 'string' || typeof model.html !== 'string' || !isAddressArray(model.from) || !isAddressArray(model.to) || !isAddressArray(model.cc) || !Array.isArray(model.attachments) || !model.attachments.every(isEmailAttachment) || !Array.isArray(model.headers) || !model.headers.every(isEmailHeader)) throw new Error('저장된 이메일 모델이 올바르지 않습니다.')
  return {
    ...model,
    attachments: model.attachments.map((attachment) => {
      return { ...attachment, content: normalizeEmailAttachmentBytes(attachment.content) }
    })
  } as EmailModel
}

function normalizeStoredModel(format: Format, model: unknown): DocumentModel {
  switch (format) {
    case 'csv':
      if (!isCsvModel(model)) throw new Error('저장된 CSV 모델이 올바르지 않습니다.')
      return model as unknown as CsvModel
    case 'eml': return normalizeEmailModel(model)
    case 'md':
      if (!isRecord(model) || typeof model.text !== 'string') throw new Error('저장된 텍스트 모델이 올바르지 않습니다.')
      return model as DocumentModelByFormat['md']
    case 'ics':
      if (!isCalendarModel(model)) throw new Error('저장된 일정 모델이 올바르지 않습니다.')
      return model as unknown as CalendarModel
    case 'vcf':
      if (!isContactModel(model)) throw new Error('저장된 연락처 모델이 올바르지 않습니다.')
      return model as unknown as ContactModel
    case 'json': case 'yaml': case 'toml':
      if (!isStructuredModel(model)) throw new Error('저장된 구조 데이터 모델이 올바르지 않습니다.')
      return model
    case 'diff':
      if (!isDiffModel(model)) throw new Error('저장된 diff 모델이 올바르지 않습니다.')
      return model
    case 'env':
      if (!isEnvModel(model)) throw new Error('저장된 ENV 모델이 올바르지 않습니다.')
      return model
  }
}

function isCsvModel(value: unknown): value is CsvModel {
  return isRecord(value) && isStringArray(value.headers) && isStringArray(value.headerRow) && Array.isArray(value.rows) && value.rows.every(isStringArray) &&
    typeof value.hasHeader === 'boolean' && typeof value.delimiter === 'string' && value.delimiter.length > 0 &&
    (value.newline === '\n' || value.newline === '\r\n') && typeof value.bom === 'boolean' && typeof value.encoding === 'string' && isStringArray(value.errors)
}

function isEmailAttachment(value: unknown): boolean {
  return isRecord(value) && typeof value.filename === 'string' && typeof value.mimeType === 'string' && isAttachmentBytes(value.content) &&
    isOptionalString(value.contentId) && isOptionalString(value.disposition)
}

function isEmailHeader(value: unknown): boolean {
  return isRecord(value) && typeof value.key === 'string' && typeof value.value === 'string' && isOptionalString(value.originalKey)
}

function isAttachmentBytes(value: unknown): boolean {
  return value instanceof Uint8Array || value instanceof ArrayBuffer ||
    (Array.isArray(value) && value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255))
}

function isCalendarModel(value: unknown): value is CalendarModel {
  return isRecord(value) && Array.isArray(value.events) && value.events.every(isCalendarEvent) && Array.isArray(value.jcal) && isJsonValue(value.jcal) && isStringArray(value.diagnostics)
}

function isCalendarEvent(value: unknown): boolean {
  return isRecord(value) && typeof value.uid === 'string' && typeof value.summary === 'string' && typeof value.location === 'string' &&
    typeof value.description === 'string' && typeof value.start === 'string' && typeof value.end === 'string' && typeof value.allDay === 'boolean' &&
    isOptionalString(value.timezone) && isOptionalString(value.recurrence) && isOptionalString(value.originalStart) && isOptionalString(value.originalEnd) &&
    (value.originalAllDay === undefined || typeof value.originalAllDay === 'boolean') && isOptionalString(value.originalRecurrence) &&
    isOptionalString(value.originalTimezone) && (value.componentIndex === undefined || (Number.isSafeInteger(value.componentIndex) && Number(value.componentIndex) >= 0))
}

function isContactModel(value: unknown): value is ContactModel {
  return isRecord(value) && Array.isArray(value.cards) && value.cards.every(isContactCard) && isStringArray(value.diagnostics)
}

function isContactCard(value: unknown): boolean {
  return isRecord(value) && typeof value.recordId === 'string' && typeof value.uid === 'string' &&
    ['2.1', '3.0', '4.0', 'unknown'].includes(String(value.version)) && Array.isArray(value.properties) && value.properties.every(isVCardProperty) &&
    typeof value.fullName === 'string' && typeof value.givenName === 'string' && typeof value.familyName === 'string' &&
    typeof value.organization === 'string' && typeof value.title === 'string' && typeof value.notes === 'string' &&
    isContactValueArray(value.phones) && isContactValueArray(value.emails) && isStringArray(value.urls)
}

function isVCardProperty(value: unknown): boolean {
  return isRecord(value) && typeof value.name === 'string' && typeof value.params === 'string' && typeof value.value === 'string' &&
    typeof value.raw === 'string' && isOptionalString(value.group)
}

function isContactValueArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => isRecord(item) && typeof item.value === 'string' && typeof item.label === 'string')
}

function isJsonValue(value: unknown): boolean {
  const stack: unknown[] = [value]
  const seen = new WeakSet<object>()
  while (stack.length) {
    const current = stack.pop()
    if (current === null || typeof current === 'string' || typeof current === 'boolean') continue
    if (typeof current === 'number' && Number.isFinite(current)) continue
    if (Array.isArray(current)) {
      if (seen.has(current)) return false
      seen.add(current)
      for (const item of current) stack.push(item)
      continue
    }
    if (isRecord(current)) {
      if (seen.has(current)) return false
      const prototype = Object.getPrototypeOf(current) as object | null
      if (prototype !== Object.prototype && prototype !== null) return false
      seen.add(current)
      for (const item of Object.values(current)) stack.push(item)
      continue
    }
    return false
  }
  return true
}

function isStringArray(value: unknown): value is string[] { return Array.isArray(value) && value.every((item) => typeof item === 'string') }
function isOptionalString(value: unknown): boolean { return value === undefined || typeof value === 'string' }

function isAddressArray(value: unknown): value is EmailModel['from'] {
  return Array.isArray(value) && value.every((address) => isRecord(address) && typeof address.address === 'string' && (address.name === undefined || typeof address.name === 'string'))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
