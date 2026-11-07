import { diffFingerprint, type DiffFileSegment, type DiffHunk, type DiffLine, type DiffModel, type DiffRange, type DiffSegment } from './model'

interface SourceLine extends DiffRange { contentEnd: number; text: string }

function linesOf(text: string): SourceLine[] {
  const result: SourceLine[] = []
  let from = 0
  while (from < text.length) {
    const newline = text.indexOf('\n', from)
    const to = newline < 0 ? text.length : newline + 1
    const contentEnd = newline < 0 ? to : newline > from && text.charCodeAt(newline - 1) === 13 ? newline - 1 : newline
    result.push({ from, to, contentEnd, text: text.slice(from, contentEnd) })
    from = to
  }
  return result
}

function isGitStart(line: SourceLine | undefined): boolean { return line?.text.startsWith('diff --') ?? false }
function isPlainStart(lines: SourceLine[], index: number): boolean {
  return Boolean(lines[index]?.text.startsWith('--- ') && lines[index + 1]?.text.startsWith('+++ '))
}
function isFileStart(lines: SourceLine[], index: number): boolean { return isGitStart(lines[index]) || isPlainStart(lines, index) }

function parseHunk(lines: SourceLine[], start: number, limit: number, diagnostics: string[]): { hunk: DiffHunk | null; next: number; complete: boolean } {
  const header = lines[start]!
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)$/.exec(header.text)
  if (!match) return { hunk: null, next: start + 1, complete: false }
  const oldStart = Number(match[1]), oldCount = match[2] === undefined ? 1 : Number(match[2])
  const newStart = Number(match[3]), newCount = match[4] === undefined ? 1 : Number(match[4])
  let oldLine = oldStart, newLine = newStart, oldSeen = 0, newSeen = 0, index = start + 1
  const rows: DiffLine[] = []
  while (index < limit && (oldSeen < oldCount || newSeen < newCount)) {
    const line = lines[index]!
    if (line.text === '\\ No newline at end of file') {
      rows.push({ kind: 'no-newline', from: line.from, to: line.to, contentFrom: line.from, contentTo: line.contentEnd, oldLine: null, newLine: null })
      index += 1
      continue
    }
    const marker = line.text[0]
    if (marker === ' ' && oldSeen < oldCount && newSeen < newCount) {
      rows.push({ kind: 'context', from: line.from, to: line.to, contentFrom: line.from + 1, contentTo: line.contentEnd, oldLine: oldLine++, newLine: newLine++ })
      oldSeen += 1; newSeen += 1
    } else if (marker === '-' && oldSeen < oldCount) {
      rows.push({ kind: 'deletion', from: line.from, to: line.to, contentFrom: line.from + 1, contentTo: line.contentEnd, oldLine: oldLine++, newLine: null })
      oldSeen += 1
    } else if (marker === '+' && newSeen < newCount) {
      rows.push({ kind: 'addition', from: line.from, to: line.to, contentFrom: line.from + 1, contentTo: line.contentEnd, oldLine: null, newLine: newLine++ })
      newSeen += 1
    } else break
    index += 1
  }
  const complete = oldSeen === oldCount && newSeen === newCount
  if (!complete) diagnostics.push(`불완전한 hunk 헤더입니다 (행 ${start + 1}).`)
  while (index < limit && lines[index]!.text === '\\ No newline at end of file') {
    const line = lines[index++]!
    rows.push({ kind: 'no-newline', from: line.from, to: line.to, contentFrom: line.from, contentTo: line.contentEnd, oldLine: null, newLine: null })
  }
  const end = rows.at(-1)?.to ?? header.to
  return { hunk: { from: header.from, to: end, header: { from: header.from, to: header.to }, oldStart, oldCount, newStart, newCount, rows }, next: index, complete }
}

function parseFile(lines: SourceLine[], start: number, end: number, diagnostics: string[]): DiffFileSegment {
  const group = lines.slice(start, end)
  const from = group[0]?.from ?? 0, to = group.at(-1)?.to ?? from
  const hunkIndex = group.findIndex((line) => line.text.startsWith('@@ '))
  const unsupported = group.some((line) => line.text.startsWith('@@@') || /^\*\*\* /.test(line.text))
  const binary = group.some((line) => /^(?:GIT binary patch|Binary files .* differ)$/.test(line.text))
  const headerEnd = hunkIndex < 0 ? group.length : hunkIndex
  const header = group.slice(0, headerEnd).map((line) => ({ from: line.from, to: line.to, kind: /^diff --git |^(?:index|new file mode|deleted file mode|similarity index|rename from|rename to|copy from|copy to|old mode|new mode|--- |\+\+\+ )/.test(line.text) ? 'header' as const : 'metadata' as const }))
  if (unsupported || binary) {
    diagnostics.push(unsupported ? '지원하지 않는 diff 변형은 원문으로 표시합니다.' : '바이너리 diff는 원문으로 표시합니다.')
    return { kind: 'file', from, to, header, hunks: [], parsed: false, label: group[0]?.text ?? 'diff' }
  }
  const hunks: DiffHunk[] = []
  let index = hunkIndex
  let rawGap = false
  let incomplete = false
  while (index >= 0 && index < group.length) {
    if (!group[index]!.text.startsWith('@@ ')) {
      if (hunks.length && group.slice(index + 1).some((line) => line.text.startsWith('@@ '))) rawGap = true
      index += 1
      continue
    }
    const parsed = parseHunk(group, index, group.length, diagnostics)
    if (!parsed.hunk) { diagnostics.push(`해석하지 못한 hunk 헤더입니다 (행 ${start + index + 1}).`); incomplete = true; index = parsed.next; continue }
    if (!parsed.complete) incomplete = true
    hunks.push(parsed.hunk)
    index = Math.max(index + 1, parsed.next)
  }
  const parsed = hunkIndex < 0 || (hunks.length > 0 && !incomplete && !rawGap)
  return { kind: 'file', from, to, header, hunks: parsed ? hunks : [], parsed, label: group[0]?.text ?? 'diff' }
}

export function parseDiff(text: string): DiffModel {
  const lines = linesOf(text)
  const diagnostics: string[] = []
  const segments: DiffSegment[] = []
  let cursor = 0, index = 0
  while (index < lines.length) {
    if (!isFileStart(lines, index)) { index += 1; continue }
    if (lines[index]!.from > cursor) segments.push({ kind: 'text', from: cursor, to: lines[index]!.from })
    let end = index + 1
    if (isGitStart(lines[index])) {
      while (end < lines.length && !isGitStart(lines[end])) end += 1
    } else {
      // Skip hunk bodies using their declared counts so deleted lines beginning with
      // --- and added lines beginning with +++ are never mistaken for file headers.
      end = index + 2
      while (end < lines.length) {
        if (isGitStart(lines[end]) || isPlainStart(lines, end)) break
        if (lines[end]!.text.startsWith('@@ ')) {
          const parsed = parseHunk(lines, end, lines.length, diagnostics)
          end = Math.max(end + 1, parsed.next)
        } else end += 1
      }
    }
    segments.push(parseFile(lines, index, end, diagnostics))
    cursor = lines[end - 1]?.to ?? cursor
    index = end
  }
  if (cursor < text.length) segments.push({ kind: 'text', from: cursor, to: text.length })
  if (!segments.length && text.length) segments.push({ kind: 'text', from: 0, to: text.length })
  return { sourceLength: text.length, sourceFingerprint: diffFingerprint(text), segments, diagnostics }
}
