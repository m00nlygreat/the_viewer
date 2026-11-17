import type { CsvCell, CsvCellState, CsvColumnDefinition, CsvFilter, CsvSort, CsvViewDefinition } from './model'
import { parseConstant } from './typing'

const stateOrder: Record<CsvCellState, number> = { value: 0, empty: 1, missing: 2, 'null-marker': 3, invalid: 4 }
type Truth = true | false | 'unknown'

export function compareForSort(column: CsvColumnDefinition, direction: 'asc' | 'desc', a: CsvCell, b: CsvCell): -1 | 0 | 1 {
  if (a.state !== 'value' || b.state !== 'value') {
    if (a.state === 'value') return -1
    if (b.state === 'value') return 1
    return sign(stateOrder[a.state] - stateOrder[b.state])
  }
  const compared = compareValues(column, a.value, b.value)
  return sign(direction === 'asc' ? compared : -compared)
}

export function effectiveSort(view: CsvViewDefinition): CsvSort[] {
  if (view.layout.kind !== 'list' || !view.layout.groupColumnId) return view.sort
  const group = view.layout.groupColumnId
  const existing = view.sort.find((item) => item.columnId === group)
  return existing ? [existing, ...view.sort.filter((item) => item !== existing)] : [{ columnId: group, direction: 'asc' }, ...view.sort]
}

export function evaluateFilter(filter: CsvFilter, columns: ReadonlyMap<string, CsvColumnDefinition>, cellOf: (columnId: string) => CsvCell): boolean {
  return evaluateTruth(filter, columns, cellOf) === true
}

export function projectColumns(view: CsvViewDefinition): string[] {
  const result = new Set(view.columnIds)
  for (const columnId of filterColumns(view.filter)) result.add(columnId)
  for (const item of effectiveSort(view)) result.add(item.columnId)
  const layout = view.layout
  if (layout.kind === 'list') for (const id of [layout.titleColumnId, layout.subtitleColumnId, layout.trailingColumnId, layout.colorColumnId, layout.groupColumnId, ...(layout.badgeColumnIds ?? [])]) if (id) result.add(id)
  if (layout.kind === 'gallery') for (const id of [layout.titleColumnId, layout.coverColumnId, layout.subtitleColumnId, ...(layout.badgeColumnIds ?? []), ...(layout.footerColumnIds ?? [])]) if (id) result.add(id)
  if (layout.kind === 'kanban') for (const id of [layout.groupColumnId, layout.titleColumnId, layout.subtitleColumnId, layout.trailingColumnId, ...(layout.footerColumnIds ?? [])]) if (id) result.add(id)
  if (layout.kind === 'calendar') for (const id of [layout.dateColumnId, layout.titleColumnId, layout.subtitleColumnId, layout.colorColumnId]) if (id) result.add(id)
  return [...result]
}

export function encodeGroupKey(cell: CsvCell): string {
  return JSON.stringify(cell.state === 'value' ? { state: 'value', value: cell.value } : { state: cell.state })
}

export function decodeGroupKey(key: string): { state: CsvCellState; value?: string | boolean | string[] } | null {
  try {
    const value: unknown = JSON.parse(key)
    if (typeof value !== 'object' || value === null || !('state' in value)) return null
    const state = value.state
    if (state === 'value' && 'value' in value && (typeof value.value === 'string' || typeof value.value === 'boolean' || Array.isArray(value.value) && value.value.every((item) => typeof item === 'string'))) return { state, value: value.value as string | boolean | string[] }
    if (state === 'empty' || state === 'missing' || state === 'null-marker' || state === 'invalid') return { state }
    return null
  } catch { return null }
}

export function filterColumns(filter: CsvFilter | null): string[] {
  if (!filter) return []
  if ('children' in filter) return filter.children.flatMap(filterColumns)
  if ('child' in filter) return filterColumns(filter.child)
  return 'columnId' in filter ? [filter.columnId] : []
}

export function allowedOperators(type: CsvColumnDefinition['type']): readonly string[] {
  switch (type) {
    case 'text': return ['eq', 'neq', 'contains', 'startsWith', 'lt', 'lte', 'gt', 'gte', 'is', 'isNot']
    case 'integer': case 'decimal': case 'date': case 'datetime': return ['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'is', 'isNot']
    case 'boolean': return ['eq', 'neq', 'is', 'isNot']
    case 'select': return ['in', 'notIn', 'is', 'isNot']
    case 'multiSelect': return ['hasAny', 'hasAll', 'is', 'isNot']
  }
}

function evaluateTruth(filter: CsvFilter, columns: ReadonlyMap<string, CsvColumnDefinition>, cellOf: (columnId: string) => CsvCell): Truth {
  if ('children' in filter && filter.op === 'and') {
    let unknown = false
    for (const child of filter.children) {
      const result = evaluateTruth(child, columns, cellOf)
      if (result === false) return false
      if (result === 'unknown') unknown = true
    }
    return unknown ? 'unknown' : true
  }
  if ('children' in filter && filter.op === 'or') {
    let unknown = false
    for (const child of filter.children) {
      const result = evaluateTruth(child, columns, cellOf)
      if (result === true) return true
      if (result === 'unknown') unknown = true
    }
    return unknown ? 'unknown' : false
  }
  if ('child' in filter) {
    const result = evaluateTruth(filter.child, columns, cellOf)
    return result === 'unknown' ? result : !result
  }
  if (!('columnId' in filter)) return 'unknown'
  const column = columns.get(filter.columnId)
  if (!column) return 'unknown'
  const cell = cellOf(filter.columnId)
  if ('state' in filter) {
    const matches = cell.state === filter.state
    return filter.op === 'is' ? matches : !matches
  }
  if (cell.state !== 'value') return 'unknown'
  if ('ignoreCase' in filter) {
    if (column.type !== 'text' || typeof cell.value !== 'string') return 'unknown'
    const target = filter.ignoreCase === 'ascii' ? asciiLower(filter.value) : filter.value
    const current = filter.ignoreCase === 'ascii' ? asciiLower(cell.value) : cell.value
    return filter.op === 'contains' ? current.includes(target) : current.startsWith(target)
  }
  if ('optionIds' in filter && (filter.op === 'in' || filter.op === 'notIn')) {
    if (column.type !== 'select' || typeof cell.value !== 'string') return 'unknown'
    const matches = filter.optionIds.includes(cell.value)
    return filter.op === 'in' ? matches : !matches
  }
  if ('optionIds' in filter && (filter.op === 'hasAny' || filter.op === 'hasAll')) {
    if (column.type !== 'multiSelect' || !Array.isArray(cell.value)) return 'unknown'
    const unique = new Set(cell.value)
    return filter.op === 'hasAny' ? filter.optionIds.some((id) => unique.has(id)) : filter.optionIds.every((id) => unique.has(id))
  }
  if (!('value' in filter)) return 'unknown'
  const constant = parseConstant(column, filter.value)
  if (constant.state !== 'value') return 'unknown'
  const compared = compareValues(column, cell.value, constant.value)
  switch (filter.op) {
    case 'eq': return compared === 0
    case 'neq': return compared !== 0
    case 'lt': return compared < 0
    case 'lte': return compared <= 0
    case 'gt': return compared > 0
    case 'gte': return compared >= 0
  }
}

function compareValues(column: CsvColumnDefinition, a: string | boolean | string[], b: string | boolean | string[]): number {
  if (column.type === 'integer' || column.type === 'decimal') return compareDecimal(String(a), String(b))
  if (column.type === 'boolean') return Number(a) - Number(b)
  if (column.type === 'select') {
    const options = column.parse.options
    const index = (value: string | boolean | string[]) => typeof value === 'string' ? options.findIndex((option) => option.id === value) : -1
    const left = index(a), right = index(b)
    if (left >= 0 || right >= 0) {
      if (left < 0) return 1
      if (right < 0) return -1
      return left - right
    }
    return compareCodepoints(String(a), String(b))
  }
  if (column.type === 'multiSelect') return 0
  return compareCodepoints(String(a), String(b))
}

function compareDecimal(a: string, b: string): number {
  const left = decimalParts(a), right = decimalParts(b)
  if (left.negative !== right.negative) return left.negative ? -1 : 1
  const scale = Math.max(left.scale, right.scale)
  const leftInt = left.coefficient * 10n ** BigInt(scale - left.scale)
  const rightInt = right.coefficient * 10n ** BigInt(scale - right.scale)
  const compared = leftInt < rightInt ? -1 : leftInt > rightInt ? 1 : 0
  return left.negative ? -compared : compared
}

function decimalParts(value: string): { negative: boolean; coefficient: bigint; scale: number } {
  const negative = value.startsWith('-')
  const unsigned = value.replace(/^-/, '')
  const [integer = '0', fraction = ''] = unsigned.split('.')
  return { negative, coefficient: BigInt(`${integer}${fraction}` || '0'), scale: fraction.length }
}

function compareCodepoints(a: string, b: string): number {
  const left = Array.from(a, (char) => char.codePointAt(0)!)
  const right = Array.from(b, (char) => char.codePointAt(0)!)
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) if (left[index] !== right[index]) return left[index]! - right[index]!
  return left.length - right.length
}

function asciiLower(value: string): string { return value.replace(/[A-Z]/gu, (character) => String.fromCharCode(character.charCodeAt(0) + 32)) }
function sign(value: number): -1 | 0 | 1 { return value < 0 ? -1 : value > 0 ? 1 : 0 }
