import { EditorState, type ChangeSet } from '@codemirror/state'

export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n|\r/gu, '\n')
}

export function findMinimalChange(previous: string, next: string): { from: number; to: number; insert: string } {
  let from = 0
  const sharedLength = Math.min(previous.length, next.length)
  while (from < sharedLength && previous.charCodeAt(from) === next.charCodeAt(from)) from += 1
  let oldEnd = previous.length
  let newEnd = next.length
  while (oldEnd > from && newEnd > from && previous.charCodeAt(oldEnd - 1) === next.charCodeAt(newEnd - 1)) {
    oldEnd -= 1
    newEnd -= 1
  }
  return { from, to: oldEnd, insert: next.slice(from, newEnd) }
}

function canonicalLineStarts(text: string): number[] {
  const starts = [0]
  const breaks = /\r\n|\r|\n/gu
  for (let match = breaks.exec(text); match; match = breaks.exec(text)) starts.push(match.index + match[0].length)
  return starts
}

function toCanonicalOffset(state: EditorState, starts: number[], position: number): number {
  const line = state.doc.lineAt(position)
  const column = Math.min(position - line.from, line.length)
  return (starts[line.number - 1] ?? 0) + column
}

function preferredLineBreak(text: string, at: number): string {
  const breaks: Array<{ from: number; to: number; value: string }> = []
  const pattern = /\r\n|\r|\n/gu
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) breaks.push({ from: match.index, to: match.index + match[0].length, value: match[0] })
  const previous = [...breaks].reverse().find((item) => item.to <= at)
  const next = breaks.find((item) => item.from >= at)
  if (previous && next) return at - previous.to <= next.from - at ? previous.value : next.value
  if (previous) return previous.value
  if (next) return next.value
  if (breaks.length) {
    const counts = new Map<string, number>()
    for (const item of breaks) counts.set(item.value, (counts.get(item.value) ?? 0) + 1)
    return [...counts].sort((left, right) => right[1] - left[1])[0]![0]
  }
  return '\n'
}

function canonicalOffset(text: string, normalizedOffset: number): number {
  let source = 0
  let normalized = 0
  while (source < text.length && normalized < normalizedOffset) {
    if (text[source] === '\r' && text[source + 1] === '\n') source += 1
    source += 1
    normalized += 1
  }
  return source
}

function applyNormalizedChange(sourceText: string, from: number, to: number, insert: string): string {
  const sourceFrom = canonicalOffset(sourceText, from)
  const sourceTo = canonicalOffset(sourceText, to)
  const insertion = insert.replace(/\n/gu, preferredLineBreak(sourceText, sourceFrom))
  return `${sourceText.slice(0, sourceFrom)}${insertion}${sourceText.slice(sourceTo)}`
}

export interface TextChange { from: number; to: number; insert: string }

function diffTextChanges(previous: string, next: string): TextChange[] | null {
  let prefix = 0
  const sharedLength = Math.min(previous.length, next.length)
  while (prefix < sharedLength && previous.charCodeAt(prefix) === next.charCodeAt(prefix)) prefix += 1
  let previousEnd = previous.length
  let nextEnd = next.length
  while (previousEnd > prefix && nextEnd > prefix && previous.charCodeAt(previousEnd - 1) === next.charCodeAt(nextEnd - 1)) {
    previousEnd -= 1
    nextEnd -= 1
  }
  if (prefix === previousEnd && prefix === nextEnd) return []

  const left = previous.slice(prefix, previousEnd)
  const right = next.slice(prefix, nextEnd)
  const maxDistance = left.length + right.length
  const trace: Map<number, number>[] = []
  let totalEntries = 0
  let frontier = new Map<number, number>([[1, 0]])
  let complete = false

  for (let distance = 0; distance <= maxDistance; distance += 1) {
    const nextFrontier = new Map<number, number>()
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      const down = diagonal === -distance || (diagonal !== distance &&
        (frontier.get(diagonal - 1) ?? -1) < (frontier.get(diagonal + 1) ?? -1))
      let x = down ? (frontier.get(diagonal + 1) ?? 0) : (frontier.get(diagonal - 1) ?? 0) + 1
      let y = x - diagonal
      while (x < left.length && y < right.length && left.charCodeAt(x) === right.charCodeAt(y)) { x += 1; y += 1 }
      nextFrontier.set(diagonal, x)
      if (x >= left.length && y >= right.length) { complete = true; break }
    }
    totalEntries += nextFrontier.size
    if (totalEntries > 200_000) return null
    trace.push(nextFrontier)
    if (complete) break
    frontier = nextFrontier
  }
  if (!complete) return null

  const operations: Array<{ kind: 'equal' | 'insert' | 'delete'; value?: string }> = []
  let x = left.length
  let y = right.length
  for (let distance = trace.length - 1; distance > 0; distance -= 1) {
    const prior = trace[distance - 1]!
    const diagonal = x - y
    const down = diagonal === -distance || (diagonal !== distance &&
      (prior.get(diagonal - 1) ?? -1) < (prior.get(diagonal + 1) ?? -1))
    const priorDiagonal = down ? diagonal + 1 : diagonal - 1
    const priorX = prior.get(priorDiagonal) ?? 0
    const priorY = priorX - priorDiagonal
    while (x > priorX && y > priorY) {
      operations.push({ kind: 'equal' })
      x -= 1; y -= 1
    }
    if (down) {
      operations.push({ kind: 'insert', value: right[y - 1] })
      y -= 1
    } else {
      operations.push({ kind: 'delete' })
      x -= 1
    }
  }
  while (x > 0 && y > 0) { operations.push({ kind: 'equal' }); x -= 1; y -= 1 }
  while (x > 0) { operations.push({ kind: 'delete' }); x -= 1 }
  while (y > 0) { operations.push({ kind: 'insert', value: right[y - 1] }); y -= 1 }
  operations.reverse()

  const changes: TextChange[] = []
  let offset = prefix
  let current: TextChange | null = null
  const finish = () => { if (current) changes.push(current); current = null }
  for (const operation of operations) {
    if (operation.kind === 'equal') {
      finish()
      offset += 1
    } else {
      current ??= { from: offset, to: offset, insert: '' }
      if (operation.kind === 'delete') {
        offset += 1
        current.to = offset
      } else {
        current.insert += operation.value ?? ''
      }
    }
  }
  finish()
  return changes
}

export function findTextChanges(previousText: string, nextText: string): TextChange[] {
  const previous = normalizeLineEndings(previousText)
  const next = normalizeLineEndings(nextText)
  if (previous === next) return []
  return diffTextChanges(previous, next) ?? [findMinimalChange(previous, next)]
}

export function createTextPositionMapper(previousText: string, nextText: string): (position: number, association?: number) => number {
  const previous = normalizeLineEndings(previousText)
  const next = normalizeLineEndings(nextText)
  const state = EditorState.create({ doc: previous })
  const changes = state.changes(findTextChanges(previous, next))
  return (position, association = 1) => changes.mapPos(Math.max(0, Math.min(position, state.doc.length)), association)
}

/** Keep local IME edits while applying a concurrent session change outside the edited range. */
export function mergeTextDuringComposition(baseText: string, localText: string, remoteText: string): string {
  const base = normalizeLineEndings(baseText)
  const local = normalizeLineEndings(localText)
  const remote = normalizeLineEndings(remoteText)
  if (local === base) return remoteText
  if (remote === base || local === remote) return localText

  const localChanges = findTextChanges(base, local)
  const remoteHunks = findTextChanges(base, remote)
  const baseState = EditorState.create({ doc: base })
  const remoteChangeSet = baseState.changes(remoteHunks)
  const mappedLocal = localChanges.map((localChange) => ({
    from: remoteChangeSet.mapPos(localChange.from, localChange.from === localChange.to ? 1 : -1),
    to: remoteChangeSet.mapPos(localChange.to, 1),
    insert: localChange.insert
  })).sort((left, right) => right.from - left.from)
  let merged = remoteText
  for (const change of mappedLocal) merged = applyNormalizedChange(merged, change.from, change.to, change.insert)
  return merged
}

export interface LineBasedTextChange {
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
  text: string
}

/** Map Monaco's line/column edit ranges back to the exact session line separators. */
export function applyLineBasedTextChanges(sourceText: string, sourceChanges: readonly LineBasedTextChange[]): string {
  const starts = canonicalLineStarts(sourceText)
  const edits = sourceChanges.map((change) => ({
    from: (starts[change.startLineNumber - 1] ?? 0) + change.startColumn - 1,
    to: (starts[change.endLineNumber - 1] ?? 0) + change.endColumn - 1,
    insert: normalizeLineEndings(change.text)
  })).sort((left, right) => left.from - right.from)
  let next = sourceText
  for (const edit of edits.reverse()) {
    const insertion = edit.insert.replace(/\n/gu, preferredLineBreak(sourceText, edit.from))
    next = `${next.slice(0, edit.from)}${insertion}${next.slice(edit.to)}`
  }
  return next
}

/** Apply CodeMirror's normalized offsets to the session string without changing untouched line endings. */
export function applyCodeMirrorChanges(startState: EditorState, changes: ChangeSet, sourceText: string): string {
  const starts = canonicalLineStarts(sourceText)
  const edits: Array<{ from: number; to: number; insert: string }> = []
  changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    edits.push({
      from: toCanonicalOffset(startState, starts, fromA),
      to: toCanonicalOffset(startState, starts, toA),
      insert: inserted.toString()
    })
  })
  let next = sourceText
  for (const edit of edits.reverse()) {
    const lineBreak = preferredLineBreak(sourceText, edit.from)
    const insertion = edit.insert.replace(/\n/gu, lineBreak)
    next = `${next.slice(0, edit.from)}${insertion}${next.slice(edit.to)}`
  }
  return next
}
