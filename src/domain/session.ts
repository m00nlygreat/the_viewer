import { FORMAT_MIME, getFormat, type DocumentModel, type ParseDiagnostic, type ViewerDocument } from './types'
import { parseWithWorker } from './workerClient'
import { serializeDocument } from './serialize'
import { hasFatalDiagnostics } from './parseDiagnostics'
import { assertInputFileSize } from './inputPolicy'
import { isStructuredFormat, sameStructuredNode, type StructuredModel } from './structured/model'
import { serializeStructured } from './structured/output'
import { patchSingleScalarSource, withoutSourceRanges } from './structured/sourcePatch'
import { decodeTextContent } from './textContent'

export interface HistoryEntry {
  model: DocumentModel
  text: string
  revision: number
  modelRevision: number
  textRevision: number
  sourceError?: string
  parseState: ViewerDocument['parseState']
  diagnostics: ParseDiagnostic[]
  bom: boolean
  structuredDraft?: boolean
}

export interface ExportSnapshot { documentId: string; revision: number; text: string; bytes: Uint8Array; encoding: string }

export function hasByteOrderMark(bytes: ArrayBuffer): boolean {
  const view = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 3))
  return (view[0] === 0xef && view[1] === 0xbb && view[2] === 0xbf) ||
    (view[0] === 0xff && view[1] === 0xfe) || (view[0] === 0xfe && view[1] === 0xff)
}

export function documentIsDirty(document: Pick<ViewerDocument, 'text' | 'savedText' | 'bom' | 'savedBytes'> & Partial<Pick<ViewerDocument, 'model' | 'structuredDraft'>>): boolean {
  const loose = document.model && 'loose' in document.model ? (document.model as StructuredModel).loose.length : 0
  return document.text !== document.savedText || document.bom !== hasByteOrderMark(document.savedBytes) || Boolean(document.structuredDraft || loose)
}

/** A structured draft deliberately keeps the last valid source at an older revision. */
export function canPersistRecovery(document: ViewerDocument): boolean {
  return document.textRevision === document.revision || (
    isStructuredFormat(document.format) && document.structuredDraft === true &&
    document.parseState === 'ready' && document.modelRevision === document.revision
  )
}

export function diagnosticsFromMessages(messages: readonly string[], severity: ParseDiagnostic['severity'] = 'warning'): ParseDiagnostic[] {
  return messages.map((message) => {
    const location = message.match(/(?:행|line)\s*(\d+)(?::(\d+))?/i)
    return { severity, message, line: location ? Number(location[1]) : undefined, column: location?.[2] ? Number(location[2]) : undefined }
  })
}

export function historyEntry(document: ViewerDocument): HistoryEntry {
  return { model: structuredClone(document.model), text: document.text, revision: document.revision, modelRevision: document.modelRevision, textRevision: document.textRevision, sourceError: document.sourceError, parseState: document.parseState, diagnostics: structuredClone(document.diagnostics), bom: document.bom, structuredDraft: document.structuredDraft }
}

export function applySourceEdit(documentId: string, nextText: string, document: ViewerDocument): ViewerDocument {
  if (document.id !== documentId || document.text === nextText) return document
  const revision = document.revision + 1
  const isMarkdown = document.format === 'md'
  return {
    ...document,
    text: nextText,
    model: isMarkdown ? { text: nextText } : document.model,
    revision,
    textRevision: revision,
    modelRevision: isMarkdown ? revision : document.modelRevision,
    parseState: isMarkdown ? 'ready' : 'pending',
    diagnostics: [],
    structuredDraft: false,
    sourceError: undefined,
    isDirty: documentIsDirty({ ...document, text: nextText }), lastEditedAt: Date.now()
  }
}

export async function applyViewCommand(documentId: string, baseRevision: number, model: DocumentModel, document: ViewerDocument): Promise<ViewerDocument> {
  if (document.id !== documentId || document.revision !== baseRevision) throw new Error('문서가 변경되어 편집 내용을 적용하지 못했습니다. 다시 시도하세요.')
  if (document.parseState !== 'ready' || document.modelRevision !== document.revision) throw new Error('원본을 먼저 수정해 구조 편집을 사용할 수 없습니다.')
  if (isStructuredFormat(document.format)) return applyStructuredViewCommand(baseRevision, model as StructuredModel, document)
  const text = await serializeDocument(document.format, model, document.text)
  const bom = document.format === 'csv' ? Boolean('bom' in model && model.bom) : document.bom
  return {
    ...document, model, text, revision: baseRevision + 1, modelRevision: baseRevision + 1, textRevision: baseRevision + 1,
    bom, parseState: 'ready', diagnostics: [], sourceError: undefined, structuredDraft: false,
    isDirty: documentIsDirty({ ...document, model, text, bom, structuredDraft: false }), lastEditedAt: Date.now()
  }
}

export function applyStructuredViewCommand(baseRevision: number, model: StructuredModel, document: ViewerDocument): ViewerDocument {
  if (!isStructuredFormat(document.format)) throw new Error('구조 데이터 문서가 아닙니다.')
  const revision = baseRevision + 1
  let text = document.text
  let structuredDraft = false
  let nextModel = model
  if (document.structuredDraft || !sameStructuredNode((document.model as StructuredModel).root, model.root)) {
    try {
      const serialized = serializeStructured(model, document.format)
      const patched = document.structuredDraft ? null : patchSingleScalarSource(document.model as StructuredModel, model, document.text, document.format)
      text = patched?.text ?? serialized
      nextModel = patched?.model ?? withoutSourceRanges(model)
    }
    catch { structuredDraft = true }
  }
  return { ...document, model: nextModel, text, revision, modelRevision: revision, textRevision: structuredDraft ? document.textRevision : revision, structuredDraft, parseState: 'ready', diagnostics: [], sourceError: undefined, isDirty: documentIsDirty({ ...document, model: nextModel, text, structuredDraft }), lastEditedAt: Date.now() }
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
  if (document.textRevision !== document.revision && !(document.structuredDraft && document.mode === 'source')) throw new Error('빈 자리나 출력할 수 없는 값을 해결한 뒤 내보내세요.')
  return document
}

export function undoDocument(documentId: string, document: ViewerDocument, entry: HistoryEntry): ViewerDocument {
  if (document.id !== documentId) return document
  const revision = document.revision + 1
  const modelMatches = entry.parseState === 'ready' && entry.modelRevision === entry.revision && (entry.textRevision === entry.revision || entry.structuredDraft)
  const restored: ViewerDocument = { ...document, ...entry, revision, textRevision: entry.structuredDraft ? revision - 1 : revision, modelRevision: modelMatches ? revision : entry.modelRevision, parseState: modelMatches ? 'ready' : entry.parseState === 'error' ? 'error' : 'pending', lastEditedAt: Date.now() }
  return { ...restored, isDirty: documentIsDirty(restored) }
}

export const redoDocument = undoDocument

export function buildExportSnapshot(documentId: string, document: ViewerDocument): ExportSnapshot {
  if (document.id !== documentId) throw new Error('내보낼 문서를 찾을 수 없습니다.')
  if (document.textRevision !== document.revision && !(document.structuredDraft && document.mode === 'source')) throw new Error('빈 자리나 출력할 수 없는 값을 해결한 뒤 내보내세요.')
  if (document.text === document.savedText && document.bom === hasByteOrderMark(document.savedBytes)) return { documentId, revision: document.revision, text: document.savedText, bytes: new Uint8Array(document.savedBytes.slice(0)), encoding: document.encoding }
  const text = document.text
  const payload = new TextEncoder().encode(`${document.bom ? '\uFEFF' : ''}${text}`)
  return { documentId, revision: document.revision, text, bytes: payload, encoding: 'UTF-8' }
}

export async function makeDocumentFromBytes(name: string, mimeType: string, bytes: Uint8Array, parentId?: string): Promise<ViewerDocument> {
  assertInputFileSize(name, bytes.byteLength, globalThis.navigator?.userAgent ?? '')
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

export async function makeFileDocumentFromBytes(name: string, mimeType: string, bytes: Uint8Array, parentId?: string): Promise<ViewerDocument> {
  if (getFormat(name, mimeType)) return makeDocumentFromBytes(name, mimeType, bytes, parentId)
  assertInputFileSize(name, bytes.byteLength, globalThis.navigator?.userAgent ?? '')
  const decoded = decodeTextContent(bytes)
  const text = decoded?.text ?? ''
  const inputBytes = bytes.slice().buffer as ArrayBuffer
  const contentKind = decoded ? 'plain-text' as const : 'unsupported' as const
  return {
    id: crypto.randomUUID(), name, format: 'md', contentKind,
    mimeType: mimeType || (decoded ? 'text/plain' : 'application/octet-stream'), size: bytes.byteLength,
    initialBytes: inputBytes.slice(0), savedBytes: inputBytes, sourceText: text, text,
    model: { text }, mode: decoded ? 'source' : 'view', revision: 0, modelRevision: 0, textRevision: 0,
    parseState: 'ready', diagnostics: [], encoding: decoded?.encoding ?? 'binary', bom: decoded?.bom ?? false,
    savedText: text, isDirty: false, openedAt: Date.now(), lastEditedAt: Date.now(), parentId
  }
}
