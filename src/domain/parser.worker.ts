import { parseFileContent } from './formatParsing'
import type { Format } from './types'

self.onmessage = async (event: MessageEvent<{ id: string; name: string; mimeType: string; bytes?: ArrayBuffer; text?: string; format?: Format; documentId?: string; revision?: number; csvHasHeader?: boolean }>) => {
  const { id, name, mimeType, bytes, text, format, documentId, revision, csvHasHeader } = event.data
  try {
    const input = bytes ? new Uint8Array(bytes) : new TextEncoder().encode(text ?? '')
    const parsed = await parseFileContent(name, mimeType, input, format, { csvHasHeader })
    self.postMessage({ id, documentId, revision, ok: true, parsed })
  } catch (error) {
    self.postMessage({ id, documentId, revision, ok: false, error: error instanceof Error ? error.message : '파일을 읽지 못했습니다.' })
  }
}
