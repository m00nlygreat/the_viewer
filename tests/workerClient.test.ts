import { afterEach, describe, expect, it, vi } from 'vitest'

class FakeWorker {
  static created: FakeWorker[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  terminated = false

  constructor() { FakeWorker.created.push(this) }

  postMessage(message: { id: string; name: string; documentId?: string; revision?: number }): void {
    if (message.name === 'slow.md') return
    queueMicrotask(() => {
      if (this.terminated) return
      this.onmessage?.({ data: {
        id: message.id,
        documentId: message.documentId,
        revision: message.revision,
        ok: true,
        parsed: { format: 'md', model: { text: message.name }, text: message.name, diagnostics: [], encoding: 'UTF-8' }
      } } as MessageEvent)
    })
  }

  terminate(): void { this.terminated = true }
}

describe('parse worker pool', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
    FakeWorker.created = []
  })

  it('reuses a bounded worker and cancels an older parse for the same document', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    const { cancelDocumentParse, parseWithWorker } = await import('../src/domain/workerClient')
    const context = { documentId: 'doc-1', revision: 1 }
    const stale = parseWithWorker('slow.md', 'text/markdown', new TextEncoder().encode('old'), 'md', context).then(
      () => new Error('stale parse unexpectedly completed'),
      (error: unknown) => error
    )
    const latest = await parseWithWorker('latest.md', 'text/markdown', new TextEncoder().encode('new'), 'md', { ...context, revision: 2 })

    expect(latest.text).toBe('latest.md')
    expect(await stale).toMatchObject({ name: 'AbortError' })
    expect(FakeWorker.created.filter((worker) => !worker.terminated)).toHaveLength(1)
    expect(FakeWorker.created).toHaveLength(2)

    const pending = parseWithWorker('slow.md', 'text/markdown', new TextEncoder().encode('pending'), 'md', { documentId: 'doc-2', revision: 1 }).then(
      () => new Error('cancelled parse unexpectedly completed'),
      (error: unknown) => error
    )
    cancelDocumentParse('doc-2')
    expect(await pending).toMatchObject({ name: 'AbortError' })
  })
})
