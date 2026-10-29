import type * as monaco from 'monaco-editor/editor/editor.api.js'
import { CSV_COLUMN_COLOR_COUNT } from './csvColumnColors'
import { nextCsvToken, type CsvLexerState } from './csvTokenizer'

class CsvMonacoState implements monaco.languages.IState, CsvLexerState {
  constructor(public inQuotes = false, public column = 0) {}

  clone(): CsvMonacoState {
    return new CsvMonacoState(this.inQuotes, this.column)
  }

  equals(other: monaco.languages.IState): boolean {
    return other instanceof CsvMonacoState && other.inQuotes === this.inQuotes && other.column === this.column
  }
}

export function createCsvMonacoTokensProvider(delimiter: string): monaco.languages.TokensProvider {
  const separator = [...delimiter][0] ?? ','

  return {
    getInitialState: () => new CsvMonacoState(),
    tokenize(line, state) {
      const nextState = state.clone() as CsvMonacoState
      const tokens: monaco.languages.IToken[] = []
      let from = 0

      while (from < line.length) {
        const token = nextCsvToken(line, from, separator, nextState)
        if (!token) break
        const scopes = token.kind === 'separator' ? 'separator.csv'
          : token.kind === 'quote' ? 'string.quote.csv'
            : token.kind === 'escape' ? 'string.escape.csv'
              : `column${token.column % CSV_COLUMN_COLOR_COUNT}.csv`
        tokens.push({ startIndex: token.from, scopes })
        from = token.to
      }

      if (!nextState.inQuotes) nextState.column = 0
      if (!tokens.length) tokens.push({ startIndex: 0, scopes: '' })
      return { tokens, endState: nextState }
    }
  }
}
