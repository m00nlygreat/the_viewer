import type { CsvColumnDefinition, CsvQueryPage, CsvQueryRequest, CsvSample } from './model'

export interface CsvWorkerEnvelope { protocol: 1; messageId: string }
export type CsvWorkerRequest = CsvWorkerEnvelope & (
  | { type: 'register-snapshot'; documentId: string; sourceRevision: string; header: (string | null)[]; records: string[][] }
  | { type: 'set-schema'; documentId: string; schemaRevision: number; columns: CsvColumnDefinition[] }
  | { type: 'query'; request: CsvQueryRequest }
  | { type: 'discover-groups'; requestId: string; queryId: string; dataset: CsvQueryRequest['dataset']; columnId: string; filter: CsvQueryRequest['filter']; limit: number }
  | { type: 'cancel'; queryId: string }
  | { type: 'sample'; documentId: string; sourceRevision: string; maxRecords: number }
  | { type: 'release'; documentId: string }
  | { type: 'dispose' }
)
export type CsvWorkerResponse = CsvWorkerEnvelope & { inReplyTo: string } & (
  | { type: 'registered'; documentId: string; sourceRevision: string; recordCount: number }
  | { type: 'schema-set'; documentId: string; schemaRevision: number }
  | { type: 'page'; page: CsvQueryPage }
  | { type: 'groups'; requestId: string; queryId: string; dataset: CsvQueryRequest['dataset']; keys: string[]; complete: boolean }
  | { type: 'sample'; sample: CsvSample }
  | { type: 'released' | 'disposed' }
  | { type: 'error'; code: string; message: string }
)

export type CsvWorkerRequestMessage = CsvWorkerRequest extends infer T ? T extends CsvWorkerEnvelope ? Omit<T, 'protocol' | 'messageId'> : never : never
export type CsvWorkerResponseMessage = CsvWorkerResponse extends infer T ? T extends CsvWorkerEnvelope ? Omit<T, 'protocol' | 'messageId' | 'inReplyTo'> : never : never

export function parseWorkerRequest(input: unknown): CsvWorkerRequest | null {
  if (!record(input) || input.protocol !== 1 || typeof input.messageId !== 'string' || typeof input.type !== 'string') return null
  switch (input.type) {
    case 'register-snapshot':
      return typeof input.documentId === 'string' && typeof input.sourceRevision === 'string' && Array.isArray(input.header) && input.header.every((item) => item === null || typeof item === 'string') && Array.isArray(input.records) && input.records.every((row) => Array.isArray(row) && row.every((cell) => typeof cell === 'string')) ? input as unknown as CsvWorkerRequest : null
    case 'set-schema':
      return typeof input.documentId === 'string' && Number.isSafeInteger(input.schemaRevision) && Array.isArray(input.columns) ? input as unknown as CsvWorkerRequest : null
    case 'query':
      return record(input.request) && record(input.request.dataset) && typeof input.request.requestId === 'string' && typeof input.request.queryId === 'string' && Array.isArray(input.request.columnIds) && typeof input.request.limit === 'number' ? input as unknown as CsvWorkerRequest : null
    case 'discover-groups':
      return typeof input.requestId === 'string' && typeof input.queryId === 'string' && record(input.dataset) && typeof input.columnId === 'string' && Number.isSafeInteger(input.limit) ? input as unknown as CsvWorkerRequest : null
    case 'cancel': return typeof input.queryId === 'string' ? input as unknown as CsvWorkerRequest : null
    case 'sample': return typeof input.documentId === 'string' && typeof input.sourceRevision === 'string' && Number.isSafeInteger(input.maxRecords) ? input as unknown as CsvWorkerRequest : null
    case 'release': return typeof input.documentId === 'string' ? input as unknown as CsvWorkerRequest : null
    case 'dispose': return input as unknown as CsvWorkerRequest
    default: return null
  }
}

export function parseWorkerResponse(input: unknown): CsvWorkerResponse | null {
  if (!record(input) || input.protocol !== 1 || typeof input.messageId !== 'string' || typeof input.inReplyTo !== 'string' || typeof input.type !== 'string') return null
  if (input.type === 'error') return typeof input.code === 'string' && typeof input.message === 'string' ? input as unknown as CsvWorkerResponse : null
  if (input.type === 'registered') return typeof input.documentId === 'string' && typeof input.sourceRevision === 'string' && Number.isSafeInteger(input.recordCount) ? input as unknown as CsvWorkerResponse : null
  if (input.type === 'schema-set') return typeof input.documentId === 'string' && Number.isSafeInteger(input.schemaRevision) ? input as unknown as CsvWorkerResponse : null
  if (input.type === 'page') return record(input.page) && Array.isArray(input.page.rows) && typeof input.page.queryId === 'string' ? input as unknown as CsvWorkerResponse : null
  if (input.type === 'groups') return typeof input.requestId === 'string' && typeof input.queryId === 'string' && record(input.dataset) && Array.isArray(input.keys) && input.keys.every((key) => typeof key === 'string') && typeof input.complete === 'boolean' ? input as unknown as CsvWorkerResponse : null
  if (input.type === 'sample') return record(input.sample) && Array.isArray(input.sample.records) ? input as unknown as CsvWorkerResponse : null
  if (input.type === 'released' || input.type === 'disposed') return input as unknown as CsvWorkerResponse
  return null
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
