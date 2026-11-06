import type { EditorView } from '@codemirror/view'
import { parseMarkdownTable, serializeMarkdownTable, type MarkdownTableModel } from '../../domain/formats/markdownTable'
import type { MarkdownReferenceContext } from './localReferenceState'

export interface MarkdownTableSnapshot {
  from: number
  to: number
  source: string
  model: MarkdownTableModel
  editing: boolean
  theme: 'light' | 'dark'
  context: MarkdownReferenceContext | null
}

export class MarkdownTableState {
  private snapshot: MarkdownTableSnapshot
  private readonly listeners = new Set<() => void>()
  private view: EditorView | null = null

  constructor(from: number, to: number, source: string, theme: 'light' | 'dark', context: MarkdownReferenceContext | null = null) {
    const model = parseMarkdownTable(source)
    if (!model) throw new Error('Invalid Markdown table block')
    this.snapshot = { from, to, source, model, editing: false, theme, context }
  }

  readonly getSnapshot = (): MarkdownTableSnapshot => this.snapshot

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  attachView(view: EditorView): void { this.view = view }

  update(from: number, to: number, source: string, theme: 'light' | 'dark', context: MarkdownReferenceContext | null = this.snapshot.context): boolean {
    if (this.snapshot.from === from && this.snapshot.to === to && this.snapshot.source === source && this.snapshot.theme === theme && this.snapshot.context === context) return true
    if (this.snapshot.source === source) {
      this.snapshot = { ...this.snapshot, from, to, theme, context }
      this.emit()
      return true
    }
    const model = parseMarkdownTable(source)
    if (!model) return false
    this.snapshot = { ...this.snapshot, from, to, source, model, theme, context }
    this.emit()
    return true
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
    if (source === this.snapshot.source || !this.view) return
    this.view.dispatch({
      changes: { from: this.snapshot.from, to: this.snapshot.to, insert: source },
      userEvent: group === 'command' ? 'input.format' : 'input.type'
    })
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }
}
