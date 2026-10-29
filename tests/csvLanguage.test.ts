import { describe, expect, it } from 'vitest'
import { StringStream } from '@codemirror/language'
import { createCsvStreamParser } from '../src/components/csvLanguage'

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
    expect(tokens.some((token) => token.text === 'uses;semicolons' && token.style === 'csv-string')).toBe(true)
  })

  it('keeps quote state across lines and recognizes escaped double quotes', () => {
    const tokens = tokenize('id,note\n1,"line one\nline ""two"", line three"\n', ',')

    expect(tokens.filter((token) => token.style === 'csv-separator').map((token) => token.text)).toEqual([',', ','])
    expect(tokens.filter((token) => token.style === 'csv-escape').map((token) => token.text)).toEqual(['""', '""'])
    expect(tokens.some((token) => token.text === 'line one' && token.style === 'csv-string')).toBe(true)
    expect(tokens.some((token) => token.text === ', line three' && token.style === 'csv-string')).toBe(true)
  })
})
