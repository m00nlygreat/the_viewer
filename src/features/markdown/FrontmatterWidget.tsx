import { WidgetType, type EditorView } from '@codemirror/view'
import { MarkdownFrontmatterBlock } from './Frontmatter'
import type { MarkdownFrontmatterState } from './frontmatterState'
import { renderWidgetRoot, unmountWidgetRoot } from '../../components/reactWidgetRoot'

export class MarkdownFrontmatterWidget extends WidgetType {
  constructor(private readonly frontmatter: MarkdownFrontmatterState) { super() }

  eq(other: WidgetType): boolean {
    return other instanceof MarkdownFrontmatterWidget && other.frontmatter === this.frontmatter
  }

  toDOM(view: EditorView): HTMLElement {
    this.frontmatter.attachView(view)
    const element = document.createElement('div')
    element.className = 'cm-md-frontmatter-widget'
    element.contentEditable = 'false'
    renderWidgetRoot(element, <MarkdownFrontmatterBlock frontmatter={this.frontmatter} />)
    return element
  }

  updateDOM(element: HTMLElement): boolean {
    renderWidgetRoot(element, <MarkdownFrontmatterBlock frontmatter={this.frontmatter} />)
    return true
  }

  ignoreEvent(): boolean { return true }

  destroy(element: HTMLElement): void {
    unmountWidgetRoot(element)
  }
}
