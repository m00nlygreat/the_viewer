import { FORMAT_MIME, getFormat, type DocumentModel, type ParseDiagnostic, type ViewerDocument } from './types'
import { parseWithWorker, type ParseWithWorkerOptions } from './workerClient'
import { serializeDocument } from './serialize'
import { hasFatalDiagnostics } from './parseDiagnostics'
import { assertInputFileSize } from './inputPolicy'
import { isStructuredFormat, sameStructuredNode, type StructuredModel } from './structured/model'
import { isDocumentModelForFormat, isStructuredViewerDocument, type DocumentModelPair } from './documentModel'
import { hasStructuredModelEnvelope } from './structured/validate'
import { decodeTextContent } from './textContent'
import { replaceDocumentModel } from './documentModel'
import { prepareBackgroundSerialization, serializeViewCommand } from './serializeQueue'
import type { EnvModel } from './env/model'
import { compileEnv } from './env/sourcePatch'

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
  /** Conservative in-memory estimate used by the undo budget. */
  estimatedBytes: number
  recordedAt: number
}

export interface ExportSnapshot { documentId: string; revision: number; text: string; bytes: Uint8Array; encoding: string }

export function hasByteOrderMark(bytes: ArrayBuffer): boolean {
  const view = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 3))
  return (view[0] === 0xef && view[1] === 0xbb && view[2] === 0xbf) ||
    (view[0] === 0xff && view[1] === 0xfe) || (view[0] === 0xfe && view[1] === 0xff)
}

export function documentIsDirty(document: Pick<ViewerDocument, 'text' | 'savedText' | 'bom' | 'savedBytes'> & Partial<Pick<ViewerDocument, 'model' | 'structuredDraft' | 'isDirty' | 'payloadLoaded'>>): boolean {
  if (document.payloadLoaded === false) return Boolean(document.isDirty)
  const loose = document.model && 'loose' in document.model ? document.model.loose.length : 0
  return document.text !== document.savedText || document.bom !== hasByteOrderMark(document.savedBytes) || Boolean(document.structuredDraft || loose)
}

/** A structured draft deliberately keeps the last valid source at an older revision. */
export function canPersistRecovery(document: ViewerDocument): boolean {
  return document.textRevision === document.revision || (
    (isStructuredFormat(document.format) || document.format === 'env') && document.structuredDraft === true &&
    document.parseState === 'ready' && document.modelRevision === document.revision
  )
}

export function diagnosticsFromMessages(messages: readonly string[], severity: ParseDiagnostic['severity'] = 'warning'): ParseDiagnostic[] {
  return messages.map((message) => {
    const location = message.match(/(?:행|line)\s*(\d+)(?::(\d+))?/i)
    return { severity, message, line: location ? Number(location[1]) : undefined, column: location?.[2] ? Number(location[2]) : undefined }
  })
}

function estimateHistoryValueBytes(root: unknown): number {
  const seen = new WeakSet<object>()
  const pending: unknown[] = [root]
  let bytes = 0
  while (pending.length) {
    const value = pending.pop()
    if (typeof value === 'string') { bytes += value.length * 2; continue }
    if (typeof value === 'number') { bytes += 8; continue }
    if (typeof value === 'boolean') { bytes += 4; continue }
    if (typeof value !== 'object' || value === null) continue
    if (seen.has(value)) continue
    seen.add(value)
    if (value instanceof ArrayBuffer) { bytes += value.byteLength; continue }
    if (ArrayBuffer.isView(value)) { bytes += value.byteLength; continue }
    if (Array.isArray(value)) {
      bytes += 24 + value.length * 8
      for (const child of value) pending.push(child)
      continue
    }
    bytes += 32
    for (const [key, child] of Object.entries(value)) {
      bytes += key.length * 2 + 8
      pending.push(child)
    }
  }
  return bytes
}

export function historyEntry(document: ViewerDocument, recordedAt = Date.now()): HistoryEntry {
  const entry = { model: structuredClone(document.model), text: document.text, revision: document.revision, modelRevision: document.modelRevision, textRevision: document.textRevision, sourceError: document.sourceError, parseState: document.parseState, diagnostics: structuredClone(document.diagnostics), bom: document.bom, structuredDraft: document.structuredDraft }
  return { ...entry, estimatedBytes: estimateHistoryValueBytes(entry), recordedAt }
}

export function applySourceEdit(documentId: string, nextText: string, document: ViewerDocument): ViewerDocument {
  if (document.id !== documentId || document.text === nextText) return document
  const revision = document.revision + 1
  const isMarkdown = document.format === 'md'
  const updated: ViewerDocument = {
    ...document,
    text: nextText,
    revision,
    textRevision: revision,
    modelRevision: isMarkdown ? revision : document.modelRevision,
    parseState: isMarkdown ? 'ready' : 'pending',
    diagnostics: [],
    structuredDraft: false,
    sourceError: undefined,
    lastEditedAt: Date.now()
  }
  const withModel = isMarkdown ? replaceDocumentModel(updated, { text: nextText }) : updated
  return { ...withModel, isDirty: documentIsDirty(withModel) }
}

export async function applyViewCommand(documentId: string, baseRevision: number, input: DocumentModelPair): Promise<ViewerDocument> {
  const { document, model } = input
  if (document.id !== documentId || document.revision !== baseRevision) throw new Error('문서가 변경되어 편집 내용을 적용하지 못했습니다. 다시 시도하세요.')
  if (input.format !== document.format || !isDocumentModelForFormat(input.format, model)) throw new Error('보기 편집 모델과 문서 형식이 일치하지 않습니다.')
  if (document.parseState !== 'ready' || document.modelRevision !== document.revision) throw new Error('원본을 먼저 수정해 구조 편집을 사용할 수 없습니다.')
  if (isStructuredFormat(document.format)) {
    if (!hasStructuredModelEnvelope(model)) throw new Error('구조 데이터 모델이 올바르지 않습니다.')
    return applyStructuredViewCommand(baseRevision, model, document)
  }
  if (document.format === 'env') return applyEnvViewCommand(baseRevision, model as EnvModel, document)
  const plainModel = model as Exclude<typeof model, EnvModel>
  const withModel = replaceDocumentModel(document, plainModel)
  const background = prepareBackgroundSerialization(withModel, document.text.length)
  const text = background
    ? await serializeViewCommand(document.id, baseRevision + 1, background)
    : await serializeDocument(withModel)
  const bom = 'bom' in withModel.model ? Boolean(withModel.model.bom) : document.bom
  return {
    ...withModel, text, revision: baseRevision + 1, modelRevision: baseRevision + 1, textRevision: baseRevision + 1,
    bom, parseState: 'ready', diagnostics: [], sourceError: undefined, structuredDraft: false,
    isDirty: documentIsDirty({ ...withModel, text, bom, structuredDraft: false }), lastEditedAt: Date.now()
  }
}

export function applyEnvViewCommand(baseRevision: number, model: EnvModel, document: Extract<ViewerDocument, { format: 'env' }>): ViewerDocument {
  if (document.revision !== baseRevision || document.parseState !== 'ready' || document.modelRevision !== baseRevision) throw new Error('원문을 먼저 수정해 ENV 편집을 사용할 수 없습니다.')
  const revision = baseRevision + 1
  const compiled = compileEnv(document.model, model.blocks, document.text)
  if (compiled.kind === 'draft') {
    const withModel = replaceDocumentModel(document, { ...compiled.model, blocks: model.blocks })
    return { ...withModel, revision, modelRevision: revision, textRevision: document.textRevision, structuredDraft: true, parseState: 'ready', diagnostics: diagnosticsFromMessages(compiled.issues, 'warning'), sourceError: undefined, isDirty: true, lastEditedAt: Date.now() }
  }
  const withModel = replaceDocumentModel(document, compiled.model)
  return {
    ...withModel, text: compiled.text, revision, modelRevision: revision, textRevision: revision,
    structuredDraft: false, parseState: 'ready', diagnostics: [], sourceError: undefined,
    isDirty: documentIsDirty({ ...withModel, text: compiled.text, structuredDraft: false }), lastEditedAt: Date.now()
  }
}

export async function applyStructuredViewCommand(baseRevision: number, model: StructuredModel, document: ViewerDocument): Promise<ViewerDocument> {
  if (!isStructuredViewerDocument(document)) throw new Error('구조 데이터 문서가 아닙니다.')
  const revision = baseRevision + 1
  let text = document.text
  let structuredDraft = document.structuredDraft === true
  let nextModel = model
  if (document.structuredDraft || !sameStructuredNode(document.model.root, model.root)) {
    try {
      const { patchSingleScalarSource, withoutSourceRanges } = await import('./structured/sourcePatch')
      const patched = document.structuredDraft ? null : patchSingleScalarSource(document.model, model, document.text, document.format)
      if (patched) {
        text = patched.text
        nextModel = patched.model
        structuredDraft = false
      } else {
        const { serializeStructured } = await import('./structured/output')
        text = serializeStructured(model, document.format)
        nextModel = withoutSourceRanges(model)
        structuredDraft = false
      }
    }
    catch { structuredDraft = true }
  }
  const withModel = replaceDocumentModel(document, nextModel)
  return { ...withModel, text, revision, modelRevision: revision, textRevision: structuredDraft ? document.textRevision : revision, structuredDraft, parseState: 'ready', diagnostics: [], sourceError: undefined, isDirty: documentIsDirty({ ...withModel, text, structuredDraft }), lastEditedAt: Date.now() }
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
  const { model, ...snapshot } = entry
  const restoredBase: ViewerDocument = {
    ...document, ...snapshot, revision,
    textRevision: entry.structuredDraft ? revision - 1 : revision,
    modelRevision: modelMatches ? revision : entry.modelRevision,
    parseState: modelMatches ? 'ready' : entry.parseState === 'error' ? 'error' : 'pending',
    lastEditedAt: Date.now()
  }
  const restored = replaceDocumentModel(restoredBase, model)
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

export interface DocumentBytesOptions { transferInputBytes?: boolean }

export async function makeDocumentFromBytes(name: string, mimeType: string, bytes: Uint8Array, parentId?: string, options: DocumentBytesOptions = {}): Promise<ViewerDocument> {
  assertInputFileSize(name, bytes.byteLength, globalThis.navigator?.userAgent ?? '')
  const inputBytes = bytes.slice().buffer as ArrayBuffer
  const size = bytes.byteLength
  const bom = (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) ||
    (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)
  const parseOptions: ParseWithWorkerOptions = { transferInputBytes: options.transferInputBytes }
  const parsed = await parseWithWorker(name, mimeType, bytes, undefined, undefined, parseOptions)
  const fatal = hasFatalDiagnostics(parsed.format, parsed.model, parsed.diagnostics)
  return {
    ...parsed,
    id: crypto.randomUUID(), name, mimeType: mimeType || FORMAT_MIME[parsed.format], size,
    initialBytes: inputBytes, savedBytes: inputBytes, sourceText: parsed.text, text: parsed.text,
    mode: 'view', revision: 0, modelRevision: fatal ? -1 : 0, textRevision: 0, parseState: fatal ? 'error' : 'ready',
    diagnostics: diagnosticsFromMessages(parsed.diagnostics, fatal ? 'error' : 'warning'), sourceError: fatal ? parsed.diagnostics[0] : undefined,
    encoding: parsed.encoding, bom, savedText: parsed.text, isDirty: false, openedAt: Date.now(), lastEditedAt: Date.now(), parentId
  }
}

export async function makeFileDocumentFromBytes(name: string, mimeType: string, bytes: Uint8Array, parentId?: string, options: DocumentBytesOptions = {}): Promise<ViewerDocument> {
  if (getFormat(name, mimeType)) return makeDocumentFromBytes(name, mimeType, bytes, parentId, options)
  assertInputFileSize(name, bytes.byteLength, globalThis.navigator?.userAgent ?? '')
  const decoded = decodeTextContent(bytes)
  const text = decoded?.text ?? ''
  const inputBytes = bytes.slice().buffer as ArrayBuffer
  const contentKind = decoded ? 'plain-text' as const : 'unsupported' as const
  return {
    id: crypto.randomUUID(), name, format: 'md', contentKind,
    mimeType: mimeType || (decoded ? 'text/plain' : 'application/octet-stream'), size: bytes.byteLength,
    initialBytes: inputBytes, savedBytes: inputBytes, sourceText: text, text,
    model: { text }, mode: decoded ? 'source' : 'view', revision: 0, modelRevision: 0, textRevision: 0,
    parseState: 'ready', diagnostics: [], encoding: decoded?.encoding ?? 'binary', bom: decoded?.bom ?? false,
    savedText: text, isDirty: false, openedAt: Date.now(), lastEditedAt: Date.now(), parentId
  }
}
