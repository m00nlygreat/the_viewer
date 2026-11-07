import type { Format, ViewerDocument } from '../domain/types'
import type { PickedFile } from '../platform/fileTypes'
import type { RelayRoute } from '../platform/pwa/extensionRelay'

export type WorkspaceInputResult = { opened: ViewerDocument[]; errors: string[] }
export type WorkspaceInputOrigin = { shareTicketId: string; shareFileIndex: number }

export type WorkspaceInput =
  | { kind: 'files'; files: PickedFile[]; format?: Format; origin?: WorkspaceInputOrigin; resolve: (result: WorkspaceInputResult) => void }
  | { kind: 'relay'; route: RelayRoute }

/** FIFO queue for inputs that must wait until a workspace transition finishes. */
export class WorkspaceInputQueue {
  private readonly items: WorkspaceInput[] = []
  private readonly queuedRelayIds = new Set<string>()

  get length(): number {
    return this.items.length
  }

  enqueueFiles(input: Omit<Extract<WorkspaceInput, { kind: 'files' }>, 'kind'>): void {
    this.items.push({ kind: 'files', ...input })
  }

  enqueueRelay(route: RelayRoute): boolean {
    if (this.queuedRelayIds.has(route.ticketId)) return false
    this.queuedRelayIds.add(route.ticketId)
    this.items.push({ kind: 'relay', route })
    return true
  }

  dequeue(): WorkspaceInput | undefined {
    const item = this.items.shift()
    if (item?.kind === 'relay') this.queuedRelayIds.delete(item.route.ticketId)
    return item
  }
}
