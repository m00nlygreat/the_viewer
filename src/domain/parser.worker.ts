import { parseFileContent } from './formatParsing'
import type { Format } from './types'

self.onmessage = async (event: MessageEvent<{ id: string; name: string; mimeType: string; bytes: ArrayBuffer; format?: Format }>) => {
  const { id, name, mimeType, bytes, format } = event.data
  try {
    const parsed = await parseFileContent(name, mimeType, new Uint8Array(bytes), format)
    self.postMessage({ id, ok: true, parsed })
  } catch (error) {
    self.postMessage({ id, ok: false, error: error instanceof Error ? error.message : '파일을 읽지 못했습니다.' })
  }
}
