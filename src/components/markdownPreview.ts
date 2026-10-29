import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { StateEffect, type EditorState, type Range } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { markdownLinkAttributes, renderMarkdown } from '../domain/markdown'

type MarkdownNode = ReturnType<typeof syntaxTree>['topNode']

const setCompositionPosition = StateEffect.define<number | null>()

class MarkerWidget extends WidgetType {
  constructor(private readonly text: string, private readonly className: string) { super() }
  eq(other: WidgetType): boolean { return other instanceof MarkerWidget && other.text === this.text && other.className === this.className }
  toDOM(): HTMLElement {
    const marker = document.createElement('span')
    marker.className = this.className
    marker.textContent = this.text
    return marker
  }
}

class ImagePreviewWidget extends WidgetType {
  constructor(private readonly source: string) { super() }
  eq(other: WidgetType): boolean { return other instanceof ImagePreviewWidget && other.source === this.source }
  toDOM(): HTMLElement {
    const image = document.createElement('span')
    image.className = 'cm-md-image-preview'
    image.innerHTML = renderMarkdown(this.source)
    return image
  }
}

class TaskCheckboxWidget extends WidgetType {
  constructor(private readonly checked: boolean, private readonly from: number) { super() }
  eq(other: WidgetType): boolean { return other instanceof TaskCheckboxWidget && other.checked === this.checked && other.from === this.from }
  toDOM(view: EditorView): HTMLElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'cm-md-task-checkbox'
    button.setAttribute('aria-label', this.checked ? '작업 항목 완료 취소' : '작업 항목 완료')
    button.setAttribute('aria-pressed', String(this.checked))
    button.textContent = this.checked ? '✓' : ''
    button.addEventListener('mousedown', (event) => event.preventDefault())
    button.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      const current = view.state.doc.sliceString(this.from, this.from + 3)
      if (current !== '[ ]' && current !== '[x]' && current !== '[X]') return
      view.dispatch({
        changes: { from: this.from, to: this.from + 3, insert: this.checked ? '[ ]' : '[x]' },
        userEvent: 'input.format'
      })
      view.focus()
    })
    return button
  }
}

function descendants(node: MarkdownNode): MarkdownNode[] {
  const result: MarkdownNode[] = []
  for (let child = node.firstChild; child; child = child.nextSibling) {
    result.push(child, ...descendants(child))
  }
  return result
}

function frontmatterRange(state: EditorState): { from: number; to: number } | null {
  if (!state.doc.lines) return null
  const first = state.doc.line(1)
  if (first.text.replace(/^\uFEFF/u, '').trim() !== '---') return null
  for (let number = 2; number <= state.doc.lines; number += 1) {
    const line = state.doc.line(number)
    if (line.text.trim() !== '---' && line.text.trim() !== '...') continue
    const next = number < state.doc.lines ? state.doc.line(number + 1).from : line.to
    return { from: first.from, to: next }
  }
  return { from: first.from, to: state.doc.length }
}

function overlapsFrontmatter(node: MarkdownNode, frontmatter: { from: number; to: number } | null): boolean {
  return Boolean(frontmatter && node.from < frontmatter.to && node.to > frontmatter.from)
}

function supportsPreview(blockName: string): boolean {
  return blockName === 'Paragraph' || blockName === 'BulletList' || blockName === 'OrderedList' ||
    blockName === 'Blockquote' || /^ATXHeading[1-6]$/u.test(blockName) || /^SetextHeading[12]$/u.test(blockName) ||
    blockName === 'Table' || blockName === 'FencedCode'
}

function startsUnknownContainerDirective(state: EditorState, block: MarkdownNode): boolean {
  return block.name === 'Paragraph' && /^\s*:::/u.test(state.doc.lineAt(block.from).text)
}

function isActiveBlock(
  from: number,
  to: number,
  ranges: EditorState['selection']['ranges'],
  composingPosition: number | null
): boolean {
  if (composingPosition !== null && composingPosition >= from && composingPosition <= to) return true
  return ranges.some((range) => range.empty
    ? range.head >= from && range.head <= to
    : range.from < to && range.to > from)
}

function activePositionInList(
  from: number,
  to: number,
  ranges: EditorState['selection']['ranges'],
  composingPosition: number | null
): number | null {
  if (composingPosition !== null && composingPosition >= from && composingPosition <= to) {
    return Math.min(composingPosition, Math.max(from, to - 1))
  }
  for (const range of ranges) {
    if (range.empty && range.head >= from && range.head <= to) {
      return Math.min(range.head, Math.max(from, to - 1))
    }
    if (!range.empty && range.from < to && range.to > from) {
      return Math.min(Math.max(range.head, from), Math.max(from, to - 1))
    }
  }
  return null
}

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

export function buildMarkdownPreviewDecorations(state: EditorState, composingPosition: number | null = null): DecorationSet {
  const tree = ensureSyntaxTree(state, state.doc.length, 40) ?? syntaxTree(state)
  const frontmatter = frontmatterRange(state)
  const lineClasses = new Map<number, Set<string>>()
  const decorations: Range<Decoration>[] = []
  const hidden = new Set<string>()
  const selections = state.selection.ranges

  const addLineClass = (from: number, to: number, className: string) => {
    const firstLine = state.doc.lineAt(from)
    const lastPosition = to > from ? to - 1 : from
    const lastLine = state.doc.lineAt(Math.min(lastPosition, state.doc.length))
    for (let number = firstLine.number; number <= lastLine.number; number += 1) {
      const line = state.doc.line(number)
      const names = lineClasses.get(line.from) ?? new Set<string>()
      names.add(className)
      lineClasses.set(line.from, names)
    }
  }

  const hide = (from: number, to: number) => {
    if (to <= from) return
    const key = `${from}:${to}`
    if (hidden.has(key)) return
    hidden.add(key)
    decorations.push(Decoration.replace({}).range(from, to))
  }

  const mark = (from: number, to: number, className: string, attributes?: Record<string, string>) => {
    if (to > from) decorations.push(Decoration.mark({ class: className, ...(attributes ? { tagName: 'a', attributes } : {}) }).range(from, to))
  }

  const hideMarkerAndSpace = (from: number, to: number) => {
    let end = to
    while (end < state.doc.length && (state.doc.sliceString(end, end + 1) === ' ' || state.doc.sliceString(end, end + 1) === '\t')) end += 1
    hide(from, end)
  }

  const visit = (node: MarkdownNode, editingLine?: { from: number; to: number }): void => {
    const overlapsEditingLine = (from: number, to: number) => Boolean(editingLine && from < editingLine.to && to > editingLine.from)
    if (node.name === 'Table' || node.name === 'FencedCode') {
      if (node.name === 'FencedCode') {
        addLineClass(node.from, node.to, 'cm-md-code-block')
        const firstLine = state.doc.lineAt(node.from)
        const lastLine = state.doc.lineAt(Math.max(node.from, node.to - 1))
        addLineClass(firstLine.from, firstLine.to, 'cm-md-code-block-start')
        addLineClass(lastLine.from, lastLine.to, 'cm-md-code-block-end')
      }
      return
    }
    if (node.name === 'Image') {
      if (!overlapsEditingLine(node.from, node.to)) {
        const rawImage = state.doc.sliceString(node.from, node.to)
        decorations.push(Decoration.replace({ widget: new ImagePreviewWidget(rawImage), inclusive: false }).range(node.from, node.to))
      }
      return
    }
    if (node.name === 'StrongEmphasis' || node.name === 'Emphasis' || node.name === 'Strikethrough' || node.name === 'InlineCode') {
      const markerNames = node.name === 'InlineCode' ? new Set(['CodeMark'])
        : node.name === 'Strikethrough' ? new Set(['StrikethroughMark']) : new Set(['EmphasisMark'])
      const markerNodes = descendants(node).filter((child) => markerNames.has(child.name))
      if (markerNodes.length >= 2 && !overlapsEditingLine(node.from, node.to)) {
        markerNodes.forEach((child) => hide(child.from, child.to))
        const className = node.name === 'StrongEmphasis' ? 'cm-md-bold'
          : node.name === 'Emphasis' ? 'cm-md-italic'
            : node.name === 'Strikethrough' ? 'cm-md-strike' : 'cm-md-inline-code'
        mark(markerNodes[0]!.to, markerNodes[markerNodes.length - 1]!.from, className)
      }
    } else if (node.name === 'Link') {
      const children = descendants(node)
      const linkMarks = children.filter((child) => child.name === 'LinkMark')
      const urls = children.filter((child) => child.name === 'URL')
      if (linkMarks.length >= 2 && !overlapsEditingLine(node.from, node.to)) {
        const url = urls[0] ? state.doc.sliceString(urls[0].from, urls[0].to) : ''
        const attrs = url ? markdownLinkAttributes(url) : null
        if (attrs) {
          linkMarks.forEach((child) => hide(child.from, child.to))
          urls.forEach((child) => hide(child.from, child.to))
          mark(linkMarks[0]!.to, linkMarks[1]!.from, 'cm-md-link', { href: attrs.href, target: attrs.target, rel: attrs.rel })
        }
      }
    } else if (node.name === 'TaskMarker') {
      const marker = state.doc.sliceString(node.from, node.to)
      if ((marker === '[ ]' || marker === '[x]' || marker === '[X]') && !overlapsEditingLine(node.from, node.to)) {
        decorations.push(Decoration.replace({ widget: new TaskCheckboxWidget(marker !== '[ ]', node.from), inclusive: false }).range(node.from, node.to))
        addLineClass(node.from, node.to, 'cm-md-task-line')
      }
      return
    } else if (node.name === 'ListMark') {
      if (!overlapsEditingLine(node.from, node.to)) {
        const marker = state.doc.sliceString(node.from, node.to)
        const display = /^\d+[.)]$/u.test(marker) ? marker : '•'
        decorations.push(Decoration.replace({ widget: new MarkerWidget(display, 'cm-md-list-marker'), inclusive: false }).range(node.from, node.to))
        addLineClass(node.from, node.to, 'cm-md-list-line')
      }
      return
    } else if (node.name === 'QuoteMark') {
      if (!overlapsEditingLine(node.from, node.to)) {
        hideMarkerAndSpace(node.from, node.to)
        addLineClass(node.from, node.to, 'cm-md-quote-line')
      }
      return
    } else if (node.name === 'HeaderMark') {
      if (!overlapsEditingLine(node.from, node.to)) hideMarkerAndSpace(node.from, node.to)
      return
    }

    for (let child = node.firstChild; child; child = child.nextSibling) visit(child, editingLine)
  }

  for (let block = tree.topNode.firstChild; block; block = block.nextSibling) {
    const isList = block.name === 'BulletList' || block.name === 'OrderedList'
    const listPosition = isList ? activePositionInList(block.from, block.to, selections, composingPosition) : null
    if (listPosition !== null) {
      const line = state.doc.lineAt(listPosition)
      addLineClass(line.from, line.to, 'cm-md-editing-block')
      visit(block, { from: line.from, to: line.to })
      continue
    }
    if (isActiveBlock(block.from, block.to, selections, composingPosition)) {
      addLineClass(block.from, block.to, 'cm-md-editing-block')
      continue
    }
    if (overlapsFrontmatter(block, frontmatter)) continue
    if (!supportsPreview(block.name) || startsUnknownContainerDirective(state, block)) continue
    const heading = block.name.match(/^ATXHeading([1-6])$/u) ?? block.name.match(/^SetextHeading([12])$/u)
    if (heading) addLineClass(block.from, block.to, `cm-md-heading-${heading[1]}`)
    if (block.name === 'Blockquote') addLineClass(block.from, block.to, 'cm-md-blockquote')
    visit(block)
  }

  for (const [from, names] of lineClasses) decorations.push(Decoration.line({ class: [...names].join(' ') }).range(from))
  return Decoration.set(decorations, true)
}

class MarkdownPreviewPlugin {
  decorations: DecorationSet
  private composingPosition: number | null = null

  constructor(view: EditorView) { this.decorations = buildMarkdownPreviewDecorations(view.state) }

  update(update: ViewUpdate): void {
    if (update.docChanged && this.composingPosition !== null) this.composingPosition = update.changes.mapPos(this.composingPosition, 1)
    for (const transaction of update.transactions) {
      for (const effect of transaction.effects) {
        if (effect.is(setCompositionPosition)) this.composingPosition = effect.value
      }
    }
    if (update.docChanged || update.selectionSet || update.viewportChanged || update.transactions.length) {
      this.decorations = buildMarkdownPreviewDecorations(update.state, this.composingPosition)
    }
  }
}

export const markdownLivePreview = [
  ViewPlugin.fromClass(MarkdownPreviewPlugin, { decorations: (plugin) => plugin.decorations }),
  EditorView.domEventHandlers({
    compositionstart(_event, view) {
      view.dispatch({ effects: setCompositionPosition.of(view.state.selection.main.head) })
      return false
    },
    compositionend(_event, view) {
      view.dispatch({ effects: setCompositionPosition.of(null) })
      return false
    }
  })
]
