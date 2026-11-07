import { sourceFingerprint } from '../structured/model'

export interface DiffRange { from: number; to: number }
export interface DiffHeaderLine extends DiffRange { kind: 'header' | 'metadata' }
export interface DiffLine extends DiffRange {
  kind: 'context' | 'addition' | 'deletion' | 'no-newline'
  contentFrom: number
  contentTo: number
  oldLine: number | null
  newLine: number | null
}
export interface DiffHunk extends DiffRange {
  header: DiffRange
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  rows: DiffLine[]
}
export interface DiffTextSegment extends DiffRange { kind: 'text' }
export interface DiffFileSegment extends DiffRange {
  kind: 'file'
  header: DiffHeaderLine[]
  hunks: DiffHunk[]
  parsed: boolean
  label: string
}
export type DiffSegment = DiffTextSegment | DiffFileSegment
export interface DiffModel {
  sourceLength: number
  sourceFingerprint: number
  segments: DiffSegment[]
  diagnostics: string[]
}

export function diffFingerprint(text: string): number {
  return sourceFingerprint(text, 0, text.length)
}
