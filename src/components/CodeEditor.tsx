import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { EditorSelection, EditorState, Prec, type ChangeSpec } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view'
import { history, historyKeymap, defaultKeymap } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { markdownLivePreview, taskMarkerRangesForSelection } from './markdownPreview'
import { csvEditorLanguage } from './csvLanguage'
import { applyCodeMirrorChanges, findTextChanges, mergeTextDuringComposition, normalizeLineEndings } from './editorText'
import { readCodeEditorState, remapCodeEditorState, saveCodeEditorState } from './codeEditorState'

type ChangeGroup = 'typing' | 'command'

export interface CodeEditorHandle {
  wrapSelection: (before: string, after?: string) => void
  prefixLines: (prefix: string) => void
  toggleChecklist: () => void
}

interface CodeEditorProps {
  value: string
  onChange: (value: string, group?: ChangeGroup) => void
  markdownMode?: boolean
  csvMode?: boolean
  csvDelimiter?: string
  livePreview?: boolean
  markdownTheme?: 'light' | 'dark'
  label: string
  onUndo?: () => void
  onRedo?: () => void
  stateKey?: string
}

function clampPosition(position: number, length: number): number {
  return Math.max(0, Math.min(position, length))
}

function currentSelection(view: EditorView): EditorSelection {
  const state = view.state
  const saved = state.selection
  return EditorSelection.create(saved.ranges.map((range) => EditorSelection.range(
    clampPosition(range.anchor, state.doc.length), clampPosition(range.head, state.doc.length)
  )), saved.mainIndex)
}

function applyChanges(view: EditorView, changes: readonly ChangeSpec[]): void {
  if (!changes.length) return
  const changeSet = view.state.changes(changes)
  view.dispatch({ changes: changeSet, selection: view.state.selection.map(changeSet), userEvent: 'input.format' })
  view.focus()
}

function formatSelection(view: EditorView, before: string, after = before): void {
  const state = view.state
  const operations = state.selection.ranges.map((range, index) => {
    return { index, range, empty: range.empty }
  })
  const insertions = new Map<number, string>()
  const changes: Array<{ from: number; insert: string }> = []
  for (const operation of operations) {
    if (operation.empty) {
      changes.push({ from: operation.range.from, insert: `${before}텍스트${after}` })
      continue
    }
    if (before) insertions.set(operation.range.from, `${insertions.get(operation.range.from) ?? ''}${before}`)
    if (after) insertions.set(operation.range.to, `${insertions.get(operation.range.to) ?? ''}${after}`)
  }
  for (const [from, insert] of insertions) changes.push({ from, insert })
  changes.sort((left, right) => left.from - right.from)
  const changeSet = state.changes(changes)
  const mapped = new Array<ReturnType<typeof EditorSelection.range>>(operations.length)
  for (const operation of operations) {
    const { range, index } = operation
    if (range.empty) {
      const contentFrom = changeSet.mapPos(range.from, -1) + before.length
      mapped[index] = EditorSelection.range(contentFrom, contentFrom + '텍스트'.length)
      continue
    }
    const start = changeSet.mapPos(range.from, 1)
    const end = changeSet.mapPos(range.to, -1)
    mapped[index] = range.anchor <= range.head ? EditorSelection.range(start, end) : EditorSelection.range(end, start)
  }
  view.dispatch({
    changes: changeSet,
    selection: EditorSelection.create(mapped, state.selection.mainIndex),
    userEvent: 'input.format'
  })
  view.focus()
}

function prefixSelectedLines(view: EditorView, prefix: string): void {
  const state = view.state
  const starts = new Set<number>()
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from)
    const lastPosition = range.to > range.from ? range.to - 1 : range.from
    const last = state.doc.lineAt(lastPosition)
    for (let number = first.number; number <= last.number; number += 1) starts.add(state.doc.line(number).from)
  }
  applyChanges(view, [...starts].sort((left, right) => left - right).map((from) => ({ from, insert: prefix })))
}

function applyChecklist(view: EditorView): void {
  const markers = taskMarkerRangesForSelection(view.state)
  if (markers.length) {
    applyChanges(view, markers.map(({ from, to, checked }) => ({ from, to, insert: checked ? '[ ]' : '[x]' })))
  } else {
    prefixSelectedLines(view, '- [ ] ')
  }
}

export const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(function CodeEditor({
  value, onChange, markdownMode = false, csvMode = false, csvDelimiter = ',', livePreview = false, markdownTheme = 'dark', label, onUndo, onRedo, stateKey
}, ref) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const valueRef = useRef(value)
  const editorText = useRef(value)
  const change = useRef(onChange)
  const undo = useRef(onUndo)
  const redo = useRef(onRedo)
  const syncing = useRef(false)
  const pendingExternalValue = useRef<string | null>(null)
  const compositionBaseValue = useRef<string | null>(null)
  change.current = onChange
  undo.current = onUndo
  redo.current = onRedo
  const hasExternalHistory = Boolean(onUndo || onRedo)

  const syncValue = (editor: EditorView, externalValue: string) => {
    const normalized = normalizeLineEndings(externalValue)
    if (editor.composing || compositionBaseValue.current !== null) {
      if (editor.state.doc.toString() === normalized) {
        valueRef.current = externalValue
        if (pendingExternalValue.current === null) editorText.current = externalValue
      } else {
        pendingExternalValue.current = externalValue
        valueRef.current = externalValue
      }
      return
    }
    if (editor.state.doc.toString() === normalized) {
      valueRef.current = externalValue
      editorText.current = externalValue
      pendingExternalValue.current = null
      return
    }
    const previous = editor.state.doc.toString()
    const changes = editor.state.changes(findTextChanges(previous, normalized))
    const top = editor.scrollDOM.scrollTop
    const left = editor.scrollDOM.scrollLeft
    syncing.current = true
    editor.dispatch({ changes, selection: editor.state.selection.map(changes) })
    editor.scrollDOM.scrollTop = top
    editor.scrollDOM.scrollLeft = left
    syncing.current = false
    valueRef.current = externalValue
    editorText.current = externalValue
    pendingExternalValue.current = null
  }

  useEffect(() => {
    if (!host.current) return
    const saved = stateKey ? readCodeEditorState(stateKey) : undefined
    const restored = saved ? remapCodeEditorState(saved, valueRef.current) : undefined
    const selection = restored
      ? EditorSelection.create(restored.ranges.map((range) => EditorSelection.range(
        clampPosition(range.anchor, normalizeLineEndings(valueRef.current).length),
        clampPosition(range.head, normalizeLineEndings(valueRef.current).length)
      )), Math.min(restored.mainIndex, Math.max(restored.ranges.length - 1, 0)))
      : undefined
    editorText.current = valueRef.current
    const state = EditorState.create({
      doc: valueRef.current,
      selection,
      extensions: [
        EditorState.allowMultipleSelections.of(true),
        ...(!livePreview ? [lineNumbers()] : []),
        ...(!hasExternalHistory ? [history(), keymap.of(historyKeymap)] : []),
        keymap.of(defaultKeymap),
        ...(hasExternalHistory ? [Prec.highest(keymap.of([
          { key: 'Mod-z', run: () => { undo.current?.(); return true } },
          { key: 'Mod-y', run: () => { redo.current?.(); return true } },
          { key: 'Mod-Shift-z', run: () => { redo.current?.(); return true } }
        ]))] : []),
        highlightActiveLine(),
        ...(markdownMode ? [markdown({ base: markdownLanguage })] : []),
        ...(csvMode ? csvEditorLanguage(csvDelimiter) : []),
        ...(livePreview ? [EditorView.lineWrapping] : []),
        ...(livePreview ? markdownLivePreview(markdownTheme, () => undo.current?.(), () => redo.current?.()) : []),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged || syncing.current) return
          const localText = applyCodeMirrorChanges(update.startState, update.changes, editorText.current)
          editorText.current = localText
          const compositionBase = compositionBaseValue.current
          const externalText = pendingExternalValue.current
          const nextText = compositionBase !== null && externalText !== null
            ? mergeTextDuringComposition(compositionBase, localText, externalText)
            : localText
          if (compositionBase !== null && externalText !== null) pendingExternalValue.current = nextText
          valueRef.current = nextText
          const group: ChangeGroup = update.transactions.some((transaction) => transaction.isUserEvent('input.format')) ? 'command' : 'typing'
          change.current(nextText, group)
        }),
        EditorView.domEventHandlers({
          compositionstart() {
            compositionBaseValue.current = editorText.current
            return false
          },
          compositionend() {
            const editor = view.current
            const pending = pendingExternalValue.current
            const base = compositionBaseValue.current
            if (editor && base !== null && pending !== null) {
              const merged = mergeTextDuringComposition(base, editorText.current, pending)
              valueRef.current = merged
              pendingExternalValue.current = merged
              if (merged !== pending) change.current(merged, 'typing')
            }
            compositionBaseValue.current = null
            window.requestAnimationFrame(() => {
              const currentEditor = view.current
              const latest = pendingExternalValue.current
              if (currentEditor && latest !== null) syncValue(currentEditor, latest)
            })
            return false
          }
        }),
        EditorView.theme({
          '&': { height: '100%', color: 'var(--text)', backgroundColor: 'var(--panel)' },
          '.cm-scroller': {
            fontFamily: livePreview ? 'inherit' : 'var(--font-mono)',
            fontSize: livePreview ? 'var(--markdown-font-size)' : '16px',
            lineHeight: livePreview ? '1.7' : '1.72',
            overflow: 'auto'
          },
          '.cm-content': { padding: livePreview ? '22px max(20px, calc((100cqw - 720px) / 2))' : '20px 22px', caretColor: 'var(--accent)' },
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
    if (restored) {
      view.current.scrollDOM.scrollTop = restored.scrollTop
      view.current.scrollDOM.scrollLeft = restored.scrollLeft
    }
    return () => {
      if (stateKey && view.current) {
        const editorSelection = currentSelection(view.current)
        saveCodeEditorState(stateKey, {
          text: view.current.state.doc.toString(),
          ranges: editorSelection.ranges.map((range) => ({ anchor: range.anchor, head: range.head })),
          mainIndex: editorSelection.mainIndex,
          scrollTop: view.current.scrollDOM.scrollTop,
          scrollLeft: view.current.scrollDOM.scrollLeft
        })
      }
      view.current?.destroy()
      view.current = null
      pendingExternalValue.current = null
      compositionBaseValue.current = null
    }
  }, [csvDelimiter, csvMode, hasExternalHistory, livePreview, markdownMode, markdownTheme, stateKey])

  useEffect(() => {
    const editor = view.current
    if (editor) syncValue(editor, value)
  }, [value])

  useImperativeHandle(ref, () => ({
    wrapSelection(before, after = before) {
      const editor = view.current
      if (editor) formatSelection(editor, before, after)
    },
    prefixLines(prefix) {
      const editor = view.current
      if (editor) prefixSelectedLines(editor, prefix)
    },
    toggleChecklist() {
      const editor = view.current
      if (editor) applyChecklist(editor)
    }
  }), [])

  return <div className={`code-editor${livePreview ? ' code-editor-live-preview' : ''}`} ref={host} aria-label={label} />
})
