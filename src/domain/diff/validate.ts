import { diffFingerprint, type DiffModel, type DiffRange } from './model'

export function hasDiffModelEnvelope(value: unknown): value is DiffModel {
  if (!value || typeof value !== 'object') return false
  const model = value as Partial<DiffModel>
  return Number.isInteger(model.sourceLength) && Number.isInteger(model.sourceFingerprint) && Array.isArray(model.segments) && Array.isArray(model.diagnostics)
}

function validRange(range: DiffRange, length: number): boolean {
  return Number.isInteger(range.from) && Number.isInteger(range.to) && range.from >= 0 && range.from <= range.to && range.to <= length
}

export function isDiffModel(value: unknown): value is DiffModel {
  if (!hasDiffModelEnvelope(value)) return false
  const model = value
  if (model.sourceLength < 0 || model.sourceFingerprint < 0 || model.sourceFingerprint > 0xffffffff || !model.diagnostics.every((item) => typeof item === 'string')) return false
  let cursor = 0
  for (const segment of model.segments) {
    if (!segment || !validRange(segment, model.sourceLength) || segment.from !== cursor) return false
    cursor = segment.to
    if (segment.kind === 'text') continue
    if (segment.kind !== 'file' || typeof segment.parsed !== 'boolean' || typeof segment.label !== 'string' || !Array.isArray(segment.header) || !Array.isArray(segment.hunks)) return false
    let prior = segment.from
    for (const line of segment.header) {
      if (!validRange(line, model.sourceLength) || line.from < segment.from || line.to > segment.to || line.from < prior || (line.kind !== 'header' && line.kind !== 'metadata')) return false
      prior = line.to
    }
    for (const hunk of segment.hunks) {
      if (!validRange(hunk, model.sourceLength) || !validRange(hunk.header, model.sourceLength) || hunk.from < segment.from || hunk.to > segment.to || hunk.header.from !== hunk.from || hunk.header.to > hunk.to || !Number.isInteger(hunk.oldStart) || !Number.isInteger(hunk.newStart) || !Number.isInteger(hunk.oldCount) || !Number.isInteger(hunk.newCount) || hunk.oldCount < 0 || hunk.newCount < 0 || !Array.isArray(hunk.rows)) return false
      let oldCount = 0, newCount = 0, rowCursor = hunk.header.to
      for (const row of hunk.rows) {
        if (!validRange(row, model.sourceLength) || row.from < rowCursor || row.from < hunk.header.to || row.to > hunk.to || !Number.isInteger(row.contentFrom) || !Number.isInteger(row.contentTo) || row.contentFrom < row.from || row.contentTo < row.contentFrom || row.contentTo > row.to) return false
        rowCursor = row.to
        if (row.kind === 'context') { oldCount += 1; newCount += 1 }
        else if (row.kind === 'deletion') oldCount += 1
        else if (row.kind === 'addition') newCount += 1
        else if (row.kind !== 'no-newline') return false
        if (row.oldLine !== null && (!Number.isInteger(row.oldLine) || row.oldLine < 0)) return false
        if (row.newLine !== null && (!Number.isInteger(row.newLine) || row.newLine < 0)) return false
      }
      if (oldCount > hunk.oldCount || newCount > hunk.newCount) return false
    }
  }
  return cursor === model.sourceLength
}

export function matchesDiffSource(model: DiffModel, source: string): boolean {
  return model.sourceLength === source.length && model.sourceFingerprint === diffFingerprint(source)
}
