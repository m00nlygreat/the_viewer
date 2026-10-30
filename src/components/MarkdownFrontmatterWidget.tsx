import { createRoot, type Root } from 'react-dom/client'
import { WidgetType, type EditorView } from '@codemirror/view'
import { MarkdownFrontmatterBlock } from './MarkdownFrontmatter'
import type { MarkdownFrontmatterState } from './markdownFrontmatterState'
import { unmountWidgetRoot } from './reactWidgetRoot'

const roots = new WeakMap<HTMLElement, Root>()

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
    const root = createRoot(element)
    roots.set(element, root)
    root.render(<MarkdownFrontmatterBlock frontmatter={this.frontmatter} />)
    return element
  }

  updateDOM(element: HTMLElement): boolean {
    roots.get(element)?.render(<MarkdownFrontmatterBlock frontmatter={this.frontmatter} />)
    return true
  }

  ignoreEvent(): boolean { return true }

  destroy(element: HTMLElement): void {
    const root = roots.get(element)
    if (root) unmountWidgetRoot(root)
    roots.delete(element)
  }
}
