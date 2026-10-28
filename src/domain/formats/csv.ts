import Papa from 'papaparse'
import type { CsvModel } from '../types'

export function parseCsv(text: string, encoding: string, bom: boolean, newline: '\n' | '\r\n', hasHeaderOverride?: boolean): CsvModel {
  if (text.length === 0) return { headers: [], headerRow: [], rows: [], hasHeader: hasHeaderOverride ?? false, delimiter: ',', newline, bom, encoding, errors: [] }
  const parsed = Papa.parse<string[]>(text, { delimiter: '', dynamicTyping: false, skipEmptyLines: false, quoteChar: '"', escapeChar: '"' })
  const data = [...(parsed.data ?? [])]
  if (/(?:\r\n|\r|\n)$/.test(text) && data.at(-1)?.every((value) => value === '')) data.pop()
  const hasHeader = hasHeaderOverride ?? data.length > 0
  const headers = hasHeader ? [...(data[0] ?? [])] : []
  const headerRow = hasHeader ? [...headers] : []
  const rows = (hasHeader ? data.slice(1) : data).map((row) => [...row])
  const columnCount = Math.max(headers.length, ...rows.map((row) => row.length), 0)
  return {
    headers, headerRow, rows, hasHeader, delimiter: parsed.meta.delimiter || ',', newline, bom, encoding,
    errors: [
      ...parsed.errors.map((error) => `${error.code}: ${error.message}${error.row !== undefined ? ` (행 ${error.row + 1})` : ''}`),
      ...rows.flatMap((row, index) => row.length !== columnCount ? [`열 수가 다른 행: ${index + (data.length > 0 ? 2 : 1)}행`] : [])
    ]
  }
}

export function serializeCsv(model: CsvModel): string {
  const rows = model.hasHeader ? [model.headers, ...model.rows] : model.rows
  return Papa.unparse(rows, { delimiter: model.delimiter, newline: model.newline, escapeChar: '"', quoteChar: '"' })
}
