import type { DocumentModel, EditorMode, ViewerDocument } from './types'
import { applySourceEdit, applyViewCommand, documentIsDirty, historyEntry, redoDocument, undoDocument, type ExportSnapshot, type HistoryEntry } from './session'

type ChangeGroup = 'typing' | 'command'
type HistoryStack = { undo: HistoryEntry[]; redo: HistoryEntry[] }

const DEFAULT_MAX_HISTORY_ENTRIES = 80
const DEFAULT_MAX_HISTORY_BYTES = 24 * 1024 * 1024

function historyEntryBytes(entry: HistoryEntry): number {
  let bytes = entry.text.length * 2
  if ('attachments' in entry.model) for (const attachment of entry.model.attachments) bytes += attachment.content.length
  return bytes
}

export interface PreparedViewCommand {
  optimisticDocument: ViewerDocument
  serializedDocument: Promise<ViewerDocument>
}

/** Owns document editing transitions and per-document undo history without UI state. */
export class DocumentController {
  private readonly history = new Map<string, HistoryStack>()
  private readonly lastGroup = new Map<string, { group: ChangeGroup; at: number }>()

  constructor(
    private readonly maxHistoryEntries = DEFAULT_MAX_HISTORY_ENTRIES,
    private readonly maxHistoryBytes = DEFAULT_MAX_HISTORY_BYTES
  ) {}

  recordHistory(document: ViewerDocument, group: ChangeGroup = 'command', now = Date.now()): void {
    const stack = this.history.get(document.id) ?? { undo: [], redo: [] }
    const previousGroup = this.lastGroup.get(document.id)
    const coalesce = group === 'typing' && previousGroup?.group === 'typing' && now - previousGroup.at < 800
    if (!coalesce) stack.undo.push(historyEntry(document))
    stack.redo = []
    this.trimHistory(stack)
    this.history.set(document.id, stack)
    this.lastGroup.set(document.id, { group, at: now })
  }

  applySourceText(document: ViewerDocument, nextText: string, group: ChangeGroup = 'typing'): ViewerDocument {
    if (document.text === nextText) return document
    this.recordHistory(document, group)
    return applySourceEdit(document.id, nextText, document)
  }

  prepareViewCommand(document: ViewerDocument, baseRevision: number, model: DocumentModel, group: ChangeGroup = 'command', now = Date.now()): PreparedViewCommand | null {
    if (document.revision !== baseRevision) throw new Error('문서가 변경되어 편집 내용을 적용하지 못했습니다. 다시 시도하세요.')
    if (document.parseState !== 'ready' || document.modelRevision !== document.revision) throw new Error('원본을 먼저 수정해 구조 편집을 사용할 수 없습니다.')
    if (model === document.model) return null
    this.recordHistory(document, group, now)
    const revision = document.revision + 1
    return {
      optimisticDocument: {
        ...document, model, revision, modelRevision: revision, parseState: 'ready', diagnostics: [],
        sourceError: undefined, isDirty: true, lastEditedAt: now
      },
      serializedDocument: applyViewCommand(document.id, baseRevision, model, document)
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
    const stack = this.history.get(document.id) ?? { undo: [], redo: [] }
    const source = direction === 'redo' ? stack.redo : stack.undo
    const target = direction === 'redo' ? stack.undo : stack.redo
    const entry = source.pop()
    if (!entry) return null
    target.push(historyEntry(document))
    this.trimHistory(stack)
    this.history.set(document.id, stack)
    this.lastGroup.delete(document.id)
    return direction === 'redo'
      ? redoDocument(document.id, document, entry)
      : undoDocument(document.id, document, entry)
  }

  clearHistory(documentId?: string): void {
    if (documentId === undefined) {
      this.history.clear()
      this.lastGroup.clear()
      return
    }
    this.history.delete(documentId)
    this.lastGroup.delete(documentId)
  }

  private trimHistory(stack: HistoryStack): void {
    const entryCount = () => stack.undo.length + stack.redo.length
    const byteCount = () => [...stack.undo, ...stack.redo].reduce((sum, entry) => sum + historyEntryBytes(entry), 0)
    while (entryCount() > this.maxHistoryEntries || (entryCount() > 1 && byteCount() > this.maxHistoryBytes)) {
      if (stack.undo.length > 1) stack.undo.shift()
      else if (stack.redo.length > 1) stack.redo.shift()
      else if (stack.undo.length && stack.redo.length) stack.redo.shift()
      else break
    }
  }
}
