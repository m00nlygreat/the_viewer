import { HighlightStyle, StreamLanguage, syntaxHighlighting, type StreamParser } from '@codemirror/language'
import { Tag, tags } from '@lezer/highlight'
import { CSV_COLUMN_COLOR_COUNT } from './csvColumnColors'
import { nextCsvToken, type CsvLexerState } from './csvTokenizer'

const csvColumnTags = Array.from({ length: CSV_COLUMN_COLOR_COUNT }, (_, index) => Tag.define(`csv-column-${index}`, tags.string))
const csvColumnTokenTable = Object.fromEntries(csvColumnTags.map((tag, index) => [`csv-column-${index}`, tag]))

export function createCsvStreamParser(delimiter: string): StreamParser<CsvLexerState> {
  const separator = [...delimiter][0] ?? ','

  return {
    startState: () => ({ inQuotes: false, column: 0 }),
    copyState: (state) => ({ ...state }),
    token(stream, state) {
      const token = nextCsvToken(stream.string, stream.pos, separator, state)
      if (!token) return null
      stream.pos = token.to
      if (token.kind === 'separator') return 'csv-separator'
      if (token.kind === 'quote') return 'csv-quote'
      if (token.kind === 'escape') return 'csv-escape'
      return `csv-column-${token.column}`
    },
    tokenTable: {
      ...csvColumnTokenTable,
      'csv-separator': tags.separator,
      'csv-quote': tags.special(tags.string),
      'csv-escape': tags.escape
    }
  }
}

const csvHighlightStyle = HighlightStyle.define([
  ...csvColumnTags.map((tag, index) => ({ tag, color: `var(--csv-column-${index})` })),
  { tag: tags.separator, color: 'var(--accent)', fontWeight: '600' },
  { tag: tags.special(tags.string), color: 'var(--accent)' },
  { tag: tags.escape, color: 'var(--warning)' }
])

export function csvEditorLanguage(delimiter: string) {
  return [StreamLanguage.define(createCsvStreamParser(delimiter)), syntaxHighlighting(csvHighlightStyle)]
}
