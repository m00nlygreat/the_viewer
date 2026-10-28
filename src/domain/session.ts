import { FORMAT_MIME, type DocumentModel, type Format, type ParseDiagnostic, type ViewerDocument } from './types'
import { parseWithWorker } from './workerClient'
import { serializeDocument } from './serialize'
import { hasFatalDiagnostics } from './formatParsing'

export interface HistoryEntry {
  model: DocumentModel
  text: string
  revision: number
  modelRevision: number
  textRevision: number
  sourceError?: string
  parseState: ViewerDocument['parseState']
  diagnostics: ParseDiagnostic[]
  isDirty: boolean
}

export interface ExportSnapshot { documentId: string; revision: number; text: string; bytes: Uint8Array; encoding: string }

export function diagnosticsFromMessages(messages: readonly string[], severity: ParseDiagnostic['severity'] = 'warning'): ParseDiagnostic[] {
  return messages.map((message) => {
    const location = message.match(/(?:행|line)\s*(\d+)(?::(\d+))?/i)
    return { severity, message, line: location ? Number(location[1]) : undefined, column: location?.[2] ? Number(location[2]) : undefined }
  })
}

export function historyEntry(document: ViewerDocument): HistoryEntry {
  return { model: document.model, text: document.text, revision: document.revision, modelRevision: document.modelRevision, textRevision: document.textRevision, sourceError: document.sourceError, parseState: document.parseState, diagnostics: document.diagnostics, isDirty: document.isDirty }
}

export function applySourceEdit(documentId: string, nextText: string, document: ViewerDocument): ViewerDocument {
  if (document.id !== documentId || document.text === nextText) return document
  return {
    ...document, text: nextText, revision: document.revision + 1, textRevision: document.revision + 1, parseState: 'pending', diagnostics: [], sourceError: undefined,
    isDirty: nextText !== document.savedText, lastEditedAt: Date.now()
  }
}

export async function applyViewCommand(documentId: string, baseRevision: number, model: DocumentModel, document: ViewerDocument): Promise<ViewerDocument> {
  if (document.id !== documentId || document.revision !== baseRevision) throw new Error('문서가 변경되어 편집 내용을 적용하지 못했습니다. 다시 시도하세요.')
  if (document.parseState !== 'ready' || document.modelRevision !== document.revision) throw new Error('원본을 먼저 수정해 구조 편집을 사용할 수 없습니다.')
  const text = await serializeDocument(document.format, model, document.text)
  return {
    ...document, model, text, revision: baseRevision + 1, modelRevision: baseRevision + 1, textRevision: baseRevision + 1,
    bom: document.format === 'csv' ? Boolean('bom' in model && model.bom) : document.bom,
    parseState: 'ready', diagnostics: [], sourceError: undefined, isDirty: text !== document.savedText, lastEditedAt: Date.now()
  }
}

export async function flushDocument(documentId: string, readDocument: () => ViewerDocument | null, readPending?: () => Promise<unknown> | undefined): Promise<ViewerDocument> {
  let pending = readPending?.()
  while (pending) {
    await pending
    const next = readPending?.()
    pending = next && next !== pending ? next : undefined
  }
  const document = readDocument()
  if (!document) throw new Error('문서를 찾을 수 없습니다.')
  if (document.id !== documentId) throw new Error('문서가 변경되어 작업을 반영하지 못했습니다.')
  if (document.textRevision !== document.revision) throw new Error('보기 편집을 원문으로 반영하지 못했습니다. 내보내기 전에 다시 시도하세요.')
  return document
}

export function undoDocument(documentId: string, document: ViewerDocument, entry: HistoryEntry): ViewerDocument {
  if (document.id !== documentId) return document
  const revision = document.revision + 1
  const modelMatches = entry.parseState === 'ready' && entry.modelRevision === entry.revision && entry.textRevision === entry.revision
  return { ...document, ...entry, revision, textRevision: revision, modelRevision: modelMatches ? revision : entry.modelRevision, parseState: modelMatches ? 'ready' : entry.parseState === 'error' ? 'error' : 'pending', lastEditedAt: Date.now() }
}

export const redoDocument = undoDocument

export function buildExportSnapshot(documentId: string, document: ViewerDocument): ExportSnapshot {
  if (document.id !== documentId) throw new Error('내보낼 문서를 찾을 수 없습니다.')
  if (document.textRevision !== document.revision) throw new Error('원문 반영이 끝나지 않아 내보낼 수 없습니다.')
  if (!document.isDirty) return { documentId, revision: document.revision, text: document.savedText, bytes: new Uint8Array(document.savedBytes.slice(0)), encoding: document.encoding }
  const text = document.text
  const payload = new TextEncoder().encode(`${document.bom ? '\uFEFF' : ''}${text}`)
  return { documentId, revision: document.revision, text, bytes: payload, encoding: 'UTF-8' }
}

export async function makeDocumentFromBytes(name: string, mimeType: string, bytes: Uint8Array, parentId?: string): Promise<ViewerDocument> {
  const limit = /Mobi|Android/i.test(globalThis.navigator?.userAgent ?? '') ? 20 * 1024 * 1024 : 50 * 1024 * 1024
  if (bytes.byteLength > limit) throw new Error(`파일 크기 제한은 ${Math.round(limit / 1024 / 1024)} MiB입니다.`)
  const parsed = await parseWithWorker(name, mimeType, bytes)
  const fatal = hasFatalDiagnostics(parsed.format, parsed.model, parsed.diagnostics)
  const inputBytes = bytes.slice().buffer as ArrayBuffer
  const bom = (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) ||
    (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)
  return {
    id: crypto.randomUUID(), name, format: parsed.format, mimeType: mimeType || FORMAT_MIME[parsed.format], size: bytes.byteLength,
    initialBytes: inputBytes.slice(0), savedBytes: inputBytes, sourceText: parsed.text, text: parsed.text, model: parsed.model,
    mode: 'view', revision: 0, modelRevision: fatal ? -1 : 0, textRevision: 0, parseState: fatal ? 'error' : 'ready',
    diagnostics: diagnosticsFromMessages(parsed.diagnostics, fatal ? 'error' : 'warning'), sourceError: fatal ? parsed.diagnostics[0] : undefined,
    encoding: parsed.encoding, bom, savedText: parsed.text, isDirty: false, openedAt: Date.now(), lastEditedAt: Date.now(), parentId
  }
}

export async function makeBlankDocument(name: string, format: Format, text: string): Promise<ViewerDocument> {
  return makeDocumentFromBytes(name, FORMAT_MIME[format], new TextEncoder().encode(text))
}
