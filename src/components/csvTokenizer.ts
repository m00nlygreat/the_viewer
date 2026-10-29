import { CSV_COLUMN_COLOR_COUNT } from './csvColumnColors'

export interface CsvLexerState {
  inQuotes: boolean
  column: number
}

export type CsvTokenKind = 'separator' | 'quote' | 'string' | 'escape'

export interface CsvToken {
  from: number
  to: number
  kind: CsvTokenKind
  column: number
}

export function nextCsvToken(line: string, from: number, delimiter: string, state: CsvLexerState): CsvToken | null {
  if (from >= line.length) return null

  const separator = [...delimiter][0] ?? ','
  const column = state.column
  let to = from
  let kind: CsvTokenKind

  if (state.inQuotes) {
    if (line.startsWith('""', from)) {
      to += 2
      kind = 'escape'
    } else if (line[from] === '"') {
      to += 1
      state.inQuotes = false
      kind = 'quote'
    } else {
      while (to < line.length && line[to] !== '"') to += 1
      kind = 'string'
    }
  } else if (line.startsWith(separator, from)) {
    to += separator.length
    state.column = (state.column + 1) % CSV_COLUMN_COLOR_COUNT
    kind = 'separator'
  } else if (line[from] === '"') {
    to += 1
    state.inQuotes = true
    kind = 'quote'
  } else {
    while (to < line.length && line[to] !== '"' && !line.startsWith(separator, to)) to += 1
    kind = 'string'
  }

  if (to === line.length && !state.inQuotes) state.column = 0
  return { from, to, kind, column }
}
