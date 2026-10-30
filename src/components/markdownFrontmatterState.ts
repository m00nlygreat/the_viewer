import type { EditorView } from '@codemirror/view'
import type { MarkdownFrontmatter } from '../domain/formats/markdownFrontmatter'

export interface MarkdownFrontmatterSnapshot extends MarkdownFrontmatter {
  editing: boolean
  theme: 'light' | 'dark'
}

export class MarkdownFrontmatterState {
  private snapshot: MarkdownFrontmatterSnapshot
  private readonly listeners = new Set<() => void>()
  private view: EditorView | null = null
  private undo: () => void
  private redo: () => void

  constructor(frontmatter: MarkdownFrontmatter, theme: 'light' | 'dark', undo: () => void, redo: () => void) {
    this.snapshot = { ...frontmatter, editing: false, theme }
    this.undo = undo
    this.redo = redo
  }

  readonly getSnapshot = (): MarkdownFrontmatterSnapshot => this.snapshot

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  attachView(view: EditorView): void { this.view = view }

  undoDocument(): void { this.undo() }
  redoDocument(): void { this.redo() }

  update(frontmatter: MarkdownFrontmatter, theme: 'light' | 'dark'): void {
    if (this.snapshot.from === frontmatter.from && this.snapshot.to === frontmatter.to &&
      this.snapshot.contentFrom === frontmatter.contentFrom && this.snapshot.contentTo === frontmatter.contentTo &&
      this.snapshot.content === frontmatter.content && this.snapshot.raw === frontmatter.raw &&
      this.snapshot.lineEnding === frontmatter.lineEnding && this.snapshot.theme === theme) return
    this.snapshot = { ...this.snapshot, ...frontmatter, theme }
    this.emit()
  }

  setEditing(editing: boolean): void {
    if (this.snapshot.editing === editing) return
    this.snapshot = { ...this.snapshot, editing }
    this.emit()
  }

  replaceRaw(content: string): void {
    if (!this.view) return
    const lineEnding = this.snapshot.lineEnding || '\n'
    const nextRaw = content.replace(/\r\n|\n|\r/gu, lineEnding)
    if (nextRaw === this.snapshot.raw) return
    this.view.dispatch({
      changes: { from: this.snapshot.from, to: this.snapshot.to, insert: nextRaw },
      userEvent: 'input.type'
    })
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }
}
