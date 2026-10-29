import { HighlightStyle, StreamLanguage, syntaxHighlighting, type StreamParser } from '@codemirror/language'
import { tags } from '@lezer/highlight'

interface CsvStreamState {
  inQuotes: boolean
}

export function createCsvStreamParser(delimiter: string): StreamParser<CsvStreamState> {
  const separator = [...delimiter][0] ?? ','

  return {
    startState: () => ({ inQuotes: false }),
    token(stream, state) {
      if (state.inQuotes) {
        if (stream.match('""')) return 'csv-escape'
        if (stream.match('"')) {
          state.inQuotes = false
          return 'csv-quote'
        }
        stream.eatWhile((character) => character !== '"')
        return 'csv-string'
      }

      if (stream.match(separator)) return 'csv-separator'
      if (stream.match('"')) {
        state.inQuotes = true
        return 'csv-quote'
      }
      stream.eatWhile((character) => character !== separator && character !== '"')
      return null
    },
    tokenTable: {
      'csv-separator': tags.separator,
      'csv-quote': tags.special(tags.string),
      'csv-string': tags.string,
      'csv-escape': tags.escape
    }
  }
}

const csvHighlightStyle = HighlightStyle.define([
  { tag: tags.separator, color: 'var(--accent)', fontWeight: '600' },
  { tag: tags.string, color: 'var(--text-secondary)' },
  { tag: tags.special(tags.string), color: 'var(--accent)' },
  { tag: tags.escape, color: 'var(--warning)' }
])

export function csvEditorLanguage(delimiter: string) {
  return [StreamLanguage.define(createCsvStreamParser(delimiter)), syntaxHighlighting(csvHighlightStyle)]
}
