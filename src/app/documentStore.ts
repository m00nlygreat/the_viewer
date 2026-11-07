import type { ViewerDocument } from '../domain/types'

export type DocumentListItem = Pick<ViewerDocument, 'id' | 'name' | 'format' | 'contentKind' | 'isDirty' | 'folderRef'>

export type DocumentStoreChange =
  | { type: 'document'; document: ViewerDocument; previous: ViewerDocument }
  | { type: 'add'; document: ViewerDocument }
  | { type: 'remove'; document: ViewerDocument }
  | { type: 'replace'; documents: readonly ViewerDocument[]; previous: readonly ViewerDocument[] }
  | { type: 'refresh'; documents: readonly ViewerDocument[] }

function summarize(document: ViewerDocument): DocumentListItem {
  return {
    id: document.id,
    name: document.name,
    format: document.format,
    contentKind: document.contentKind,
    isDirty: document.isDirty,
    folderRef: document.folderRef
  }
}

function sameSummary(left: DocumentListItem, right: DocumentListItem): boolean {
  return left.id === right.id && left.name === right.name && left.format === right.format &&
    left.contentKind === right.contentKind && left.isDirty === right.isDirty && left.folderRef === right.folderRef
}

/** Owns full document snapshots while exposing a stable, lightweight list snapshot. */
export class DocumentStore {
  private byId = new Map<string, ViewerDocument>()
  private order: string[] = []
  private summariesById = new Map<string, DocumentListItem>()
  private listSnapshot: readonly DocumentListItem[] = []
  private documentListeners = new Map<string, Set<() => void>>()
  private listListeners = new Set<() => void>()
  private changeListeners = new Set<(change: DocumentStoreChange) => void>()

  get = (id: string): ViewerDocument | null => this.byId.get(id) ?? null
  getAll = (): readonly ViewerDocument[] => this.order.flatMap((id) => {
    const document = this.byId.get(id)
    return document ? [document] : []
  })
  getListSnapshot = (): readonly DocumentListItem[] => this.listSnapshot

  subscribeDocument = (id: string, listener: () => void): (() => void) => this.subscribe(this.documentListeners, id, listener)
  subscribeList = (listener: () => void): (() => void) => this.subscribe(this.listListeners, '', listener)
  subscribeChanges = (listener: (change: DocumentStoreChange) => void): (() => void) => {
    this.changeListeners.add(listener)
    return () => this.changeListeners.delete(listener)
  }

  update(document: ViewerDocument): boolean {
    const previous = this.byId.get(document.id)
    if (!previous) return false
    if (previous === document) return true
    this.byId.set(document.id, document)
    if (this.updateSummary(document)) this.rebuildListSnapshot()
    this.emitDocument(document.id)
    this.emitChange({ type: 'document', document, previous })
    return true
  }

  upsert(document: ViewerDocument, toFront = true): void {
    const previous = this.byId.get(document.id)
    const moved = toFront && this.order[0] !== document.id
    if (previous === document && !moved) return
    this.byId.set(document.id, document)
    if (moved) this.order = [document.id, ...this.order.filter((id) => id !== document.id)]
    else if (!previous) this.order.push(document.id)
    const summaryChanged = this.updateSummary(document)
    if (!previous || moved || summaryChanged) this.rebuildListSnapshot()
    this.emitDocument(document.id)
    this.emitChange(previous ? { type: 'document', document, previous } : { type: 'add', document })
  }

  replaceAll(documents: readonly ViewerDocument[]): void {
    const previous = this.getAll()
    const previousById = this.byId
    const previousSummaries = new Map(this.listSnapshot.map((item) => [item.id, item]))
    this.byId = new Map(documents.map((document) => [document.id, document]))
    this.order = [...this.byId.keys()]
    this.summariesById = new Map(this.order.map((id) => {
      const document = this.byId.get(id)!
      const next = summarize(document)
      const old = previousSummaries.get(id)
      return [id, old && sameSummary(old, next) ? old : next]
    }))
    this.rebuildListSnapshot()
    for (const id of new Set([...previousById.keys(), ...this.byId.keys()])) {
      if (previousById.get(id) !== this.byId.get(id)) this.emitDocument(id)
    }
    this.emitChange({ type: 'replace', documents: this.getAll(), previous })
  }

  remove(id: string): ViewerDocument | null {
    const previous = this.byId.get(id)
    if (!previous) return null
    this.byId.delete(id)
    this.order = this.order.filter((item) => item !== id)
    this.summariesById.delete(id)
    this.rebuildListSnapshot()
    this.emitDocument(id)
    this.emitChange({ type: 'remove', document: previous })
    return previous
  }

  clear(): void { this.replaceAll([]) }

  refresh(): void { this.emitChange({ type: 'refresh', documents: this.getAll() }) }

  private subscribe<T>(listeners: Map<string, Set<T>> | Set<T>, key: string, listener: T): () => void {
    if (listeners instanceof Set) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
    const keyed = listeners.get(key) ?? new Set<T>()
    keyed.add(listener)
    listeners.set(key, keyed)
    return () => {
      keyed.delete(listener)
      if (keyed.size === 0) listeners.delete(key)
    }
  }

  private updateSummary(document: ViewerDocument): boolean {
    const previous = this.summariesById.get(document.id)
    const next = summarize(document)
    if (previous && sameSummary(previous, next)) return false
    this.summariesById.set(document.id, next)
    return true
  }

  private rebuildListSnapshot(): void {
    const nextSummaries = this.order.flatMap((id) => {
      const summary = this.summariesById.get(id)
      return summary ? [summary] : []
    })
    const unchanged = nextSummaries.length === this.listSnapshot.length && nextSummaries.every((item, index) => item === this.listSnapshot[index])
    if (!unchanged) {
      this.listSnapshot = nextSummaries
      for (const listener of this.listListeners) listener()
    }
  }

  private emitDocument(id: string): void {
    for (const listener of this.documentListeners.get(id) ?? []) listener()
  }

  private emitChange(change: DocumentStoreChange): void {
    for (const listener of this.changeListeners) listener(change)
  }
}
