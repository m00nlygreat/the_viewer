import { FORMATS, type Format } from '../fileTypes'

export const PROTOCOL_VERSION = 1
export const PORT_NAME = 'the-viewer-relay-v1'
export const CHUNK_BYTES = 192 * 1024
export const DESKTOP_FILE_LIMIT = 50 * 1024 * 1024
export const MOBILE_FILE_LIMIT = 20 * 1024 * 1024
export const WORKSPACE_SNAPSHOT_LIMIT = 200 * 1024 * 1024
export const SNAPSHOT_MIME = 'application/vnd.the-viewer.workspace+json'
export const PWA_ORIGIN = 'https://m00nlygreat.github.io'
export const PWA_PATHS = ['/the_viewer/', '/the_viewer/index.html'] as const
export const RELAY_ERROR_CODES = [
  'INVALID_MESSAGE', 'VERSION_MISMATCH', 'INVALID_TICKET', 'EXPIRED', 'ACCESS_DENIED',
  'BUSY', 'SEQUENCE', 'SIZE_LIMIT', 'CONNECTION_CLOSED', 'TIMEOUT', 'PERMISSION', 'UNKNOWN'
] as const
export type RelayErrorCode = typeof RELAY_ERROR_CODES[number]
export type RelayKind = Format | 'workspace-snapshot'

export interface HelloMessage { type: 'HELLO'; version: number; ticketId: string }
export interface MetaMessage { type: 'META'; version: number; ticketId: string; kind: RelayKind; name: string; mimeType: string; byteLength: number; chunkCount: number }
export interface ReadMessage { type: 'READ'; ticketId: string; sequence: number }
export interface ChunkMessage { type: 'CHUNK'; ticketId: string; sequence: number; base64: string }
export interface CommitMessage { type: 'COMMIT'; ticketId: string }
export interface CommittedMessage { type: 'COMMITTED'; ticketId: string }
export interface ErrorMessage { type: 'ERROR'; ticketId: string; code: RelayErrorCode; message: string }
export type RelayMessage = HelloMessage | MetaMessage | ReadMessage | ChunkMessage | CommitMessage | CommittedMessage | ErrorMessage

export interface RelayRoute { extensionId: string; ticketId: string }

export function maxFileBytes(userAgent = ''): number {
  return /Mobi|Android|iPhone|iPad|iPod/i.test(userAgent) ? MOBILE_FILE_LIMIT : DESKTOP_FILE_LIMIT
}

export function maxBytesForKind(kind: RelayKind, userAgent = ''): number {
  return kind === 'workspace-snapshot' ? Math.min(WORKSPACE_SNAPSHOT_LIMIT, /Mobi|Android|iPhone|iPad|iPod/i.test(userAgent) ? 100 * 1024 * 1024 : WORKSPACE_SNAPSHOT_LIMIT) : maxFileBytes(userAgent)
}

export function expectedChunkCount(byteLength: number): number {
  return Math.ceil(byteLength / CHUNK_BYTES)
}

export function isSupportedProtocolVersion(value: unknown): value is typeof PROTOCOL_VERSION {
  return value === PROTOCOL_VERSION
}

export function isExtensionId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-p]{32}$/.test(value)
}

export function isTicketId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

export function parseRelayRoute(hash: string): RelayRoute | null {
  const match = /^#\/?relay\/([a-p]{32})\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.exec(hash)
  return match ? { extensionId: match[1], ticketId: match[2] } : null
}

export function isTrustedPwaSender(sender: { origin?: string; url?: string; frameId?: number; tabId?: number }, ticketTabId: number): boolean {
  if (typeof sender.origin !== 'string' || typeof sender.url !== 'string' || sender.frameId !== 0 || sender.tabId !== ticketTabId) return false
  try {
    const url = new URL(sender.url)
    return url.origin === PWA_ORIGIN && sender.origin === url.origin && PWA_PATHS.includes(url.pathname as typeof PWA_PATHS[number])
  } catch { return false }
}

export function isRelayKind(value: unknown): value is RelayKind {
  return value === 'workspace-snapshot' || (typeof value === 'string' && FORMATS.includes(value as Format))
}

export function isValidBase64(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > Math.ceil(CHUNK_BYTES / 3) * 4 || value.length % 4 !== 0) return false
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return false
  try { return bytesToBase64(base64ToBytes(value)) === value } catch { return false }
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

export function isRelayMessage(value: unknown): value is RelayMessage {
  if (!isRecord(value) || typeof value.type !== 'string' || !isTicketId(value.ticketId)) return false
  switch (value.type) {
    case 'HELLO': return Number.isInteger(value.version) && typeof value.version === 'number'
    case 'META': return typeof value.version === 'number' && Number.isInteger(value.version) && isRelayKind(value.kind) &&
      typeof value.name === 'string' && value.name.length > 0 && value.name.length <= 255 &&
      typeof value.mimeType === 'string' && value.mimeType.length <= 128 &&
      Number.isSafeInteger(value.byteLength) && typeof value.byteLength === 'number' && value.byteLength >= 0 &&
      value.byteLength <= WORKSPACE_SNAPSHOT_LIMIT && Number.isSafeInteger(value.chunkCount) && typeof value.chunkCount === 'number' &&
      value.chunkCount === expectedChunkCount(value.byteLength)
    case 'READ': return Number.isSafeInteger(value.sequence) && typeof value.sequence === 'number' && value.sequence >= 0
    case 'CHUNK': return Number.isSafeInteger(value.sequence) && typeof value.sequence === 'number' && value.sequence >= 0 && isValidBase64(value.base64)
    case 'COMMIT':
    case 'COMMITTED': return true
    case 'ERROR': return typeof value.code === 'string' && RELAY_ERROR_CODES.includes(value.code as RelayErrorCode) && typeof value.message === 'string' && value.message.length <= 500
    default: return false
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
