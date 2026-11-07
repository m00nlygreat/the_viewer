import type { CalendarModel, ContactModel, CsvModel, ViewerDocument } from './types'

export type BackgroundSerializationInput =
  | { format: 'csv'; model: CsvModel }
  | { format: 'ics'; model: CalendarModel }
  | { format: 'vcf'; model: ContactModel }

interface SerializeJob {
  id: string
  documentId: string
  revision: number
  input: BackgroundSerializationInput
  resolve: (text: string) => void
  reject: (error: Error) => void
  scheduleTimer?: number
  timer?: number
  fallback?: boolean
  settled?: boolean
}

interface SerializeResponse { id: string; documentId: string; revision: number; ok: boolean; text?: string; error?: string }
interface WorkerSlot { worker: Worker | null; job: SerializeJob | null }

const WORKER_COUNT = 2
const SERIALIZE_TIMEOUT_MS = 60_000
const COALESCE_MS = 90
const slots: WorkerSlot[] = Array.from({ length: WORKER_COUNT }, () => ({ worker: null, job: null }))
const queue: SerializeJob[] = []
const jobsByDocument = new Map<string, SerializeJob>()
let fallbackActive = false

function abortError(): Error { return new DOMException('문서가 변경되어 이전 직렬화를 취소했습니다.', 'AbortError') }

function finishJob(job: SerializeJob, result: { text: string } | { error: Error }): void {
  if (job.settled) return
  job.settled = true
  if (job.scheduleTimer !== undefined) globalThis.clearTimeout(job.scheduleTimer)
  if (job.timer !== undefined) globalThis.clearTimeout(job.timer)
  if (jobsByDocument.get(job.documentId) === job) jobsByDocument.delete(job.documentId)
  if ('text' in result) job.resolve(result.text)
  else job.reject(result.error)
}

async function serializeInline(job: SerializeJob): Promise<string> {
  switch (job.input.format) {
    case 'csv': {
      const { serializeCsv } = await import('./formats/csv')
      if (job.settled) throw abortError()
      return serializeCsv(job.input.model)
    }
    case 'ics': {
      const { serializeCalendar } = await import('./formats/calendar')
      if (job.settled) throw abortError()
      return serializeCalendar(job.input.model)
    }
    case 'vcf': {
      const { serializeVCF } = await import('./vcard')
      if (job.settled) throw abortError()
      return serializeVCF(job.input.model)
    }
  }
}

function runFallback(job: SerializeJob): void {
  fallbackActive = true
  job.fallback = true
  job.timer = globalThis.setTimeout(() => {
    finishJob(job, { error: new Error('파일 직렬화 시간이 초과되었습니다.') })
    fallbackActive = false
    dispatch()
  }, SERIALIZE_TIMEOUT_MS) as unknown as number
  void serializeInline(job)
    .then((text) => finishJob(job, { text }))
    .catch((error: unknown) => finishJob(job, { error: error instanceof Error ? error : new Error('파일을 직렬화하지 못했습니다.') }))
    .finally(() => { fallbackActive = false; dispatch() })
}

function ensureWorker(slot: WorkerSlot): Worker {
  if (slot.worker) return slot.worker
  const worker = new Worker(new URL('./serialize.worker.ts', import.meta.url), { type: 'module', name: 'the-viewer-serializer' })
  slot.worker = worker
  worker.onmessage = (event: MessageEvent<SerializeResponse>) => {
    const job = slot.job
    if (!job || event.data.id !== job.id) return
    slot.job = null
    if (event.data.documentId !== job.documentId || event.data.revision !== job.revision) finishJob(job, { error: new Error('오래된 직렬화 결과를 무시했습니다.') })
    else if (event.data.ok && typeof event.data.text === 'string') finishJob(job, { text: event.data.text })
    else finishJob(job, { error: new Error(event.data.error ?? '파일을 직렬화하지 못했습니다.') })
    dispatch()
  }
  worker.onerror = () => {
    const job = slot.job
    slot.job = null
    worker.terminate()
    slot.worker = null
    if (job) finishJob(job, { error: new Error('파일 직렬화 작업자에서 오류가 발생했습니다.') })
    dispatch()
  }
  return worker
}

function dispatch(): void {
  if (fallbackActive) return
  for (const slot of slots) {
    if (fallbackActive) return
    if (slot.job || !queue.length) continue
    const job = queue.shift()!
    slot.job = job
    job.timer = globalThis.setTimeout(() => {
      if (slot.job !== job) return
      slot.job = null
      slot.worker?.terminate()
      slot.worker = null
      finishJob(job, { error: new Error('파일 직렬화 시간이 초과되었습니다.') })
      dispatch()
    }, SERIALIZE_TIMEOUT_MS) as unknown as number
    try {
      const worker = ensureWorker(slot)
      worker.postMessage({ id: job.id, documentId: job.documentId, revision: job.revision, ...job.input })
    } catch {
      slot.job = null
      slot.worker?.terminate()
      slot.worker = null
      if (job.timer !== undefined) globalThis.clearTimeout(job.timer)
      job.timer = undefined
      runFallback(job)
      return
    }
  }
}

function cancelJob(job: SerializeJob): void {
  if (job.scheduleTimer !== undefined) { globalThis.clearTimeout(job.scheduleTimer); job.scheduleTimer = undefined }
  const queuedIndex = queue.indexOf(job)
  if (queuedIndex >= 0) queue.splice(queuedIndex, 1)
  const slot = slots.find((candidate) => candidate.job === job)
  if (slot) {
    slot.worker?.terminate()
    slot.worker = null
    slot.job = null
  }
  finishJob(job, { error: abortError() })
  if (slot) dispatch()
}

export function cancelDocumentSerialization(documentId: string): void {
  const job = jobsByDocument.get(documentId)
  if (job) cancelJob(job)
}

export function cancelAllSerializations(): void {
  for (const job of [...jobsByDocument.values()]) cancelJob(job)
}

export function prepareBackgroundSerialization(document: ViewerDocument, sourceTextLength: number): BackgroundSerializationInput | null {
  const largeSource = sourceTextLength >= 512 * 1024
  switch (document.format) {
    case 'csv': {
      const cells = document.model.rows.length * Math.max(1, document.model.headers.length)
      return largeSource || document.model.rows.length >= 10_000 || cells >= 100_000 ? { format: 'csv', model: document.model } : null
    }
    case 'ics': return largeSource || document.model.events.length >= 250 ? { format: 'ics', model: document.model } : null
    case 'vcf': return largeSource || document.model.cards.length >= 250 ? { format: 'vcf', model: document.model } : null
    default: return null
  }
}

export function serializeViewCommand(documentId: string, revision: number, input: BackgroundSerializationInput): Promise<string> {
  cancelDocumentSerialization(documentId)
  return new Promise((resolve, reject) => {
    const job: SerializeJob = { id: crypto.randomUUID(), documentId, revision, input, resolve, reject }
    jobsByDocument.set(documentId, job)
    job.scheduleTimer = globalThis.setTimeout(() => {
      job.scheduleTimer = undefined
      if (job.settled) return
      queue.push(job)
      dispatch()
    }, COALESCE_MS) as unknown as number
  })
}
