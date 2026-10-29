import { useEffect, useRef, useState } from 'react'
import * as monaco from 'monaco-editor/editor/editor.api.js'
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker'
import 'monaco-editor/languages/definitions/markdown/register.js'
import '../../node_modules/monaco-editor/min/vs/editor/editor.main.css'
import type { ParseDiagnostic } from '../domain/types'
import type { Format } from '../platform/fileTypes'
import { CodeEditor } from './CodeEditor'
import { CSV_COLUMN_DARK_COLORS, CSV_COLUMN_LIGHT_COLORS } from './csvColumnColors'
import { registerCsvMonacoLanguage } from './csvMonacoLanguage'
import { normalizeMonacoThemeColor } from './monacoThemeColors'
import { registerSourceEditorDisposer } from './sourceEditorRegistry'
import { applyLineBasedTextChanges, createTextPositionMapper, findTextChanges, mergeTextDuringComposition, normalizeLineEndings } from './editorText'

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
let workerConfigured = false

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
  const changes = findTextChanges(previous, next)
  const mapPosition = createTextPositionMapper(previous, next)
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

export default function SourceEditor({ documentId, format, csvDelimiter = ',', value, diagnostics, theme, onChange, onUndo, onRedo, label }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const changeRef = useRef(onChange)
  const undoRef = useRef(onUndo)
  const redoRef = useRef(onRedo)
  const valueRef = useRef(value)
  const editorText = useRef(value)
  const themeRef = useRef(theme)
  const externalUpdate = useRef(false)
  const pendingExternalValue = useRef<string | null>(null)
  const compositionBaseValue = useRef<string | null>(null)
  const [mobile, setMobile] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(max-width: 767px)').matches)
  changeRef.current = onChange
  undoRef.current = onUndo
  redoRef.current = onRedo
  themeRef.current = theme

  useEffect(() => {
    const query = matchMedia('(max-width: 767px)')
    const update = (event: MediaQueryListEvent) => setMobile(event.matches)
    setMobile(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    if (mobile || !host.current) return
    if (!workerConfigured) {
      ;(globalThis as typeof globalThis & { MonacoEnvironment?: { getWorker: () => Worker } }).MonacoEnvironment = { getWorker: () => new EditorWorker() }
      workerConfigured = true
    }
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

    monaco.editor.defineTheme('the-viewer-dark', {
      base: 'vs-dark', inherit: true, rules: [
        ...CSV_COLUMN_DARK_COLORS.map((color, index) => ({ token: `column${index}.csv`, foreground: color.slice(1) })),
        { token: 'separator.csv', foreground: 'A4AAF7' },
        { token: 'string.csv', foreground: 'CE9178' },
        { token: 'string.quote.csv', foreground: 'E0A33A' },
        { token: 'string.escape.csv', foreground: 'E0A33A' }
      ], colors: {
        'editor.background': cssColor('--panel', '#0B0B0C'),
        'editor.foreground': cssColor('--text', '#E6E6E8'),
        'editorLineNumber.foreground': cssColor('--text-weak', '#777980'),
        'editorLineNumber.activeForeground': cssColor('--text-strong', '#F2F2F3'),
        'editorCursor.foreground': cssColor('--accent', '#A4AAF7'),
        'editor.selectionBackground': cssColor('--selection', '#353859')
      }
    })
    monaco.editor.defineTheme('the-viewer-light', {
      base: 'vs', inherit: true, rules: [
        ...CSV_COLUMN_LIGHT_COLORS.map((color, index) => ({ token: `column${index}.csv`, foreground: color.slice(1) })),
        { token: 'separator.csv', foreground: '4A52C4' },
        { token: 'string.csv', foreground: '287A46' },
        { token: 'string.quote.csv', foreground: 'A0650F' },
        { token: 'string.escape.csv', foreground: 'A0650F' }
      ], colors: {
        'editor.background': cssColor('--panel', '#FCFCFD'),
        'editor.foreground': cssColor('--text', '#1C1D21'),
        'editorLineNumber.foreground': cssColor('--text-weak', '#8A8B91'),
        'editorLineNumber.activeForeground': cssColor('--text-strong', '#111216'),
        'editorCursor.foreground': cssColor('--accent', '#4A52C4'),
        'editor.selectionBackground': cssColor('--selection', '#D9DBF7')
      }
    })
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
      const compositionBase = compositionBaseValue.current
      const externalText = pendingExternalValue.current
      const nextText = compositionBase !== null && externalText !== null
        ? mergeTextDuringComposition(compositionBase, localText, externalText)
        : localText
      if (compositionBase !== null && externalText !== null) pendingExternalValue.current = nextText
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
      compositionBaseValue.current = editorText.current
    })
    const compositionListener = editor.onDidCompositionEnd(() => {
      const compositionBase = compositionBaseValue.current
      const pending = pendingExternalValue.current
      if (compositionBase !== null && pending !== null) {
        const merged = mergeTextDuringComposition(compositionBase, editorText.current, pending)
        valueRef.current = merged
        pendingExternalValue.current = merged
        if (merged !== pending) changeRef.current(merged)
      }
      compositionBaseValue.current = null
      window.requestAnimationFrame(() => {
        const latest = pendingExternalValue.current
        if (latest === null) return
        const currentModel = models.get(documentId)
        if (!currentModel || currentModel.isDisposed()) return
        externalUpdate.current = true
        syncModelText(currentModel, latest, editor, documentId)
        externalUpdate.current = false
        editorText.current = latest
        valueRef.current = latest
        pendingExternalValue.current = null
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
    }
  }, [csvDelimiter, documentId, format, label, mobile])

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
      pendingExternalValue.current = null
      return
    }
    if (editor?.inComposition || compositionBaseValue.current !== null) {
      if (normalizeLineEndings(model.getValue()) === normalizeLineEndings(value)) {
        valueRef.current = value
        if (pendingExternalValue.current === null) editorText.current = value
        return
      }
      pendingExternalValue.current = value
      valueRef.current = value
      return
    }
    if (normalizeLineEndings(model.getValue()) === normalizeLineEndings(value)) {
      valueRef.current = value
      editorText.current = value
      pendingExternalValue.current = null
      return
    }
    externalUpdate.current = true
    syncModelText(model, value, editor, documentId)
    externalUpdate.current = false
    valueRef.current = value
    editorText.current = value
    pendingExternalValue.current = null
  }, [documentId, value])

  return <div className="source-editor-host" ref={host} aria-label={label}>
    {mobile && <CodeEditor stateKey={`source:${documentId}`} value={value} onChange={onChange} markdownMode={format === 'md'} csvMode={format === 'csv'} csvDelimiter={csvDelimiter} label={label} onUndo={onUndo} onRedo={onRedo} />}
  </div>
}

function cssColor(name: string, fallback: string): string {
  const value = typeof document === 'undefined' ? '' : getComputedStyle(document.documentElement).getPropertyValue(name)
  return normalizeMonacoThemeColor(value, fallback)
}
