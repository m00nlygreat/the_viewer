import { describe, expect, it, vi } from 'vitest'
import { WorkspaceOperationCoordinator } from '../src/app/workspaceOperationCoordinator'

describe('workspace operation coordinator', () => {
  it('owns the transition lock and phase together', () => {
    const coordinator = new WorkspaceOperationCoordinator()

    coordinator.setLocked(true)
    expect(coordinator.locked).toBe(true)
    expect(coordinator.phase).toBe('settling')
    coordinator.setPhase('picking')
    expect(coordinator.phase).toBe('picking')
    coordinator.setLocked(false)
    expect(coordinator.locked).toBe(false)
    expect(coordinator.phase).toBe('idle')
  })

  it('waits for tracked operations, including operations added before the queue drains', async () => {
    const coordinator = new WorkspaceOperationCoordinator()
    let releaseFirst!: () => void
    let releaseSecond!: () => void
    const first = coordinator.track(new Promise<void>((resolve) => { releaseFirst = resolve }))
    coordinator.track(new Promise<void>((resolve) => { releaseSecond = resolve }))
    const settled = vi.fn()
    const wait = coordinator.waitForActive().then(settled)

    releaseFirst()
    await first
    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()
    releaseSecond()
    await wait
    expect(settled).toHaveBeenCalledOnce()
  })
})
