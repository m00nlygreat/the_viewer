import { WidgetType, type EditorView } from '@codemirror/view'
import { MarkdownCodeBlock } from './CodeBlock'
import type { MarkdownCodeBlockState } from './codeBlockState'
import { renderWidgetRoot, unmountWidgetRoot } from '../../components/reactWidgetRoot'

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
    renderWidgetRoot(element, <MarkdownCodeBlock block={this.block} />)
    return element
  }

  updateDOM(): boolean { return true }

  ignoreEvent(): boolean { return true }

  destroy(element: HTMLElement): void {
    unmountWidgetRoot(element)
  }
}
