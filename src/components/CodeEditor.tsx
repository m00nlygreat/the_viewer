import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { EditorSelection, EditorState, Prec } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view'
import { history, historyKeymap, defaultKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'

export interface CodeEditorHandle { wrapSelection: (before: string, after?: string) => void }
interface CodeEditorProps {
  value: string
  onChange: (value: string) => void
  markdownMode?: boolean
  label: string
  onUndo?: () => void
  onRedo?: () => void
  stateKey?: string
}

const savedEditorStates = new Map<string, { anchor: number; head: number; scrollTop: number }>()

export const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(function CodeEditor({ value, onChange, markdownMode = false, label, onUndo, onRedo, stateKey }, ref) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const valueRef = useRef(value)
  const change = useRef(onChange)
  const undo = useRef(onUndo)
  const redo = useRef(onRedo)
  const syncing = useRef(false)
  change.current = onChange
  undo.current = onUndo
  redo.current = onRedo
  valueRef.current = value
  const hasExternalHistory = Boolean(onUndo || onRedo)

  useEffect(() => {
    if (!host.current) return
    const saved = stateKey ? savedEditorStates.get(stateKey) : undefined
    const state = EditorState.create({
      doc: valueRef.current,
      selection: saved ? EditorSelection.range(Math.min(saved.anchor, valueRef.current.length), Math.min(saved.head, valueRef.current.length)) : undefined,
      extensions: [
        lineNumbers(),
        ...(!hasExternalHistory ? [history(), keymap.of(historyKeymap)] : []),
        keymap.of(defaultKeymap),
        ...(hasExternalHistory ? [Prec.highest(keymap.of([
          { key: 'Mod-z', run: () => { undo.current?.(); return true } },
          { key: 'Mod-y', run: () => { redo.current?.(); return true } },
          { key: 'Mod-Shift-z', run: () => { redo.current?.(); return true } }
        ]))] : []),
        highlightActiveLine(), ...(markdownMode ? [markdown()] : []),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !syncing.current) change.current(update.state.doc.toString())
        }),
        EditorView.theme({
          '&': { height: '100%', color: 'var(--text)', backgroundColor: 'var(--panel)' },
          '.cm-scroller': { fontFamily: 'var(--font-mono)', fontSize: '16px', lineHeight: '1.72', overflow: 'auto' },
          '.cm-content': { padding: '20px 22px', caretColor: 'var(--accent)' },
          '.cm-gutters': { backgroundColor: 'var(--panel)', color: 'var(--text-weak)', border: 'none', borderRight: '1px solid var(--line)' },
          '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--accent) 6%, transparent)' },
          '.cm-activeLineGutter': { color: 'var(--accent)' },
          '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--accent)' },
          '.cm-selectionBackground, ::selection': { backgroundColor: 'color-mix(in srgb, var(--accent) 28%, transparent) !important' },
          '.cm-tooltip': { backgroundColor: 'var(--panel-raised)', borderColor: 'var(--line)' }
        })
      ]
    })
    view.current = new EditorView({ state, parent: host.current })
    if (saved) view.current.scrollDOM.scrollTop = saved.scrollTop
    return () => {
      if (stateKey && view.current) {
        const selection = view.current.state.selection.main
        savedEditorStates.set(stateKey, { anchor: selection.anchor, head: selection.head, scrollTop: view.current.scrollDOM.scrollTop })
      }
      view.current?.destroy(); view.current = null
    }
  }, [hasExternalHistory, markdownMode, stateKey])

  useEffect(() => {
    const editor = view.current
    if (!editor || editor.state.doc.toString() === value) return
    syncing.current = true
    const selection = editor.state.selection.main
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value }, selection: EditorSelection.range(Math.min(selection.anchor, value.length), Math.min(selection.head, value.length)) })
    syncing.current = false
  }, [value])

  useImperativeHandle(ref, () => ({
    wrapSelection(before, after = before) {
      const editor = view.current
      if (!editor) return
      const selection = editor.state.selection.main
      const selected = editor.state.sliceDoc(selection.from, selection.to)
      const content = selected || '텍스트'
      editor.dispatch({
        changes: { from: selection.from, to: selection.to, insert: `${before}${content}${after}` },
        selection: { anchor: selection.from + before.length, head: selection.from + before.length + content.length },
        scrollIntoView: true,
        userEvent: 'input.format'
      })
      editor.focus()
    }
  }), [])

  return <div className="code-editor" ref={host} aria-label={label} />
})
