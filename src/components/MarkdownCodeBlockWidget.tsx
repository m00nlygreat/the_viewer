import { createRoot, type Root } from 'react-dom/client'
import { WidgetType, type EditorView } from '@codemirror/view'
import { MarkdownCodeBlock } from './MarkdownCodeBlock'
import type { MarkdownCodeBlockState } from './markdownCodeBlockState'
import { unmountWidgetRoot } from './reactWidgetRoot'

const roots = new WeakMap<HTMLElement, Root>()

export class MarkdownCodeBlockWidget extends WidgetType {
  constructor(private readonly block: MarkdownCodeBlockState) { super() }

  eq(other: WidgetType): boolean {
    return other instanceof MarkdownCodeBlockWidget && other.block === this.block
  }

  toDOM(view: EditorView): HTMLElement {
    this.block.attachView(view)
    const element = document.createElement('div')
    element.className = 'cm-md-code-widget'
    element.contentEditable = 'false'
    const root = createRoot(element)
    roots.set(element, root)
    root.render(<MarkdownCodeBlock block={this.block} />)
    return element
  }

  updateDOM(): boolean { return true }

  ignoreEvent(): boolean { return true }

  destroy(element: HTMLElement): void {
    const root = roots.get(element)
    if (root) unmountWidgetRoot(root)
    roots.delete(element)
  }
}
