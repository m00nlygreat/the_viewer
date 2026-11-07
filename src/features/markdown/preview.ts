import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { ChangeSet, EditorState, StateEffect, StateField, Transaction, type ChangeDesc, type Range } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { markdownLinkAttributes, renderMarkdown } from '../../domain/markdown'
import { detectMarkdownFrontmatter } from '../../domain/formats/markdownFrontmatter'
import { MarkdownFrontmatterState } from './frontmatterState'
import { MarkdownFrontmatterWidget } from './FrontmatterWidget'
import { MarkdownCodeBlockState, type MarkdownCodeBlockContext } from './codeBlockState'
import { MarkdownCodeBlockWidget } from './CodeBlockWidget'
import { MarkdownTableState } from './tableState'
import { MarkdownTableWidget } from './TableWidget'
import { collectMarkdownReferences, type MarkdownReference } from '../../domain/markdownReferences'
import { parseLocalReference } from '../../domain/folderPaths'
import { LocalReferenceWidget } from './LocalReferenceWidget'
import { markdownReferenceKey, type MarkdownReferenceContext } from './localReferenceState'
import type { RefObject } from 'react'
export { taskMarkerRangesForSelection } from './taskMarkers'

type MarkdownNode = ReturnType<typeof syntaxTree>['topNode']
interface MarkdownDocumentAnalysis {
  tree: ReturnType<typeof syntaxTree>
  complete: boolean
  frontmatter: ReturnType<typeof detectMarkdownFrontmatter>
  references: MarkdownReference[]
  localReferences: MarkdownReference[]
  renderableLocalReferences: MarkdownReference[]
  localReferencesByLine: Map<number, MarkdownReference[]>
  localReferenceRanges: Set<string>
  tableRanges: Array<{ from: number; to: number }>
}
const markdownAnalysisByDocument = new WeakMap<object, MarkdownDocumentAnalysis>()
const noMarkdownReferenceRanges = new Set<string>()

function markdownDocumentAnalysis(state: EditorState): MarkdownDocumentAnalysis {
  const key = state.doc as object
  const cached = markdownAnalysisByDocument.get(key)
  if (cached?.complete) return cached
  const source = state.doc.toString()
  const completeTree = ensureSyntaxTree(state, state.doc.length, 40)
  const tree = completeTree ?? syntaxTree(state)
  const frontmatter = detectMarkdownFrontmatter(source)
  const references = collectMarkdownReferences(source)
  const localReferences = references.filter(isLocalReference)
  const tableRanges: Array<{ from: number; to: number }> = []
  tree.iterate({ enter: (node) => { if (node.name === 'Table') tableRanges.push({ from: node.from, to: node.to }) } })
  const renderableLocalReferences = localReferences.filter((reference) =>
    !overlapsFrontmatter(reference, frontmatter) && !tableRanges.some((range) => reference.from >= range.from && reference.to <= range.to))
  const localReferencesByLine = new Map<number, MarkdownReference[]>()
  for (const reference of renderableLocalReferences) {
    const first = state.doc.lineAt(reference.from).number
    const last = state.doc.lineAt(Math.max(reference.from, reference.to - 1)).number
    for (let line = first; line <= last; line++) {
      const items = localReferencesByLine.get(line)
      if (items) items.push(reference)
      else localReferencesByLine.set(line, [reference])
    }
  }
  const analysis: MarkdownDocumentAnalysis = {
    tree, complete: completeTree !== null, frontmatter, references, localReferences, renderableLocalReferences, localReferencesByLine,
    localReferenceRanges: new Set(localReferences.map((reference) => `${reference.from}:${reference.to}`)), tableRanges
  }
  if (analysis.complete) markdownAnalysisByDocument.set(key, analysis)
  return analysis
}

const setCompositionPosition = StateEffect.define<number | null>()
export const markdownContextChanged = StateEffect.define<void>()
const setMarkdownFocus = StateEffect.define<boolean>()

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

function frontmatterRange(state: EditorState) {
  return markdownDocumentAnalysis(state).frontmatter
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

function walkMarkdownTree(node: MarkdownNode, visit: (node: MarkdownNode) => void): void {
  const stack = [node]
  while (stack.length) {
    const current = stack.pop()!
    visit(current)
    for (let child = current.firstChild; child; child = child.nextSibling) stack.push(child)
  }
}

function markdownBlockAtPosition(state: EditorState, position: number): MarkdownNode | null {
  const tree = markdownDocumentAnalysis(state).tree
  let node = tree.resolveInner(Math.min(position, state.doc.length), -1)
  while (node.parent?.parent) node = node.parent
  return node.parent ? node : null
}

export function buildMarkdownPreviewDecorations(
  state: EditorState,
  composingPosition: number | null = null,
  codeBlocksAreWidgets = false,
  editorIsFocused = true,
  contextRef?: RefObject<MarkdownReferenceContext | null>,
  onlyBlocks?: readonly MarkdownNode[]
): DecorationSet {
  const analysis = markdownDocumentAnalysis(state)
  const tree = analysis.tree
  const blocks = onlyBlocks ?? Array.from((function* () { for (let block = tree.topNode.firstChild; block; block = block.nextSibling) yield block })())
  const frontmatter = analysis.frontmatter
  const editingPosition = composingPosition ?? state.selection.main.head
  const activeLine = state.doc.lineAt(editingPosition)
  const editingLine = { from: activeLine.from, to: activeLine.to }
  const lineClasses = new Map<number, Set<string>>()
  const decorations: Range<Decoration>[] = []
  const hidden = new Set<string>()
  const localReferenceRanges = contextRef?.current?.folderId ? analysis.localReferenceRanges : noMarkdownReferenceRanges
  const widgetRanges: Array<{ from: number; to: number }> = []
  if (codeBlocksAreWidgets) for (const block of blocks) walkMarkdownTree(block, (node) => {
    if (node.name === 'FencedCode' && !overlapsFrontmatter(node, frontmatter)) widgetRanges.push({ from: markdownCodeBlockFrom(state, node.from), to: node.to })
  })

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
        if (editorIsFocused && line.from === editingLine.from) continue
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
  for (const block of blocks) walkMarkdownTree(block, (node) => {
    if ((node.name === 'Table' || node.name === 'FencedCode') && editingPosition >= node.from && editingPosition <= node.to && !overlapsFrontmatter(node, frontmatter)) {
      editingRenderedBlock = true
    }
  })
  const editingFrontmatter = Boolean(frontmatter && editingPosition >= frontmatter.from && editingPosition < frontmatter.to)
  if (editorIsFocused && !editingRenderedBlock && !editingFrontmatter) addLineClass(editingLine.from, editingLine.to, 'cm-md-editing-block')

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
        if (localReferenceRanges.has(`${node.from}:${node.to}`)) return
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
      if (localReferenceRanges.has(`${node.from}:${node.to}`)) return
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

  for (const block of blocks) {
    const canPreviewBlock = !overlapsFrontmatter(block, frontmatter) && supportsPreview(block.name) && !startsUnknownContainerDirective(state, block)
    if (canPreviewBlock) addBlockLineClasses(block)
    if (canPreviewBlock && (block.name === 'BulletList' || block.name === 'OrderedList' || block.name === 'Blockquote')) addNestedListLineClasses(block)

    if (isPositionInBlock(state, block.from, block.to, editingPosition)) {
      if (canPreviewBlock) visit(block, editorIsFocused ? editingLine : undefined)
      continue
    }
    if (!canPreviewBlock) continue
    visit(block)
  }

  for (const [from, names] of lineClasses) decorations.push(Decoration.line({ class: [...names].join(' ') }).range(from))
  return Decoration.set(decorations, true)
}

export function refreshMarkdownPreviewForActiveLine(
  previous: DecorationSet,
  oldState: EditorState,
  state: EditorState,
  composingPosition: number | null,
  codeBlocksAreWidgets: boolean,
  editorIsFocused: boolean,
  contextRef: RefObject<MarkdownReferenceContext | null> | undefined
): DecorationSet {
  const oldLine = oldState.doc.lineAt(oldState.selection.main.head)
  const newLine = state.doc.lineAt(state.selection.main.head)
  const blocks = [
    markdownBlockAtPosition(oldState, oldState.selection.main.head),
    markdownBlockAtPosition(state, state.selection.main.head)
  ].filter((block): block is MarkdownNode => block !== null)
  const uniqueBlocks = [...new Map(blocks.map((block) => [`${block.from}:${block.to}:${block.name}`, block])).values()]
  const affectedRanges = [
    ...uniqueBlocks.map((block) => ({ from: block.from, to: block.to })),
    { from: oldLine.from, to: oldLine.to },
    { from: newLine.from, to: newLine.to }
  ]
  let decorations = previous
  for (const range of affectedRanges) {
    decorations = decorations.update({
      filterFrom: range.from,
      filterTo: Math.max(range.from + 1, range.to),
      filter: (from, to) => from === to
        ? !(from >= range.from && from <= range.to)
        : !(from < range.to && to > range.from)
    })
  }
  const refreshed = buildMarkdownPreviewDecorations(state, composingPosition, codeBlocksAreWidgets, editorIsFocused, contextRef, uniqueBlocks)
  const additions: Range<Decoration>[] = []
  refreshed.between(0, state.doc.length, (from, to, decoration) => { additions.push(decoration.range(from, to)) })
  return decorations.update({ add: additions, sort: true })
}

function isLocalReference(reference: MarkdownReference): boolean {
  const syntax = reference.kind.startsWith('obsidian') ? 'obsidian' : 'markdown'
  return parseLocalReference(reference.target, syntax).kind !== 'external'
}

function buildLocalReferenceDecorations(
  state: EditorState,
  contextRef: RefObject<MarkdownReferenceContext | null>,
  editorIsFocused: boolean,
  analysis = markdownDocumentAnalysis(state)
): DecorationSet {
  const context = contextRef.current
  if (!context?.folderId || !context.services) return Decoration.set([], true)
  const active = state.doc.lineAt(state.selection.main.head)
  const ranges: Range<Decoration>[] = []
  context.referenceState.retain(context.instanceId, new Set(analysis.localReferences.map((reference) => markdownReferenceKey(context.instanceId, reference))))
  for (const reference of analysis.renderableLocalReferences) {
    if (editorIsFocused && reference.from < active.to && reference.to > active.from) continue
    ranges.push(localReferenceDecoration(reference, contextRef))
  }
  return Decoration.set(ranges, true)
}

function localReferenceDecoration(reference: MarkdownReference, contextRef: RefObject<MarkdownReferenceContext | null>): Range<Decoration> {
  const block = reference.kind === 'image' || reference.kind === 'obsidian-embed'
  return Decoration.replace({ widget: new LocalReferenceWidget(reference, contextRef), inclusive: false, ...(block ? { block: true } : {}) }).range(reference.from, reference.to)
}

function localReferenceDecorationsForLine(
  analysis: MarkdownDocumentAnalysis,
  contextRef: RefObject<MarkdownReferenceContext | null>,
  lineNumber: number,
  skipLine?: { from: number; to: number }
): Range<Decoration>[] {
  const context = contextRef.current
  if (!context?.folderId || !context.services) return []
  return (analysis.localReferencesByLine.get(lineNumber) ?? [])
    .filter((reference) => !(skipLine && reference.from < skipLine.to && reference.to > skipLine.from))
    .map((reference) => localReferenceDecoration(reference, contextRef))
}

interface LocalReferenceDecorationValue { focused: boolean; activeLine: number | null; analysis: MarkdownDocumentAnalysis; decorations: DecorationSet }

function markdownLocalReferenceDecorations(contextRef: RefObject<MarkdownReferenceContext | null>) {
  return StateField.define<LocalReferenceDecorationValue>({
    create: (state) => {
      const analysis = markdownDocumentAnalysis(state)
      return { focused: false, activeLine: null, analysis, decorations: buildLocalReferenceDecorations(state, contextRef, false, analysis) }
    },
    update(value, transaction) {
      let focused = value.focused
      let contextChanged = false
      const context = contextRef.current
      if (transaction.docChanged && context) context.referenceState.remap(transaction.changes, context.instanceId)
      for (const effect of transaction.effects) {
        if (effect.is(markdownContextChanged)) contextChanged = true
        if (effect.is(setMarkdownFocus) && effect.value !== focused) focused = effect.value
      }
      const state = transaction.state
      const analysis = transaction.docChanged ? markdownDocumentAnalysis(state) : value.analysis
      const activeLine = focused ? state.doc.lineAt(state.selection.main.head).number : null
      if (transaction.docChanged || contextChanged || focused !== value.focused) {
        return { focused, activeLine, analysis, decorations: buildLocalReferenceDecorations(state, contextRef, focused, analysis) }
      }
      if (!transaction.selection || activeLine === value.activeLine) return value

      const oldLine = value.activeLine === null ? null : state.doc.line(value.activeLine)
      const nextLine = activeLine === null ? null : state.doc.line(activeLine)
      const add = oldLine ? localReferenceDecorationsForLine(analysis, contextRef, value.activeLine!, nextLine ?? undefined) : []
      const decorations = nextLine
        ? value.decorations.update({ add, sort: true, filterFrom: nextLine.from, filterTo: nextLine.to, filter: (from, to) => !(from < nextLine.to && to > nextLine.from) })
        : value.decorations.update({ add, sort: true })
      return { focused, activeLine, analysis, decorations }
    },
    provide: (field) => EditorView.decorations.from(field, (value) => value.decorations)
  })
}

class MarkdownReferenceFocusPlugin {
  private focused: boolean
  private destroyed = false
  constructor(private readonly view: EditorView) {
    this.focused = view.hasFocus
    if (this.focused) queueMicrotask(() => { if (!this.destroyed) this.view.dispatch({ effects: setMarkdownFocus.of(true) }) })
  }
  update(update: ViewUpdate): void {
    if (!update.focusChanged || this.focused === update.view.hasFocus) return
    this.focused = update.view.hasFocus
    const focused = this.focused
    queueMicrotask(() => { if (!this.destroyed) this.view.dispatch({ effects: setMarkdownFocus.of(focused) }) })
  }
  destroy(): void { this.destroyed = true }
}

export function buildMarkdownFrontmatterDecorations(
  state: EditorState,
  theme: 'light' | 'dark' = 'dark',
  undo: () => void = () => {},
  redo: () => void = () => {}
): DecorationSet {
  const frontmatter = frontmatterRange(state)
  if (!frontmatter) return Decoration.set([], true)
  const block = new MarkdownFrontmatterState(frontmatter, theme, undo, redo)
  return Decoration.set([
    Decoration.replace({ widget: new MarkdownFrontmatterWidget(block), inclusive: false, block: true }).range(frontmatter.from, frontmatter.to)
  ], true)
}

interface MarkdownFrontmatterDecorationValue {
  frontmatter: MarkdownFrontmatterState | null
  decorations: DecorationSet
}

function buildMarkdownFrontmatterDecorationValue(
  state: EditorState,
  theme: 'light' | 'dark',
  undo: () => void,
  redo: () => void,
  previous: MarkdownFrontmatterState | null = null
): MarkdownFrontmatterDecorationValue {
  const frontmatter = frontmatterRange(state)
  if (!frontmatter) return { frontmatter: null, decorations: Decoration.set([], true) }
  const block = previous ?? new MarkdownFrontmatterState(frontmatter, theme, undo, redo)
  block.update(frontmatter, theme)
  const decorations = Decoration.set([
    Decoration.replace({ widget: new MarkdownFrontmatterWidget(block), inclusive: false, block: true }).range(frontmatter.from, frontmatter.to)
  ], true)
  return { frontmatter: block, decorations }
}

function markdownFrontmatterDecorations(theme: 'light' | 'dark', undo: () => void, redo: () => void) {
  return StateField.define<MarkdownFrontmatterDecorationValue>({
    create: (state) => buildMarkdownFrontmatterDecorationValue(state, theme, undo, redo),
    update: (value, transaction) => transaction.docChanged
      ? buildMarkdownFrontmatterDecorationValue(transaction.state, theme, undo, redo, value.frontmatter)
      : value,
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
  changes?: ChangeDesc,
  contextRef?: RefObject<MarkdownReferenceContext | null>
): MarkdownTableDecorationValue {
  const mappedPrevious = new Map<number, MarkdownTableState>()
  for (const [from, table] of previous) mappedPrevious.set(changes ? changes.mapPos(from, -1) : from, table)
  const tableStates = new Map<number, MarkdownTableState>()
  const ranges: Range<Decoration>[] = []
  const frontmatter = frontmatterRange(state)
  const tree = markdownDocumentAnalysis(state).tree
  const context = contextRef?.current ?? null

  tree.iterate({ enter: (node) => {
    if (node.name !== 'Table' || overlapsFrontmatter(node, frontmatter)) return
    const source = state.doc.sliceString(node.from, node.to)
    if (!source.trim()) return
    const previousTable = mappedPrevious.get(node.from)
    const table = previousTable ?? new MarkdownTableState(node.from, node.to, source, theme, context)
    if (previousTable && !table.update(node.from, node.to, source, theme, context)) return
    tableStates.set(node.from, table)
    if (node.to > node.from) ranges.push(Decoration.replace({ widget: new MarkdownTableWidget(table), inclusive: true, block: true }).range(node.from, node.to))
  } })

  return { tableStates, decorations: Decoration.set(ranges, true) }
}

function markdownTableDecorations(theme: 'light' | 'dark', contextRef: RefObject<MarkdownReferenceContext | null>) {
  return StateField.define<MarkdownTableDecorationValue>({
    create: (state) => buildMarkdownTableDecorationValue(state, theme, new Map(), undefined, contextRef),
    update: (value, transaction) => transaction.docChanged || transaction.effects.some((effect) => effect.is(markdownContextChanged))
      ? buildMarkdownTableDecorationValue(transaction.state, theme, value.tableStates, transaction.changes, contextRef)
      : value,
    provide: (field) => EditorView.decorations.from(field, (value) => value.decorations)
  })
}

function markdownTableSeparatorPrefix(state: EditorState, from: number, to: number, inserted: string): string {
  if (!inserted || inserted.startsWith('\n')) return ''
  const tree = markdownDocumentAnalysis(state).tree
  let tableEnd: number | null = null
  tree.iterate({ enter: (node) => {
    if (node.name === 'Table' && (node.to === from || node.to + 1 === from)) tableEnd = node.to
  } })
  if (tableEnd === null) return ''
  if (from === tableEnd) return '\n\n'

  const line = state.doc.lineAt(from)
  if (line.text.trim() !== '' || from < line.from || to > line.to + 1 || line.number <= 1) return ''
  const previous = state.doc.line(line.number - 1)
  return previous.to === tableEnd && line.from === previous.to + 1 ? '\n' : ''
}

function markdownTableSeparatorInput(transaction: Transaction): Transaction {
  if (!transaction.docChanged || !transaction.isUserEvent('input')) return transaction

  const changes: Array<{ from: number; to: number; insert: string }> = []
  const insertedSeparators: Array<{ from: number; insert: string }> = []
  transaction.changes.iterChanges((fromA, toA, fromB, _toB, inserted) => {
    const text = inserted.toString()
    const prefix = markdownTableSeparatorPrefix(transaction.startState, fromA, toA, text)
    changes.push({ from: fromA, to: toA, insert: `${prefix}${text}` })
    if (prefix) insertedSeparators.push({ from: fromB, insert: prefix })
  })
  if (!insertedSeparators.length) return transaction

  const extraChanges = ChangeSet.of(insertedSeparators, transaction.newDoc.length)
  const userEvent = transaction.annotation(Transaction.userEvent)
  const time = transaction.annotation(Transaction.time)
  const addToHistory = transaction.annotation(Transaction.addToHistory)
  const annotations = [
    ...(userEvent === undefined ? [] : [Transaction.userEvent.of(userEvent)]),
    ...(time === undefined ? [] : [Transaction.time.of(time)]),
    ...(addToHistory === undefined ? [] : [Transaction.addToHistory.of(addToHistory)])
  ]
  const effects = transaction.effects
    .map((effect) => effect.map(extraChanges))
    .filter((effect) => effect !== undefined)

  return transaction.startState.update({
    changes,
    selection: transaction.newSelection.map(extraChanges),
    effects,
    annotations,
    scrollIntoView: transaction.scrollIntoView,
    filter: false
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
  const tree = markdownDocumentAnalysis(state).tree

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
      if (node.to > from) ranges.push(Decoration.replace({ widget: new MarkdownCodeBlockWidget(codeBlock), inclusive: true, block: true }).range(from, node.to))
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
  private editorIsFocused: boolean
  private readonly contextRef?: RefObject<MarkdownReferenceContext | null>

  constructor(view: EditorView, contextRef?: RefObject<MarkdownReferenceContext | null>) {
    this.contextRef = contextRef
    this.editorIsFocused = view.hasFocus
    this.decorations = buildMarkdownPreviewDecorations(view.state, null, true, this.editorIsFocused, this.contextRef)
  }

  update(update: ViewUpdate): void {
    if (update.docChanged && this.composingPosition !== null) this.composingPosition = update.changes.mapPos(this.composingPosition, 1)
    const activeLineChanged = update.selectionSet && update.startState.doc.lineAt(update.startState.selection.main.head).number !== update.state.doc.lineAt(update.state.selection.main.head).number
    const contextChanged = update.transactions.some((transaction) => transaction.effects.some((effect) => effect.is(markdownContextChanged)))
    let compositionChanged = false
    let needsRefresh = update.docChanged || activeLineChanged || update.focusChanged || contextChanged
    if (update.focusChanged) this.editorIsFocused = update.view.hasFocus
    for (const transaction of update.transactions) {
      for (const effect of transaction.effects) {
        if (effect.is(setCompositionPosition) && effect.value !== this.composingPosition) {
          this.composingPosition = effect.value
          compositionChanged = true
          needsRefresh = true
        }
      }
    }
    if (!needsRefresh) return
    if (!update.docChanged && activeLineChanged && !update.focusChanged && !contextChanged && !compositionChanged) {
      this.decorations = refreshMarkdownPreviewForActiveLine(this.decorations, update.startState, update.state, this.composingPosition, true, this.editorIsFocused, this.contextRef)
    } else this.decorations = buildMarkdownPreviewDecorations(update.state, this.composingPosition, true, this.editorIsFocused, this.contextRef)
  }
}

const emptyMarkdownContextRef: RefObject<MarkdownReferenceContext | null> = { current: null }

export function markdownLivePreview(
  theme: 'light' | 'dark',
  undo: () => void = () => {},
  redo: () => void = () => {},
  contextRef: RefObject<MarkdownReferenceContext | null> = emptyMarkdownContextRef
) {
  return [
    EditorState.transactionFilter.of(markdownTableSeparatorInput),
    markdownFrontmatterDecorations(theme, undo, redo),
    markdownTableDecorations(theme, contextRef),
    markdownCodeBlockDecorations(theme, undo, redo),
    markdownLocalReferenceDecorations(contextRef),
    ViewPlugin.define((view) => new MarkdownReferenceFocusPlugin(view)),
    ViewPlugin.define((view) => new MarkdownPreviewPlugin(view, contextRef), { decorations: (plugin) => plugin.decorations }),
    EditorView.domEventHandlers({
      keydown(event, view) {
        if (event.key !== 'Escape' || event.isComposing || !view.hasFocus) return false
        if (event.target instanceof Element && event.target.closest('.cm-md-code-widget, .cm-md-table-widget, .cm-md-frontmatter-widget')) return false
        event.preventDefault()
        view.contentDOM.blur()
        return true
      },
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
