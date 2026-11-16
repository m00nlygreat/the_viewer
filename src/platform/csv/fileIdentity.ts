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
  target: CsvFileIdentity,
  targetHandle: FileSystemFileHandle | null,
  known: { fileId: string; identity: CsvFileIdentity; handle: FileSystemFileHandle | null }[]
): Promise<CsvIdentityMatch> {
  if (targetHandle) {
    for (const candidate of known) {
      if (!candidate.handle?.isSameEntry) continue
      try { if (await targetHandle.isSameEntry(candidate.handle)) return { kind: 'same', fileId: candidate.fileId, basis: 'handle' } }
      catch { /* Permission and browser-specific handle errors fall back to fingerprints. */ }
    }
  }
  const folderCandidates = known.filter((candidate) => isCsvFileIdentity(candidate.identity) && target.folder && candidate.identity.folder &&
    target.folder.rootId === candidate.identity.folder.rootId && target.folder.relativePath === candidate.identity.folder.relativePath &&
    target.size === candidate.identity.size && target.lastModified === candidate.identity.lastModified)
  if (folderCandidates.length === 1) return { kind: 'same', fileId: folderCandidates[0]!.fileId, basis: 'folder-path' }

  const digestCandidates = known.filter((candidate) => isCsvFileIdentity(candidate.identity) && target.headerDigest !== null && target.sampleDigest !== null &&
    target.headerDigest === candidate.identity.headerDigest && target.sampleDigest.algorithm === candidate.identity.sampleDigest?.algorithm &&
    target.sampleDigest.offset === candidate.identity.sampleDigest.offset && target.sampleDigest.length === candidate.identity.sampleDigest.length &&
    target.sampleDigest.digest === candidate.identity.sampleDigest.digest && target.size === candidate.identity.size)
  if (digestCandidates.length === 1) return { kind: 'same', fileId: digestCandidates[0]!.fileId, basis: 'digest' }
  if (digestCandidates.length > 1) return { kind: 'ambiguous', candidates: digestCandidates.map(({ fileId }) => ({ fileId, basis: 'digest' })) }

  const weakCandidates = known.filter((candidate) => isCsvFileIdentity(candidate.identity) && candidate.identity.name === target.name && candidate.identity.size === target.size)
  return weakCandidates.length ? { kind: 'ambiguous', candidates: weakCandidates.map(({ fileId }) => ({ fileId, basis: 'name-size' })) } : { kind: 'new' }
}

function isCsvFileIdentity(value: unknown): value is CsvFileIdentity {
  if (typeof value !== 'object' || value === null) return false
  const identity = value as Partial<CsvFileIdentity>
  return typeof identity.name === 'string' && Number.isFinite(identity.size) && Number.isFinite(identity.lastModified) &&
    (identity.headerDigest === null || typeof identity.headerDigest === 'string') &&
    (identity.sampleDigest === null || typeof identity.sampleDigest === 'object') &&
    (identity.folder === null || typeof identity.folder === 'object')
}

async function sha256(input: ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  const data = new Uint8Array(bytes.byteLength)
  data.set(bytes)
  const digest = await crypto.subtle.digest('SHA-256', data.buffer)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
