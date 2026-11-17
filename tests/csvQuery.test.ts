import { describe, expect, it } from 'vitest'
import { compareForSort, decodeGroupKey, effectiveSort, encodeGroupKey, evaluateFilter, projectColumns } from '../src/domain/csv-views/query'
import { createDefaultColumn, parseCell } from '../src/domain/csv-views/typing'
import type { CsvColumnDefinition, CsvViewDefinition } from '../src/domain/csv-views/model'

const integer = createDefaultColumn('integer', { id: 'n', sourceIndex: 0, sourceHeader: 'n', label: 'n', typeSource: 'user', nullMarkers: [], allowSurroundingSpace: false }, null)
const text = createDefaultColumn('text', { id: 't', sourceIndex: 1, sourceHeader: 't', label: 't', typeSource: 'user', nullMarkers: [], allowSurroundingSpace: false }, null)

describe('CSV query semantics', () => {
  it('sorts exact numeric strings and keeps non-value states last in either direction', () => {
    expect(compareForSort(integer, 'asc', parseCell(integer, '2'), parseCell(integer, '10'))).toBe(-1)
    expect(compareForSort(integer, 'desc', parseCell(integer, '2'), parseCell(integer, '10'))).toBe(1)
    expect(compareForSort(integer, 'desc', { state: 'value', raw: '2', value: '2' }, { state: 'empty' })).toBe(-1)
    expect(compareForSort(integer, 'asc', { state: 'missing' }, { state: 'invalid', raw: 'x', code: 'syntax' })).toBe(-1)
  })

  it('uses SQL-like three-valued logic and ASCII-only case folding', () => {
    const columns = new Map<string, CsvColumnDefinition>([[integer.id, integer], [text.id, text]])
    const filter = { op: 'or', children: [
      { op: 'eq', columnId: 'n', value: '1' },
      { op: 'contains', columnId: 't', value: 'ABC', ignoreCase: 'ascii' }
    ] } as const
    expect(evaluateFilter(filter, columns, (id) => id === 'n' ? { state: 'empty' } : { state: 'value', raw: 'x abc y', value: 'x abc y' })).toBe(true)
    expect(evaluateFilter({ op: 'neq', columnId: 'n', value: '1' }, columns, () => ({ state: 'empty' }))).toBe(false)
  })

  it('adds list grouping ahead of the saved sort and includes hidden dependencies', () => {
    const view: CsvViewDefinition = { id: 'v', name: 'list', layout: { kind: 'list', titleColumnId: 't', subtitleColumnId: null, trailingColumnId: null, colorColumnId: null, groupColumnId: 'n' }, columnIds: ['t'], filter: null, sort: [{ columnId: 't', direction: 'desc' }], displayOverrides: {}, updatedAt: '2026-11-16T00:00:00Z' }
    expect(effectiveSort(view).map((item) => item.columnId)).toEqual(['n', 't'])
    expect(projectColumns(view)).toEqual(['t', 'n'])
  })

  it('projects explicit card roles without guessing from column labels', () => {
    const view: CsvViewDefinition = { id: 'v', name: 'gallery', layout: { kind: 'gallery', titleColumnId: 't', coverColumnId: null, subtitleColumnId: 'n', badgeColumnIds: ['t'], footerColumnIds: ['n'] }, columnIds: [], filter: null, sort: [], displayOverrides: {}, updatedAt: '2026-11-16T00:00:00Z' }
    expect(projectColumns(view)).toEqual(['t', 'n'])
  })

  it('round-trips group keys without merging empty and invalid cells', () => {
    const empty = encodeGroupKey({ state: 'empty' })
    const invalid = encodeGroupKey({ state: 'invalid', raw: 'bad', code: 'syntax' })
    expect(decodeGroupKey(empty)).toEqual({ state: 'empty' })
    expect(decodeGroupKey(invalid)).toEqual({ state: 'invalid' })
    expect(decodeGroupKey(encodeGroupKey(parseCell(integer, '7')))).toEqual({ state: 'value', value: '7' })
  })
})
