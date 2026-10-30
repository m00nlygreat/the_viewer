import { FORMATS, type Format, type PickedFile } from '../fileTypes'
import type { CalendarModel, ContactModel, CsvModel, EmailModel, ViewerDocument } from '../../domain/types'
import { normalizeEmailAttachmentBytes } from '../../domain/emailAttachmentBytes'
import {
  base64ToBytes, CHUNK_BYTES, expectedChunkCount, isExtensionId, isRelayMessage,
  isSupportedProtocolVersion, maxBytesForKind, PORT_NAME, PROTOCOL_VERSION, type ErrorMessage, type MetaMessage,
  type RelayErrorCode, type RelayMessage
} from '../relay/protocol'

export { parseRelayRoute } from '../relay/protocol'
export type { RelayRoute } from '../relay/protocol'

export interface RelayProgress { receivedBytes: number; totalBytes: number }
export interface ReceivedExtensionFile { ticketId: string; kind: MetaMessage['kind']; file: PickedFile }
export interface ReceiveOptions { extensionId: string; ticketId: string; onProgress?: (progress: RelayProgress) => void }
const TIMEOUT_MS = 30_000
const receiving = new Map<string, Promise<ReceivedExtensionFile>>()
const connectedPorts = new Map<string, chrome.runtime.Port>()
const portFailures = new WeakMap<chrome.runtime.Port, RelayTransferError>()

export class RelayTransferError extends Error {
  constructor(readonly code: RelayErrorCode, message: string) {
    super(message)
    this.name = 'RelayTransferError'
  }
}

export function restoreLegacySnapshot(bytes: Uint8Array): ViewerDocument {
  if (bytes.byteLength > maxBytesForKind('workspace-snapshot', navigator.userAgent)) {
    throw new RelayTransferError('SIZE_LIMIT', '이전 작업 데이터가 이 기기의 크기 제한을 초과합니다.')
  }
  let value: unknown
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
  catch { throw new RelayTransferError('INVALID_MESSAGE', '기존 작업 데이터가 올바른 JSON 문서가 아닙니다.') }
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.document)) {
    throw new RelayTransferError('INVALID_MESSAGE', '지원하지 않는 기존 작업 스키마입니다.')
  }
  const saved = value.document
  const format = saved.format
  const sourceBytesBase64 = saved.sourceBytesBase64
  if (!isFormat(format) || typeof sourceBytesBase64 !== 'string' || !isLegacyDocumentShape(saved, format)) {
    throw new RelayTransferError('INVALID_MESSAGE', '기존 문서의 필수 필드나 편집 데이터가 올바르지 않습니다.')
  }
  const sourceBytes = decodeLegacyBase64(sourceBytesBase64, maxBytesForKind(format, navigator.userAgent))
  if (saved.size !== sourceBytes.byteLength) throw new RelayTransferError('INVALID_MESSAGE', '기존 문서의 원본 크기가 일치하지 않습니다.')
  const restored: Record<string, unknown> = { ...saved }
  delete restored.sourceBytesBase64
  const document = { ...restored }
  delete document.sourceBytes
  if (format === 'eml' && isRecord(document.model) && Array.isArray((document.model as { attachments?: unknown }).attachments)) {
    const model = document.model as unknown as EmailModel
    document.model = {
      ...model,
      attachments: model.attachments.map((attachment) => ({ ...attachment, content: normalizeEmailAttachmentBytes(attachment.content) }))
    }
  }
  const savedBytes = sourceBytes.buffer.slice(sourceBytes.byteOffset, sourceBytes.byteOffset + sourceBytes.byteLength)
  return {
    ...document,
    mode: saved.mode === 'edit' ? 'view' : saved.mode,
    modelRevision: -1,
    textRevision: Number.isSafeInteger(saved.revision) ? saved.revision : 0,
    parseState: 'pending',
    diagnostics: [],
    encoding: format === 'csv' && isRecord(saved.model) && typeof saved.model.encoding === 'string' ? saved.model.encoding : 'UTF-8',
    bom: format === 'csv' && isRecord(saved.model) && typeof saved.model.bom === 'boolean' ? saved.model.bom : false,
    savedBytes
  } as unknown as ViewerDocument
}

export function receiveExtensionFile(options: ReceiveOptions): Promise<ReceivedExtensionFile> {
  const existing = receiving.get(options.ticketId)
  if (existing) return existing
  const task = receiveOnce(options).finally(() => receiving.delete(options.ticketId))
  receiving.set(options.ticketId, task)
  return task
}

async function receiveOnce({ extensionId, ticketId, onProgress }: ReceiveOptions): Promise<ReceivedExtensionFile> {
  if (!isExtensionId(extensionId)) throw new RelayTransferError('INVALID_TICKET', 'Chrome 확장 ID 형식이 올바르지 않습니다.')
  const port = connect(extensionId)
  try {
    const response = await request(port, { type: 'HELLO', version: PROTOCOL_VERSION, ticketId }, ['META', 'COMMITTED'], ticketId)
    if (response.type === 'COMMITTED') throw new RelayTransferError('INVALID_TICKET', '이 전달 티켓은 이미 완료되었습니다.')
    if (response.type !== 'META' || !isSupportedProtocolVersion(response.version)) {
      throw new RelayTransferError('VERSION_MISMATCH', 'PWA와 Chrome 확장의 전달 프로토콜이 다릅니다. 확장을 업데이트한 뒤 다시 시도하세요.')
    }
    const maxBytes = maxBytesForKind(response.kind, navigator.userAgent)
    if (response.byteLength > maxBytes) throw new RelayTransferError('SIZE_LIMIT', '전달 파일이 이 기기의 크기 제한을 초과합니다.')
    if (response.chunkCount !== expectedChunkCount(response.byteLength)) throw new RelayTransferError('INVALID_MESSAGE', '파일 조각 수가 올바르지 않습니다.')

    const bytes = new Uint8Array(response.byteLength)
    let receivedBytes = 0
    onProgress?.({ receivedBytes, totalBytes: response.byteLength })
    for (let sequence = 0; sequence < response.chunkCount; sequence += 1) {
      const chunk = await request(port, { type: 'READ', ticketId, sequence }, ['CHUNK'], ticketId)
      if (chunk.type !== 'CHUNK' || chunk.sequence !== sequence) throw new RelayTransferError('SEQUENCE', '받은 파일 조각의 순번이 맞지 않습니다.')
      const decoded = base64ToBytes(chunk.base64)
      const expectedBytes = Math.min(CHUNK_BYTES, response.byteLength - receivedBytes)
      if (decoded.byteLength !== expectedBytes) throw new RelayTransferError('SIZE_LIMIT', '받은 파일 조각의 크기가 올바르지 않습니다.')
      bytes.set(decoded, receivedBytes)
      receivedBytes += decoded.byteLength
      onProgress?.({ receivedBytes, totalBytes: response.byteLength })
    }
    if (receivedBytes !== response.byteLength || bytes.byteLength !== response.byteLength) {
      throw new RelayTransferError('SIZE_LIMIT', '복원한 파일 크기가 원본과 다릅니다.')
    }
    connectedPorts.set(ticketId, port)
    return { ticketId, kind: response.kind, file: { name: response.name, type: response.mimeType, bytes } }
  } catch (error) {
    try { port.disconnect() } catch { /* Already closed. */ }
    throw normalizeError(error)
  }
}

export async function commitExtensionFile({ extensionId, ticketId }: Pick<ReceiveOptions, 'extensionId' | 'ticketId'>): Promise<void> {
  if (!isExtensionId(extensionId)) throw new RelayTransferError('INVALID_TICKET', 'Chrome 확장 ID 형식이 올바르지 않습니다.')
  let port = connectedPorts.get(ticketId)
  if (port) {
    try {
      await request(port, { type: 'COMMIT', ticketId }, ['COMMITTED'], ticketId)
      finishPort(ticketId, port)
      return
    } catch (error) {
      finishPort(ticketId, port)
      const normalized = normalizeError(error)
      if (!['CONNECTION_CLOSED', 'TIMEOUT', 'INVALID_TICKET'].includes(normalized.code)) throw normalized
    }
  }

  let lastError: RelayTransferError | null = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    port = connect(extensionId)
    try {
      const handshake = await request(port, { type: 'HELLO', version: PROTOCOL_VERSION, ticketId }, ['META', 'COMMITTED'], ticketId)
      if (handshake.type !== 'COMMITTED') await request(port, { type: 'COMMIT', ticketId }, ['COMMITTED'], ticketId)
      finishPort(ticketId, port)
      return
    } catch (error) {
      finishPort(ticketId, port)
      lastError = normalizeError(error)
      if (!['CONNECTION_CLOSED', 'TIMEOUT', 'INVALID_TICKET'].includes(lastError.code) || attempt === 1) throw lastError
      await new Promise((resolve) => window.setTimeout(resolve, 120))
    }
  }
  throw lastError ?? new RelayTransferError('CONNECTION_CLOSED', '확장과 연결되지 않았습니다. 다시 시도하세요.')
}

function finishPort(ticketId: string, port: chrome.runtime.Port): void {
  if (connectedPorts.get(ticketId) === port) connectedPorts.delete(ticketId)
  try { port.disconnect() } catch { /* Already closed. */ }
}

function connect(extensionId: string): chrome.runtime.Port {
  if (typeof chrome === 'undefined' || !chrome.runtime || typeof chrome.runtime.connect !== 'function') {
    throw new RelayTransferError('PERMISSION', 'Chrome 확장 연결을 사용할 수 없습니다. Chrome에서 PWA를 열고 확장 권한을 확인하세요.')
  }
  try {
    const port = chrome.runtime.connect(extensionId, { name: PORT_NAME })
    port.onDisconnect.addListener(() => {
      const message = chrome.runtime.lastError?.message
      if (message) portFailures.set(port, new RelayTransferError('PERMISSION', 'Chrome 확장에 연결하지 못했습니다. 확장이 설치·실행 중인지 확인하세요.'))
      for (const [ticketId, active] of connectedPorts) if (active === port) connectedPorts.delete(ticketId)
    })
    return port
  } catch {
    throw new RelayTransferError('PERMISSION', 'Chrome 확장에 연결하지 못했습니다. 확장 설치와 PWA 주소를 확인하세요.')
  }
}

function request(
  port: chrome.runtime.Port,
  outgoing: RelayMessage,
  expectedTypes: readonly ('META' | 'CHUNK' | 'COMMITTED')[],
  ticketId: string
): Promise<MetaMessage | Extract<RelayMessage, { type: 'CHUNK' | 'COMMITTED' }>> {
  return new Promise((resolve, reject) => {
    const finish = (callback: () => void) => {
      window.clearTimeout(timer)
      port.onMessage.removeListener(onMessage)
      port.onDisconnect.removeListener(onDisconnect)
      callback()
    }
    const onMessage = (raw: unknown) => {
      if (!isRelayMessage(raw) || raw.ticketId !== ticketId) {
        finish(() => reject(new RelayTransferError('INVALID_MESSAGE', '확장에서 올바르지 않은 응답을 받았습니다.')))
        return
      }
      if (raw.type === 'ERROR') {
        finish(() => reject(fromRelayError(raw)))
        return
      }
      if (!expectedTypes.includes(raw.type as 'META' | 'CHUNK' | 'COMMITTED')) return
      finish(() => resolve(raw as MetaMessage | Extract<RelayMessage, { type: 'CHUNK' | 'COMMITTED' }>))
    }
    const onDisconnect = () => finish(() => reject(portFailures.get(port) ?? new RelayTransferError('CONNECTION_CLOSED', '파일 전달 도중 연결이 끊겼습니다.')))
    const timer = window.setTimeout(() => finish(() => reject(new RelayTransferError('TIMEOUT', '확장 응답 시간이 초과되었습니다. 다시 시도하세요.'))), TIMEOUT_MS)
    port.onMessage.addListener(onMessage)
    port.onDisconnect.addListener(onDisconnect)
    try { port.postMessage(outgoing) }
    catch { finish(() => reject(new RelayTransferError('CONNECTION_CLOSED', '확장에 메시지를 보내지 못했습니다.'))) }
  })
}

function fromRelayError(error: ErrorMessage): RelayTransferError {
  const defaultMessage: Partial<Record<RelayErrorCode, string>> = {
    EXPIRED: '전달 티켓이 만료되었습니다. 확장에서 파일을 다시 여세요.',
    ACCESS_DENIED: '전달 요청을 확인할 수 없습니다. 허용된 The Viewer PWA에서 다시 시도하세요.',
    VERSION_MISMATCH: 'PWA와 Chrome 확장의 프로토콜 버전이 다릅니다. 두 쪽을 최신 버전으로 업데이트하세요.',
    INVALID_TICKET: '전달 티켓을 찾을 수 없습니다. 확장에서 파일을 다시 여세요.',
    PERMISSION: '확장 연결 권한이 없습니다. 확장 설치와 PWA 주소를 확인하세요.'
  }
  return new RelayTransferError(error.code, defaultMessage[error.code] ?? error.message)
}

function normalizeError(error: unknown): RelayTransferError {
  if (error instanceof RelayTransferError) return error
  if (error instanceof Error) return new RelayTransferError('UNKNOWN', error.message)
  return new RelayTransferError('UNKNOWN', '파일을 전달하지 못했습니다.')
}

function decodeLegacyBase64(value: string, maximumBytes: number): Uint8Array {
  if (value.length % 4 !== 0 || value.length > Math.ceil(maximumBytes / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new RelayTransferError('SIZE_LIMIT', '기존 문서의 원본 데이터가 너무 크거나 Base64 형식이 올바르지 않습니다.')
  }
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  const byteLength = value.length * 3 / 4 - padding
  if (byteLength > maximumBytes) throw new RelayTransferError('SIZE_LIMIT', '기존 문서가 이 기기의 파일 크기 제한을 초과합니다.')
  const result = new Uint8Array(byteLength)
  let offset = 0
  const segmentLength = 256 * 1024
  for (let index = 0; index < value.length; index += segmentLength) {
    const end = Math.min(index + segmentLength, value.length)
    const decoded = base64ToBytes(value.slice(index, end))
    result.set(decoded, offset)
    offset += decoded.byteLength
  }
  if (offset !== byteLength) throw new RelayTransferError('INVALID_MESSAGE', '기존 문서의 원본 바이트를 복원하지 못했습니다.')
  return result
}

function isLegacyDocumentShape(value: Record<string, unknown>, format: Format): boolean {
  return typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 128 &&
    typeof value.name === 'string' && value.name.length > 0 && value.name.length <= 255 &&
    typeof value.mimeType === 'string' && value.mimeType.length <= 128 &&
    Number.isSafeInteger(value.size) && typeof value.size === 'number' && value.size >= 0 &&
    typeof value.sourceText === 'string' && typeof value.text === 'string' &&
    isDocumentModel(format, value.model) &&
    ['view', 'edit', 'source'].includes(String(value.mode)) &&
    Number.isSafeInteger(value.revision) && typeof value.revision === 'number' && value.revision >= 0 &&
    typeof value.savedText === 'string' && typeof value.isDirty === 'boolean' &&
    Number.isFinite(value.openedAt) && Number.isFinite(value.lastEditedAt) &&
    (value.sourceError === undefined || typeof value.sourceError === 'string') &&
    (value.parentId === undefined || typeof value.parentId === 'string')
}

function isDocumentModel(format: Format, value: unknown): value is ViewerDocument['model'] {
  if (!isRecord(value)) return false
  if (format === 'csv') {
    const model = value as unknown as CsvModel
    return isStringArray(model.headers) && isStringArray(model.headerRow) && isStringRows(model.rows) &&
      typeof model.hasHeader === 'boolean' && typeof model.delimiter === 'string' &&
      (model.newline === '\n' || model.newline === '\r\n') && typeof model.bom === 'boolean' &&
      typeof model.encoding === 'string' && isStringArray(model.errors)
  }
  if (format === 'eml') {
    const model = value as unknown as EmailModel
    return typeof model.subject === 'string' && isAddressArray(model.from) && isAddressArray(model.to) && isAddressArray(model.cc) &&
      typeof model.date === 'string' && typeof model.text === 'string' && typeof model.html === 'string' &&
      Array.isArray(model.attachments) && model.attachments.every((item) => isRecord(item) && typeof item.filename === 'string' &&
        typeof item.mimeType === 'string' && Array.isArray(item.content) && item.content.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) &&
      Array.isArray(model.headers) && model.headers.every((item) => isRecord(item) && typeof item.key === 'string' && typeof item.value === 'string')
  }
  if (format === 'ics') {
    const model = value as unknown as CalendarModel
    return Array.isArray(model.events) && model.events.every((event) => isRecord(event) && typeof event.uid === 'string' &&
      typeof event.summary === 'string' && typeof event.location === 'string' && typeof event.description === 'string' &&
      typeof event.start === 'string' && typeof event.end === 'string' && typeof event.allDay === 'boolean') &&
      Array.isArray(model.jcal) && isStringArray(model.diagnostics)
  }
  if (format === 'vcf') {
    const model = value as unknown as ContactModel
    return Array.isArray(model.cards) && model.cards.every((card) => isRecord(card) && typeof card.uid === 'string' &&
      typeof card.version === 'string' && ['2.1', '3.0', '4.0', 'unknown'].includes(card.version) && Array.isArray(card.properties) &&
      card.properties.every((property) => isRecord(property) && typeof property.name === 'string' && typeof property.params === 'string' && typeof property.value === 'string' && typeof property.raw === 'string') &&
      typeof card.fullName === 'string' && typeof card.givenName === 'string' && typeof card.familyName === 'string' &&
      typeof card.organization === 'string' && typeof card.title === 'string' && typeof card.notes === 'string' &&
      Array.isArray(card.phones) && card.phones.every((item) => isRecord(item) && typeof item.value === 'string' && typeof item.label === 'string') &&
      Array.isArray(card.emails) && card.emails.every((item) => isRecord(item) && typeof item.value === 'string' && typeof item.label === 'string') &&
      isStringArray(card.urls)) && isStringArray(model.diagnostics)
  }
  return isRecord(value) && typeof value.text === 'string'
}

function isFormat(value: unknown): value is Format {
  return typeof value === 'string' && FORMATS.includes(value as Format)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isStringRows(value: unknown): value is string[][] {
  return Array.isArray(value) && value.every(isStringArray)
}

function isAddressArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => isRecord(item) && typeof item.address === 'string' && (item.name === undefined || typeof item.name === 'string'))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
