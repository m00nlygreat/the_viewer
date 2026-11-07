import { describe, expect, it, vi } from 'vitest'
import type { RelayRoute } from '../src/platform/pwa/extensionRelay'
import { WorkspaceInputQueue } from '../src/app/workspaceInputQueue'

const route = (ticketId: string): RelayRoute => ({ extensionId: 'a'.repeat(32), ticketId })

describe('workspace input queue', () => {
  it('preserves FIFO order across file and relay inputs', () => {
    const queue = new WorkspaceInputQueue()
    const resolve = vi.fn()
    const firstRoute = route('first')
    const secondRoute = route('second')

    queue.enqueueFiles({ files: [{ name: 'one.md', type: 'text/markdown', bytes: new Uint8Array() }], resolve })
    queue.enqueueRelay(firstRoute)
    queue.enqueueFiles({ files: [{ name: 'two.md', type: 'text/markdown', bytes: new Uint8Array() }], resolve })
    queue.enqueueRelay(secondRoute)

    expect(queue.length).toBe(4)
    expect(queue.dequeue()).toMatchObject({ kind: 'files', files: [{ name: 'one.md' }] })
    expect(queue.dequeue()).toEqual({ kind: 'relay', route: firstRoute })
    expect(queue.dequeue()).toMatchObject({ kind: 'files', files: [{ name: 'two.md' }] })
    expect(queue.dequeue()).toEqual({ kind: 'relay', route: secondRoute })
    expect(queue.dequeue()).toBeUndefined()
    expect(resolve).not.toHaveBeenCalled()
  })

  it('suppresses queued relay duplicates and releases the ticket when dequeued', () => {
    const queue = new WorkspaceInputQueue()
    const first = route('same-ticket')

    expect(queue.enqueueRelay(first)).toBe(true)
    expect(queue.enqueueRelay(route('same-ticket'))).toBe(false)
    expect(queue.length).toBe(1)
    expect(queue.dequeue()).toEqual({ kind: 'relay', route: first })
    expect(queue.enqueueRelay(route('same-ticket'))).toBe(true)
    expect(queue.length).toBe(1)
  })
})
