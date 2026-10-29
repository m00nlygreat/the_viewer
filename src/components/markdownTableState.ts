import type { EditorView } from '@codemirror/view'
import { parseMarkdownTable, serializeMarkdownTable, type MarkdownTableModel } from '../domain/formats/markdownTable'

export interface MarkdownTableSnapshot {
  from: number
  to: number
  source: string
  model: MarkdownTableModel
  editing: boolean
  theme: 'light' | 'dark'
}

export class MarkdownTableState {
  private snapshot: MarkdownTableSnapshot
  private readonly listeners = new Set<() => void>()

  constructor(private view: EditorView, from: number, to: number, source: string, theme: 'light' | 'dark') {
    const model = parseMarkdownTable(source)
    if (!model) throw new Error('Invalid Markdown table block')
    this.snapshot = { from, to, source, model, editing: false, theme }
  }

  readonly getSnapshot = (): MarkdownTableSnapshot => this.snapshot

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  update(view: EditorView, from: number, to: number, source: string, theme: 'light' | 'dark'): void {
    const model = parseMarkdownTable(source)
    if (!model) return
    if (this.view === view && this.snapshot.from === from && this.snapshot.to === to && this.snapshot.source === source && this.snapshot.theme === theme) return
    this.view = view
    this.snapshot = { ...this.snapshot, from, to, source, model, theme }
    this.emit()
  }

  setEditing(editing: boolean): void {
    if (this.snapshot.editing === editing) return
    this.snapshot = { ...this.snapshot, editing }
    this.emit()
  }

  replaceModel(model: MarkdownTableModel, group: 'typing' | 'command' = 'typing'): void {
    this.replaceSource(serializeMarkdownTable(model), group)
  }

  private replaceSource(source: string, group: 'typing' | 'command'): void {
    if (source === this.snapshot.source) return
    this.view.dispatch({
      changes: { from: this.snapshot.from, to: this.snapshot.to, insert: source },
      userEvent: group === 'command' ? 'input.format' : 'input.type'
    })
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }
}
