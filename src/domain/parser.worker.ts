import { parseFileContent } from './formatParsing'
import type { Format } from './types'

self.onmessage = async (event: MessageEvent<{ id: string; name: string; mimeType: string; bytes: ArrayBuffer; format?: Format; documentId?: string; revision?: number; csvHasHeader?: boolean }>) => {
  const { id, name, mimeType, bytes, format, documentId, revision, csvHasHeader } = event.data
  try {
    const parsed = await parseFileContent(name, mimeType, new Uint8Array(bytes), format, { csvHasHeader })
    self.postMessage({ id, documentId, revision, ok: true, parsed })
  } catch (error) {
    self.postMessage({ id, documentId, revision, ok: false, error: error instanceof Error ? error.message : '파일을 읽지 못했습니다.' })
  }
}
