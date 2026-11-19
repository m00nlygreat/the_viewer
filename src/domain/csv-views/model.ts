import { CSV_POLICY } from './policy'

export type CsvColumnType = 'text' | 'integer' | 'decimal' | 'boolean' | 'date' | 'datetime' | 'select' | 'multiSelect'
export type CsvThousandsSeparator = ',' | '.' | ' ' | "'"

export interface CsvColumnBase {
  id: string
  sourceIndex: number
  sourceHeader: string | null
  label: string
  typeSource: 'inferred' | 'user'
  nullMarkers: string[]
  allowSurroundingSpace: boolean
}

export interface CsvSelectOption { id: string; raw: string; label: string; color: CsvOptionColor }
export interface CsvIntegerParse {
  allowPlusSign: boolean
  thousandsSeparator: CsvThousandsSeparator | null
  allowFullWidthDigits: boolean
  allowExponent: boolean
}
export interface CsvDecimalParse {
  precision: number
  scale: number
  decimalSeparator: '.' | ','
  thousandsSeparator: CsvThousandsSeparator | null
  currencySymbols: string[]
  percentInput: 'reject' | 'strip-sign' | 'divide-by-100'
  allowBareFraction: boolean
  allowExponent: boolean
}
export interface CsvBooleanParse { trueValues: string[]; falseValues: string[]; ignoreCase: 'none' | 'ascii' }
export type CsvDateFormat = 'YYYY-MM-DD' | 'YYYY/MM/DD' | 'YYYY.MM.DD' | 'YYYYMMDD' | 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'DD.MM.YYYY'
export interface CsvDateParse { formats: CsvDateFormat[] }
export interface CsvDateTimeParse {
  offset: { kind: 'require' } | { kind: 'assume'; timeZone: string }
  allowTwelveHour: boolean
  allowDateOnly: boolean
}
export interface CsvSelectParse { options: CsvSelectOption[]; matching: 'exact' | 'ascii-case-trim'; closed: boolean }
export interface CsvMultiSelectParse extends CsvSelectParse { separator: string; duplicates: 'keep' | 'collapse' }

export type CsvOptionColor = 'gray' | 'red' | 'orange' | 'yellow' | 'green' | 'teal' | 'blue' | 'purple' | 'pink'
export interface CsvTextDisplay { as: 'plain' | 'link' | 'image' }
export interface CsvNumberDisplay {
  grouping: boolean
  fractionDigits: 'scale' | number
  style: { kind: 'plain' } | { kind: 'currency'; symbol: string; position: 'prefix' | 'suffix' } | { kind: 'percent' }
  negative: 'minus' | 'parentheses'
}
export interface CsvBooleanDisplay { as: 'check' | 'text'; trueLabel: string; falseLabel: string }
export interface CsvDateDisplay { pattern: 'iso' | 'ko-long' | 'ko-short' }
export interface CsvDateTimeDisplay { zone: { kind: 'source' } | { kind: 'utc' } | { kind: 'fixed'; timeZone: string }; seconds: boolean }
export interface CsvSelectDisplay { as: 'chip' | 'text' }
export type CsvColumnDisplay = CsvColumnDefinition['display']

export type CsvColumnDefinition = CsvColumnBase & (
  | { type: 'text'; parse: Record<string, never>; display: CsvTextDisplay }
  | { type: 'integer'; parse: CsvIntegerParse; display: CsvNumberDisplay }
  | { type: 'decimal'; parse: CsvDecimalParse; display: CsvNumberDisplay }
  | { type: 'boolean'; parse: CsvBooleanParse; display: CsvBooleanDisplay }
  | { type: 'date'; parse: CsvDateParse; display: CsvDateDisplay }
  | { type: 'datetime'; parse: CsvDateTimeParse; display: CsvDateTimeDisplay }
  | { type: 'select'; parse: CsvSelectParse; display: CsvSelectDisplay }
  | { type: 'multiSelect'; parse: CsvMultiSelectParse; display: CsvSelectDisplay }
)

export type CsvLayout =
  | { kind: 'grid' }
  | { kind: 'list'; titleColumnId: string; subtitleColumnId: string | null; trailingColumnId: string | null; colorColumnId: string | null; groupColumnId: string | null; badgeColumnIds?: string[] }
  | { kind: 'gallery'; titleColumnId: string; coverColumnId: string | null; subtitleColumnId?: string | null; badgeColumnIds?: string[]; footerColumnIds?: string[] }
  | { kind: 'kanban'; groupColumnId: string; hiddenGroupKeys: string[]; titleColumnId?: string | null; subtitleColumnId?: string | null; trailingColumnId?: string | null; footerColumnIds?: string[] }
  | { kind: 'calendar'; dateColumnId: string; titleColumnId?: string | null; subtitleColumnId?: string | null; colorColumnId?: string | null }

export interface CsvViewDefinition {
  id: string
  name: string
  layout: CsvLayout
  columnIds: string[]
  filter: CsvFilter | null
  sort: CsvSort[]
  displayOverrides: Record<string, CsvDisplayOverride>
  updatedAt: string
}

export type CsvFilter =
  | { op: 'and' | 'or'; children: CsvFilter[] }
  | { op: 'not'; child: CsvFilter }
  | { op: 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte'; columnId: string; value: string }
  | { op: 'contains' | 'startsWith'; columnId: string; value: string; ignoreCase: 'none' | 'ascii' }
  | { op: 'in' | 'notIn' | 'hasAny' | 'hasAll'; columnId: string; optionIds: string[] }
  | { op: 'is' | 'isNot'; columnId: string; state: CsvCellState }

export interface CsvSort { columnId: string; direction: 'asc' | 'desc' }
export type CsvCellState = 'value' | 'empty' | 'missing' | 'null-marker' | 'invalid'
export type CsvInvalidCode = 'syntax' | 'whitespace' | 'range' | 'scale' | 'thousands' | 'date' | 'offset-required' | 'dst-gap' | 'dst-overlap' | 'closed-option' | 'empty-item'
export type CsvCell =
  | { state: 'value'; raw: string; value: string | boolean | string[] }
  | { state: 'empty' }
  | { state: 'missing' }
  | { state: 'null-marker'; raw: string }
  | { state: 'invalid'; raw: string; code: CsvInvalidCode }

export interface CsvDisplayOverride {
  label: string | null
  display: CsvColumnDisplay | null
  stateText: Partial<Record<'empty' | 'missing' | 'null-marker', string>>
}

export interface CsvParserSettings {
  encoding: string
  bom: 'auto' | 'present' | 'absent'
  hasHeader: boolean
  delimiter: string
  quote: '"' | "'" | null
  escape: 'double-quote' | 'backslash'
  newline: 'auto' | 'lf' | 'crlf' | 'cr'
}

export interface CsvFileProfile {
  schemaVersion: 1
  fileId: string
  parser: CsvParserSettings
  columns: CsvColumnDefinition[]
  schemaRevision: number
  profileRevision: number
  viewOrder: string[]
  updatedAt: string
}

export interface CsvFileIdentity {
  name: string
  size: number
  lastModified: number
  headerDigest: string | null
  sampleDigest: { algorithm: 'SHA-256'; offset: number; length: number; digest: string } | null
  folder: { rootId: string; relativePath: string } | null
}

export interface CsvFileRecord {
  fileId: string
  profile: CsvFileProfile
  identity: CsvFileIdentity
  handle: FileSystemFileHandle | null
  createdAt: string
  lastOpenedAt: string
}
export interface CsvViewRecord { fileId: string; viewId: string; view: CsvViewDefinition }
export interface CsvViewSelectionRecord { documentId: string; fileId: string; selection: CsvViewSelection; updatedAt: string }
export interface CsvSessionRecord {
  documentId: string; fileId: string; sourceRevision: string; name: string; mimeType: string; size: number
  mode: 'view' | 'source'; openedAt: string; lastEditedAt: string
  folderRef: { rootId: string; relativePath: string } | null
}

export type CsvViewSelection = { kind: 'builtin'; mode: 'view' | 'source' } | { kind: 'custom'; viewId: string }
export interface CsvViewBundle {
  kind: 'csv-view-bundle'; schemaVersion: 1; exportedAt: string; appVersion: string
  source: { fileName: string; headers: (string | null)[]; columnCount: number }
  profile: Omit<CsvFileProfile, 'viewOrder'>; viewOrder: string[]; views: CsvViewDefinition[]
}
export interface CsvViewBackup {
  kind: 'csv-view-backup'; schemaVersion: 1; exportedAt: string; appVersion: string
  profiles: Omit<CsvViewBundle, 'kind' | 'schemaVersion' | 'exportedAt' | 'appVersion'>[]
}

export type CsvValidationCode = 'type' | 'required' | 'unknown-version' | 'limit' | 'duplicate-id' | 'unknown-column' | 'layout-column-type' | 'operator-not-allowed' | 'constant-invalid' | 'option-conflict' | 'sort-not-allowed'
export interface CsvValidationIssue { path: string; code: CsvValidationCode; detail: string | null }
export interface CsvFilledDefault { path: string }
export type CsvValidationResult<T> = { ok: true; value: T; filledDefaults: CsvFilledDefault[] } | { ok: false; issues: CsvValidationIssue[] }

export interface CsvQueryDatasetToken { documentId: string; fileId: string; sourceRevision: string; schemaRevision: number }
export type CsvQueryScope = { kind: 'rows' } | { kind: 'group'; columnId: string; key: string } | { kind: 'calendar'; columnId: string; start: string; end: string }
export interface CsvQueryRequest {
  dataset: CsvQueryDatasetToken; requestId: string; queryId: string; columnIds: string[]; filter: CsvFilter | null; sort: CsvSort[]
  scope: CsvQueryScope; cursor: string | null; limit: number; maxResultBytes: number
}
export type CsvTotal = { status: 'unknown' } | { status: 'estimated'; value: string; basis: 'sample' } | { status: 'exact'; value: string; scope: 'query' | 'file' }
export interface CsvQueryRow { rowId: string; recordNo: string; cells: Record<string, CsvCell> }
export interface CsvQueryDiagnostic {
  code: 'record-too-wide' | 'record-too-short' | 'quote-error' | 'cell-too-large' | 'result-bytes-exceeded' | 'source-changed' | 'parse-incomplete'
  severity: 'info' | 'warning' | 'error'; recordNo: string | null; columnId: string | null; count: string | null
}
export interface CsvQueryPage {
  dataset: CsvQueryDatasetToken; requestId: string; queryId: string; engineGeneration: number; rows: CsvQueryRow[]
  nextCursor: string | null; hasMore: boolean; total: CsvTotal; diagnostics: CsvQueryDiagnostic[]
}
export interface CsvSample {
  header: (string | null)[]; records: string[][]; firstRecordNo: 1; reachedEof: boolean; bytesRead: number
  stoppedBy: 'records' | 'bytes' | 'eof'
}
export type CsvColumnSample = { sourceIndex: number; raws: (string | undefined)[] }
export type CsvInferenceWarning = 'leading-zero' | 'ambiguous-date' | 'zero-one' | 'long-identifier' | 'few-samples'
export interface CsvTypeCandidate {
  column: CsvColumnDefinition; matched: number; failed: number
  failures: { recordNo: number; raw: string; code: CsvInvalidCode }[]; autoSelectable: boolean; warnings: CsvInferenceWarning[]
}
export interface CsvColumnRecommendation {
  sourceIndex: number; counts: Record<CsvCellState, number>; candidates: CsvTypeCandidate[]; selected: CsvColumnDefinition
}
export interface CsvTypePreview {
  rows: { recordNo: number; raw: string | undefined; cell: CsvCell }[]; counts: Record<CsvCellState, number>
  leadingZeroLoss: number; scaleUsed: number | null
}

export interface CsvQueryDiagnosticError extends Error { code: 'cancelled' | 'stale-dataset' | 'cursor-expired' | 'budget-exceeded' | 'invalid-request' | 'source-unavailable' | 'engine-restarted' | 'internal' }
export class CsvQueryError extends Error {
  constructor(public readonly code: NonNullable<CsvQueryDiagnosticError['code']>, message: string) { super(message); this.name = 'CsvQueryError' }
}
export interface CsvStorageError { code: 'quota' | 'blocked' | 'corrupt' | 'unavailable' | 'unknown'; message: string }
export interface CsvStoredProfile { record: CsvFileRecord; views: CsvViewDefinition[] }
export interface CsvProfileChange { profile: CsvFileProfile; putViews: CsvViewDefinition[]; deleteViewIds: string[] }
export interface CsvImportPreview {
  bundle: CsvViewBundle
  filledDefaults: CsvFilledDefault[]
  columnMatches: { importedColumnId: string; sourceIndex: number | null; basis: 'header-and-position' | 'header' | 'position' | 'none' }[]
  typeConflicts: { columnId: string; existing: CsvColumnType; imported: CsvColumnType }[]
  idConflicts: string[]
}
export interface CsvImportDecisions {
  columnMap: Record<string, number | 'skip'>
  typeResolution: Record<string, 'keep-existing' | 'use-imported'>
  viewIds: string[]
}
export type CsvSaveResult =
  | { ok: true; profileRevision: number; schemaRevision: number }
  | { ok: false; reason: 'conflict'; current: CsvStoredProfile }
  | { ok: false; reason: 'invalid'; issues: CsvValidationIssue[] }
  | { ok: false; reason: 'storage'; error: CsvStorageError }

export function nextRevisions(
  previous: Pick<CsvFileProfile, 'schemaRevision' | 'profileRevision'> | null,
  change: { schemaChanged: boolean }
): Pick<CsvFileProfile, 'schemaRevision' | 'profileRevision'> {
  if (!previous) return { schemaRevision: 1, profileRevision: 1 }
  return {
    schemaRevision: previous.schemaRevision + (change.schemaChanged ? 1 : 0),
    profileRevision: previous.profileRevision + 1
  }
}

export function defaultParserSettings(): CsvParserSettings {
  return { encoding: 'utf-8', bom: 'auto', hasHeader: true, delimiter: ',', quote: '"', escape: 'double-quote', newline: 'auto' }
}

export function defaultView(id: string = crypto.randomUUID(), name = '새 보기', columnIds: string[] = []): CsvViewDefinition {
  return { id, name, layout: { kind: 'grid' }, columnIds, filter: null, sort: [], displayOverrides: {}, updatedAt: new Date().toISOString() }
}

export function isFileBackedCsvDocument(value: unknown): value is import('../types').FileBackedCsvDocument {
  return isRecord(value) && value.storageKind === 'file-csv' && value.format === 'csv'
}
export function isMemoryCsvDocument(value: unknown): value is import('../types').ViewerDocument & { format: 'csv' } {
  return isRecord(value) && value.format === 'csv' && value.storageKind !== 'file-csv'
}
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export const CSV_SCHEMA_VERSION = 1 as const
export const CSV_POLICY_LIMITS = CSV_POLICY
