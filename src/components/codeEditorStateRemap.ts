import { EditorSelection, EditorState } from '@codemirror/state'
import { findMinimalChange, normalizeLineEndings } from './editorText'
import type { SavedCodeEditorState } from './codeEditorState'

export function remapCodeEditorState(saved: SavedCodeEditorState, text: string): SavedCodeEditorState {
  const previousText = normalizeLineEndings(saved.text)
  const nextText = normalizeLineEndings(text)
  const previous = EditorState.create({
    doc: previousText,
    extensions: [EditorState.allowMultipleSelections.of(true)],
    selection: EditorSelection.create(saved.ranges.map(({ anchor, head }) => EditorSelection.range(
      Math.max(0, Math.min(anchor, previousText.length)),
      Math.max(0, Math.min(head, previousText.length))
    )), Math.min(saved.mainIndex, Math.max(saved.ranges.length - 1, 0)))
  })
  const changes = previous.changes(findMinimalChange(previousText, nextText))
  const selection = previous.selection.map(changes)
  return {
    ...saved,
    text,
    ranges: selection.ranges.map(({ anchor, head }) => ({ anchor, head }))
  }
}
