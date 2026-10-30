import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'

export function taskMarkerRangesForSelection(state: EditorState): Array<{ from: number; to: number; checked: boolean }> {
  const tree = ensureSyntaxTree(state, state.doc.length, 40) ?? syntaxTree(state)
  const ranges = state.selection.ranges
  const selectedLines = new Set<number>()
  for (const range of ranges) {
    const firstLine = state.doc.lineAt(range.from)
    const lastPosition = range.to > range.from ? range.to - 1 : range.from
    const lastLine = state.doc.lineAt(lastPosition)
    for (let number = firstLine.number; number <= lastLine.number; number += 1) selectedLines.add(number)
  }
  const result: Array<{ from: number; to: number; checked: boolean }> = []
  tree.iterate({ enter(node) {
    if (node.name !== 'TaskMarker' || !selectedLines.has(state.doc.lineAt(node.from).number)) return
    const marker = state.doc.sliceString(node.from, node.to)
    if (marker === '[ ]' || marker === '[x]' || marker === '[X]') result.push({ from: node.from, to: node.to, checked: marker !== '[ ]' })
  } })
  return result
}
