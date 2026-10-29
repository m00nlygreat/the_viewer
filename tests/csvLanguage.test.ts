import { describe, expect, it } from 'vitest'
import { StringStream } from '@codemirror/language'
import { createCsvStreamParser } from '../src/components/csvLanguage'
import { createCsvMonacoTokensProvider } from '../src/components/csvMonacoTokenizer'

function tokenize(text: string, delimiter: string): Array<{ text: string; style: string | null }> {
  const parser = createCsvStreamParser(delimiter)
  const state = parser.startState!(4)
  const tokens: Array<{ text: string; style: string | null }> = []

  for (const line of text.split(/\r\n|\r|\n/u)) {
    const stream = new StringStream(line, 4, 2)
    while (!stream.eol()) {
      stream.start = stream.pos
      const style = parser.token(stream, state)
      if (stream.pos === stream.start) throw new Error('CSV tokenizer did not advance')
      tokens.push({ text: line.slice(stream.start, stream.pos), style })
    }
  }
  return tokens
}

describe('CSV source syntax highlighting', () => {
  it('uses the detected delimiter and ignores the same character inside quoted fields', () => {
    const tokens = tokenize('name;note\nAda;"uses;semicolons"\n', ';')

    expect(tokens.filter((token) => token.style === 'csv-separator').map((token) => token.text)).toEqual([';', ';'])
    expect(tokens.some((token) => token.text === 'uses;semicolons' && token.style === 'csv-column-1')).toBe(true)
  })

  it('keeps quote state across lines and recognizes escaped double quotes', () => {
    const tokens = tokenize('id,note\n1,"line one\nline ""two"", line three"\n', ',')

    expect(tokens.filter((token) => token.style === 'csv-separator').map((token) => token.text)).toEqual([',', ','])
    expect(tokens.filter((token) => token.style === 'csv-escape').map((token) => token.text)).toEqual(['""', '""'])
    expect(tokens.some((token) => token.text === 'line one' && token.style === 'csv-column-1')).toBe(true)
    expect(tokens.some((token) => token.text === ', line three' && token.style === 'csv-column-1')).toBe(true)
  })

  it('assigns stable colors by column and restarts at the first color for each row', () => {
    const tokens = tokenize('first,second,third\n1,"two,\nlines",3\nx,y,z', ',')

    expect(tokens.some((token) => token.text === 'first' && token.style === 'csv-column-0')).toBe(true)
    expect(tokens.some((token) => token.text === 'second' && token.style === 'csv-column-1')).toBe(true)
    expect(tokens.some((token) => token.text === 'third' && token.style === 'csv-column-2')).toBe(true)
    expect(tokens.some((token) => token.text === 'two,' && token.style === 'csv-column-1')).toBe(true)
    expect(tokens.some((token) => token.text === 'lines' && token.style === 'csv-column-1')).toBe(true)
    expect(tokens.some((token) => token.text === '3' && token.style === 'csv-column-2')).toBe(true)
    expect(tokens.some((token) => token.text === 'x' && token.style === 'csv-column-0')).toBe(true)
  })

  it('uses the same column colors in Monaco across multiline quoted fields', () => {
    const provider = createCsvMonacoTokensProvider(';')
    let state = provider.getInitialState()
    const lines = ['first;second;third', '1;"two;', 'lines";3', 'x;y;z']
    const tokens = lines.flatMap((line) => {
      const result = provider.tokenize(line, state)
      state = result.endState
      return result.tokens.map((token, index) => ({
        text: line.slice(token.startIndex, result.tokens[index + 1]?.startIndex ?? line.length),
        scopes: token.scopes
      }))
    })

    expect(tokens.some((token) => token.text === 'second' && token.scopes === 'column1.csv')).toBe(true)
    expect(tokens.some((token) => token.text === 'two;' && token.scopes === 'column1.csv')).toBe(true)
    expect(tokens.some((token) => token.text === 'lines' && token.scopes === 'column1.csv')).toBe(true)
    expect(tokens.some((token) => token.text === '3' && token.scopes === 'column2.csv')).toBe(true)
    expect(tokens.some((token) => token.text === 'x' && token.scopes === 'column0.csv')).toBe(true)
  })
})
