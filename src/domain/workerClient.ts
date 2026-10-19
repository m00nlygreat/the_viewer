import type { Format } from './types'
import type { ParsedFile } from './formatParsing'

export function parseWithWorker(name: string, mimeType: string, bytes: Uint8Array, format?: Format): Promise<ParsedFile> {
  if (typeof Worker === 'undefined') return import('./formatParsing').then(({ parseFileContent }) => parseFileContent(name, mimeType, bytes, format))
  const worker = new Worker(new URL('./parser.worker.ts', import.meta.url), { type: 'module', name: 'the-viewer-parser' })
  const id = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => { worker.terminate(); reject(new Error('파일 처리 시간이 초과되었습니다.')) }, 60_000)
    worker.onmessage = (event: MessageEvent<{ id: string; ok: boolean; parsed?: ParsedFile; error?: string }>) => {
      if (event.data.id !== id) return
      globalThis.clearTimeout(timeout)
      worker.terminate()
      if (event.data.ok && event.data.parsed) resolve(event.data.parsed)
      else reject(new Error(event.data.error ?? '파일을 읽지 못했습니다.'))
    }
    worker.onerror = () => { globalThis.clearTimeout(timeout); worker.terminate(); reject(new Error('파일 처리 작업자에서 오류가 발생했습니다.')) }
    const buffer = bytes.slice().buffer
    worker.postMessage({ id, name, mimeType, bytes: buffer, format }, [buffer])
  })
}
