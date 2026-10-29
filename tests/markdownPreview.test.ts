import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { buildMarkdownPreviewDecorations, taskMarkerRangesForSelection } from '../src/components/markdownPreview'
import { markdownLinkAttributes } from '../src/domain/markdown'

function makeState(text: string, position = text.length): EditorState {
  return EditorState.create({
    doc: text,
    selection: { anchor: position },
    extensions: [EditorState.allowMultipleSelections.of(true), markdown({ base: markdownLanguage })]
  })
}

function collectDecorations(state: EditorState, composingPosition: number | null = null) {
  const items: Array<{ from: number; to: number; className?: string; tagName?: string; attributes?: Record<string, string>; hasWidget: boolean }> = []
  buildMarkdownPreviewDecorations(state, composingPosition).between(0, state.doc.length, (from, to, decoration) => {
    items.push({ from, to, className: decoration.spec.class, tagName: decoration.spec.tagName, attributes: decoration.spec.attributes, hasWidget: Boolean(decoration.spec.widget) })
  })
  return items
}

describe('Markdown live preview decorations', () => {
  it('hides parsed inline and block syntax while preserving the original source text', () => {
    const text = '# Heading\n\n**bold** *italic* ~~deleted~~ `code` [link](https://example.com)\n'
    const state = makeState(text)
    const decorations = collectDecorations(state)
    expect(state.doc.toString()).toBe(text)
    expect(decorations.some((item) => item.from === 0 && item.to === 2 && !item.className)).toBe(true)
    expect(decorations.some((item) => item.className === 'cm-md-bold')).toBe(true)
    expect(decorations.some((item) => item.className === 'cm-md-italic')).toBe(true)
    expect(decorations.some((item) => item.className === 'cm-md-strike')).toBe(true)
    expect(decorations.some((item) => item.className === 'cm-md-inline-code')).toBe(true)
    expect(decorations.some((item) => item.className === 'cm-md-link')).toBe(true)
    expect(decorations.some((item) => item.className === 'cm-md-link' && item.tagName === 'a' && item.attributes?.rel === 'noopener noreferrer')).toBe(true)
    const labelStart = text.indexOf('link](https://')
    const link = decorations.find((item) => item.className === 'cm-md-link')
    expect(link && [link.from, link.to]).toEqual([labelStart, labelStart + 4])
  })

  it('previews headings, unordered and ordered lists, quotes, and task markers', () => {
    const text = 'focus here\n\n# Heading\n\nSetext title\n---\n\n- bullet\n1. numbered\n\n> quoted\n\n- [ ] open\n- [x] done\n'
    const state = makeState(text, text.indexOf('focus') + 2)
    const decorations = collectDecorations(state)
    expect(decorations.some((item) => item.className === 'cm-md-heading-1')).toBe(true)
    expect(decorations.some((item) => item.className === 'cm-md-heading-2')).toBe(true)
    expect(decorations.some((item) => item.hasWidget && item.from === text.indexOf('- bullet'))).toBe(true)
    expect(decorations.some((item) => item.hasWidget && item.from === text.indexOf('1. numbered'))).toBe(true)
    expect(decorations.some((item) => item.className?.includes('cm-md-quote-line'))).toBe(true)
    expect(decorations.filter((item) => item.hasWidget && (item.from === text.indexOf('[ ]') || item.from === text.indexOf('[x]')))).toHaveLength(2)
    expect(state.doc.toString()).toBe(text)
  })

  it('shows the whole selected block as raw Markdown for cursor, multiple selections, and composition', () => {
    const text = '**first**\n\n*second*\n'
    const base = makeState(text)
    const cursorInFirst = base.update({ selection: { anchor: 3 } }).state
    expect(collectDecorations(cursorInFirst).some((item) => item.className === 'cm-md-bold')).toBe(false)

    const multiple = base.update({ selection: EditorSelection.create([
      EditorSelection.range(2, 5),
      EditorSelection.cursor(text.indexOf('second') + 2)
    ]) }).state
    expect(collectDecorations(multiple).some((item) => item.className === 'cm-md-bold')).toBe(false)
    expect(collectDecorations(multiple).some((item) => item.className === 'cm-md-italic')).toBe(true)
    expect(collectDecorations(base, 2).some((item) => item.className === 'cm-md-bold')).toBe(false)
  })

  it('marks only the actively edited line while keeping other lines in preview', () => {
    const text = '**editing**\n\n**preview**\n'
    const editingStart = text.indexOf('**editing**')
    const previewStart = text.indexOf('**preview**')
    const state = makeState(text, editingStart + 4)
    const decorations = collectDecorations(state)

    expect(decorations.some((item) => item.className === 'cm-md-editing-block' && item.from === editingStart)).toBe(true)
    expect(decorations.some((item) => item.className === 'cm-md-bold' && item.from === previewStart + 2)).toBe(true)
    expect(decorations.some((item) => item.className === 'cm-md-bold' && item.from === editingStart + 2)).toBe(false)
    expect(state.doc.toString()).toBe(text)
  })

  it('keeps a multi-line paragraph in preview except for the active source line', () => {
    const text = '**first**\n**second**\n**third**\n'
    const secondStart = text.indexOf('**second**')
    const state = makeState(text, secondStart + 4)
    const decorations = collectDecorations(state)

    expect(decorations.filter((item) => item.className === 'cm-md-editing-block').map((item) => item.from)).toEqual([secondStart])
    expect(decorations.filter((item) => item.className === 'cm-md-bold').map((item) => item.from)).toEqual([
      text.indexOf('**first**') + 2,
      text.indexOf('**third**') + 2
    ])
    expect(state.doc.toString()).toBe(text)
  })

  it('marks a focused blank line without activating either neighboring block', () => {
    const text = '**above**\n\n**below**\n'
    const blankLine = text.indexOf('\n') + 1
    const base = makeState(text)
    const state = base.update({ selection: { anchor: blankLine } }).state
    const decorations = collectDecorations(state)

    expect(decorations.filter((item) => item.className === 'cm-md-editing-block').map((item) => item.from)).toEqual([blankLine])
    expect(decorations.filter((item) => item.className === 'cm-md-bold')).toHaveLength(2)
    expect(state.doc.toString()).toBe(text)
  })

  it('keeps a list in preview except for its single active source line', () => {
    const text = '- **first**\n- **second**\n- **third**\n'
    const secondStart = text.indexOf('- **second**')
    const state = makeState(text, secondStart + 6)
    const decorations = collectDecorations(state)

    expect(decorations.filter((item) => item.className === 'cm-md-editing-block').map((item) => item.from)).toEqual([secondStart])
    expect(decorations.filter((item) => item.className === 'cm-md-bold').map((item) => item.from)).toEqual([
      text.indexOf('**first**') + 2,
      text.indexOf('**third**') + 2
    ])
    expect(state.doc.toString()).toBe(text)
  })

  it('marks only the primary selection line or IME composition line as active', () => {
    const text = '**first**\n\n**second**\n'
    const firstStart = text.indexOf('**first**')
    const secondStart = text.indexOf('**second**')
    const base = makeState(text)
    const multiple = base.update({ selection: EditorSelection.create([
      EditorSelection.cursor(firstStart + 3),
      EditorSelection.cursor(secondStart + 3)
    ]) }).state
    const multiDecorations = collectDecorations(multiple)

    expect(multiDecorations.filter((item) => item.className === 'cm-md-editing-block').map((item) => item.from)).toEqual([firstStart])
    expect(multiDecorations.some((item) => item.className === 'cm-md-bold' && item.from === secondStart + 2)).toBe(true)
    expect(collectDecorations(base, secondStart + 3).some((item) => item.className === 'cm-md-editing-block' && item.from === secondStart)).toBe(true)
    expect(collectDecorations(base, secondStart + 3).some((item) => item.className === 'cm-md-bold' && item.from === firstStart + 2)).toBe(true)
    expect(base.doc.toString()).toBe(text)
  })

  it('does not treat the next block as selected when a drag range ends at its boundary', () => {
    const text = '**first**\n\n**second**\n'
    const base = makeState(text)
    const boundary = text.indexOf('**second**')
    const selectedFirst = base.update({ selection: { anchor: 0, head: boundary } }).state
    expect(collectDecorations(selectedFirst).some((item) => item.className === 'cm-md-bold')).toBe(true)
  })

  it('leaves tables, fenced code, and frontmatter source intact while rendering blocked images safely', () => {
    const text = '---\ntitle: Note\n---\n\n| a | b |\n| - | - |\n| x | y |\n\n```ts\nconst x = 1\n```\n\n![cat](https://example.com/cat.png)\n'
    const state = makeState(text)
    const decorations = collectDecorations(state)
    const frontmatterEnd = text.indexOf('\n\n')
    const tableStart = text.indexOf('| a')
    const tableEnd = text.indexOf('\n\n', tableStart)
    const codeStart = text.indexOf('```')
    const codeEnd = text.indexOf('\n\n', codeStart)
    expect(decorations.some((item) => item.from < frontmatterEnd && item.to > 0)).toBe(false)
    expect(decorations.some((item) => item.from < tableEnd && item.to > tableStart && !item.className)).toBe(false)
    expect(decorations.some((item) => item.from < codeEnd && item.to > codeStart && !item.className)).toBe(false)
    expect(decorations.some((item) => item.hasWidget && item.from === text.indexOf('!['))).toBe(true)
    expect(state.doc.toString()).toBe(text)
  })

  it('styles the opening and closing lines of inactive fenced code without changing its source', () => {
    const text = 'focus\n\n```ts title=demo\nconst x = 1\n```\n'
    const state = makeState(text, text.indexOf('focus') + 2)
    const decorations = collectDecorations(state)
    const codeStart = text.indexOf('```ts')
    const codeEnd = text.indexOf('```', codeStart + 3)

    expect(decorations.some((item) => item.className?.includes('cm-md-code-block-start') && item.from === codeStart)).toBe(true)
    expect(decorations.some((item) => item.className?.includes('cm-md-code-block-end') && item.from === codeEnd)).toBe(true)
    expect(state.doc.toString()).toBe(text)
  })

  it('keeps custom container syntax raw even when its body contains recognized Markdown', () => {
    const text = 'focus\n\n:::warning\n**inside**\n:::\n'
    const state = makeState(text, 2)
    const start = text.indexOf(':::warning')
    const end = text.length - 1
    expect(collectDecorations(state).filter((item) => item.from >= start && item.to <= end)).toEqual([])
    expect(state.doc.toString()).toBe(text)
  })

  it('keeps BOM-prefixed frontmatter raw while previewing following blocks', () => {
    const text = '\uFEFF---\ntitle: **raw**\n---\n\nfocus\n\n**outside**\n'
    const state = makeState(text, text.indexOf('focus') + 2)
    const frontmatterEnd = text.indexOf('\n\n')
    const decorations = collectDecorations(state)
    expect(decorations.filter((item) => item.from < frontmatterEnd && item.to > 0)).toEqual([])
    expect(decorations.some((item) => item.className === 'cm-md-bold')).toBe(true)
    expect(state.doc.toString()).toBe(text)
  })

  it('uses the Lezer task marker range for checklist actions', () => {
    const text = '- [ ] first\n- [x] second\n'
    const state = makeState(text, text.indexOf('first') + 2)
    expect(taskMarkerRangesForSelection(state)).toEqual([{ from: 2, to: 5, checked: false }])
    const all = state.update({ selection: { anchor: 0, head: text.length } }).state
    expect(taskMarkerRangesForSelection(all)).toEqual([
      { from: 2, to: 5, checked: false },
      { from: 14, to: 17, checked: true }
    ])
    expect(all.doc.toString()).toBe(text)
  })

  it('uses MarkdownIt link validation for safe preview anchors', () => {
    expect(markdownLinkAttributes('https://example.com')).toEqual({
      href: 'https://example.com', target: '_blank', rel: 'noopener noreferrer'
    })
    expect(markdownLinkAttributes('javascript:alert(1)')).toBeNull()

    const unsafeText = 'active\n\n[unsafe](javascript:alert(1))\n'
    const unsafeState = makeState(unsafeText, 2)
    const unsafeStart = unsafeText.indexOf('[unsafe]')
    const unsafeEnd = unsafeText.indexOf('\n', unsafeStart)
    expect(collectDecorations(unsafeState).filter((item) => item.from >= unsafeStart && item.to <= unsafeEnd)).toEqual([])
  })
})
