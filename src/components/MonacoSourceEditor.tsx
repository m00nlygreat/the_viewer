import { useEffect, useRef } from 'react'
import 'monaco-editor/languages/definitions/markdown/register.js'
import '../../node_modules/monaco-editor/min/vs/editor/editor.main.css'
import type { ParseDiagnostic } from '../domain/types'
import type { Format } from '../platform/fileTypes'
import { registerCsvMonacoLanguage } from './csvMonacoLanguage'
import { configureMonacoWorker, defineViewerMonacoThemes, monaco } from './monacoRuntime'
import { registerSourceEditorDisposer } from './sourceEditorRegistry'
import { applyLineBasedTextChanges, EditorTextSyncSession, findTextChangesWithMapper, normalizeLineEndings } from './editorText'

interface Props {
  documentId: string
  format: Format
  csvDelimiter?: string
  value: string
  diagnostics: ParseDiagnostic[]
  theme: 'light' | 'dark'
  onChange: (value: string) => void
  onUndo: () => void
  onRedo: () => void
  label: string
}

interface SavedEditorState {
  position: monaco.Position | null
  selections: monaco.Selection[]
  scrollTop: number
  scrollLeft: number
}

const models = new Map<string, monaco.editor.ITextModel>()
const editorStates = new Map<string, SavedEditorState>()

function disposeSourceEditorModel(documentId: string): void {
  const model = models.get(documentId)
  if (model && !model.isDisposed()) model.dispose()
  models.delete(documentId)
  editorStates.delete(documentId)
}

function syncModelText(model: monaco.editor.ITextModel, value: string, editor: monaco.editor.IStandaloneCodeEditor | null, documentId: string): void {
  const previous = normalizeLineEndings(model.getValue())
  const next = normalizeLineEndings(value)
  if (previous === next) return
  const { changes, mapPosition } = findTextChangesWithMapper(previous, next)
  const edits = changes.map((change) => {
    const start = model.getPositionAt(change.from)
    const end = model.getPositionAt(change.to)
    return {
      range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column),
      text: change.insert,
      forceMoveMarkers: true
    }
  })
  const liveSelections = editor?.getSelections() ?? null
  const saved = liveSelections ? null : editorStates.get(documentId)
  const selectionOffsets = liveSelections?.map((selection) => ({
    anchor: model.getOffsetAt({ lineNumber: selection.selectionStartLineNumber, column: selection.selectionStartColumn }),
    head: model.getOffsetAt({ lineNumber: selection.positionLineNumber, column: selection.positionColumn })
  })) ?? (saved?.selections.length ? saved.selections.map((selection) => ({
    anchor: model.getOffsetAt({ lineNumber: selection.selectionStartLineNumber, column: selection.selectionStartColumn }),
    head: model.getOffsetAt({ lineNumber: selection.positionLineNumber, column: selection.positionColumn })
  })) : null)
  const positionOffset = saved?.position ? model.getOffsetAt(saved.position) : null
  const scrollTop = editor?.getScrollTop() ?? saved?.scrollTop
  const scrollLeft = editor?.getScrollLeft() ?? saved?.scrollLeft
  model.applyEdits(edits)
  if (selectionOffsets) {
    const selections = selectionOffsets.map(({ anchor, head }) => {
      const forward = anchor <= head
      const mappedAnchor = model.getPositionAt(mapPosition(anchor, forward ? -1 : 1))
      const mappedHead = model.getPositionAt(mapPosition(head, forward ? 1 : -1))
      return new monaco.Selection(mappedAnchor.lineNumber, mappedAnchor.column, mappedHead.lineNumber, mappedHead.column)
    })
    if (editor) editor.setSelections(selections)
    else if (saved) editorStates.set(documentId, {
      ...saved,
      position: positionOffset === null ? saved.position : model.getPositionAt(mapPosition(positionOffset)),
      selections
    })
  } else if (saved && positionOffset !== null) {
    editorStates.set(documentId, { ...saved, position: model.getPositionAt(mapPosition(positionOffset)) })
  }
  if (editor && scrollTop !== undefined) editor.setScrollTop(scrollTop)
  if (editor && scrollLeft !== undefined) editor.setScrollLeft(scrollLeft)
  if (saved) editorStates.set(documentId, { ...editorStates.get(documentId) ?? saved, scrollTop: scrollTop ?? saved.scrollTop, scrollLeft: scrollLeft ?? saved.scrollLeft })
}

export default function MonacoSourceEditor({ documentId, format, csvDelimiter = ',', value, diagnostics, theme, onChange, onUndo, onRedo, label }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const changeRef = useRef(onChange)
  const undoRef = useRef(onUndo)
  const redoRef = useRef(onRedo)
  const valueRef = useRef(value)
  const editorText = useRef(value)
  const themeRef = useRef(theme)
  const externalUpdate = useRef(false)
  const textSync = useRef(new EditorTextSyncSession())
  changeRef.current = onChange
  undoRef.current = onUndo
  redoRef.current = onRedo
  themeRef.current = theme

  useEffect(() => {
    if (!host.current) return
    const textSession = textSync.current
    configureMonacoWorker()
    const language = format === 'md' ? 'markdown' : format === 'csv' ? registerCsvMonacoLanguage(csvDelimiter) : 'plaintext'
    const uri = monaco.Uri.parse(`inmemory://the-viewer/${encodeURIComponent(documentId)}.${format}`)
    let model = models.get(documentId)
    if (!model || model.isDisposed()) {
      model = monaco.editor.createModel(valueRef.current, language, uri)
      models.set(documentId, model)
    } else {
      if (normalizeLineEndings(model.getValue()) !== normalizeLineEndings(valueRef.current)) syncModelText(model, valueRef.current, null, documentId)
      monaco.editor.setModelLanguage(model, language)
    }
    editorText.current = valueRef.current
    registerSourceEditorDisposer(documentId, () => disposeSourceEditorModel(documentId))

    defineViewerMonacoThemes()
    const editor = monaco.editor.create(host.current, {
      model,
      theme: themeRef.current === 'dark' ? 'the-viewer-dark' : 'the-viewer-light',
      ariaLabel: label,
      automaticLayout: true,
      lineNumbers: 'on',
      wordWrap: 'on',
      minimap: { enabled: false },
      contextmenu: false,
      formatOnPaste: false,
      formatOnType: false,
      scrollBeyondLastLine: false,
      fontFamily: 'var(--font-mono), Consolas, monospace',
      fontSize: 15,
      tabSize: 2,
      padding: { top: 18, bottom: 18 },
      renderLineHighlight: 'line',
      overviewRulerBorder: false,
      fixedOverflowWidgets: true
    })
    editorRef.current = editor
    const saved = editorStates.get(documentId)
    if (saved) {
      if (saved.selections.length) editor.setSelections(saved.selections)
      else if (saved.position) editor.setPosition(saved.position)
      editor.setScrollTop(saved.scrollTop)
      editor.setScrollLeft(saved.scrollLeft)
    }
    const contentListener = model.onDidChangeContent((event) => {
      if (externalUpdate.current) return
      const localText = applyLineBasedTextChanges(editorText.current, event.changes.map((change) => ({
        startLineNumber: change.range.startLineNumber,
        startColumn: change.range.startColumn,
        endLineNumber: change.range.endLineNumber,
        endColumn: change.range.endColumn,
        text: change.text
      })))
      editorText.current = localText
      const nextText = textSync.current.mergeLocal(localText)
      valueRef.current = nextText
      changeRef.current(nextText)
    })
    const commandListener = editor.onKeyDown((event) => {
      const command = event.ctrlKey || event.metaKey
      if (!command || event.altKey) return
      if (event.keyCode === monaco.KeyCode.KeyZ) {
        event.preventDefault(); event.stopPropagation()
        if (event.shiftKey) redoRef.current()
        else undoRef.current()
      } else if (event.keyCode === monaco.KeyCode.KeyY) {
        event.preventDefault(); event.stopPropagation(); redoRef.current()
      }
    })
    const compositionStartListener = editor.onDidCompositionStart(() => {
      textSync.current.beginComposition(editorText.current)
    })
    const compositionListener = editor.onDidCompositionEnd(() => {
      const finished = textSync.current.finishComposition(editorText.current)
      if (finished.pendingExternalValue !== null) {
        valueRef.current = finished.text
        if (finished.changed) changeRef.current(finished.text)
      }
      window.requestAnimationFrame(() => {
        const latest = textSync.current.pendingExternalValue
        if (latest === null) return
        const currentModel = models.get(documentId)
        if (!currentModel || currentModel.isDisposed()) return
        externalUpdate.current = true
        syncModelText(currentModel, latest, editor, documentId)
        externalUpdate.current = false
        editorText.current = latest
        valueRef.current = latest
        textSync.current.completeExternalUpdate()
      })
    })
    editor.addAction({ id: 'viewer.undo', label: '실행 취소', contextMenuGroupId: 'navigation', contextMenuOrder: 1, run: () => undoRef.current() })
    editor.addAction({ id: 'viewer.redo', label: '다시 실행', contextMenuGroupId: 'navigation', contextMenuOrder: 2, run: () => redoRef.current() })
    return () => {
      editorStates.set(documentId, {
        position: editor.getPosition(),
        selections: editor.getSelections() ?? [],
        scrollTop: editor.getScrollTop(),
        scrollLeft: editor.getScrollLeft()
      })
      editorRef.current = null
      contentListener.dispose()
      commandListener.dispose()
      compositionStartListener.dispose()
      compositionListener.dispose()
      editor.dispose()
      textSession.reset()
    }
  }, [csvDelimiter, documentId, format, label])

  useEffect(() => {
    const model = models.get(documentId)
    if (!model || model.isDisposed()) return
    const markers = diagnostics.map((diagnostic) => {
      const start = diagnostic.from !== undefined ? model.getPositionAt(diagnostic.from) : {
        lineNumber: Math.max(1, diagnostic.line ?? 1), column: Math.max(1, diagnostic.column ?? 1)
      }
      const end = diagnostic.to !== undefined ? model.getPositionAt(diagnostic.to) : start
      return {
        severity: diagnostic.severity === 'error' ? monaco.MarkerSeverity.Error : diagnostic.severity === 'warning' ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Info,
        message: diagnostic.message,
        startLineNumber: start.lineNumber, startColumn: start.column,
        endLineNumber: Math.max(start.lineNumber, end.lineNumber), endColumn: end.lineNumber === start.lineNumber ? Math.max(start.column + 1, end.column) : Math.max(1, end.column)
      }
    })
    monaco.editor.setModelMarkers(model, 'the-viewer-parser', markers)
  }, [diagnostics, documentId])

  useEffect(() => {
    if (!editorRef.current) return
    monaco.editor.setTheme(theme === 'dark' ? 'the-viewer-dark' : 'the-viewer-light')
  }, [theme])

  useEffect(() => {
    const model = models.get(documentId)
    const editor = editorRef.current
    if (!model || model.isDisposed()) {
      valueRef.current = value
      editorText.current = value
      textSync.current.completeExternalUpdate()
      return
    }
    const update = textSync.current.receiveExternal(value, model.getValue(), editor?.inComposition ?? false)
    if (update.status === 'defer') {
      valueRef.current = value
      if (update.matchesEditor && textSync.current.pendingExternalValue === null) editorText.current = value
      return
    }
    if (update.status === 'same') {
      valueRef.current = value
      editorText.current = value
      return
    }
    externalUpdate.current = true
    syncModelText(model, value, editor, documentId)
    externalUpdate.current = false
    valueRef.current = value
    editorText.current = value
    textSync.current.completeExternalUpdate()
  }, [documentId, value])

  return <div className="source-editor-host" ref={host} aria-label={label} />
}
