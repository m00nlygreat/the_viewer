import { describe, expect, it } from 'vitest'
import { createDefaultColumn, parseCell } from '../src/domain/csv-views/typing'
import type { CsvColumnDefinition, CsvColumnType } from '../src/domain/csv-views/model'

function column(type: CsvColumnType, rawSamples: string[] = []): CsvColumnDefinition {
  const base = { id: 'c1', sourceIndex: 0, sourceHeader: 'value', label: 'value', typeSource: 'user' as const, nullMarkers: [], allowSurroundingSpace: false }
  return createDefaultColumn(type, base, { sourceIndex: 0, raws: rawSamples })
}

describe('parseCell', () => {
  it('preserves empty, missing and leading-zero integer states', () => {
    const integer = column('integer')
    expect(parseCell(integer, undefined)).toEqual({ state: 'missing' })
    expect(parseCell(integer, '')).toEqual({ state: 'empty' })
    expect(parseCell(integer, '00123')).toEqual({ state: 'value', raw: '00123', value: '123' })
    expect(parseCell(integer, '123456789012345678901234567890123456789')).toMatchObject({ state: 'invalid', code: 'range' })
  })

  it('checks decimal grouping and scale without rounding', () => {
    const decimal = column('decimal', ['12.345'])
    expect(parseCell(decimal, '12.345')).toMatchObject({ state: 'value', value: '12.345' })
    expect(parseCell(decimal, '12.3456')).toMatchObject({ state: 'invalid', code: 'scale' })
    decimal.parse.thousandsSeparator = ','
    expect(parseCell(decimal, '1,234.5')).toMatchObject({ state: 'value', value: '1234.5' })
    expect(parseCell(decimal, '12,34.5')).toMatchObject({ state: 'invalid', code: 'thousands' })
  })

  it('validates calendar dates and explicit datetime offsets', () => {
    const date = column('date')
    expect(parseCell(date, '2024-02-29')).toMatchObject({ state: 'value', value: '2024-02-29' })
    expect(parseCell(date, '2023-02-29')).toMatchObject({ state: 'invalid', code: 'date' })
    const datetime = column('datetime')
    expect(parseCell(datetime, '2026-11-16T09:30:00+09:00')).toMatchObject({ state: 'value', value: '2026-11-16T00:30:00.000Z' })
    expect(parseCell(datetime, '2026-11-16T09:30:00')).toMatchObject({ state: 'invalid', code: 'offset-required' })
    datetime.parse.allowTwelveHour = true
    expect(parseCell(datetime, '2026-11-16 09:30 PM+09:00')).toMatchObject({ state: 'value', value: '2026-11-16T12:30:00.000Z' })
  })
})
