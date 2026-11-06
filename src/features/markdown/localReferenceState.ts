import type { FolderPath } from '../../domain/workspace'
import type { MarkdownReferenceSyntax } from '../../domain/folderPaths'
import type { ChangeDesc } from '@codemirror/state'
import type { MarkdownReference } from '../../domain/markdownReferences'

export type MarkdownReferenceResolution =
  | { status: 'external'; href: string }
  | { status: 'markdown'; path: FolderPath; text: string; revision: number; fragment?: string }
  | { status: 'image'; path: FolderPath; mimeType: string; fragment?: string }
  | { status: 'file'; path: FolderPath; name: string; mimeType: string; size: number; supported: boolean }
  | { status: 'error'; kind: 'blocked' | 'invalid' | 'missing' | 'ambiguous' | 'incomplete' | 'permission-denied'; message: string; choices?: FolderPath[] }

export interface MarkdownReferenceServices {
  resolveReference: (ownerPath: FolderPath, ownerText: string, reference: string, syntax: MarkdownReferenceSyntax, generation: number, signal: AbortSignal) => Promise<MarkdownReferenceResolution>
  acquireImage: (path: FolderPath, generation: number, signal: AbortSignal) => Promise<{ url: string; release: () => void }>
  openFile: (path: FolderPath) => void
  downloadFile: (path: FolderPath) => void
  subscribeDocument: (folderId: string, path: FolderPath, listener: () => void) => () => void
}

export interface MarkdownReferenceAncestor { folderId: string; path: FolderPath; fragment: string }

export interface MarkdownReferenceContext {
  services: MarkdownReferenceServices | null
  referenceState: LocalReferenceState
  instanceId: string
  folderId: string | null
  generation: number
  ownerPath: FolderPath
  ownerText: string
  ancestors: readonly MarkdownReferenceAncestor[]
  depth: number
}

export class LocalReferenceState {
  private readonly overrides = new Map<string, { ownerId: string; from: number; to: number; kind: string; value: boolean }>()
  isExpanded(key: string, defaultValue = false): boolean { return this.overrides.get(key)?.value ?? defaultValue }
  toggle(instanceId: string, reference: MarkdownReference, defaultValue = false): boolean {
    const key = markdownReferenceKey(instanceId, reference)
    const value = !this.isExpanded(key, defaultValue)
    this.overrides.set(key, { ownerId: instanceId, from: reference.from, to: reference.to, kind: reference.kind, value })
    return value
  }
  delete(key: string): void { this.overrides.delete(key) }
  clear(): void { this.overrides.clear() }

  remap(changes: ChangeDesc, ownerId: string): void {
    const moved = new Map<string, { ownerId: string; from: number; to: number; kind: string; value: boolean }>()
    for (const [key, item] of this.overrides) {
      if (item.ownerId !== ownerId) { moved.set(key, item); continue }
      let touched = false
      changes.iterChangedRanges((from, to) => {
        if (from === to ? from >= item.from && from < item.to : from < item.to && to > item.from) touched = true
      })
      if (touched) continue
      const from = changes.mapPos(item.from, 1)
      const to = changes.mapPos(item.to, -1)
      const next = { ...item, from, to }
      moved.set(referenceKey(ownerId, from, to, item.kind), next)
    }
    this.overrides.clear()
    for (const [key, value] of moved) this.overrides.set(key, value)
  }

  retain(ownerId: string, validKeys: ReadonlySet<string>): void {
    for (const [key, item] of this.overrides) if (item.ownerId === ownerId && !validKeys.has(key)) this.overrides.delete(key)
  }

  clearOwner(ownerId: string): void {
    for (const [key, item] of this.overrides) if (item.ownerId === ownerId || item.ownerId.startsWith(`${ownerId}/`)) this.overrides.delete(key)
  }
}

export function markdownReferenceKey(instanceId: string, reference: Pick<MarkdownReference, 'from' | 'to' | 'kind'>): string {
  return referenceKey(instanceId, reference.from, reference.to, reference.kind)
}

function referenceKey(ownerId: string, from: number, to: number, kind: string): string {
  return JSON.stringify([ownerId, from, to, kind])
}
