import { describe, expect, it } from 'vitest'
import { DocumentWriteQueue } from '../src/platform/documentWriteQueue'

describe('document write queue', () => {
  it('serializes writes and deletions for one document while keeping other documents independent', async () => {
    const queue = new DocumentWriteQueue()
    const events: string[] = []
    let finishFirst!: () => void
    const firstWrite = queue.enqueue('a', async () => {
      events.push('a:save:start')
      await new Promise<void>((resolve) => { finishFirst = resolve })
      events.push('a:save:end')
    })
    const deleteA = queue.enqueue('a', async () => { events.push('a:delete') })
    const saveB = queue.enqueue('b', async () => { events.push('b:save') })

    await saveB
    expect(events).toEqual(['a:save:start', 'b:save'])
    finishFirst()
    await Promise.all([firstWrite, deleteA])
    await queue.flush()
    expect(events).toEqual(['a:save:start', 'b:save', 'a:save:end', 'a:delete'])
  })
})
