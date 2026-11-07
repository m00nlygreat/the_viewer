import type { Format } from './types'
import type { ParsedFile } from './formatParsing'

export interface ParseRequestContext { documentId: string; revision: number; csvHasHeader?: boolean }

interface ParseResponse {
  id: string
  documentId?: string
  revision?: number
  ok: boolean
  parsed?: ParsedFile
  error?: string
}

interface ParseJob {
  id: string
  name: string
  mimeType: string
  bytes?: ArrayBuffer
  text?: string
  format?: Format
  context?: ParseRequestContext
  resolve: (parsed: ParsedFile) => void
  reject: (error: Error) => void
  timer?: number
  fallback?: boolean
  settled?: boolean
}

interface WorkerSlot { worker: Worker | null; job: ParseJob | null }

export interface ParseWithWorkerOptions { transferInputBytes?: boolean }

const WORKER_COUNT = 2
const PARSE_TIMEOUT_MS = 60_000
const slots: WorkerSlot[] = Array.from({ length: WORKER_COUNT }, () => ({ worker: null, job: null }))
const queue: ParseJob[] = []
const jobsByDocument = new Map<string, ParseJob>()

function abortError(): Error { return new DOMException('문서가 변경되어 이전 해석을 취소했습니다.', 'AbortError') }

function finishJob(job: ParseJob, result: { parsed: ParsedFile } | { error: Error }): void {
  if (job.settled) return
  job.settled = true
  if (job.timer !== undefined) globalThis.clearTimeout(job.timer)
  if (job.context && jobsByDocument.get(job.context.documentId) === job) jobsByDocument.delete(job.context.documentId)
  if ('parsed' in result) job.resolve(result.parsed)
  else job.reject(result.error)
}

function runFallback(job: ParseJob): void {
  job.fallback = true
  job.timer = globalThis.setTimeout(() => {
    finishJob(job, { error: new Error('파일 처리 시간이 초과되었습니다.') })
    dispatch()
  }, PARSE_TIMEOUT_MS) as unknown as number
  void import('./formatParsing').then(({ parseFileContent }) => {
    if (job.settled) return undefined
    const bytes = job.bytes ? new Uint8Array(job.bytes) : new TextEncoder().encode(job.text ?? '')
    return parseFileContent(job.name, job.mimeType, bytes, job.format, job.context)
  }).then((parsed) => {
    if (parsed) finishJob(job, { parsed })
  }).catch((error: unknown) => finishJob(job, { error: error instanceof Error ? error : new Error('파일을 읽지 못했습니다.') })).finally(dispatch)
}

function ensureWorker(slot: WorkerSlot): Worker {
  if (slot.worker) return slot.worker
  const worker = new Worker(new URL('./parser.worker.ts', import.meta.url), { type: 'module', name: 'the-viewer-parser' })
  slot.worker = worker
  worker.onmessage = (event: MessageEvent<ParseResponse>) => {
    const job = slot.job
    if (!job || event.data.id !== job.id) return
    slot.job = null
    if (job.context && (event.data.documentId !== job.context.documentId || event.data.revision !== job.context.revision)) {
      finishJob(job, { error: new Error('오래된 문서 해석 결과를 무시했습니다.') })
    } else if (event.data.ok && event.data.parsed) finishJob(job, { parsed: event.data.parsed })
    else finishJob(job, { error: new Error(event.data.error ?? '파일을 읽지 못했습니다.') })
    dispatch()
  }
  worker.onerror = () => {
    const job = slot.job
    slot.job = null
    worker.terminate()
    slot.worker = null
    if (job) finishJob(job, { error: new Error('파일 처리 작업자에서 오류가 발생했습니다.') })
    dispatch()
  }
  return worker
}

function dispatch(): void {
  for (const slot of slots) {
    if (slot.job || !queue.length) continue
    const job = queue.shift()!
    slot.job = job
    job.timer = globalThis.setTimeout(() => {
      if (slot.job !== job) return
      slot.job = null
      slot.worker?.terminate()
      slot.worker = null
      finishJob(job, { error: new Error('파일 처리 시간이 초과되었습니다.') })
      dispatch()
    }, PARSE_TIMEOUT_MS) as unknown as number

    try {
      const worker = ensureWorker(slot)
      const input = job.bytes ? { bytes: job.bytes } : { text: job.text ?? '' }
      worker.postMessage({ id: job.id, name: job.name, mimeType: job.mimeType, format: job.format, ...input, ...job.context }, job.bytes ? [job.bytes] : [])
    } catch {
      slot.job = null
      slot.worker?.terminate()
      slot.worker = null
      if (job.timer !== undefined) globalThis.clearTimeout(job.timer)
      job.timer = undefined
      runFallback(job)
    }
  }
}

export function cancelDocumentParse(documentId: string): void {
  const job = jobsByDocument.get(documentId)
  if (!job) return
  const queuedIndex = queue.indexOf(job)
  if (queuedIndex >= 0) {
    queue.splice(queuedIndex, 1)
    finishJob(job, { error: abortError() })
    return
  }
  const slot = slots.find((candidate) => candidate.job === job)
  if (!slot) {
    if (job.fallback) finishJob(job, { error: abortError() })
    return
  }
  slot.worker?.terminate()
  slot.worker = null
  slot.job = null
  finishJob(job, { error: abortError() })
  dispatch()
}

function enqueueParseJob(name: string, mimeType: string, input: { bytes: ArrayBuffer } | { text: string }, format?: Format, context?: ParseRequestContext): Promise<ParsedFile> {
  if (context) cancelDocumentParse(context.documentId)
  const id = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    const job: ParseJob = { id, name, mimeType, ...input, format, context, resolve, reject }
    if (context) jobsByDocument.set(context.documentId, job)
    if (typeof Worker === 'undefined') {
      runFallback(job)
      return
    }
    queue.push(job)
    dispatch()
  })
}

export function parseWithWorker(name: string, mimeType: string, bytes: Uint8Array, format?: Format, context?: ParseRequestContext, options: ParseWithWorkerOptions = {}): Promise<ParsedFile> {
  const sourceBuffer = bytes.buffer
  const ownsWholeBuffer = sourceBuffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === sourceBuffer.byteLength
  const buffer = options.transferInputBytes && ownsWholeBuffer ? sourceBuffer : bytes.slice().buffer as ArrayBuffer
  return enqueueParseJob(name, mimeType, { bytes: buffer }, format, context)
}

export function parseTextWithWorker(name: string, mimeType: string, text: string, format: Format, context?: ParseRequestContext): Promise<ParsedFile> {
  return enqueueParseJob(name, mimeType, { text }, format, context)
}
