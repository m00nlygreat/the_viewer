export type MarkdownTableAlignment = 'left' | 'center' | 'right' | null

export interface MarkdownTableModel {
  headers: string[]
  alignments: MarkdownTableAlignment[]
  rows: string[][]
  newline: '\n' | '\r\n'
}

function splitRow(line: string): string[] {
  const cells: string[] = []
  let cell = ''

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]!
    if (character === '\\' && index + 1 < line.length) {
      cell += character + line[index + 1]!
      index += 1
      continue
    }
    if (character === '|') {
      cells.push(cell.trim())
      cell = ''
      continue
    }
    cell += character
  }

  cells.push(cell.trim())
  if (cells[0] === '' && /^\s*\|/u.test(line)) cells.shift()
  const trimmedLine = line.trimEnd()
  if (trimmedLine.endsWith('|')) {
    let backslashes = 0
    for (let index = trimmedLine.length - 2; index >= 0 && trimmedLine[index] === '\\'; index -= 1) backslashes += 1
    if (backslashes % 2 === 0 && cells.at(-1) === '') cells.pop()
  }
  return cells
}

function alignmentOf(cell: string): MarkdownTableAlignment | undefined {
  if (!/^:?-{1,}:?$/u.test(cell)) return undefined
  const left = cell.startsWith(':')
  const right = cell.endsWith(':')
  if (left && right) return 'center'
  if (left) return 'left'
  if (right) return 'right'
  return null
}

export function parseMarkdownTable(source: string): MarkdownTableModel | null {
  const newline: '\n' | '\r\n' = source.includes('\r\n') ? '\r\n' : '\n'
  const lines = source.split(/\r\n|\r|\n/u)
  if (lines.length < 2) return null

  const headers = splitRow(lines[0] ?? '')
  const delimiter = splitRow(lines[1] ?? '')
  const alignments = delimiter.map(alignmentOf)
  if (headers.length === 0 || delimiter.length === 0 || alignments.some((alignment) => alignment === undefined)) return null

  const columnCount = Math.max(headers.length, delimiter.length, ...lines.slice(2).map((line) => splitRow(line).length), 1)
  const normalizedHeaders = Array.from({ length: columnCount }, (_, index) => headers[index] ?? '')
  const normalizedAlignments = Array.from({ length: columnCount }, (_, index) => alignments[index] ?? null)
  const rows = lines.slice(2).filter((line) => line.trim() !== '').map((line) => {
    const row = splitRow(line)
    return Array.from({ length: columnCount }, (_, index) => row[index] ?? '')
  })

  return { headers: normalizedHeaders, alignments: normalizedAlignments, rows, newline }
}

function escapePipes(value: string): string {
  let result = ''
  let backslashes = 0
  for (const character of value.trim().replace(/[\r\n]+/gu, ' ')) {
    if (character === '|') {
      if (backslashes % 2 === 0) result += '\\'
      result += character
      backslashes = 0
      continue
    }
    result += character
    backslashes = character === '\\' ? backslashes + 1 : 0
  }
  return result
}

function serializeAlignment(alignment: MarkdownTableAlignment): string {
  if (alignment === 'left') return ':---'
  if (alignment === 'center') return ':---:'
  if (alignment === 'right') return '---:'
  return '---'
}

export function serializeMarkdownTable(model: MarkdownTableModel): string {
  const columnCount = Math.max(model.headers.length, model.alignments.length, ...model.rows.map((row) => row.length), 1)
  const renderRow = (row: readonly string[]) => `| ${Array.from({ length: columnCount }, (_, index) => escapePipes(row[index] ?? '')).join(' | ')} |`
  const delimiter = Array.from({ length: columnCount }, (_, index) => serializeAlignment(model.alignments[index] ?? null))
  return [renderRow(model.headers), renderRow(delimiter), ...model.rows.map(renderRow)].join(model.newline)
}
