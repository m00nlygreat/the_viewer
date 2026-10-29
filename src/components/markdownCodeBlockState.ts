import type { EditorView } from '@codemirror/view'
import { markdownCodeLanguage, markdownCodeLanguageLabel, type MarkdownCodeLanguage } from '../domain/formats/markdownCodeBlock'

export interface MarkdownCodeBlockSnapshot {
  from: number
  to: number
  source: string
  code: string
  info: string
  context: MarkdownCodeBlockContext
  language: MarkdownCodeLanguage | null
  languageLabel: string
  editing: boolean
  theme: 'light' | 'dark'
}

export interface MarkdownCodeBlockContext {
  bodyPrefix: string
  closingPrefix: string
}

interface ParsedMarkdownCodeBlock {
  openingLine: string
  closingLine: string | null
  lineEnding: string
  code: string
  info: string
  indent: string
  fence: string
}

export class MarkdownCodeBlockState {
  private snapshot: MarkdownCodeBlockSnapshot
  private readonly listeners = new Set<() => void>()
  private view: EditorView | null = null
  private undo: () => void
  private redo: () => void

  constructor(
    from: number,
    to: number,
    source: string,
    theme: 'light' | 'dark',
    undo: () => void = () => {},
    redo: () => void = () => {},
    context: MarkdownCodeBlockContext = { bodyPrefix: '', closingPrefix: '' }
  ) {
    this.snapshot = createSnapshot(from, to, source, theme, false, context)
    this.undo = undo
    this.redo = redo
  }

  readonly getSnapshot = (): MarkdownCodeBlockSnapshot => this.snapshot

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  attachView(view: EditorView): void { this.view = view }

  undoDocument(): void { this.undo() }
  redoDocument(): void { this.redo() }

  update(from: number, to: number, source: string, theme: 'light' | 'dark', context: MarkdownCodeBlockContext): void {
    if (this.snapshot.from === from && this.snapshot.to === to && this.snapshot.source === source && this.snapshot.theme === theme &&
      this.snapshot.context.bodyPrefix === context.bodyPrefix && this.snapshot.context.closingPrefix === context.closingPrefix) return
    this.snapshot = createSnapshot(from, to, source, theme, this.snapshot.editing, context)
    this.emit()
  }

  setEditing(editing: boolean): void {
    if (this.snapshot.editing === editing) return
    this.snapshot = { ...this.snapshot, editing }
    this.emit()
  }

  replaceCode(code: string, group: 'typing' | 'command' = 'typing'): void {
    const source = replaceMarkdownCode(this.snapshot.source, code, this.snapshot.context)
    if (source === this.snapshot.source || !this.view) return
    this.view.dispatch({
      changes: { from: this.snapshot.from, to: this.snapshot.to, insert: source },
      userEvent: group === 'command' ? 'input.format' : 'input.type'
    })
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }
}

function createSnapshot(from: number, to: number, source: string, theme: 'light' | 'dark', editing: boolean, context: MarkdownCodeBlockContext): MarkdownCodeBlockSnapshot {
  const parsed = parseMarkdownCodeBlock(source, context)
  return {
    from, to, source, code: parsed.code, info: parsed.info, context,
    language: markdownCodeLanguage(parsed.info), languageLabel: markdownCodeLanguageLabel(parsed.info),
    editing, theme
  }
}

function parseMarkdownCodeBlock(source: string, context: MarkdownCodeBlockContext): ParsedMarkdownCodeBlock {
  const lineBreak = /\r\n|\n|\r/u.exec(source)
  const lineEnding = lineBreak?.[0] ?? '\n'
  const openingLine = lineBreak ? source.slice(0, lineBreak.index) : source
  const opening = openingLine.match(/^([ \t]{0,3})(`{3,}|~{3,})(.*)$/u)
  const indent = opening?.[1] ?? ''
  const fence = opening?.[2] ?? '```'
  const info = opening?.[3]?.trim() ?? ''
  if (!lineBreak) return { openingLine, closingLine: null, lineEnding, code: '', info, indent, fence }

  const content = source.slice(lineBreak.index + lineEnding.length)
  const lastLineBreak = findLastLineBreak(content)
  const possibleClosing = lastLineBreak ? content.slice(lastLineBreak.index + lastLineBreak.value.length) : content
  const closingLine = possibleClosing.startsWith(context.closingPrefix)
    ? possibleClosing.slice(context.closingPrefix.length)
    : possibleClosing
  const closing = parseClosingFence(closingLine, fence)
  if (closing) {
    const rawCode = lastLineBreak ? content.slice(0, lastLineBreak.index) : ''
    const code = removeLinePrefix(rawCode, context.bodyPrefix, lineEnding)
    return { openingLine, closingLine: possibleClosing, lineEnding, code, info, indent, fence }
  }
  return { openingLine, closingLine: null, lineEnding, code: removeLinePrefix(content, context.bodyPrefix, lineEnding), info, indent, fence }
}

function replaceMarkdownCode(source: string, code: string, context: MarkdownCodeBlockContext): string {
  const parsed = parseMarkdownCodeBlock(source, context)
  const opening = parsed.openingLine.match(/^([ \t]{0,3})(`{3,}|~{3,})(.*)$/u)
  if (!opening) return `${parsed.openingLine}${parsed.lineEnding}${code}`

  const indent = opening[1] ?? ''
  const originalFence = opening[2] ?? '```'
  const fenceCharacter = originalFence[0] ?? '`'
  const requiredLength = code.split(/\r\n|\n|\r/u).reduce((length, line) => {
    const match = line.match(/^([ \t]{0,3})(`+|~+)([ \t]*)$/u)
    if (match?.[2]?.[0] !== fenceCharacter) return length
    return Math.max(length, match[2].length + 1)
  }, originalFence.length)
  const fence = fenceCharacter.repeat(requiredLength)
  const openingLine = `${indent}${fence}${opening[3] ?? ''}`
  const closingLine = parsed.closingLine?.startsWith(context.closingPrefix)
    ? parsed.closingLine.slice(context.closingPrefix.length)
    : parsed.closingLine ?? ''
  const closingParts = parsed.closingLine ? parseClosingFence(closingLine, originalFence) : null
  const closingIndent = context.closingPrefix || closingParts?.indent || indent
  const closingWhitespace = closingParts?.trailingWhitespace ?? ''
  const closingFenceLine = `${closingIndent}${fence}${closingWhitespace}`
  const wrappedCode = code.length
    ? code.split(/\r\n|\n|\r/u).map((line) => `${context.bodyPrefix}${line}`).join(parsed.lineEnding)
    : ''
  return `${openingLine}${parsed.lineEnding}${wrappedCode}${wrappedCode ? parsed.lineEnding : ''}${closingFenceLine}`
}

function removeLinePrefix(value: string, prefix: string, lineEnding: string): string {
  if (!prefix) return value
  return value.split(lineEnding).map((line) => line.startsWith(prefix) ? line.slice(prefix.length) : line).join(lineEnding)
}

function findLastLineBreak(value: string): { index: number; value: string } | null {
  const expression = /\r\n|\n|\r/gu
  let match: RegExpExecArray | null
  let last: { index: number; value: string } | null = null
  while ((match = expression.exec(value))) last = { index: match.index, value: match[0] }
  return last
}

function parseClosingFence(value: string, openingFence: string): { indent: string; trailingWhitespace: string } | null {
  const fenceCharacter = openingFence[0] ?? '`'
  const match = value.match(/^([ \t]{0,3})(`+|~+)([ \t]*)$/u)
  if (!match || match[2]?.[0] !== fenceCharacter || match[2].length < openingFence.length) return null
  return { indent: match[1] ?? '', trailingWhitespace: match[3] ?? '' }
}
