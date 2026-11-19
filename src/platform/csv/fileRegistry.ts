import type { FileBackedCsvDocument } from '../../domain/types'
import type { CsvFileIdentity, CsvStoredProfile, CsvSample } from '../../domain/csv-views/model'
import { defaultParserSettings } from '../../domain/csv-views/model'
import { recommendColumns } from '../../domain/csv-views/inference'
import { CSV_POLICY } from '../../domain/csv-views/policy'
import type { PickedFile } from '../fileTypes'
import { getFormat } from '../../domain/fileFormats'
import { matchIdentity } from './fileIdentity'
import { identifyCsvFile, readCsvSample, type CsvSourceFile } from './sampleFile'
import { csvViewStorage, createCsvFileRecord, defaultCsvSession } from './viewStorage'
import { saveCsvSession } from './viewStorage'
import { createUtf8OpfsSource, type CsvPreparedSource } from './utf8OpfsSource'

export interface CsvFileSourceEntry { file: CsvSourceFile; handle: FileSystemFileHandle | null; documentId: string; sample: CsvSample; stored: CsvStoredProfile; queryFile: Promise<CsvPreparedSource>; requiresTranscode: boolean; retainQueryFile(): () => void; requestRelease(): void }
export type FileBackedCsvOpenResult =
  | { status: 'choose'; candidates: { fileId: string; basis: 'digest' | 'name-size' | 'header' }[]; sample: CsvSample; identity: CsvFileIdentity; parser: ReturnType<typeof defaultParserSettings> }
  | { status: 'opened'; document: FileBackedCsvDocument; stored: CsvStoredProfile; sample: CsvSample }

const sources = new Map<string, CsvFileSourceEntry>()

export async function openFileBackedCsv(
  picked: PickedFile,
  options: { folderRef?: FileBackedCsvDocument['folderRef']; fileIdChoice?: string | 'new'; documentId?: string; mode?: 'view' | 'source'; persistSession?: boolean; signal?: AbortSignal } = {}
): Promise<FileBackedCsvOpenResult> {
  if (!('file' in picked) || !picked.file) throw new Error('파일 참조가 없어 부분 읽기를 시작할 수 없습니다.')
  const file = picked.file as CsvSourceFile
  if (getFormat(file.name, file.type) !== 'csv') throw new Error('CSV 형식으로 확인된 파일만 파일 기반 경로에서 열 수 있습니다.')
  if (file.size > CSV_POLICY.maxFileBackedCsvBytes) throw new Error(`파일 기반 CSV 임시 한도 ${Math.round(CSV_POLICY.maxFileBackedCsvBytes / 1024 / 1024)} MiB를 초과했습니다.`)
  const folder = options.folderRef ? { rootId: options.folderRef.folderId, relativePath: options.folderRef.path } : null
  const known = await csvViewStorage.listIdentities()
  const profilesWithoutIdentity = await csvViewStorage.listProfilesWithoutIdentity()
  let preferred = options.fileIdChoice && options.fileIdChoice !== 'new' ? await csvViewStorage.loadProfile(options.fileIdChoice) : null
  if (!preferred && options.fileIdChoice === undefined && picked.fileHandle) {
    for (const candidate of known) {
      try {
        if (typeof candidate.handle?.isSameEntry !== 'function') continue
        if (await picked.fileHandle.isSameEntry(candidate.handle)) { preferred = await csvViewStorage.loadProfile(candidate.fileId); break }
      } catch { /* Fall back to bounded file fingerprints when handle comparison is unavailable. */ }
    }
  }
  if (!preferred && options.fileIdChoice === undefined && picked.fileHandle) {
    for (const candidate of profilesWithoutIdentity) {
      try {
        if (typeof candidate.handle?.isSameEntry !== 'function') continue
        if (await picked.fileHandle.isSameEntry(candidate.handle)) { preferred = await csvViewStorage.loadProfile(candidate.fileId); break }
      } catch { /* A damaged record handle falls back to header confirmation. */ }
    }
  }
  const { sample, parser } = await readCsvSample(file, preferred?.record.profile.parser, options.signal)
  if (sample.bytesRead === 0 && file.size > 0) throw new Error('CSV 표본에서 텍스트 레코드를 읽지 못했습니다.')
  const identity = await identifyCsvFile(file, sample.header, folder)
  const match = await matchIdentity(identity, picked.fileHandle ?? null, known)
  if (match.kind === 'ambiguous' && options.fileIdChoice === undefined) {
    return { status: 'choose', candidates: match.candidates, sample, identity, parser }
  }
  if (match.kind === 'new' && options.fileIdChoice === undefined && parser.hasHeader) {
    const recovered = profilesWithoutIdentity.filter(({ profile }) => profile.parser.hasHeader && profile.parser.delimiter === parser.delimiter &&
      profile.columns.length === sample.header.length && profile.columns.every((column, index) => column.sourceIndex === index && column.sourceHeader === sample.header[index]))
    if (recovered.length) return { status: 'choose', candidates: recovered.map(({ fileId }) => ({ fileId, basis: 'header' })), sample, identity, parser }
  }
  const selectedId = options.fileIdChoice === 'new' ? null : options.fileIdChoice ?? (match.kind === 'same' ? match.fileId : preferred?.record.fileId ?? null)
  let stored = selectedId ? await csvViewStorage.loadProfile(selectedId) : null
  if (selectedId && !stored) throw new Error('선택한 CSV 설정을 찾을 수 없습니다.')
  if (stored) await csvViewStorage.touch(stored.record.fileId, identity, picked.fileHandle ?? null)
  if (!stored) {
    const columns = recommendColumns(sample, null).map((entry) => entry.selected)
    const profile = { schemaVersion: 1 as const, fileId: '', parser, columns, schemaRevision: 1, profileRevision: 1, viewOrder: [], updatedAt: new Date().toISOString() }
    const record = createCsvFileRecord(crypto.randomUUID(), profile, identity, picked.fileHandle ?? null)
    const created = await csvViewStorage.createProfile(record, [])
    if (!created.ok && created.reason === 'conflict') stored = created.current
    else if (!created.ok) throw new Error(created.reason === 'storage' ? created.error.message : created.issues[0]?.detail ?? 'CSV 설정을 만들지 못했습니다.')
    else stored = await csvViewStorage.loadProfile(record.fileId) ?? null
  }
  if (!stored) throw new Error('CSV 설정을 연결하지 못했습니다.')
  const abortConversion = new AbortController()
  if (options.signal?.aborted) abortConversion.abort()
  else options.signal?.addEventListener('abort', () => abortConversion.abort(), { once: true })
  const requiresTranscode = !['utf-8', 'utf8'].includes(stored.record.profile.parser.encoding.toLowerCase())
  const queryFile: Promise<CsvPreparedSource> = requiresTranscode
    ? createUtf8OpfsSource(file, stored.record.profile.parser.encoding, stored.record.profile.parser.bom, abortConversion.signal)
    : Promise.resolve({ file, handle: picked.fileHandle ?? null, release: async () => undefined })
  void queryFile.catch(() => undefined)
  let queryFileRetainers = 0
  let releaseRequested = false
  let released = false
  const releasePreparedFile = () => {
    if (!releaseRequested || queryFileRetainers > 0 || released) return
    released = true
    abortConversion.abort()
    void queryFile.then((prepared) => prepared.release()).catch(() => undefined)
  }
  const retainQueryFile = () => {
    queryFileRetainers += 1
    let retained = true
    return () => {
      if (!retained) return
      retained = false
      queryFileRetainers -= 1
      releasePreparedFile()
    }
  }
  const documentId = options.documentId ?? crypto.randomUUID()
  const sourceRevision = `${identity.size}:${identity.lastModified}:${identity.sampleDigest?.digest ?? 'empty'}`
  const document: FileBackedCsvDocument = {
    id: documentId, name: file.name, format: 'csv', mimeType: file.type || 'text/csv', size: file.size,
    storageKind: 'file-csv', fileId: stored.record.fileId, sourceRevision, mode: options.mode ?? 'view', openedAt: Date.now(), lastEditedAt: Date.now(),
    ...(options.folderRef ? { folderRef: options.folderRef } : {}), isDirty: false,
    capabilities: { canView: true, canSource: true, canDownloadOriginal: true, canShare: true, canEditData: false, canOverwriteOriginal: false, canUndo: false },
    sourceState: { status: 'ready' }
  }
  sources.set(documentId, { file, handle: picked.fileHandle ?? null, documentId, sample, stored, queryFile, requiresTranscode, retainQueryFile, requestRelease: () => { releaseRequested = true; releasePreparedFile() } })
  if (options.persistSession !== false) await saveCsvSession({ ...defaultCsvSession(document.id, document.fileId, sourceRevision, document.name, document.mimeType, document.size,
    options.folderRef ? { rootId: options.folderRef.folderId, relativePath: options.folderRef.path } : null), mode: document.mode })
  return { status: 'opened', document, stored, sample }
}

export function getCsvFileSource(documentId: string): CsvFileSourceEntry | null { return sources.get(documentId) ?? null }
export function releaseCsvFileSource(documentId: string): void {
  const entry = sources.get(documentId)
  if (!entry) return
  sources.delete(documentId)
  entry.requestRelease()
}
export function clearCsvFileSources(): void { for (const id of sources.keys()) releaseCsvFileSource(id) }
