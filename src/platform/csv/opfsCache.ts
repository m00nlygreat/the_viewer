import { CSV_POLICY } from '../../domain/csv-views/policy'
import { clearUtf8OpfsSources } from './utf8OpfsSource'

const FORMAT_VERSION = 1
const appBase = typeof __APP_BASE__ === 'string' ? __APP_BASE__ : '/'
const directoryName = `the-viewer-${safeName(appBase)}-csv-cache-v${FORMAT_VERSION}`

interface CacheEntry { key: string; name: string; size: number; touchedAt: number; source: string }
interface CacheManifest { version: 1; entries: CacheEntry[] }
let rootPromise: Promise<FileSystemDirectoryHandle> | null = null
let queue: Promise<unknown> = Promise.resolve()

export function csvCacheKey(parts: {
  documentId: string; fileId: string; sourceRevision: string; schemaRevision: number; condition: unknown;
  sort: unknown; range: unknown; columnIds: string[]; engineGeneration: number
}): string {
  return JSON.stringify(parts)
}

export async function getCsvCache(key: string): Promise<FileSystemFileHandle | null> {
  return serial(async () => {
    const root = await getRoot()
    const manifest = await readManifest(root)
    const entry = manifest.entries.find((candidate) => candidate.key === key)
    if (!entry) return null
    try {
      const handle = await root.getFileHandle(entry.name)
      const file = await handle.getFile()
      entry.touchedAt = Date.now()
      await writeManifest(root, manifest)
      return file.size === entry.size ? handle : null
    } catch { return null }
  })
}

export async function getCsvCacheForSource(key: string, sourceSignature: string): Promise<FileSystemFileHandle | null> {
  return serial(async () => {
    const root = await getRoot()
    const manifest = await readManifest(root)
    const entry = manifest.entries.find((candidate) => candidate.key === key && candidate.source === sourceSignature)
    if (!entry) return null
    try {
      const handle = await root.getFileHandle(entry.name)
      const file = await handle.getFile()
      if (file.size !== entry.size) return null
      entry.touchedAt = Date.now()
      await writeManifest(root, manifest)
      return handle
    } catch { return null }
  })
}

export async function putCsvCache(key: string, source: Blob, sourceSignature: string): Promise<FileSystemFileHandle> {
  if (!('storage' in navigator) || !navigator.storage.getDirectory) throw new Error('이 브라우저에서 OPFS 캐시를 사용할 수 없습니다.')
  const estimate = await navigator.storage.estimate()
  if (estimate.quota !== undefined && estimate.usage !== undefined && estimate.quota - estimate.usage < source.size) throw new Error('저장 공간이 부족해 조회 캐시를 만들 수 없습니다.')
  return serial(async () => {
    const root = await getRoot()
    const manifest = await readManifest(root)
    const name = `${await digest(key)}-${crypto.randomUUID()}.cache`
    const handle = await root.getFileHandle(name, { create: true })
    try {
      const writable = await handle.createWritable()
      const reader = source.stream().getReader()
      try {
        while (true) {
          const next = await reader.read()
          if (next.done) break
          await writable.write(next.value)
        }
        await writable.close()
      } catch (error) {
        await reader.cancel().catch(() => undefined)
        await writable.abort(error).catch(() => undefined)
        throw error
      }
      const file = await handle.getFile()
      manifest.entries = manifest.entries.filter((entry) => entry.key !== key)
      manifest.entries.push({ key, name, size: file.size, touchedAt: Date.now(), source: sourceSignature })
      await writeManifest(root, manifest)
      await enforceCacheLimit(root, manifest)
      return handle
    } catch (error) {
      await root.removeEntry(name).catch(() => undefined)
      throw error
    }
  })
}

export async function deleteCsvCache(key: string): Promise<void> {
  await serial(async () => {
    const root = await getRoot()
    const manifest = await readManifest(root)
    const removed = manifest.entries.filter((entry) => entry.key === key)
    manifest.entries = manifest.entries.filter((entry) => entry.key !== key)
    await writeManifest(root, manifest)
    await Promise.all(removed.map((entry) => root.removeEntry(entry.name).catch(() => undefined)))
  })
}

export async function getCsvCacheUsage(): Promise<{ bytes: number; entries: number; limit: number }> {
  try {
    const manifest = await readManifest(await getRoot())
    return { bytes: manifest.entries.reduce((total, entry) => total + entry.size, 0), entries: manifest.entries.length, limit: CSV_POLICY.opfsCacheBytes }
  } catch { return { bytes: 0, entries: 0, limit: CSV_POLICY.opfsCacheBytes } }
}

export async function clearAllCsvCache(): Promise<void> {
  await serial(async () => {
    rootPromise = null
    if (!('storage' in navigator) || !navigator.storage.getDirectory) return
    try { await (await navigator.storage.getDirectory()).removeEntry(directoryName, { recursive: true }) }
    catch (error) { if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error }
    await clearUtf8OpfsSources()
  })
}

async function getRoot(): Promise<FileSystemDirectoryHandle> {
  if (!('storage' in navigator) || !navigator.storage.getDirectory) throw new Error('이 브라우저에서 OPFS 캐시를 사용할 수 없습니다.')
  rootPromise ??= navigator.storage.getDirectory().then((directory) => directory.getDirectoryHandle(directoryName, { create: true }))
  return rootPromise
}

async function readManifest(root: FileSystemDirectoryHandle): Promise<CacheManifest> {
  try {
    const handle = await root.getFileHandle('manifest.json')
    const text = await (await handle.getFile()).text()
    const value: unknown = JSON.parse(text)
    if (isManifest(value)) return value
  } catch { /* a missing or corrupt manifest triggers orphan cleanup */ }
  const manifest: CacheManifest = { version: 1, entries: [] }
  for await (const [name] of root.entries()) if (name !== 'manifest.json') await root.removeEntry(name).catch(() => undefined)
  await writeManifest(root, manifest)
  return manifest
}

async function writeManifest(root: FileSystemDirectoryHandle, manifest: CacheManifest): Promise<void> {
  const handle = await root.getFileHandle('manifest.json', { create: true })
  const writable = await handle.createWritable()
  await writable.write(JSON.stringify(manifest))
  await writable.close()
}

async function enforceCacheLimit(root: FileSystemDirectoryHandle, manifest: CacheManifest): Promise<void> {
  manifest.entries.sort((left, right) => right.touchedAt - left.touchedAt)
  let bytes = 0
  const keep: CacheEntry[] = []
  for (const entry of manifest.entries) {
    if (bytes + entry.size <= CSV_POLICY.opfsCacheBytes) { keep.push(entry); bytes += entry.size }
    else await root.removeEntry(entry.name).catch(() => undefined)
  }
  manifest.entries = keep
  await writeManifest(root, manifest)
}

async function digest(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
function isManifest(value: unknown): value is CacheManifest {
  return typeof value === 'object' && value !== null && 'version' in value && value.version === 1 && 'entries' in value && Array.isArray(value.entries) && value.entries.every((entry) =>
    typeof entry === 'object' && entry !== null && 'key' in entry && typeof entry.key === 'string' && 'name' in entry && typeof entry.name === 'string' &&
    'size' in entry && Number.isSafeInteger(entry.size) && 'touchedAt' in entry && typeof entry.touchedAt === 'number' && 'source' in entry && typeof entry.source === 'string')
}
function safeName(value: string): string { return value.replace(/[^a-z0-9]+/giu, '-').replace(/^-|-$/gu, '') || 'root' }
function serial<T>(operation: () => Promise<T>): Promise<T> {
  const next = queue.then(operation)
  queue = next.then(() => undefined, () => undefined)
  return next
}
