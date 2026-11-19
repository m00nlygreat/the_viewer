import { CSV_POLICY } from '../domain/csv-views/policy'
import { defaultParserSettings, nextRevisions, type CsvColumnDefinition, type CsvFileIdentity, type CsvFileProfile, type CsvSample, type CsvStoredProfile } from '../domain/csv-views/model'
import { recommendColumns } from '../domain/csv-views/inference'
import { matchIdentity, readIdentity, type CsvIdentityMatch } from '../platform/csv/fileIdentity'
import { csvViewStorage, createCsvFileRecord } from '../platform/csv/viewStorage'
import type { ViewerDocument } from '../domain/types'

export type CsvProfileResolution =
  | { status: 'linked'; stored: CsvStoredProfile; identity: CsvFileIdentity }
  | { status: 'choose'; candidates: Extract<CsvIdentityMatch, { kind: 'ambiguous' }>['candidates']; identity: CsvFileIdentity; sample: CsvSample }
  | { status: 'recover'; candidates: { fileId: string; headers: (string | null)[] }[]; identity: CsvFileIdentity; sample: CsvSample }

export async function resolveMemoryCsvProfile(document: ViewerDocument, fileIdChoice?: string | 'new'): Promise<CsvProfileResolution> {
  if (document.format !== 'csv') throw new Error('CSV 문서가 아닙니다.')
  const model = document.model
  const width = Math.max(model.headers.length, ...model.rows.map((row) => row.length), 0)
  const sample = sampleFromModel(model.hasHeader ? model.headers : Array.from({ length: width }, () => null), model.rows)
  const headerText = model.hasHeader ? JSON.stringify(model.headers) : null
  const bytes = new Blob([document.savedBytes.slice(0)], { type: document.mimeType })
  const file = Object.assign(bytes, { name: document.name, lastModified: document.sourceLastModified ?? document.openedAt }) as Blob & { name: string; lastModified: number }
  const folder = document.folderRef ? { rootId: document.folderRef.folderId, relativePath: document.folderRef.path } : null
  const identity = await readIdentity(file, headerText, folder)
  const known = await csvViewStorage.listIdentities()
  const match = await matchIdentity(identity, document.sourceFileHandle ?? null, known)
  if (match.kind === 'ambiguous' && fileIdChoice === undefined) return { status: 'choose', candidates: match.candidates, identity, sample }
  const selectedFileId = fileIdChoice === 'new' ? null : fileIdChoice ?? (match.kind === 'same' ? match.fileId : null)
  if (selectedFileId) {
    const stored = await csvViewStorage.loadProfile(selectedFileId)
    if (stored) {
      await csvViewStorage.touch(selectedFileId, identity, document.sourceFileHandle ?? null)
      return { status: 'linked', stored, identity }
    }
    throw new Error('선택한 CSV 설정을 찾을 수 없습니다.')
  }

  if (fileIdChoice === undefined && match.kind === 'new' && model.hasHeader) {
    const recoveryCandidates = (await csvViewStorage.listProfilesWithoutIdentity()).filter(({ profile }) =>
      profile.parser.hasHeader && profile.parser.delimiter === model.delimiter && profile.columns.length === sample.header.length &&
      profile.columns.every((column, index) => column.sourceIndex === index && column.sourceHeader === sample.header[index])
    ).map(({ fileId, profile }) => ({ fileId, headers: profile.columns.map((column) => column.sourceHeader) }))
    if (recoveryCandidates.length) return { status: 'recover', candidates: recoveryCandidates, identity, sample }
  }

  const columns: CsvColumnDefinition[] = recommendColumns(sample, null).map((item) => item.selected)
  const parser = defaultParserSettings()
  parser.encoding = document.encoding.toLowerCase() === 'utf-8' ? 'utf-8' : document.encoding
  parser.bom = document.bom ? 'present' : 'absent'
  parser.hasHeader = model.hasHeader
  parser.delimiter = model.delimiter.length === 1 ? model.delimiter : ','
  const fileId = crypto.randomUUID()
  const revisions = nextRevisions(null, { schemaChanged: true })
  const profile: CsvFileProfile = { schemaVersion: 1, fileId, parser, columns, ...revisions, viewOrder: [], updatedAt: new Date().toISOString() }
  const record = createCsvFileRecord(fileId, profile, identity, document.sourceFileHandle ?? null)
  const created = await csvViewStorage.createProfile(record, [])
  if (!created.ok && created.reason === 'conflict') return { status: 'linked', stored: created.current, identity }
  if (!created.ok) throw new Error(created.reason === 'storage' ? created.error.message : created.issues[0]?.detail ?? 'CSV 설정을 만들지 못했습니다.')
  const stored = await csvViewStorage.loadProfile(fileId)
  if (!stored) throw new Error('방금 만든 CSV 설정을 읽지 못했습니다.')
  return { status: 'linked', stored, identity }
}

function sampleFromModel(header: (string | null)[], records: string[][]): CsvSample {
  const sampled: string[][] = []
  let bytesRead = 0
  let stoppedBy: CsvSample['stoppedBy'] = 'eof'
  for (const row of records) {
    if (sampled.length >= CSV_POLICY.sampleRecords) { stoppedBy = 'records'; break }
    const bytes = row.reduce((sum, value) => sum + new TextEncoder().encode(value).byteLength, 0)
    if (bytesRead + bytes > CSV_POLICY.sampleBytes) { stoppedBy = 'bytes'; break }
    sampled.push(row)
    bytesRead += bytes
  }
  return { header, records: sampled, firstRecordNo: 1, reachedEof: sampled.length === records.length, bytesRead, stoppedBy }
}
