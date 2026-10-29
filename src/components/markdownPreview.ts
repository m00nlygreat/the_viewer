import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { StateEffect, StateField, type ChangeDesc, type EditorState, type Range } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { markdownLinkAttributes, renderMarkdown } from '../domain/markdown'
import { detectMarkdownFrontmatter } from '../domain/formats/markdownFrontmatter'
import { parseMarkdownTable } from '../domain/formats/markdownTable'
import { MarkdownCodeBlockState, type MarkdownCodeBlockContext } from './markdownCodeBlockState'
import { MarkdownCodeBlockWidget } from './MarkdownCodeBlockWidget'
import { MarkdownTableState } from './markdownTableState'
import { MarkdownTableWidget } from './MarkdownTableWidget'

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

class MarkdownFrontmatterWidget extends WidgetType {
  constructor(private readonly content: string, private readonly from: number) { super() }
  eq(other: WidgetType): boolean { return other instanceof MarkdownFrontmatterWidget && other.content === this.content && other.from === this.from }
  toDOM(view: EditorView): HTMLElement {
    const section = document.createElement('section')
    section.className = 'markdown-frontmatter cm-md-frontmatter-widget'
    section.setAttribute('aria-label', 'YAML frontmatter')

    const label = document.createElement('div')
    label.className = 'markdown-frontmatter-label'
    label.textContent = 'YAML'

    const edit = document.createElement('button')
    edit.type = 'button'
    edit.className = 'toolbar-button'
    edit.textContent = 'YAML 원문 편집'
    edit.addEventListener('mousedown', (event) => event.preventDefault())
    edit.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      view.dispatch({ selection: { anchor: this.from } })
      view.focus()
    })
    label.append(edit)

    const pre = document.createElement('pre')
    const code = document.createElement('code')
    code.className = 'language-yaml'
    code.textContent = this.content
    pre.append(code)
    section.append(label, pre)
    return section
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

function frontmatterRange(state: EditorState) {
  return detectMarkdownFrontmatter(state.doc.toString())
}

function overlapsFrontmatter(node: { from: number; to: number }, frontmatter: { from: number; to: number } | null): boolean {
  return Boolean(frontmatter && node.from < frontmatter.to && node.to > frontmatter.from)
}

function markdownCodeBlockContext(state: EditorState, node: MarkdownNode): MarkdownCodeBlockContext {
  const children = descendants(node)
  const firstCodeText = children.find((child) => child.name === 'CodeText')
  const codeMarks = children.filter((child) => child.name === 'CodeMark')
  const bodyPrefix = firstCodeText
    ? state.doc.sliceString(state.doc.lineAt(firstCodeText.from).from, firstCodeText.from)
    : ''
  const closingMark = codeMarks.length > 1 ? codeMarks[codeMarks.length - 1] : null
  const closingPrefix = closingMark
    ? state.doc.sliceString(state.doc.lineAt(closingMark.from).from, closingMark.from)
    : bodyPrefix
  return { bodyPrefix, closingPrefix }
}

function markdownCodeBlockFrom(state: EditorState, from: number): number {
  const line = state.doc.lineAt(from)
  const prefix = state.doc.sliceString(line.from, from)
  return /^[ \t]{0,3}$/u.test(prefix) ? line.from : from
}

function supportsPreview(blockName: string): boolean {
  return blockName === 'Paragraph' || blockName === 'BulletList' || blockName === 'OrderedList' ||
    blockName === 'Blockquote' || /^ATXHeading[1-6]$/u.test(blockName) || /^SetextHeading[12]$/u.test(blockName) ||
    blockName === 'Table' || blockName === 'FencedCode'
}

function startsUnknownContainerDirective(state: EditorState, block: MarkdownNode): boolean {
  return block.name === 'Paragraph' && /^\s*:::/u.test(state.doc.lineAt(block.from).text)
}

function isPositionInBlock(state: EditorState, from: number, to: number, position: number): boolean {
  const firstLine = state.doc.lineAt(from).number
  const lastPosition = to > from ? to - 1 : to
  const lastLine = state.doc.lineAt(lastPosition).number
  const positionLine = state.doc.lineAt(position).number
  return positionLine >= firstLine && positionLine <= lastLine
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

export function buildMarkdownPreviewDecorations(
  state: EditorState,
  composingPosition: number | null = null,
  codeBlocksAreWidgets = false
): DecorationSet {
  const tree = ensureSyntaxTree(state, state.doc.length, 40) ?? syntaxTree(state)
  const frontmatter = frontmatterRange(state)
  const editingPosition = composingPosition ?? state.selection.main.head
  const activeLine = state.doc.lineAt(editingPosition)
  const editingLine = { from: activeLine.from, to: activeLine.to }
  const lineClasses = new Map<number, Set<string>>()
  const decorations: Range<Decoration>[] = []
  const hidden = new Set<string>()
  const widgetRanges: Array<{ from: number; to: number }> = []
  if (codeBlocksAreWidgets) tree.iterate({ enter: (node) => {
    if (node.name === 'FencedCode' && !overlapsFrontmatter(node, frontmatter)) widgetRanges.push({ from: markdownCodeBlockFrom(state, node.from), to: node.to })
  } })

  const addLineClass = (from: number, to: number, className: string) => {
    const firstLine = state.doc.lineAt(from)
    const lastPosition = to > from ? to - 1 : from
    const lastLine = state.doc.lineAt(Math.min(lastPosition, state.doc.length))
    for (let number = firstLine.number; number <= lastLine.number; number += 1) {
      const line = state.doc.line(number)
      if (widgetRanges.some((range) => line.from >= range.from && line.from < range.to)) continue
      const names = lineClasses.get(line.from) ?? new Set<string>()
      names.add(className)
      lineClasses.set(line.from, names)
    }
  }

  const addNestedListLineClasses = (node: MarkdownNode, depth = 0): void => {
    const isList = node.name === 'BulletList' || node.name === 'OrderedList'
    const currentDepth = depth + (isList ? 1 : 0)
    if (isList && currentDepth > 1) {
      const firstLine = state.doc.lineAt(node.from)
      const lastPosition = node.to > node.from ? node.to - 1 : node.to
      const lastLine = state.doc.lineAt(Math.min(lastPosition, state.doc.length))
      for (let number = firstLine.number; number <= lastLine.number; number += 1) {
        const line = state.doc.line(number)
        if (line.from === editingLine.from) continue
        addLineClass(line.from, line.to, `cm-md-list-depth-${Math.min(currentDepth, 6)}`)
      }
    }
    for (let child = node.firstChild; child; child = child.nextSibling) addNestedListLineClasses(child, currentDepth)
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

  const addBlockLineClasses = (block: MarkdownNode) => {
    const heading = block.name.match(/^ATXHeading([1-6])$/u) ?? block.name.match(/^SetextHeading([12])$/u)
    if (heading) addLineClass(block.from, block.to, `cm-md-heading-${heading[1]}`)
    if (block.name === 'Blockquote') addLineClass(block.from, block.to, 'cm-md-blockquote')
  }

  const hideMarkerAndSpace = (from: number, to: number) => {
    let end = to
    while (end < state.doc.length && (state.doc.sliceString(end, end + 1) === ' ' || state.doc.sliceString(end, end + 1) === '\t')) end += 1
    hide(from, end)
  }

  let editingRenderedBlock = false
  tree.iterate({ enter: (node) => {
    if ((node.name === 'Table' || node.name === 'FencedCode') && editingPosition >= node.from && editingPosition <= node.to && !overlapsFrontmatter(node, frontmatter)) {
      editingRenderedBlock = true
    }
  } })
  if (!editingRenderedBlock) addLineClass(editingLine.from, editingLine.to, 'cm-md-editing-block')

  const visit = (node: MarkdownNode, editingLine?: { from: number; to: number }): void => {
    const overlapsEditingLine = (from: number, to: number) => Boolean(editingLine && from < editingLine.to && to > editingLine.from)
    if (node.name === 'Table') return
    if (node.name === 'FencedCode') {
      if (!codeBlocksAreWidgets) {
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
    const canPreviewBlock = !overlapsFrontmatter(block, frontmatter) && supportsPreview(block.name) && !startsUnknownContainerDirective(state, block)
    if (canPreviewBlock) addBlockLineClasses(block)
    if (canPreviewBlock && (block.name === 'BulletList' || block.name === 'OrderedList' || block.name === 'Blockquote')) addNestedListLineClasses(block)

    if (isPositionInBlock(state, block.from, block.to, editingPosition)) {
      if (canPreviewBlock) visit(block, editingLine)
      continue
    }
    if (!canPreviewBlock) continue
    visit(block)
  }

  for (const [from, names] of lineClasses) decorations.push(Decoration.line({ class: [...names].join(' ') }).range(from))
  return Decoration.set(decorations, true)
}

export function buildMarkdownFrontmatterDecorations(state: EditorState, composingPosition: number | null = null): DecorationSet {
  const frontmatter = frontmatterRange(state)
  const editingPosition = composingPosition ?? state.selection.main.head
  if (!frontmatter || (editingPosition >= frontmatter.from && editingPosition < frontmatter.to)) return Decoration.set([], true)
  return Decoration.set([
    Decoration.replace({ widget: new MarkdownFrontmatterWidget(frontmatter.content, frontmatter.from), inclusive: false, block: true }).range(frontmatter.from, frontmatter.to)
  ], true)
}

interface MarkdownFrontmatterDecorationValue {
  composingPosition: number | null
  decorations: DecorationSet
}

function markdownFrontmatterDecorations() {
  return StateField.define<MarkdownFrontmatterDecorationValue>({
    create: (state) => ({ composingPosition: null, decorations: buildMarkdownFrontmatterDecorations(state) }),
    update: (value, transaction) => {
      let composingPosition = transaction.docChanged && value.composingPosition !== null
        ? transaction.changes.mapPos(value.composingPosition, 1)
        : value.composingPosition
      let needsRefresh = transaction.docChanged || Boolean(transaction.selection && !transaction.selection.eq(transaction.startState.selection))
      for (const effect of transaction.effects) {
        if (!effect.is(setCompositionPosition) || effect.value === composingPosition) continue
        composingPosition = effect.value
        needsRefresh = true
      }
      return needsRefresh
        ? { composingPosition, decorations: buildMarkdownFrontmatterDecorations(transaction.state, composingPosition) }
        : value
    },
    provide: (field) => EditorView.decorations.from(field, (value) => value.decorations)
  })
}

interface MarkdownTableDecorationValue {
  tableStates: Map<number, MarkdownTableState>
  decorations: DecorationSet
}

function buildMarkdownTableDecorationValue(
  state: EditorState,
  theme: 'light' | 'dark',
  previous = new Map<number, MarkdownTableState>(),
  changes?: ChangeDesc
): MarkdownTableDecorationValue {
  const mappedPrevious = new Map<number, MarkdownTableState>()
  for (const [from, table] of previous) mappedPrevious.set(changes ? changes.mapPos(from, -1) : from, table)
  const tableStates = new Map<number, MarkdownTableState>()
  const ranges: Range<Decoration>[] = []
  const frontmatter = frontmatterRange(state)
  const tree = ensureSyntaxTree(state, state.doc.length, 40) ?? syntaxTree(state)

  tree.iterate({ enter: (node) => {
    if (node.name !== 'Table' || overlapsFrontmatter(node, frontmatter)) return
    const source = state.doc.sliceString(node.from, node.to)
    if (!source.trim() || !parseMarkdownTable(source)) return
    const table = mappedPrevious.get(node.from) ?? new MarkdownTableState(node.from, node.to, source, theme)
    table.update(node.from, node.to, source, theme)
    tableStates.set(node.from, table)
    if (node.to > node.from) ranges.push(Decoration.replace({ widget: new MarkdownTableWidget(table), inclusive: false, block: true }).range(node.from, node.to))
  } })

  return { tableStates, decorations: Decoration.set(ranges, true) }
}

function markdownTableDecorations(theme: 'light' | 'dark') {
  return StateField.define<MarkdownTableDecorationValue>({
    create: (state) => buildMarkdownTableDecorationValue(state, theme),
    update: (value, transaction) => transaction.docChanged
      ? buildMarkdownTableDecorationValue(transaction.state, theme, value.tableStates, transaction.changes)
      : value,
    provide: (field) => EditorView.decorations.from(field, (value) => value.decorations)
  })
}

interface MarkdownCodeBlockDecorationValue {
  codeBlocks: Map<number, MarkdownCodeBlockState>
  decorations: DecorationSet
}

function buildMarkdownCodeBlockDecorationValue(
  state: EditorState,
  theme: 'light' | 'dark',
  undo: () => void,
  redo: () => void,
  previous = new Map<number, MarkdownCodeBlockState>(),
  changes?: ChangeDesc
): MarkdownCodeBlockDecorationValue {
  const mappedPrevious = new Map<number, MarkdownCodeBlockState>()
  for (const [from, codeBlock] of previous) mappedPrevious.set(changes ? changes.mapPos(from, -1) : from, codeBlock)
  const codeBlocks = new Map<number, MarkdownCodeBlockState>()
  const ranges: Range<Decoration>[] = []
  const frontmatter = frontmatterRange(state)
  const tree = ensureSyntaxTree(state, state.doc.length, 40) ?? syntaxTree(state)

  const visit = (node: MarkdownNode): void => {
    if (node.name === 'FencedCode') {
      if (overlapsFrontmatter(node, frontmatter)) return
      const from = markdownCodeBlockFrom(state, node.from)
      const source = state.doc.sliceString(from, node.to)
      if (!source.trim()) return
      const context = markdownCodeBlockContext(state, node)
      const codeBlock = mappedPrevious.get(from) ?? new MarkdownCodeBlockState(from, node.to, source, theme, undo, redo, context)
      codeBlock.update(from, node.to, source, theme, context)
      codeBlocks.set(from, codeBlock)
      if (node.to > from) ranges.push(Decoration.replace({ widget: new MarkdownCodeBlockWidget(codeBlock), inclusive: false, block: true }).range(from, node.to))
      return
    }
    for (let child = node.firstChild; child; child = child.nextSibling) visit(child)
  }
  for (let node = tree.topNode.firstChild; node; node = node.nextSibling) visit(node)

  return { codeBlocks, decorations: Decoration.set(ranges, true) }
}

function markdownCodeBlockDecorations(theme: 'light' | 'dark', undo: () => void, redo: () => void) {
  return StateField.define<MarkdownCodeBlockDecorationValue>({
    create: (state) => buildMarkdownCodeBlockDecorationValue(state, theme, undo, redo),
    update: (value, transaction) => transaction.docChanged
      ? buildMarkdownCodeBlockDecorationValue(transaction.state, theme, undo, redo, value.codeBlocks, transaction.changes)
      : value,
    provide: (field) => EditorView.decorations.from(field, (value) => value.decorations)
  })
}

class MarkdownPreviewPlugin {
  decorations: DecorationSet
  private composingPosition: number | null = null

  constructor(view: EditorView) { this.decorations = buildMarkdownPreviewDecorations(view.state, null, true) }

  update(update: ViewUpdate): void {
    if (update.docChanged && this.composingPosition !== null) this.composingPosition = update.changes.mapPos(this.composingPosition, 1)
    let needsRefresh = update.docChanged || update.selectionSet
    for (const transaction of update.transactions) {
      for (const effect of transaction.effects) {
        if (effect.is(setCompositionPosition) && effect.value !== this.composingPosition) {
          this.composingPosition = effect.value
          needsRefresh = true
        }
      }
    }
    if (needsRefresh) this.decorations = buildMarkdownPreviewDecorations(update.state, this.composingPosition, true)
  }
}

export function markdownLivePreview(theme: 'light' | 'dark', undo: () => void = () => {}, redo: () => void = () => {}) {
  return [
    markdownFrontmatterDecorations(),
    markdownTableDecorations(theme),
    markdownCodeBlockDecorations(theme, undo, redo),
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
}
