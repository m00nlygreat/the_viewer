import type { ViewerDocument } from '../../domain/types'
import { bytesToBase64, maxBytesForKind, SNAPSHOT_MIME } from '../relay/protocol'

export interface LegacyDocumentRecord extends Omit<ViewerDocument, 'sourceBytes'> {
  sourceBytes: ArrayBuffer
}

export interface LegacySnapshot {
  schemaVersion: 1
  document: Omit<LegacyDocumentRecord, 'sourceBytes'> & { sourceBytesBase64: string }
}

const LEGACY_DATABASE_NAME = 'the-viewer:./'

export async function readLegacyDocuments(): Promise<LegacyDocumentRecord[]> {
  const databases = await indexedDB.databases()
  if (!databases.some((database) => database.name === LEGACY_DATABASE_NAME)) return []
  const db = await openLegacyDatabase()
  try {
    if (!db.objectStoreNames.contains('documents')) return []
    const records = await requestResult<unknown[]>(db.transaction('documents', 'readonly').objectStore('documents').getAll())
    return records.filter(isLegacyDocument).sort((a, b) => b.openedAt - a.openedAt)
  } finally { db.close() }
}

export function createLegacySnapshot(document: LegacyDocumentRecord): { bytes: Uint8Array; name: string; mimeType: string } {
  const { sourceBytes, ...savedDocument } = document
  const snapshot: LegacySnapshot = {
    schemaVersion: 1,
    document: { ...savedDocument, sourceBytesBase64: bytesToBase64(new Uint8Array(sourceBytes)) }
  }
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot, (_key, value: unknown) => value instanceof Uint8Array ? Array.from(value) : value))
  if (bytes.byteLength > maxBytesForKind('workspace-snapshot', navigator.userAgent)) {
    throw new Error('기존 문서가 이 기기의 이전 작업 크기 제한을 초과합니다.')
  }
  return {
    bytes,
    name: document.name,
    mimeType: SNAPSHOT_MIME
  }
}

function openLegacyDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LEGACY_DATABASE_NAME)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('기존 작업 저장소를 열지 못했습니다.'))
    request.onupgradeneeded = () => {
      request.transaction?.abort()
      reject(new Error('기존 작업 저장소를 읽기 전용으로 열 수 없습니다.'))
    }
  })
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('기존 작업 저장소를 읽지 못했습니다.'))
  })
}

function isLegacyDocument(value: unknown): value is LegacyDocumentRecord {
  if (!isRecord(value)) return false
  const bytes = value.sourceBytes instanceof ArrayBuffer ? value.sourceBytes : null
  return bytes !== null && typeof value.id === 'string' && typeof value.name === 'string' &&
    typeof value.format === 'string' && typeof value.mimeType === 'string' &&
    Number.isFinite(value.size) && typeof value.sourceText === 'string' && typeof value.text === 'string' &&
    isRecord(value.model) && ['view', 'edit', 'source'].includes(String(value.mode)) &&
    Number.isFinite(value.revision) && typeof value.savedText === 'string' && typeof value.isDirty === 'boolean' &&
    Number.isFinite(value.openedAt) && Number.isFinite(value.lastEditedAt)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
