import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseCsv } from '../src/domain/formats/csv'
import type { ViewerDocument } from '../src/domain/types'

type Request = { id: string; documentId: string; revision: number; format: 'csv' | 'ics' | 'vcf'; model: unknown }

class FakeWorker {
  static created: FakeWorker[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  terminated = false
  constructor() { FakeWorker.created.push(this) }
  postMessage(request: Request): void {
    queueMicrotask(() => {
      if (this.terminated) return
      this.onmessage?.({ data: { id: request.id, documentId: request.documentId, revision: request.revision, ok: true, text: `revision-${request.revision}` } } as MessageEvent)
    })
  }
  terminate(): void { this.terminated = true }
}

class QuietWorker extends FakeWorker {
  override postMessage(): void {}
}

describe('large view serialization queue', () => {
  afterEach(() => {
    FakeWorker.created.forEach((worker) => worker.terminate())
    FakeWorker.created = []
    vi.unstubAllGlobals()
    vi.useRealTimers()
    vi.doUnmock('../src/domain/formats/csv')
    vi.resetModules()
  })

  it('selects only large CSV, calendar, and contact models for background serialization', async () => {
    const { prepareBackgroundSerialization } = await import('../src/domain/serializeQueue')
    const small = parseCsv('name\nAda', 'UTF-8', false, '\n')
    const common = {
      id: 'doc-1', name: 'sample', mimeType: 'text/plain', size: 0, initialBytes: new ArrayBuffer(0), savedBytes: new ArrayBuffer(0),
      sourceText: '', text: '', mode: 'view' as const, revision: 0, modelRevision: 0, textRevision: 0,
      parseState: 'ready' as const, diagnostics: [], encoding: 'UTF-8', bom: false, savedText: '', isDirty: false, openedAt: 0, lastEditedAt: 0
    }
    const smallDocument: ViewerDocument = { ...common, format: 'csv', model: small }
    expect(prepareBackgroundSerialization(smallDocument, 0)).toBeNull()

    const largeCsv = { ...small, rows: Array.from({ length: 10_000 }, () => ['Ada']) }
    const largeCsvDocument: ViewerDocument = { ...common, format: 'csv', model: largeCsv }
    const calendarDocument: ViewerDocument = { ...common, format: 'ics', model: { events: [], jcal: [], diagnostics: [] } }
    const contactDocument: ViewerDocument = { ...common, format: 'vcf', model: { cards: [], diagnostics: [] } }
    expect(prepareBackgroundSerialization(largeCsvDocument, 0)).toMatchObject({ format: 'csv' })
    expect(prepareBackgroundSerialization(calendarDocument, 512 * 1024)).toMatchObject({ format: 'ics' })
    expect(prepareBackgroundSerialization(contactDocument, 512 * 1024)).toMatchObject({ format: 'vcf' })
  })

  it('coalesces same-document edits and ignores the superseded serialization', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    const { serializeViewCommand } = await import('../src/domain/serializeQueue')
    const firstInput = { format: 'csv', model: parseCsv('name\nFirst', 'UTF-8', false, '\n') } as const
    const latestInput = { format: 'csv', model: parseCsv('name\nLatest', 'UTF-8', false, '\n') } as const
    const stale = serializeViewCommand('doc-1', 1, firstInput).then(() => null, (error: unknown) => error)
    const latest = serializeViewCommand('doc-1', 2, latestInput)

    await expect(latest).resolves.toBe('revision-2')
    expect(await stale).toMatchObject({ name: 'AbortError' })
    expect(FakeWorker.created).toHaveLength(1)
  })

  it('falls back to inline serialization when workers are unavailable', async () => {
    vi.stubGlobal('Worker', undefined)
    const { serializeViewCommand } = await import('../src/domain/serializeQueue')
    const input = { format: 'csv', model: parseCsv('name\nAda', 'UTF-8', false, '\n') } as const

    await expect(serializeViewCommand('doc-2', 1, input)).resolves.toBe('name\nAda')
  })

  it('times out a worker request that does not return', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('Worker', QuietWorker)
    const { serializeViewCommand } = await import('../src/domain/serializeQueue')
    const input = { format: 'csv', model: parseCsv('name\nAda', 'UTF-8', false, '\n') } as const
    const result = serializeViewCommand('doc-3', 1, input).then(() => null, (error: unknown) => error)

    await vi.advanceTimersByTimeAsync(90)
    await vi.advanceTimersByTimeAsync(60_001)
    expect(await result).toMatchObject({ message: '파일 직렬화 시간이 초과되었습니다.' })
  })
})
