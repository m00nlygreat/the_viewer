import { createRoot, type Root } from 'react-dom/client'
import { WidgetType, type EditorView } from '@codemirror/view'
import { MarkdownTableBlock } from '../features/MarkdownTableGrid'
import type { MarkdownTableState } from './markdownTableState'

const roots = new WeakMap<HTMLElement, Root>()

export class MarkdownTableWidget extends WidgetType {
  constructor(private readonly table: MarkdownTableState) { super() }

  eq(other: WidgetType): boolean {
    return other instanceof MarkdownTableWidget && other.table === this.table
  }

  toDOM(view: EditorView): HTMLElement {
    this.table.attachView(view)
    const element = document.createElement('div')
    element.className = 'cm-md-table-widget'
    const root = createRoot(element)
    roots.set(element, root)
    root.render(<MarkdownTableBlock table={this.table} />)
    return element
  }

  updateDOM(element: HTMLElement): boolean {
    roots.get(element)?.render(<MarkdownTableBlock table={this.table} />)
    return true
  }

  ignoreEvent(): boolean { return true }

  destroy(element: HTMLElement): void {
    roots.get(element)?.unmount()
    roots.delete(element)
  }
}
