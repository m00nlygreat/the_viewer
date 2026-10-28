import { useEffect, useRef, useState } from 'react'
import * as monaco from 'monaco-editor/editor/editor.api.js'
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker'
import 'monaco-editor/languages/definitions/markdown/register.js'
import '../../node_modules/monaco-editor/min/vs/editor/editor.main.css'
import type { ParseDiagnostic } from '../domain/types'
import type { Format } from '../platform/fileTypes'
import { CodeEditor } from './CodeEditor'
import { registerSourceEditorDisposer } from './sourceEditorRegistry'

interface Props {
  documentId: string
  format: Format
  value: string
  diagnostics: ParseDiagnostic[]
  theme: 'light' | 'dark'
  onChange: (value: string) => void
  onUndo: () => void
  onRedo: () => void
  label: string
}

interface SavedEditorState { position: monaco.Position | null; selection: monaco.Selection | null; scrollTop: number }

const models = new Map<string, monaco.editor.ITextModel>()
const editorStates = new Map<string, SavedEditorState>()
let workerConfigured = false

function disposeSourceEditorModel(documentId: string): void {
  const model = models.get(documentId)
  if (model && !model.isDisposed()) model.dispose()
  models.delete(documentId)
  editorStates.delete(documentId)
}

export default function SourceEditor({ documentId, format, value, diagnostics, theme, onChange, onUndo, onRedo, label }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const changeRef = useRef(onChange)
  const undoRef = useRef(onUndo)
  const redoRef = useRef(onRedo)
  const valueRef = useRef(value)
  const themeRef = useRef(theme)
  const externalUpdate = useRef(false)
  const [mobile, setMobile] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(max-width: 767px)').matches)
  changeRef.current = onChange
  undoRef.current = onUndo
  redoRef.current = onRedo
  valueRef.current = value
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
    const uri = monaco.Uri.parse(`inmemory://the-viewer/${encodeURIComponent(documentId)}.${format}`)
    let model = models.get(documentId)
    if (!model || model.isDisposed()) {
      model = monaco.editor.createModel(valueRef.current, format === 'md' ? 'markdown' : 'plaintext', uri)
      models.set(documentId, model)
    } else {
      if (model.getValue() !== valueRef.current) model.setValue(valueRef.current)
      monaco.editor.setModelLanguage(model, format === 'md' ? 'markdown' : 'plaintext')
    }
    registerSourceEditorDisposer(documentId, () => disposeSourceEditorModel(documentId))

    monaco.editor.defineTheme('the-viewer-dark', {
      base: 'vs-dark', inherit: true, rules: [], colors: {
        'editor.background': cssColor('--panel', '#0B0B0C'),
        'editor.foreground': cssColor('--text', '#E6E6E8'),
        'editorLineNumber.foreground': cssColor('--text-weak', '#777980'),
        'editorLineNumber.activeForeground': cssColor('--text-strong', '#F2F2F3'),
        'editorCursor.foreground': cssColor('--accent', '#A4AAF7'),
        'editor.selectionBackground': cssColor('--selection', '#353859')
      }
    })
    monaco.editor.defineTheme('the-viewer-light', {
      base: 'vs', inherit: true, rules: [], colors: {
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
      if (saved.position) editor.setPosition(saved.position)
      if (saved.selection) editor.setSelection(saved.selection)
      editor.setScrollTop(saved.scrollTop)
    }
    const contentListener = model.onDidChangeContent(() => {
      if (!externalUpdate.current) changeRef.current(model.getValue())
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
    editor.addAction({ id: 'viewer.undo', label: '실행 취소', contextMenuGroupId: 'navigation', contextMenuOrder: 1, run: () => undoRef.current() })
    editor.addAction({ id: 'viewer.redo', label: '다시 실행', contextMenuGroupId: 'navigation', contextMenuOrder: 2, run: () => redoRef.current() })
    return () => {
      editorStates.set(documentId, { position: editor.getPosition(), selection: editor.getSelection(), scrollTop: editor.getScrollTop() })
      editorRef.current = null
      contentListener.dispose()
      commandListener.dispose()
      editor.dispose()
    }
  }, [documentId, format, label, mobile])

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
    if (!model || model.isDisposed() || model.getValue() === value) return
    externalUpdate.current = true
    model.setValue(value)
    externalUpdate.current = false
  }, [documentId, value])

  return <div className="source-editor-host" ref={host} aria-label={label}>
    {mobile && <CodeEditor stateKey={`source:${documentId}`} value={value} onChange={onChange} markdownMode={format === 'md'} label={label} onUndo={onUndo} onRedo={onRedo} />}
  </div>
}

function cssColor(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}
