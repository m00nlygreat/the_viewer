import { useEffect, useRef } from 'react'
import '../../node_modules/monaco-editor/min/vs/editor/editor.main.css'
import { configureMonacoWorker, defineViewerMonacoThemes, monaco } from '../components/monacoRuntime'
import { registerMonacoJsonLanguage } from '../components/monacoJsonLanguage'
import { createTextPositionMapper, findTextChanges, normalizeLineEndings } from '../components/editorText'
import type { MarkdownCodeBlockState } from '../components/markdownCodeBlockState'

interface Props {
  block: MarkdownCodeBlockState
  code: string
  language: string
  theme: 'light' | 'dark'
}

const languageLoaders: Record<string, () => Promise<unknown>> = {
  cpp: () => import('monaco-editor/languages/definitions/cpp/register.js'),
  csharp: () => import('monaco-editor/languages/definitions/csharp/register.js'),
  css: () => import('monaco-editor/languages/definitions/css/register.js'),
  dockerfile: () => import('monaco-editor/languages/definitions/dockerfile/register.js'),
  go: () => import('monaco-editor/languages/definitions/go/register.js'),
  html: () => import('monaco-editor/languages/definitions/html/register.js'),
  ini: () => import('monaco-editor/languages/definitions/ini/register.js'),
  java: () => import('monaco-editor/languages/definitions/java/register.js'),
  javascript: () => import('monaco-editor/languages/definitions/javascript/register.js'),
  json: async () => registerMonacoJsonLanguage(),
  kotlin: () => import('monaco-editor/languages/definitions/kotlin/register.js'),
  markdown: () => import('monaco-editor/languages/definitions/markdown/register.js'),
  php: () => import('monaco-editor/languages/definitions/php/register.js'),
  powershell: () => import('monaco-editor/languages/definitions/powershell/register.js'),
  python: () => import('monaco-editor/languages/definitions/python/register.js'),
  ruby: () => import('monaco-editor/languages/definitions/ruby/register.js'),
  rust: () => import('monaco-editor/languages/definitions/rust/register.js'),
  scss: () => import('monaco-editor/languages/definitions/scss/register.js'),
  shell: () => import('monaco-editor/languages/definitions/shell/register.js'),
  sql: () => import('monaco-editor/languages/definitions/sql/register.js'),
  typescript: () => import('monaco-editor/languages/definitions/typescript/register.js'),
  xml: () => import('monaco-editor/languages/definitions/xml/register.js'),
  yaml: () => import('monaco-editor/languages/definitions/yaml/register.js')
}

export default function MarkdownCodeBlockMonacoEditor({ block, code, language, theme }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const modelRef = useRef<monaco.editor.ITextModel | null>(null)
  const externalUpdate = useRef(false)
  const codeRef = useRef(code)
  const themeRef = useRef(theme)
  codeRef.current = code
  themeRef.current = theme

  useEffect(() => {
    if (!host.current) return
    let cancelled = false
    let editor: monaco.editor.IStandaloneCodeEditor | null = null
    let model: monaco.editor.ITextModel | null = null
    let contentListener: monaco.IDisposable | null = null
    let commandListener: monaco.IDisposable | null = null

    const createEditor = async () => {
      configureMonacoWorker()
      try { await languageLoaders[language]?.() } catch { /* Keep the editor usable as plain text. */ }
      if (cancelled || !host.current) return

      defineViewerMonacoThemes()
      model = monaco.editor.createModel(codeRef.current, language)
      modelRef.current = model
      editor = monaco.editor.create(host.current, {
        model,
        theme: themeRef.current === 'dark' ? 'the-viewer-dark' : 'the-viewer-light',
        ariaLabel: `${language} 코드 편집기`,
        automaticLayout: true,
        lineNumbers: 'on',
        wordWrap: 'off',
        minimap: { enabled: false },
        contextmenu: false,
        formatOnPaste: false,
        formatOnType: false,
        scrollBeyondLastLine: false,
        fontFamily: 'var(--font-mono), Consolas, monospace',
        fontSize: 13,
        tabSize: 2,
        padding: { top: 12, bottom: 12 },
        renderLineHighlight: 'line',
        overviewRulerBorder: false,
        fixedOverflowWidgets: true
      })
      editorRef.current = editor
      contentListener = model.onDidChangeContent(() => {
        if (!externalUpdate.current) block.replaceCode(model?.getValue() ?? '')
      })
      commandListener = editor.onKeyDown((event) => {
        const command = event.ctrlKey || event.metaKey
        if (!command || event.altKey) return
        if (event.keyCode === monaco.KeyCode.KeyZ) {
          event.preventDefault()
          event.stopPropagation()
          if (event.shiftKey) block.redoDocument()
          else block.undoDocument()
        } else if (event.keyCode === monaco.KeyCode.KeyY) {
          event.preventDefault()
          event.stopPropagation()
          block.redoDocument()
        }
      })
      window.requestAnimationFrame(() => { if (!cancelled) editor?.focus() })
    }

    void createEditor()
    return () => {
      cancelled = true
      contentListener?.dispose()
      commandListener?.dispose()
      editor?.dispose()
      model?.dispose()
      editorRef.current = null
      modelRef.current = null
    }
  }, [block, language])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    monaco.editor.setTheme(theme === 'dark' ? 'the-viewer-dark' : 'the-viewer-light')
  }, [theme])

  useEffect(() => {
    const model = modelRef.current
    const editor = editorRef.current
    if (!model || model.isDisposed() || normalizeLineEndings(model.getValue()) === normalizeLineEndings(code)) return
    externalUpdate.current = true
    syncMonacoCode(model, code, editor)
    externalUpdate.current = false
  }, [code])

  return <div className="cm-md-code-monaco-host" ref={host} aria-label={`${language} Monaco 편집기`} />
}

function syncMonacoCode(model: monaco.editor.ITextModel, value: string, editor: monaco.editor.IStandaloneCodeEditor | null): void {
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
  const selectionOffsets = editor?.getSelections()?.map((selection) => ({
    anchor: model.getOffsetAt({ lineNumber: selection.selectionStartLineNumber, column: selection.selectionStartColumn }),
    head: model.getOffsetAt({ lineNumber: selection.positionLineNumber, column: selection.positionColumn })
  }))
  model.applyEdits(edits)
  if (!editor || !selectionOffsets?.length) return
  editor.setSelections(selectionOffsets.map(({ anchor, head }) => {
    const forward = anchor <= head
    const mappedAnchor = model.getPositionAt(mapPosition(anchor, forward ? -1 : 1))
    const mappedHead = model.getPositionAt(mapPosition(head, forward ? 1 : -1))
    return new monaco.Selection(mappedAnchor.lineNumber, mappedAnchor.column, mappedHead.lineNumber, mappedHead.column)
  }))
}
