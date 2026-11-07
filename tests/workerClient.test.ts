import { afterEach, describe, expect, it, vi } from 'vitest'

class FakeWorker {
  static created: FakeWorker[] = []
  static transfers: Array<Transferable[]> = []
  static messages: Array<{ id: string; name: string; mimeType: string; bytes?: ArrayBuffer; text?: string; documentId?: string; revision?: number }> = []
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  terminated = false

  constructor() { FakeWorker.created.push(this) }

  postMessage(message: { id: string; name: string; mimeType: string; bytes?: ArrayBuffer; text?: string; documentId?: string; revision?: number }, transfer: Transferable[] = []): void {
    FakeWorker.messages.push(message)
    FakeWorker.transfers.push(transfer)
    if (transfer.length && message.bytes) structuredClone(message.bytes, { transfer })
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
    vi.useRealTimers()
    vi.doUnmock('../src/domain/formatParsing')
    vi.resetModules()
    FakeWorker.created = []
    FakeWorker.transfers = []
    FakeWorker.messages = []
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

  it('copies input by default and transfers only explicitly owned whole buffers', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    const { parseWithWorker } = await import('../src/domain/workerClient')
    const input = new TextEncoder().encode('owned')

    await parseWithWorker('default.md', 'text/markdown', input, 'md')
    expect(FakeWorker.transfers[0]?.[0]).not.toBe(input.buffer)
    expect(input.byteLength).toBeGreaterThan(0)

    const ownedInput = new TextEncoder().encode('transfer')
    await parseWithWorker('owned.md', 'text/markdown', ownedInput, 'md', undefined, { transferInputBytes: true })
    expect(FakeWorker.transfers[1]?.[0]).toBe(ownedInput.buffer)
    expect(ownedInput.byteLength).toBe(0)

    const largerInput = new TextEncoder().encode('prefix-view-suffix')
    const view = largerInput.subarray(7, 11)
    await parseWithWorker('view.md', 'text/markdown', view, 'md', undefined, { transferInputBytes: true })
    expect(FakeWorker.transfers[2]?.[0]).not.toBe(largerInput.buffer)
    expect(largerInput.byteLength).toBeGreaterThan(0)
  })

  it('sends reparse text to the Worker without encoding or transferring a main-thread buffer', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    const { parseTextWithWorker } = await import('../src/domain/workerClient')
    const text = 'name,value\nAda,1'

    await parseTextWithWorker('reparse.csv', 'text/csv', text, 'csv', { documentId: 'reparse-doc', revision: 4 })

    expect(FakeWorker.messages[0]).toMatchObject({ text, documentId: 'reparse-doc', revision: 4 })
    expect(FakeWorker.messages[0]?.bytes).toBeUndefined()
    expect(FakeWorker.transfers[0]).toEqual([])
  })

  it('keeps text reparse functional when Workers are unavailable', async () => {
    vi.stubGlobal('Worker', undefined)
    const { parseTextWithWorker } = await import('../src/domain/workerClient')
    const text = 'name,value\nAda,1'

    const parsed = await parseTextWithWorker('reparse.csv', 'text/csv', text, 'csv')

    expect(parsed.format).toBe('csv')
    expect(parsed.text).toBe(text)
  })

  it('cancels a fallback parse started after worker construction fails', async () => {
    vi.stubGlobal('Worker', class { constructor() { throw new Error('worker unavailable') } })
    const { cancelDocumentParse, parseWithWorker } = await import('../src/domain/workerClient')
    const pending = parseWithWorker('fallback.md', 'text/markdown', new TextEncoder().encode('fallback'), 'md', { documentId: 'fallback-doc', revision: 1 }).then(
      () => new Error('cancelled fallback unexpectedly completed'),
      (error: unknown) => error
    )

    cancelDocumentParse('fallback-doc')
    expect(await pending).toMatchObject({ name: 'AbortError' })
  })

  it('times out a fallback parse and ignores its late completion', async () => {
    vi.useFakeTimers()
    vi.doMock('../src/domain/formatParsing', () => ({ parseFileContent: () => new Promise(() => undefined) }))
    vi.stubGlobal('Worker', undefined)
    const { parseWithWorker } = await import('../src/domain/workerClient')
    const pending = parseWithWorker('fallback.md', 'text/markdown', new TextEncoder().encode('fallback'), 'md', { documentId: 'timeout-doc', revision: 1 }).then(
      () => new Error('timed out fallback unexpectedly completed'),
      (error: unknown) => error
    )

    await vi.advanceTimersByTimeAsync(60_001)
    expect(await pending).toMatchObject({ message: '파일 처리 시간이 초과되었습니다.' })
    vi.doUnmock('../src/domain/formatParsing')
  })
})
