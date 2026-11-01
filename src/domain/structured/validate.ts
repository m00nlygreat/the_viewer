import type { StructuredModel } from './model'

type WorkItem = { kind: 'node' | 'slot' | 'loose'; value: unknown; parent?: 'object' | 'array' }

/** Validate serialized block data before accepting it from the extension relay. */
export function isStructuredModel(value: unknown): value is StructuredModel {
  if (!isRecord(value) || !Array.isArray(value.loose) || (value.unsupported !== undefined && typeof value.unsupported !== 'string')) return false
  const work: WorkItem[] = value.loose.map((item) => ({ kind: 'loose', value: item }))
  if (value.root !== null) work.push({ kind: 'node', value: value.root })
  const seen = new WeakSet<object>()
  const ids = new Set<string>()
  while (work.length) {
    const item = work.pop()!
    if (!isRecord(item.value) || seen.has(item.value)) return false
    const entry = item.value
    seen.add(entry)
    if (typeof entry.id !== 'string' || !entry.id || ids.has(entry.id)) return false
    ids.add(entry.id)
    if (item.kind === 'loose') {
      if (typeof entry.x !== 'number' || !Number.isFinite(entry.x) || typeof entry.y !== 'number' || !Number.isFinite(entry.y)) return false
      if ((entry.node === undefined) === (entry.slot === undefined)) return false
      work.push(entry.node !== undefined ? { kind: 'node', value: entry.node } : { kind: 'slot', value: entry.slot })
    } else if (item.kind === 'slot') {
      if (!(entry.key === null || typeof entry.key === 'string') || (item.parent === 'array' && entry.key !== null)) return false
      if (entry.nameMissing !== undefined && typeof entry.nameMissing !== 'boolean') return false
      if (entry.node !== null) work.push({ kind: 'node', value: entry.node })
    } else if (entry.kind === 'object' || entry.kind === 'array') {
      if (!Array.isArray(entry.items)) return false
      for (const child of entry.items) work.push({ kind: 'slot', value: child, parent: entry.kind })
    } else if (entry.kind === 'scalar') {
      if (typeof entry.raw !== 'string' || !['string', 'number', 'boolean', 'null', 'native-date-time'].includes(String(entry.dataType))) return false
      if (entry.dataType === 'boolean' && entry.raw !== 'true' && entry.raw !== 'false') return false
      if (entry.dataType === 'null' && entry.raw !== '') return false
      if (entry.sourceFormat !== undefined && !['json', 'yaml', 'toml'].includes(String(entry.sourceFormat))) return false
      if (entry.displayHint !== undefined && !['date', 'color'].includes(String(entry.displayHint))) return false
      if (entry.dateKind !== undefined && !['offset-date-time', 'local-date-time', 'local-date', 'local-time'].includes(String(entry.dateKind))) return false
      if (entry.sourceRange !== undefined) {
        const range = entry.sourceRange
        if (!isRecord(range) || !Number.isSafeInteger(range.from) || !Number.isSafeInteger(range.to) || typeof range.from !== 'number' || typeof range.to !== 'number' || range.from < 0 || range.to < range.from || !['json', 'yaml', 'toml'].includes(String(range.format)) || !Number.isInteger(range.fingerprint) || typeof range.fingerprint !== 'number' || range.fingerprint < 0 || range.fingerprint > 0xffffffff) return false
      }
    } else return false
  }
  return true
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
