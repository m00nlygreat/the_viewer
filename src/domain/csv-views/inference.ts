import { CSV_POLICY } from './policy'
import type {
  CsvCellState, CsvColumnBase, CsvColumnDefinition, CsvColumnRecommendation, CsvColumnSample, CsvColumnType,
  CsvInferenceWarning, CsvSample, CsvTypeCandidate, CsvTypePreview
} from './model'
import { createDefaultColumn, parseCell } from './typing'

const colors = ['gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'] as const

export function recommendColumns(sample: CsvSample, existing: CsvColumnDefinition[] | null): CsvColumnRecommendation[] {
  const width = Math.max(sample.header.length, ...sample.records.map((record) => record.length), existing?.length ?? 0)
  const recommendations: CsvColumnRecommendation[] = []
  for (let sourceIndex = 0; sourceIndex < width; sourceIndex += 1) {
    const raws = sample.records.map((record) => record[sourceIndex])
    const columnSample: CsvColumnSample = { sourceIndex, raws }
    const old = existing?.find((column) => column.sourceIndex === sourceIndex)
    if (old?.typeSource === 'user') {
      const candidate = scoreCandidate(old, columnSample, sample.reachedEof)
      recommendations.push({ sourceIndex, counts: countStates(columnSample), candidates: [candidate], selected: old })
      continue
    }
    const header = sample.header[sourceIndex] ?? null
    const base = { id: `csv-col-${sourceIndex + 1}`, sourceIndex, sourceHeader: header, label: header?.trim() || `열 ${sourceIndex + 1}`, typeSource: 'inferred' as const, nullMarkers: [], allowSurroundingSpace: false }
    const candidates = buildCandidates(base, columnSample, sample.reachedEof)
    const selected = candidates.find((candidate) => candidate.autoSelectable && candidate.column.type !== 'text')?.column
      ?? createDefaultColumn('text', base, columnSample)
    recommendations.push({ sourceIndex, counts: countStates(columnSample), candidates, selected })
  }
  return recommendations
}

export function previewColumn(sample: CsvSample, draft: CsvColumnDefinition): CsvTypePreview {
  const rows = sample.records.map((record, index) => {
    const raw = record[draft.sourceIndex]
    return { recordNo: sample.firstRecordNo + index, raw, cell: parseCell(draft, raw) }
  })
  const counts = emptyCounts()
  let leadingZeroLoss = 0
  for (const row of rows) {
    counts[row.cell.state] += 1
    if (draft.type === 'integer' && row.raw !== undefined && row.cell.state === 'value' && typeof row.cell.value === 'string' && row.raw.replace(/^-?0+(?=\d)/u, row.raw.startsWith('-') ? '-' : '') !== row.cell.value) leadingZeroLoss += 1
  }
  const failures = rows.filter((row) => row.cell.state === 'invalid')
  const shown = [...failures, ...rows.filter((row) => row.cell.state !== 'invalid')].slice(0, 50)
  return { rows: shown, counts, leadingZeroLoss, scaleUsed: draft.type === 'decimal' ? draft.parse.scale : null }
}

function buildCandidates(base: CsvColumnBase, sample: CsvColumnSample, reachedEof: boolean): CsvTypeCandidate[] {
  const rawValues = sample.raws.filter((raw): raw is string => raw !== undefined && raw !== '')
  const values = [...new Set(rawValues)]
  const types: CsvColumnType[] = ['integer', 'decimal', 'boolean', 'date', 'datetime']
  const result: CsvTypeCandidate[] = []
  for (const type of types) {
    const column = createDefaultColumn(type, base, sample)
    const candidate = scoreCandidate(column, sample, reachedEof)
    if (candidate.matched > 0 || rawValues.length === 0) result.push(candidate)
  }
  if (values.length > 0 && values.length <= 20) {
    const column = createDefaultColumn('select', base, sample)
    if (column.type === 'select') column.parse.options = values.map((raw, index) => ({ id: `csv-option-${base.sourceIndex + 1}-${index + 1}`, raw, label: raw, color: colors[index % colors.length]! }))
    result.push(scoreCandidate(column, sample, reachedEof))
  }
  result.push(scoreCandidate(createDefaultColumn('text', base, sample), sample, reachedEof))
  return result.sort((a, b) => b.autoSelectable === a.autoSelectable ? b.matched - a.matched || typeRank(a.column.type) - typeRank(b.column.type) : Number(b.autoSelectable) - Number(a.autoSelectable))
}

function scoreCandidate(column: CsvColumnDefinition, sample: CsvColumnSample, reachedEof: boolean): CsvTypeCandidate {
  let matched = 0
  let failed = 0
  const failures: CsvTypeCandidate['failures'] = []
  const values = sample.raws.filter((raw): raw is string => raw !== undefined && raw !== '')
  for (let index = 0; index < sample.raws.length; index += 1) {
    const raw = sample.raws[index]
    if (raw === undefined || raw === '') continue
    const cell = parseCell(column, raw)
    if (cell.state === 'value') matched += 1
    else {
      failed += 1
      if (cell.state === 'invalid' && failures.length < 5) failures.push({ recordNo: index + 1, raw, code: cell.code })
    }
  }
  const warnings: CsvInferenceWarning[] = []
  const sufficient = matched >= CSV_POLICY.sampleMinimumValid || reachedEof
  if (!sufficient) warnings.push('few-samples')
  if (column.type === 'integer' || column.type === 'decimal') {
    if (values.some((value) => /^-?0\d+$/u.test(value))) warnings.push('leading-zero')
    if (values.every((value) => /^(?:0|1)$/u.test(value)) && values.length > 0) warnings.push('zero-one')
    if (values.some((value) => value.replace(/\D/gu, '').length >= 16)) warnings.push('long-identifier')
  }
  if (column.type === 'date' && values.some((value) => /^\d{1,2}[/.]\d{1,2}[/.]\d{4}$/u.test(value))) warnings.push('ambiguous-date')
  const blocked = warnings.some((warning) => warning !== 'few-samples')
  return { column, matched, failed, failures, autoSelectable: sufficient && matched === values.length && !blocked && column.type !== 'text', warnings: [...new Set(warnings)] }
}

function countStates(sample: CsvColumnSample): Record<CsvCellState, number> {
  const counts = emptyCounts()
  const textColumn = createDefaultColumn('text', { id: `sample-${sample.sourceIndex}`, sourceIndex: sample.sourceIndex, sourceHeader: null, label: '', typeSource: 'inferred', nullMarkers: [], allowSurroundingSpace: false }, sample)
  for (const raw of sample.raws) counts[parseCell(textColumn, raw).state] += 1
  return counts
}

function emptyCounts(): Record<CsvCellState, number> { return { value: 0, empty: 0, missing: 0, 'null-marker': 0, invalid: 0 } }
function typeRank(type: CsvColumnType): number { return ['integer', 'decimal', 'boolean', 'date', 'datetime', 'select', 'multiSelect', 'text'].indexOf(type) }
