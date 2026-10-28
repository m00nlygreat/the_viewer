import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { applyCodeMirrorChanges, applyLineBasedTextChanges, createTextPositionMapper, findTextChanges, mergeTextDuringComposition, normalizeLineEndings } from '../src/components/editorText'
import { remapCodeEditorState } from '../src/components/codeEditorState'

describe('CodeMirror source text mapping', () => {
  it('preserves mixed line endings and a leading BOM around an edited range', () => {
    const source = '\uFEFF---\r\ntitle: Note\r\n---\n\n**hello**\r'
    const state = EditorState.create({ doc: source })
    const normalized = normalizeLineEndings(source)
    const start = normalized.indexOf('hello')
    const transaction = state.update({ changes: { from: start, to: start + 5, insert: '안녕' } })

    expect(applyCodeMirrorChanges(state, transaction.changes, source))
      .toBe(source.replace('hello', '안녕'))
  })

  it('converts new lines inserted by CodeMirror to the nearest source line ending', () => {
    const source = 'first\r\nsecond\r\nthird'
    const state = EditorState.create({ doc: source })
    const lineEnd = state.doc.line(2).to
    const transaction = state.update({ changes: { from: lineEnd, insert: '\nnew line' } })

    expect(applyCodeMirrorChanges(state, transaction.changes, source)).toBe('first\r\nsecond\r\nnew line\r\nthird')
  })

  it('maps Monaco line and column edits without normalizing untouched mixed separators', () => {
    const source = '\uFEFF# 제목\r\nsecond\rthird\n'
    const changed = applyLineBasedTextChanges(source, [{
      startLineNumber: 3, startColumn: 5, endLineNumber: 3, endColumn: 6, text: 'D'
    }])
    expect(changed).toBe('\uFEFF# 제목\r\nsecond\rthirD\n')
  })

  it('merges a composing edit with an external change and keeps the remote line endings', () => {
    const base = 'title\r\ncompose\r\nfooter'
    const local = 'title\r\n한글\r\n입력\r\nfooter'
    const remote = 'updated title\r\ncompose\r\nfooter'
    expect(mergeTextDuringComposition(base, local, remote)).toBe('updated title\r\n한글\r\n입력\r\nfooter')
  })

  it('keeps the composing text when the external edit overlaps its range', () => {
    expect(mergeTextDuringComposition('draft', '한글', 'older')).toBe('한글')
  })

  it('preserves multiple external edits around a composing range', () => {
    const base = 'title\ncompose\nfooter'
    const local = 'title\n한글\nfooter'
    const remote = 'updated title\ncompose\nupdated footer'
    expect(mergeTextDuringComposition(base, local, remote)).toBe('updated title\n한글\nupdated footer')
  })

  it('maps positions between multiple external edits instead of collapsing them to one replacement', () => {
    const previous = 'title\nkeep this\nfooter'
    const next = 'updated title\nkeep this\nupdated footer'
    const middle = previous.indexOf('keep') + 3
    const mapper = createTextPositionMapper(previous, next)
    const changeState = EditorState.create({ doc: previous }).update({ changes: findTextChanges(previous, next) }).state
    expect(changeState.doc.toString()).toBe(next)
    expect(mapper(middle)).toBe(next.indexOf('keep') + 3)
  })

  it('produces valid multiple changes for inserts, deletes, repeated text, and Korean characters', () => {
    const examples: Array<[string, string]> = [
      ['abc', 'axc'], ['abc', 'abc!'], ['abc!', 'abc'], ['aaaaab', 'aaacb'],
      ['ababa', 'babab'], ['한글 😀 내용', '한글 🌱 내용'], ['a\nb\nc', 'x\na\nc']
    ]
    for (const [previous, next] of examples) {
      const state = EditorState.create({ doc: previous })
      const changed = state.update({ changes: findTextChanges(previous, next) }).state.doc.toString()
      expect(changed).toBe(next)
    }
  })

  it('remaps multiple saved selections when restoring an editor after a source edit', () => {
    const saved = remapCodeEditorState({
      text: 'before\nkeep\nlast',
      ranges: [{ anchor: 8, head: 10 }, { anchor: 14, head: 14 }],
      mainIndex: 1,
      scrollTop: 140,
      scrollLeft: 12
    }, 'inserted\nbefore\nkeep\nlast')
    expect(saved.ranges).toEqual([{ anchor: 17, head: 19 }, { anchor: 23, head: 23 }])
    expect(saved.mainIndex).toBe(1)
    expect(saved.scrollTop).toBe(140)
    expect(saved.scrollLeft).toBe(12)
  })
})
