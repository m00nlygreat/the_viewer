/// <reference lib="webworker" />
import type { CsvCell, CsvColumnDefinition, CsvQueryRequest, CsvSample } from './model'
import { CSV_POLICY } from './policy'
import { compareForSort, effectiveSort, encodeGroupKey, evaluateFilter } from './query'
import { parseWorkerRequest, type CsvWorkerRequest, type CsvWorkerResponse, type CsvWorkerResponseMessage } from './protocol'
import { parseCell } from './typing'

interface Snapshot { sourceRevision: string; header: (string | null)[]; records: string[][]; schemaRevision: number | null; columns: Map<string, CsvColumnDefinition> }
interface Cursor { queryId: string; documentId: string; sourceRevision: string; schemaRevision: number; position: number; indices: Uint32Array; request: CsvQueryRequest }
const snapshots = new Map<string, Snapshot>()
const cursors = new Map<string, Cursor>()
const cancelled = new Set<string>()

self.addEventListener('message', (event: MessageEvent<unknown>) => {
  const request = parseWorkerRequest(event.data)
  if (!request) return
  void handle(request)
})

async function handle(request: CsvWorkerRequest): Promise<void> {
  try {
    switch (request.type) {
      case 'register-snapshot': {
        cursorsForDocument(request.documentId)
        snapshots.set(request.documentId, { sourceRevision: request.sourceRevision, header: request.header, records: request.records, schemaRevision: null, columns: new Map() })
        reply(request, { type: 'registered', documentId: request.documentId, sourceRevision: request.sourceRevision, recordCount: request.records.length })
        break
      }
      case 'set-schema': {
        const snapshot = snapshots.get(request.documentId)
        if (!snapshot) throw queryError('source-unavailable', '조회 원본이 등록되지 않았습니다.')
        snapshot.schemaRevision = request.schemaRevision
        snapshot.columns = new Map(request.columns.map((column) => [column.id, column]))
        cursorsForDocument(request.documentId)
        reply(request, { type: 'schema-set', documentId: request.documentId, schemaRevision: request.schemaRevision })
        break
      }
      case 'query': await query(request); break
      case 'discover-groups': await discoverGroups(request); break
      case 'cancel': cancelled.add(request.queryId); break
      case 'sample': {
        const snapshot = snapshots.get(request.documentId)
        if (!snapshot || snapshot.sourceRevision !== request.sourceRevision) throw queryError('stale-dataset', '표본의 원본 revision이 변경되었습니다.')
        const records = snapshot.records.slice(0, Math.min(request.maxRecords, CSV_POLICY.sampleRecords))
        const sample: CsvSample = { header: snapshot.header, records, firstRecordNo: 1, reachedEof: records.length >= snapshot.records.length, bytesRead: estimateRecordsBytes(records), stoppedBy: records.length >= snapshot.records.length ? 'eof' : 'records' }
        reply(request, { type: 'sample', sample })
        break
      }
      case 'release': snapshots.delete(request.documentId); cursorsForDocument(request.documentId); reply(request, { type: 'released' }); break
      case 'dispose': snapshots.clear(); cursors.clear(); reply(request, { type: 'disposed' }); break
    }
  } catch (error) {
    reply(request, { type: 'error', code: error instanceof WorkerQueryError ? error.code : 'internal', message: error instanceof Error ? error.message : 'CSV 조회에 실패했습니다.' })
  }
}

async function discoverGroups(envelope: Extract<CsvWorkerRequest, { type: 'discover-groups' }>): Promise<void> {
  const snapshot = snapshots.get(envelope.dataset.documentId)
  if (!snapshot) throw queryError('source-unavailable', '조회 원본이 등록되지 않았습니다.')
  if (snapshot.sourceRevision !== envelope.dataset.sourceRevision || snapshot.schemaRevision !== envelope.dataset.schemaRevision) throw queryError('stale-dataset', '원본 또는 스키마 revision이 변경되었습니다.')
  const column = snapshot.columns.get(envelope.columnId)
  if (!column) throw queryError('invalid-request', '그룹 컬럼 설정을 찾을 수 없습니다.')
  const keys = new Set<string>()
  let complete = true
  for (let index = 0; index < snapshot.records.length; index += 1) {
    checkCancelled(envelope.queryId)
    const record = snapshot.records[index]!
    const cell = parseCell(column, record[column.sourceIndex])
    if (envelope.filter && !evaluateFilter(envelope.filter, snapshot.columns, (columnId) => {
      const candidate = snapshot.columns.get(columnId)
      return candidate ? parseCell(candidate, record[candidate.sourceIndex]) : { state: 'missing' }
    })) continue
    keys.add(encodeGroupKey(cell))
    if (keys.size > envelope.limit) { complete = false; break }
    if ((index & 127) === 127) await yieldToWorker()
  }
  checkCancelled(envelope.queryId)
  reply(envelope, { type: 'groups', requestId: envelope.requestId, queryId: envelope.queryId, dataset: envelope.dataset, keys: [...keys].slice(0, envelope.limit), complete })
}

async function query(envelope: Extract<CsvWorkerRequest, { type: 'query' }>): Promise<void> {
  const request = envelope.request
  const snapshot = snapshots.get(request.dataset.documentId)
  if (!snapshot) throw queryError('source-unavailable', '조회 원본이 등록되지 않았습니다.')
  if (snapshot.sourceRevision !== request.dataset.sourceRevision || snapshot.schemaRevision !== request.dataset.schemaRevision) throw queryError('stale-dataset', '원본 또는 스키마 revision이 변경되었습니다.')
  const existing = request.cursor ? cursors.get(request.cursor) : undefined
  let cursor: Cursor
  if (request.cursor) {
    if (!existing || existing.queryId !== request.queryId || existing.documentId !== request.dataset.documentId || existing.sourceRevision !== request.dataset.sourceRevision || existing.schemaRevision !== request.dataset.schemaRevision) throw queryError('cursor-expired', '조회 위치가 만료되었습니다. 다시 조회하세요.')
    cursor = existing
  } else {
    const indices = await makeResultIndices(snapshot, request)
    cursor = { queryId: request.queryId, documentId: request.dataset.documentId, sourceRevision: request.dataset.sourceRevision, schemaRevision: request.dataset.schemaRevision, position: 0, indices, request }
  }
  const rows = []
  let bytes = 0
  const limit = Math.min(CSV_POLICY.pageSize, Math.max(1, Math.floor(request.limit)))
  while (cursor.position < cursor.indices.length && rows.length < limit) {
    checkCancelled(request.queryId)
    const rowIndex = cursor.indices[cursor.position]!
    const record = snapshot.records[rowIndex]!
    const cells: Record<string, CsvCell> = {}
    for (const columnId of request.columnIds) {
      const column = snapshot.columns.get(columnId)
      if (!column) throw queryError('invalid-request', `알 수 없는 컬럼입니다: ${columnId}`)
      const cell = parseCell(column, record[column.sourceIndex])
      cells[columnId] = cell
      bytes += estimateCellBytes(cell)
    }
    if (bytes > request.maxResultBytes && rows.length === 0) throw queryError('budget-exceeded', '셀 크기가 결과 페이지 한도를 넘었습니다. 컬럼을 줄여 다시 조회하세요.')
    if (bytes > request.maxResultBytes) break
    rows.push({ rowId: `${request.dataset.sourceRevision}:${rowIndex + 1}`, recordNo: String(rowIndex + 1), cells })
    cursor.position += 1
    if ((rows.length & 31) === 0) await yieldToWorker()
  }
  checkCancelled(request.queryId)
  const hasMore = cursor.position < cursor.indices.length
  const nextCursor = hasMore ? `${request.queryId}:${crypto.randomUUID()}` : null
  if (nextCursor) cursors.set(nextCursor, cursor)
  const page = {
    dataset: request.dataset, requestId: request.requestId, queryId: request.queryId, engineGeneration: 0,
    rows, nextCursor, hasMore, total: { status: 'unknown' as const }, diagnostics: []
  }
  reply(envelope, { type: 'page', page })
}

async function makeResultIndices(snapshot: Snapshot, request: CsvQueryRequest): Promise<Uint32Array> {
  const indices: number[] = []
  const sort = effectiveSort({ id: request.queryId, name: '', layout: { kind: 'grid' }, columnIds: request.columnIds, filter: request.filter, sort: request.sort, displayOverrides: {}, updatedAt: new Date(0).toISOString() })
  const parsed = new Map<number, Map<string, CsvCell>>()
  const cellOf = (rowIndex: number, columnId: string): CsvCell => {
    let rowCells = parsed.get(rowIndex)
    if (!rowCells) { rowCells = new Map(); parsed.set(rowIndex, rowCells) }
    let cell = rowCells.get(columnId)
    if (!cell) {
      const column = snapshot.columns.get(columnId)
      if (!column) throw queryError('invalid-request', `알 수 없는 컬럼입니다: ${columnId}`)
      cell = parseCell(column, snapshot.records[rowIndex]?.[column.sourceIndex])
      rowCells.set(columnId, cell)
    }
    return cell
  }
  for (let rowIndex = 0; rowIndex < snapshot.records.length; rowIndex += 1) {
    checkCancelled(request.queryId)
    if (request.scope.kind === 'group' && !sameGroupKey(cellOf(rowIndex, request.scope.columnId), request.scope.key)) continue
    if (request.scope.kind === 'calendar' && !withinCalendar(cellOf(rowIndex, request.scope.columnId), request.scope.start, request.scope.end)) continue
    if (!request.filter || evaluateFilter(request.filter, snapshot.columns, (columnId) => cellOf(rowIndex, columnId))) indices.push(rowIndex)
    if ((rowIndex & 127) === 127) await yieldToWorker()
  }
  const ordered = sort.length ? await cooperativeSort(indices, (left, right) => {
    for (const item of sort) {
      const column = snapshot.columns.get(item.columnId)
      if (!column) continue
      const compared = compareForSort(column, item.direction, cellOf(left, item.columnId), cellOf(right, item.columnId))
      if (compared) return compared
    }
    return left - right
  }, request.queryId) : indices
  return Uint32Array.from(ordered)
}

async function cooperativeSort(values: number[], compare: (left: number, right: number) => number, queryId: string): Promise<number[]> {
  let source = values
  let target = new Array<number>(values.length)
  let operations = 0
  for (let width = 1; width < values.length; width *= 2) {
    for (let start = 0; start < values.length; start += width * 2) {
      const middle = Math.min(start + width, values.length)
      const end = Math.min(start + width * 2, values.length)
      let left = start, right = middle, write = start
      while (left < middle && right < end) {
        target[write++] = compare(source[left]!, source[right]!) <= 0 ? source[left++]! : source[right++]!
        if ((++operations & 8191) === 0) { checkCancelled(queryId); await yieldToWorker() }
      }
      while (left < middle) target[write++] = source[left++]!
      while (right < end) target[write++] = source[right++]!
    }
    ;[source, target] = [target, source]
  }
  return source
}

function sameGroupKey(cell: CsvCell, key: string): boolean {
  try {
    const decoded = JSON.parse(key) as { state?: string; value?: unknown }
    if (decoded.state !== cell.state) return false
    if (cell.state !== 'value') return true
    return JSON.stringify(cell.value) === JSON.stringify(decoded.value)
  } catch { return false }
}
function withinCalendar(cell: CsvCell, start: string, end: string): boolean {
  if (cell.state !== 'value' || typeof cell.value !== 'string') return false
  return cell.value >= start && cell.value < end
}
function estimateCellBytes(cell: CsvCell): number { return cell.state === 'value' ? new TextEncoder().encode(JSON.stringify(cell)).byteLength : cell.state === 'invalid' || cell.state === 'null-marker' ? new TextEncoder().encode(cell.raw).byteLength + 24 : 8 }
function estimateRecordsBytes(records: string[][]): number { return records.reduce((sum, row) => sum + row.reduce((rowSum, cell) => rowSum + new TextEncoder().encode(cell).byteLength, 0), 0) }
function checkCancelled(queryId: string): void { if (cancelled.delete(queryId)) throw queryError('cancelled', '조회가 취소되었습니다.') }
function cursorsForDocument(documentId: string): void { for (const [key, cursor] of cursors) if (cursor.documentId === documentId) cursors.delete(key) }
function queryError(code: WorkerQueryError['code'], message: string): WorkerQueryError { return new WorkerQueryError(code, message) }
async function yieldToWorker(): Promise<void> { await new Promise<void>((resolve) => setTimeout(resolve, 0)) }
function reply(request: CsvWorkerRequest, response: CsvWorkerResponseMessage): void {
  const message: CsvWorkerResponse = { protocol: 1, messageId: crypto.randomUUID(), inReplyTo: request.messageId, ...response } as CsvWorkerResponse
  self.postMessage(message)
}
class WorkerQueryError extends Error {
  constructor(public readonly code: 'cancelled' | 'stale-dataset' | 'cursor-expired' | 'budget-exceeded' | 'invalid-request' | 'source-unavailable' | 'engine-restarted' | 'internal', message: string) { super(message) }
}
