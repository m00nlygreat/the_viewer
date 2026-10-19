import { FORMAT_MIME, type Format, type ViewerDocument } from './types'
import { parseWithWorker } from './workerClient'

export async function makeDocumentFromBytes(name: string, mimeType: string, bytes: Uint8Array, parentId?: string): Promise<ViewerDocument> {
  const limit = /Mobi|Android/i.test(globalThis.navigator?.userAgent ?? '') ? 20 * 1024 * 1024 : 50 * 1024 * 1024
  if (bytes.byteLength > limit) throw new Error(`파일 크기 제한은 ${Math.round(limit / 1024 / 1024)} MiB입니다.`)
  const parsed = await parseWithWorker(name, mimeType, bytes)
  return {
    id: crypto.randomUUID(), name, format: parsed.format, mimeType: mimeType || FORMAT_MIME[parsed.format], size: bytes.byteLength,
    sourceBytes: bytes.slice().buffer, sourceText: parsed.text, text: parsed.text, model: parsed.model, mode: 'view', revision: 0,
    savedText: parsed.text, isDirty: false, openedAt: Date.now(), lastEditedAt: Date.now(), parentId
  }
}

export async function makeBlankDocument(name: string, format: Format, text: string): Promise<ViewerDocument> {
  return makeDocumentFromBytes(name, FORMAT_MIME[format], new TextEncoder().encode(text))
}
