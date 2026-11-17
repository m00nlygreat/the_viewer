import { CSV_POLICY } from '../../domain/csv-views/policy'
import type { CsvSourceFile } from './sampleFile'

const appBase = typeof __APP_BASE__ === 'string' ? __APP_BASE__ : '/'
const directoryName = `the-viewer-${appBase.replace(/[^a-z0-9]+/giu, '-').replace(/^-|-$/gu, '') || 'root'}-csv-source-v1`

export interface CsvPreparedSource { file: CsvSourceFile; handle: FileSystemFileHandle | null; release(): Promise<void> }

export async function createUtf8OpfsSource(source: CsvSourceFile, encoding: string, bom: 'auto' | 'present' | 'absent', signal: AbortSignal): Promise<CsvPreparedSource> {
  if (!('storage' in navigator) || !navigator.storage.getDirectory) throw new Error('이 브라우저는 다른 인코딩 CSV의 임시 UTF-8 변환에 필요한 OPFS를 지원하지 않습니다.')
  const estimate = await navigator.storage.estimate()
  if (estimate.quota !== undefined && estimate.usage !== undefined && estimate.quota - estimate.usage < source.size) throw new Error('저장 공간이 부족해 CSV 인코딩 변환을 시작할 수 없습니다.')
  const root = await navigator.storage.getDirectory()
  const directory = await root.getDirectoryHandle(directoryName, { create: true })
  await removeAbandonedFiles(directory)
  const name = `source-${Date.now()}-${crypto.randomUUID()}.tmp`
  const handle = await directory.getFileHandle(name, { create: true })
  const writable = await handle.createWritable()
  const reader = source.stream().getReader()
  const decoder = new TextDecoder(encoding, { fatal: true, ignoreBOM: bom === 'absent' })
  const encoder = new TextEncoder()
  let outputBytes = 0
  try {
    while (true) {
      if (signal.aborted) throw abortError()
      const next = await reader.read()
      if (next.done) break
      const text = decoder.decode(next.value, { stream: true })
      if (!text) continue
      const bytes = encoder.encode(text)
      outputBytes += bytes.byteLength
      if (outputBytes > CSV_POLICY.maxFileBackedCsvBytes) throw new Error('UTF-8 변환 결과가 파일 기반 CSV 임시 한도를 넘었습니다.')
      await writable.write(bytes)
    }
    const tail = decoder.decode()
    if (tail) {
      const bytes = encoder.encode(tail)
      outputBytes += bytes.byteLength
      if (outputBytes > CSV_POLICY.maxFileBackedCsvBytes) throw new Error('UTF-8 변환 결과가 파일 기반 CSV 임시 한도를 넘었습니다.')
      await writable.write(bytes)
    }
    if (signal.aborted) throw abortError()
    await writable.close()
    const file = await handle.getFile()
    return { file, handle, release: async () => { await directory.removeEntry(name).catch(() => undefined) } }
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    await writable.abort(error).catch(() => undefined)
    await directory.removeEntry(name).catch(() => undefined)
    throw error
  } finally { reader.releaseLock() }
}

export async function clearUtf8OpfsSources(): Promise<void> {
  if (!('storage' in navigator) || !navigator.storage.getDirectory) return
  const root = await navigator.storage.getDirectory()
  await root.removeEntry(directoryName, { recursive: true }).catch((error: unknown) => {
    if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error
  })
}

async function removeAbandonedFiles(directory: FileSystemDirectoryHandle): Promise<void> {
  const abandonedBefore = Date.now() - 24 * 60 * 60 * 1000
  for await (const [name] of directory.entries()) {
    const createdAt = /^source-(\d+)-[\da-f-]+\.tmp$/iu.exec(name)?.[1]
    if (createdAt && Number(createdAt) < abandonedBefore) await directory.removeEntry(name).catch(() => undefined)
  }
}

function abortError(): DOMException { return new DOMException('CSV 인코딩 변환이 취소되었습니다.', 'AbortError') }
