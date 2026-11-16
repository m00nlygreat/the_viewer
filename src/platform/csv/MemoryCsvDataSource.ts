import type { CsvColumnDefinition, CsvQueryPage, CsvQueryRequest, CsvSample } from '../../domain/csv-views/model'
import { CsvQueryError } from '../../domain/csv-views/model'
import { parseWorkerResponse, type CsvWorkerRequest, type CsvWorkerRequestMessage, type CsvWorkerResponse } from '../../domain/csv-views/protocol'

interface PendingRequest { resolve(response: CsvWorkerResponse): void; reject(error: Error): void }

export class MemoryCsvDataSource {
  private readonly worker: Worker
  private readonly pending = new Map<string, PendingRequest>()
  private disposed = false

  constructor() {
    this.worker = new Worker(new URL('../../domain/csv-views/memoryQuery.worker.ts', import.meta.url), { type: 'module', name: 'csv-memory-query' })
    this.worker.addEventListener('message', this.onMessage)
    this.worker.addEventListener('error', this.onError)
  }

  async registerSnapshot(documentId: string, sourceRevision: string, header: (string | null)[], records: string[][]): Promise<void> {
    const response = await this.send({ type: 'register-snapshot', documentId, sourceRevision, header, records })
    if (response.type !== 'registered') throw new CsvQueryError('internal', 'CSV 작업본을 등록하지 못했습니다.')
  }

  async setSchema(documentId: string, schemaRevision: number, columns: CsvColumnDefinition[]): Promise<void> {
    const response = await this.send({ type: 'set-schema', documentId, schemaRevision, columns })
    if (response.type !== 'schema-set') throw new CsvQueryError('internal', 'CSV 컬럼 설정을 등록하지 못했습니다.')
  }

  async sample(documentId: string, sourceRevision: string, maxRecords: number): Promise<CsvSample> {
    const response = await this.send({ type: 'sample', documentId, sourceRevision, maxRecords })
    if (response.type !== 'sample') throw new CsvQueryError('internal', 'CSV 표본을 준비하지 못했습니다.')
    return response.sample
  }

  async discoverGroups(request: { requestId: string; queryId: string; dataset: CsvQueryRequest['dataset']; columnId: string; filter: CsvQueryRequest['filter']; limit: number }, signal: AbortSignal): Promise<{ keys: string[]; complete: boolean }> {
    if (signal.aborted) throw new CsvQueryError('cancelled', '그룹 조회가 취소되었습니다.')
    const promise = this.send({ type: 'discover-groups', ...request })
    const onAbort = () => { void this.cancel(request.queryId) }
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      const response = await promise
      if (signal.aborted) throw new CsvQueryError('cancelled', '그룹 조회가 취소되었습니다.')
      if (response.type !== 'groups') throw new CsvQueryError('internal', '그룹 조회 결과가 올바르지 않습니다.')
      return { keys: response.keys, complete: response.complete }
    } finally { signal.removeEventListener('abort', onAbort) }
  }

  async query(request: CsvQueryRequest, signal: AbortSignal): Promise<CsvQueryPage> {
    if (signal.aborted) throw new CsvQueryError('cancelled', '조회가 취소되었습니다.')
    const promise = this.send({ type: 'query', request })
    const onAbort = () => { void this.cancel(request.queryId) }
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      const response = await promise
      if (signal.aborted) throw new CsvQueryError('cancelled', '조회가 취소되었습니다.')
      if (response.type !== 'page') throw new CsvQueryError('internal', 'CSV 조회 결과가 올바르지 않습니다.')
      return response.page
    } finally { signal.removeEventListener('abort', onAbort) }
  }

  async cancel(queryId: string): Promise<void> {
    if (this.disposed) return
    this.worker.postMessage(this.envelope({ type: 'cancel', queryId }))
  }

  async release(documentId: string): Promise<void> {
    if (this.disposed) return
    await this.send({ type: 'release', documentId })
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.worker.removeEventListener('message', this.onMessage)
    this.worker.removeEventListener('error', this.onError)
    this.worker.terminate()
    for (const request of this.pending.values()) request.reject(new CsvQueryError('engine-restarted', 'CSV 조회 Worker가 종료되었습니다.'))
    this.pending.clear()
  }

  private readonly onMessage = (event: MessageEvent<unknown>) => {
    const response = parseWorkerResponse(event.data)
    if (!response) { console.warn('CSV Worker가 잘못된 응답을 보냈습니다.'); return }
    const request = this.pending.get(response.inReplyTo)
    if (!request) return
    this.pending.delete(response.inReplyTo)
    if (response.type === 'error') request.reject(new CsvQueryError(asQueryErrorCode(response.code), response.message))
    else request.resolve(response)
  }

  private readonly onError = (event: ErrorEvent) => {
    const error = new CsvQueryError('internal', event.message || 'CSV 조회 Worker를 실행하지 못했습니다.')
    for (const request of this.pending.values()) request.reject(error)
    this.pending.clear()
  }

  private send(message: CsvWorkerRequestMessage): Promise<CsvWorkerResponse> {
    if (this.disposed) return Promise.reject(new CsvQueryError('engine-restarted', 'CSV 조회 Worker가 종료되었습니다.'))
    const envelope = this.envelope(message)
    return new Promise((resolve, reject) => {
      this.pending.set(envelope.messageId, { resolve, reject })
      this.worker.postMessage(envelope)
    })
  }

  private envelope(message: CsvWorkerRequestMessage): CsvWorkerRequest {
    return { protocol: 1, messageId: crypto.randomUUID(), ...message } as CsvWorkerRequest
  }
}

function asQueryErrorCode(value: string): ConstructorParameters<typeof CsvQueryError>[0] {
  return ['cancelled', 'stale-dataset', 'cursor-expired', 'budget-exceeded', 'invalid-request', 'source-unavailable', 'engine-restarted', 'internal'].includes(value)
    ? value as ConstructorParameters<typeof CsvQueryError>[0]
    : 'internal'
}
