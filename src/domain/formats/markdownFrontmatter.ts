export interface MarkdownFrontmatter {
  from: number
  to: number
  contentFrom: number
  contentTo: number
  content: string
  lineEnding: string
}

interface MarkdownLine {
  from: number
  to: number
  next: number
  text: string
}

function readMarkdownLine(source: string, from: number): MarkdownLine {
  const lineFeed = source.indexOf('\n', from)
  const carriageReturn = source.indexOf('\r', from)
  const candidates = [lineFeed, carriageReturn].filter((position) => position >= 0)
  const separatorAt = candidates.length ? Math.min(...candidates) : -1
  if (separatorAt < 0) {
    return { from, to: source.length, next: source.length, text: source.slice(from) }
  }
  const to = separatorAt
  const next = to + (source.startsWith('\r\n', to) ? 2 : 1)
  return { from, to, next, text: source.slice(from, to) }
}

export function detectMarkdownFrontmatter(source: string): MarkdownFrontmatter | null {
  let opening: MarkdownLine | null = null
  let openingFrom = 0
  while (openingFrom < source.length) {
    const line = readMarkdownLine(source, openingFrom)
    const text = line.text.replace(/^\uFEFF/u, '')
    if (text.trim() === '---') {
      opening = line
      break
    }
    if (text.trim() !== '' || line.next === line.to) return null
    openingFrom = line.next
  }
  if (!opening || opening.next === opening.to) return null

  let lineStart = opening.next
  while (lineStart < source.length) {
    const line = readMarkdownLine(source, lineStart)
    if (line.text.trim() === '---' || line.text.trim() === '...') {
      const followingLine = line.next < source.length ? readMarkdownLine(source, line.next) : null
      const to = followingLine?.text.trim() === '' ? followingLine.next : line.next
      return {
        from: 0,
        to,
        contentFrom: opening.next,
        contentTo: line.from,
        content: source.slice(opening.next, line.from),
        lineEnding: source.slice(opening.to, opening.next)
      }
    }
    if (line.next === line.to) break
    lineStart = line.next
  }
  return null
}
