import { container, scalar, slot, type StructuredModel } from '../structured/model'
import { envFingerprint, type EnvAssignmentRecord, type EnvModel, type EnvQuote, type EnvRecord } from './model'

export class EnvParseError extends Error {
  constructor(message: string, readonly from: number, readonly to: number, readonly line: number, readonly column: number) {
    super(message)
    this.name = 'EnvParseError'
  }
}

function fail(text: string, from: number, to: number, message: string): never {
  const prior = text.slice(0, from)
  const line = (prior.match(/\n/g)?.length ?? 0) + 1
  const lineStart = prior.lastIndexOf('\n') + 1
  throw new EnvParseError(`${message} (행 ${line}, 열 ${from - lineStart + 1})`, from, to, line, from - lineStart + 1)
}

function lineEnd(text: string, from: number): { contentEnd: number; end: number } {
  const newline = text.indexOf('\n', from)
  if (newline < 0) return { contentEnd: text.length, end: text.length }
  const contentEnd = newline > from && text.charCodeAt(newline - 1) === 13 ? newline - 1 : newline
  return { contentEnd, end: newline + 1 }
}

function decodeQuoted(raw: string, quote: EnvQuote): string {
  if (quote === 'double') return raw.replace(/\\n/g, '\n')
  return raw
}

function parseAssignment(text: string, from: number): { record: EnvAssignmentRecord; end: number; key: string; value: string } {
  const first = lineEnd(text, from)
  const firstLine = text.slice(from, first.contentEnd)
  const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(firstLine)
  if (!match) {
    const equals = firstLine.indexOf('=')
    const rangeStart = from + Math.max(0, firstLine.search(/\S|$/))
    if (equals < 0) fail(text, rangeStart, first.contentEnd, '변수 선언에 =가 없습니다.')
    fail(text, rangeStart, from + equals, '환경 변수 이름은 영문자·숫자·밑줄로 구성해야 합니다.')
  }
  const key = match[1]!
  const keyOffset = match[0].lastIndexOf(key)
  const keyFrom = from + keyOffset
  const keyRange = { from: keyFrom, to: keyFrom + key.length }
  const equals = match[0].lastIndexOf('=')
  let valueFrom = from + equals + 1
  while (valueFrom < first.contentEnd && /\s/.test(text[valueFrom]!)) valueFrom += 1
  let quote: EnvQuote = 'none'
  let valueTo = valueFrom
  let value: string
  let recordEnd = first.end
  const opening = text[valueFrom]
  if (opening === '"' || opening === "'" || opening === '`') {
    quote = opening === '"' ? 'double' : opening === "'" ? 'single' : 'backtick'
    let close = valueFrom + 1
    while (close < text.length) {
      if (text[close] === opening && !(opening === '"' && close > valueFrom && text[close - 1] === '\\')) break
      close += 1
    }
    if (close >= text.length) fail(text, valueFrom, text.length, '인용된 값의 닫는 기호가 없습니다.')
    valueTo = close + 1
    const trailing = lineEnd(text, valueTo)
    let cursor = valueTo
    while (cursor < trailing.contentEnd && /\s/.test(text[cursor]!)) cursor += 1
    if (cursor < trailing.contentEnd && text[cursor] !== '#') fail(text, cursor, trailing.contentEnd, '인용된 값 뒤에는 주석이나 줄 끝만 올 수 있습니다.')
    recordEnd = trailing.end
    value = decodeQuoted(text.slice(valueFrom + 1, close), quote)
  } else {
    let end = first.contentEnd
    for (let cursor = valueFrom; cursor < first.contentEnd; cursor += 1) {
      if (text[cursor] === '#') { end = cursor; break }
    }
    while (end > valueFrom && /\s/.test(text[end - 1]!)) end -= 1
    valueTo = end
    value = text.slice(valueFrom, valueTo)
  }
  const valueRange = { from: valueFrom, to: valueTo }
  const record: EnvAssignmentRecord = { type: 'assignment', slotId: '', key, value, range: { from, to: recordEnd }, keyRange, valueRange, quote }
  return { record, end: recordEnd, key, value }
}

export function parseEnv(text: string): EnvModel {
  const root = container('object')
  const records: EnvRecord[] = []
  let cursor = 0
  while (cursor < text.length) {
    const line = lineEnd(text, cursor)
    const content = text.slice(cursor, line.contentEnd)
    const trimmed = content.trim()
    if (!trimmed) {
      records.push({ type: 'blank', range: { from: cursor, to: line.end } })
      cursor = line.end
      continue
    }
    if (content.trimStart().startsWith('#')) {
      records.push({ type: 'comment', range: { from: cursor, to: line.end } })
      cursor = line.end
      continue
    }
    const parsed = parseAssignment(text, cursor)
    const item = slot(parsed.key, scalar('string', parsed.value))
    parsed.record.slotId = item.id
    root.items.push(item)
    records.push(parsed.record)
    cursor = parsed.end
  }
  const blocks: StructuredModel = { root, loose: [] }
  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  return { blocks, syntax: { sourceLength: text.length, sourceFingerprint: envFingerprint(text), newline, records }, detached: [] }
}
