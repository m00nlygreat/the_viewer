import { WidgetType, type EditorView } from '@codemirror/view'
import { MarkdownTableBlock } from './TableGrid'
import type { MarkdownTableState } from './tableState'
import { renderWidgetRoot, unmountWidgetRoot } from '../../components/reactWidgetRoot'

export class MarkdownTableWidget extends WidgetType {
  constructor(private readonly table: MarkdownTableState) { super() }

  eq(other: WidgetType): boolean {
    return other instanceof MarkdownTableWidget && other.table === this.table
  }

  toDOM(view: EditorView): HTMLElement {
    this.table.attachView(view)
    const element = document.createElement('div')
    element.className = 'cm-md-table-widget'
    element.contentEditable = 'false'
    renderWidgetRoot(element, <MarkdownTableBlock table={this.table} />)
    return element
  }

  updateDOM(element: HTMLElement): boolean {
    renderWidgetRoot(element, <MarkdownTableBlock table={this.table} />)
    return true
  }

  ignoreEvent(): boolean { return true }

  destroy(element: HTMLElement): void {
    unmountWidgetRoot(element)
  }
}
