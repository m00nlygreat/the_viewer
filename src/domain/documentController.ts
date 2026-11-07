import type { EditorMode, ViewerDocument } from './types'
import { applySourceEdit, applyStructuredViewCommand, applyViewCommand, documentIsDirty, historyEntry, redoDocument, undoDocument, type ExportSnapshot, type HistoryEntry } from './session'
import { isStructuredFormat } from './structured/model'
import { isDocumentModelForFormat, replaceDocumentModel, type DocumentModelPair } from './documentModel'
import { hasStructuredModelEnvelope } from './structured/validate'
import { cancelAllSerializations, cancelDocumentSerialization } from './serializeQueue'
import { applyEnvViewCommand } from './session'
import type { EnvModel } from './env/model'

type ChangeGroup = 'typing' | 'command'
type HistoryStack = { undo: HistoryEntry[]; redo: HistoryEntry[]; bytes: number }

const DEFAULT_MAX_HISTORY_ENTRIES = 80
const DEFAULT_MAX_HISTORY_BYTES = 24 * 1024 * 1024
const DEFAULT_MAX_TOTAL_HISTORY_BYTES = 96 * 1024 * 1024

export interface PreparedViewCommand {
  optimisticDocument: ViewerDocument
  serializedDocument: Promise<ViewerDocument>
}

/** Owns document editing transitions and per-document undo history without UI state. */
export class DocumentController {
  private readonly history = new Map<string, HistoryStack>()
  private totalHistoryBytes = 0
  private readonly lastGroup = new Map<string, { group: ChangeGroup; at: number }>()
  private readonly continuousGroups = new Set<string>()

  constructor(
    private readonly maxHistoryEntries = DEFAULT_MAX_HISTORY_ENTRIES,
    private readonly maxHistoryBytes = DEFAULT_MAX_HISTORY_BYTES,
    private readonly maxTotalHistoryBytes = DEFAULT_MAX_TOTAL_HISTORY_BYTES
  ) {}

  recordHistory(document: ViewerDocument, group: ChangeGroup = 'command', now = Date.now()): void {
    const stack = this.history.get(document.id) ?? { undo: [], redo: [], bytes: 0 }
    const previousGroup = this.lastGroup.get(document.id)
    const coalesce = group === 'typing' && previousGroup?.group === 'typing' && (this.continuousGroups.has(document.id) || now - previousGroup.at < 800)
    if (!coalesce) {
      const entry = historyEntry(document, now)
      stack.undo.push(entry)
      stack.bytes += entry.estimatedBytes
      this.totalHistoryBytes += entry.estimatedBytes
    }
    for (const entry of stack.redo) {
      stack.bytes -= entry.estimatedBytes
      this.totalHistoryBytes -= entry.estimatedBytes
    }
    stack.redo = []
    this.trimHistory(stack)
    this.history.set(document.id, stack)
    this.trimGlobalHistory()
    this.lastGroup.set(document.id, { group, at: now })
  }

  beginContinuousGroup(documentId: string): void { this.lastGroup.delete(documentId); this.continuousGroups.add(documentId) }
  endContinuousGroup(documentId: string): void { this.continuousGroups.delete(documentId); this.lastGroup.delete(documentId) }

  applySourceText(document: ViewerDocument, nextText: string, group: ChangeGroup = 'typing'): ViewerDocument {
    if (document.text === nextText) return document
    this.recordHistory(document, group)
    return applySourceEdit(document.id, nextText, document)
  }

  prepareViewCommand(input: DocumentModelPair, baseRevision: number, group: ChangeGroup = 'command', now = Date.now()): PreparedViewCommand | null {
    const { document, model } = input
    if (input.format !== document.format || !isDocumentModelForFormat(input.format, model)) {
      throw new Error(isStructuredFormat(document.format) ? '구조 데이터 모델이 올바르지 않습니다.' : '보기 편집 모델과 문서 형식이 일치하지 않습니다.')
    }
    if (document.revision !== baseRevision) throw new Error('문서가 변경되어 편집 내용을 적용하지 못했습니다. 다시 시도하세요.')
    if (document.parseState !== 'ready' || document.modelRevision !== document.revision) throw new Error('원본을 먼저 수정해 구조 편집을 사용할 수 없습니다.')
    if (model === document.model) return null
    if (isStructuredFormat(document.format)) {
      if (!hasStructuredModelEnvelope(model)) throw new Error('구조 데이터 모델이 올바르지 않습니다.')
      this.recordHistory(document, group, now)
      const revision = baseRevision + 1
      const optimisticDocument = replaceDocumentModel({
        ...document, revision, modelRevision: revision, parseState: 'ready', diagnostics: [],
        sourceError: undefined, structuredDraft: true, isDirty: true, lastEditedAt: now
      }, model)
      return { optimisticDocument, serializedDocument: applyStructuredViewCommand(baseRevision, model, document) }
    }
    if (document.format === 'env') {
      const envModel = model as EnvModel
      this.recordHistory(document, group, now)
      const revision = baseRevision + 1
      const optimisticDocument = replaceDocumentModel({
        ...document, revision, modelRevision: revision, parseState: 'ready', diagnostics: [],
        sourceError: undefined, structuredDraft: true, isDirty: true, lastEditedAt: now
      }, envModel)
      return { optimisticDocument, serializedDocument: Promise.resolve(applyEnvViewCommand(baseRevision, envModel, document)) }
    }
    this.recordHistory(document, group, now)
    const revision = document.revision + 1
    const plainModel = model as Exclude<typeof model, EnvModel>
    const optimisticDocument = replaceDocumentModel({
      ...document, revision, modelRevision: revision, parseState: 'ready', diagnostics: [],
      sourceError: undefined, structuredDraft: document.structuredDraft, isDirty: true, lastEditedAt: now
    }, plainModel)
    return {
      optimisticDocument,
      serializedDocument: applyViewCommand(document.id, baseRevision, input)
    }
  }

  changeMode(document: ViewerDocument, mode: EditorMode): ViewerDocument {
    return document.mode === mode ? document : { ...document, mode }
  }

  markSaved(document: ViewerDocument, snapshot: ExportSnapshot): ViewerDocument {
    if (document.id !== snapshot.documentId) return document
    const savedText = snapshot.text
    const savedBytes = snapshot.bytes.slice().buffer as ArrayBuffer
    return {
      ...document, savedText, savedBytes, encoding: snapshot.encoding,
      isDirty: documentIsDirty({ ...document, savedText, savedBytes })
    }
  }

  restoreHistory(document: ViewerDocument, direction: 'undo' | 'redo' = 'undo'): ViewerDocument | null {
    const stack = this.history.get(document.id) ?? { undo: [], redo: [], bytes: 0 }
    const source = direction === 'redo' ? stack.redo : stack.undo
    const target = direction === 'redo' ? stack.undo : stack.redo
    const entry = source.pop()
    if (!entry) return null
    const snapshot = historyEntry(document)
    stack.bytes += snapshot.estimatedBytes - entry.estimatedBytes
    this.totalHistoryBytes += snapshot.estimatedBytes - entry.estimatedBytes
    target.push(snapshot)
    this.trimHistory(stack)
    this.history.set(document.id, stack)
    this.trimGlobalHistory()
    this.lastGroup.delete(document.id)
    return direction === 'redo'
      ? redoDocument(document.id, document, entry)
      : undoDocument(document.id, document, entry)
  }

  clearHistory(documentId?: string): void {
    if (documentId === undefined) {
      cancelAllSerializations()
      this.history.clear()
      this.totalHistoryBytes = 0
      this.lastGroup.clear()
      this.continuousGroups.clear()
      return
    }
    cancelDocumentSerialization(documentId)
    const removed = this.history.get(documentId)
    if (removed) this.totalHistoryBytes -= removed.bytes
    this.history.delete(documentId)
    this.lastGroup.delete(documentId)
    this.continuousGroups.delete(documentId)
  }

  private trimHistory(stack: HistoryStack): void {
    const entryCount = () => stack.undo.length + stack.redo.length
    while (entryCount() > this.maxHistoryEntries || (entryCount() > 1 && stack.bytes > this.maxHistoryBytes)) {
      if (stack.undo.length > 1) this.dropOldest(stack, 'undo')
      else if (stack.redo.length > 1) this.dropOldest(stack, 'redo')
      else if (stack.undo.length && stack.redo.length) this.dropOldest(stack, 'redo')
      else break
    }
  }

  private trimGlobalHistory(): void {
    while (this.totalHistoryBytes > this.maxTotalHistoryBytes) {
      let oldest: { stack: HistoryStack; direction: 'undo' | 'redo'; recordedAt: number } | null = null
      for (const stack of this.history.values()) {
        for (const direction of ['undo', 'redo'] as const) {
          const first = stack[direction][0]
          if (first && (!oldest || first.recordedAt < oldest.recordedAt)) oldest = { stack, direction, recordedAt: first.recordedAt }
        }
      }
      if (!oldest) break
      this.dropOldest(oldest.stack, oldest.direction)
    }
  }

  private dropOldest(stack: HistoryStack, direction: 'undo' | 'redo'): void {
    const dropped = stack[direction].shift()
    if (!dropped) return
    stack.bytes -= dropped.estimatedBytes
    this.totalHistoryBytes -= dropped.estimatedBytes
  }
}
