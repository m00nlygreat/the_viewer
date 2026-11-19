import type { CsvFileIdentity } from '../../domain/csv-views/model'

export type CsvIdentityMatch =
  | { kind: 'same'; fileId: string; basis: 'handle' | 'folder-path' | 'digest' }
  | { kind: 'ambiguous'; candidates: { fileId: string; basis: 'digest' | 'name-size' }[] }
  | { kind: 'new' }

const IDENTITY_SAMPLE_BYTES = 64 * 1024

export async function readIdentity(
  file: Blob & { name: string; lastModified: number },
  header: string | null,
  folder: CsvFileIdentity['folder']
): Promise<CsvFileIdentity> {
  const headerDigest = header === null ? null : await sha256(new TextEncoder().encode(header))
  const length = Math.min(file.size, IDENTITY_SAMPLE_BYTES)
  const sampleDigest = length ? { algorithm: 'SHA-256' as const, offset: 0, length, digest: await sha256(await file.slice(0, length).arrayBuffer()) } : null
  return { name: file.name, size: file.size, lastModified: file.lastModified, headerDigest, sampleDigest, folder }
}

export async function matchIdentity(
  target: CsvFileIdentity | null | undefined,
  targetHandle: FileSystemFileHandle | null,
  known: { fileId: string; identity: CsvFileIdentity; handle: FileSystemFileHandle | null }[]
): Promise<CsvIdentityMatch> {
  const validKnown = known.flatMap((candidate) => candidate && isCsvFileIdentity(candidate.identity) ? [candidate] : [])
  if (targetHandle) {
    for (const candidate of validKnown) {
      try {
        if (typeof candidate.handle?.isSameEntry !== 'function') continue
        if (await targetHandle.isSameEntry(candidate.handle)) return { kind: 'same', fileId: candidate.fileId, basis: 'handle' }
      }
      catch { /* Permission and browser-specific handle errors fall back to fingerprints. */ }
    }
  }
  if (!isCsvFileIdentity(target)) return { kind: 'new' }
  const folderCandidates = validKnown.filter((candidate) => target.folder && candidate.identity.folder &&
    target.folder.rootId === candidate.identity.folder.rootId && target.folder.relativePath === candidate.identity.folder.relativePath &&
    target.size === candidate.identity.size && target.lastModified === candidate.identity.lastModified)
  if (folderCandidates.length === 1) return { kind: 'same', fileId: folderCandidates[0]!.fileId, basis: 'folder-path' }

  const digestCandidates = validKnown.filter((candidate) => {
    const identity = candidate.identity
    return target.headerDigest !== null && target.sampleDigest !== null &&
      target.headerDigest === identity.headerDigest && target.sampleDigest.algorithm === identity.sampleDigest?.algorithm &&
      target.sampleDigest.offset === identity.sampleDigest.offset && target.sampleDigest.length === identity.sampleDigest.length &&
      target.sampleDigest.digest === identity.sampleDigest.digest && target.size === identity.size
  })
  if (digestCandidates.length === 1) return { kind: 'same', fileId: digestCandidates[0]!.fileId, basis: 'digest' }
  if (digestCandidates.length > 1) return { kind: 'ambiguous', candidates: digestCandidates.map(({ fileId }) => ({ fileId, basis: 'digest' })) }

  const weakCandidates = validKnown.filter((candidate) => candidate.identity.name === target.name && candidate.identity.size === target.size)
  return weakCandidates.length ? { kind: 'ambiguous', candidates: weakCandidates.map(({ fileId }) => ({ fileId, basis: 'name-size' })) } : { kind: 'new' }
}

export function isCsvFileIdentity(value: unknown): value is CsvFileIdentity {
  if (typeof value !== 'object' || value === null) return false
  const identity = value as Partial<CsvFileIdentity>
  if (typeof identity.name !== 'string' || !Number.isSafeInteger(identity.size) || identity.size! < 0 || !Number.isFinite(identity.lastModified)) return false
  if (identity.headerDigest !== null && !isSha256(identity.headerDigest)) return false
  if (identity.sampleDigest !== null) {
    const sample = identity.sampleDigest
    if (!isRecord(sample) || sample.algorithm !== 'SHA-256' || !Number.isSafeInteger(sample.offset) || sample.offset < 0 ||
      !Number.isSafeInteger(sample.length) || sample.length <= 0 || sample.offset + sample.length > identity.size! || !isSha256(sample.digest)) return false
  }
  if (identity.folder !== null && (!isRecord(identity.folder) || typeof identity.folder.rootId !== 'string' || typeof identity.folder.relativePath !== 'string')) return false
  return true
}

function isSha256(value: unknown): value is string { return typeof value === 'string' && /^[\da-f]{64}$/iu.test(value) }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }

async function sha256(input: ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  const data = new Uint8Array(bytes.byteLength)
  data.set(bytes)
  const digest = await crypto.subtle.digest('SHA-256', data.buffer)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
