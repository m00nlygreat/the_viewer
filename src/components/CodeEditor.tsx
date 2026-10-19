import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view'
import { history, historyKeymap, defaultKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'

export interface CodeEditorHandle { wrapSelection: (before: string, after?: string) => void }
interface CodeEditorProps {
  value: string
  onChange: (value: string) => void
  markdownMode?: boolean
  label: string
}

export const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(function CodeEditor({ value, onChange, markdownMode = false, label }, ref) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const initialValue = useRef(value)
  const change = useRef(onChange)
  change.current = onChange

  useEffect(() => {
    if (!host.current) return
    const state = EditorState.create({
      doc: initialValue.current,
      extensions: [
        lineNumbers(), history(), keymap.of([...defaultKeymap, ...historyKeymap]),
        highlightActiveLine(), ...(markdownMode ? [markdown()] : []),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) change.current(update.state.doc.toString())
        }),
        EditorView.theme({
          '&': { height: '100%', color: 'var(--text)', backgroundColor: 'var(--panel)' },
          '.cm-scroller': { fontFamily: 'var(--font-mono)', fontSize: '13px', lineHeight: '1.72', overflow: 'auto' },
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
    return () => { view.current?.destroy(); view.current = null }
  }, [markdownMode])

  useEffect(() => {
    const editor = view.current
    if (!editor || editor.state.doc.toString() === value) return
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } })
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
