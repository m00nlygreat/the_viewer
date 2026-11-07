import type { FolderTransitionPhase } from '../domain/folderTransition'
import { WorkspaceInputQueue } from './workspaceInputQueue'

/** Owns the transition barrier, pending workspace inputs, and operations that must settle before a transition. */
export class WorkspaceOperationCoordinator {
  readonly inputs = new WorkspaceInputQueue()
  locked = false
  phase: FolderTransitionPhase = 'idle'
  private readonly active = new Set<Promise<unknown>>()

  setLocked(locked: boolean): void {
    this.locked = locked
    if (locked) this.phase = 'settling'
    else this.phase = 'idle'
  }

  setPhase(phase: FolderTransitionPhase): void {
    this.phase = phase
  }

  track<T>(operation: Promise<T>): Promise<T> {
    const tracked = operation.finally(() => this.active.delete(tracked))
    this.active.add(tracked)
    return tracked
  }

  async waitForActive(): Promise<void> {
    while (this.active.size) {
      await Promise.all([...this.active].map((operation) => operation.catch(() => undefined)))
    }
  }
}
