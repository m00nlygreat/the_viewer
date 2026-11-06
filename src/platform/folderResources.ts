import { assertInputFileSize } from '../domain/inputPolicy'
import { readFolderFile, type FolderSource } from './folderAccess'
import type { FolderPath } from '../domain/workspace'

interface ResourceEntry { url: string; refs: number }
interface PendingEntry { promise: Promise<string>; controller: AbortController; waiters: number }
const allowedTypes = new Set(['image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'])

export class FolderResourceManager {
  private readonly resources = new Map<string, ResourceEntry>()
  private readonly pending = new Map<string, PendingEntry>()
  private generation = 0

  nextGeneration(): number { this.releaseAll(); this.generation += 1; return this.generation }
  setGeneration(generation: number): void { this.releaseAll(); this.generation = generation }

  async acquire(source: FolderSource, generation: number, path: FolderPath, signal: AbortSignal): Promise<{ url: string; release: () => void }> {
    if (generation !== this.generation) throw new DOMException('폴더 자원이 만료되었습니다.', 'AbortError')
    if (signal.aborted) throw new DOMException('이미지 요청이 취소되었습니다.', 'AbortError')
    const key = `${generation}:${path}`
    const existing = this.resources.get(key)
    if (existing) { existing.refs += 1; return { url: existing.url, release: () => this.release(key) } }
    let pending = this.pending.get(key)
    if (!pending) {
      const controller = new AbortController()
      const entry: PendingEntry = { controller, waiters: 0, promise: Promise.resolve('') }
      entry.promise = this.createUrl(source, generation, path, controller.signal).then((url) => {
        if (generation !== this.generation || controller.signal.aborted) { URL.revokeObjectURL(url); this.assertCurrent(generation, controller.signal) }
        this.resources.set(key, { url, refs: 0 })
        return url
      }).finally(() => { if (this.pending.get(key) === entry) this.pending.delete(key) })
      pending = entry
      this.pending.set(key, entry)
    }
    pending.waiters += 1
    try {
      const url = await waitForRequest(pending.promise, signal)
      this.assertCurrent(generation, signal)
      const resource = this.resources.get(key)
      if (!resource || resource.url !== url) throw new DOMException('폴더 자원이 만료되었습니다.', 'AbortError')
      resource.refs += 1
      return { url: resource.url, release: () => this.release(key) }
    } finally {
      pending.waiters -= 1
      if (pending.waiters === 0) {
        if (this.pending.get(key) === pending) pending.controller.abort()
        const resource = this.resources.get(key)
        if (resource?.refs === 0) { URL.revokeObjectURL(resource.url); this.resources.delete(key) }
      }
    }
  }

  releaseAll(): void {
    for (const item of this.resources.values()) URL.revokeObjectURL(item.url)
    this.resources.clear()
    for (const item of this.pending.values()) item.controller.abort()
    this.pending.clear()
  }

  private async createUrl(source: FolderSource, generation: number, path: FolderPath, signal: AbortSignal): Promise<string> {
    const { file } = await readFolderFile(source, path, signal)
    this.assertCurrent(generation, signal)
    assertInputFileSize(file.name, file.size, navigator.userAgent)
    const type = file.type.toLowerCase()
    const extension = file.name.split('.').pop()?.toLowerCase()
    const extensionTypes: Record<string, string> = { avif: 'image/avif', gif: 'image/gif', jpeg: 'image/jpeg', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', svg: 'image/svg+xml' }
    const expected = extension ? extensionTypes[extension] : undefined
    if (!expected || !allowedTypes.has(expected) || (type && type !== expected)) throw new Error(`“${file.name}”은 지원하는 이미지가 아닙니다.`)
    const bytes = new Uint8Array(await file.arrayBuffer())
    this.assertCurrent(generation, signal)
    if (expected !== 'image/svg+xml' && !hasRasterSignature(bytes, expected)) throw new Error(`“${file.name}”의 실제 파일 형식이 이미지와 다릅니다.`)
    const blob = expected === 'image/svg+xml' ? await sanitizeSvg(bytes, file.name) : new Blob([bytes], { type: expected })
    this.assertCurrent(generation, signal)
    const url = URL.createObjectURL(blob)
    if (generation !== this.generation || signal.aborted) { URL.revokeObjectURL(url); this.assertCurrent(generation, signal) }
    return url
  }

  private assertCurrent(generation: number, signal: AbortSignal): void {
    if (generation !== this.generation || signal.aborted) throw new DOMException('폴더 자원이 만료되었습니다.', 'AbortError')
  }

  private release(key: string): void {
    const item = this.resources.get(key)
    if (!item) return
    item.refs -= 1
    if (item.refs <= 0) { URL.revokeObjectURL(item.url); this.resources.delete(key) }
  }
}

function waitForRequest<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new DOMException('이미지 요청이 취소되었습니다.', 'AbortError'))
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException('이미지 요청이 취소되었습니다.', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

async function sanitizeSvg(bytes: Uint8Array, name: string): Promise<Blob> {
  const source = new TextDecoder().decode(bytes)
  const parsed = new DOMParser().parseFromString(source, 'image/svg+xml')
  if (parsed.querySelector('parsererror') || parsed.documentElement.localName.toLowerCase() !== 'svg') throw new Error(`“${name}” SVG를 읽지 못했습니다.`)
  const root = parsed.documentElement
  for (const node of Array.from(root.querySelectorAll('script, foreignObject, iframe, object, embed, style'))) node.remove()
  for (const element of Array.from(root.querySelectorAll('*'))) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase()
      const value = attribute.value.trim()
      if (name.startsWith('on') || /url\s*\(/iu.test(value) || ['href', 'xlink:href', 'src'].includes(name) && value && !value.startsWith('#')) element.removeAttribute(attribute.name)
    }
  }
  return new Blob([new XMLSerializer().serializeToString(root)], { type: 'image/svg+xml' })
}

function hasRasterSignature(bytes: Uint8Array, type: string): boolean {
  if (type === 'image/png') return bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  if (type === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (type === 'image/gif') return bytes.length >= 6 && new TextDecoder().decode(bytes.subarray(0, 6)).match(/^GIF8[79]a$/u) !== null
  if (type === 'image/webp') return bytes.length >= 12 && new TextDecoder().decode(bytes.subarray(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.subarray(8, 12)) === 'WEBP'
  if (type === 'image/avif') return bytes.length >= 12 && new TextDecoder().decode(bytes.subarray(4, 12)).includes('ftypavif')
  return false
}
