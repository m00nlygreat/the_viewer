import type { StructuredModel } from '../structured/model'

export type EnvQuote = 'none' | 'single' | 'double' | 'backtick'
export interface EnvRange { from: number; to: number }
export interface EnvAssignmentRecord {
  type: 'assignment'
  slotId: string
  key: string
  value: string
  range: EnvRange
  keyRange: EnvRange
  valueRange: EnvRange
  quote: EnvQuote
}
export interface EnvCommentRecord { type: 'comment'; range: EnvRange }
export interface EnvBlankRecord { type: 'blank'; range: EnvRange }
export type EnvRecord = EnvAssignmentRecord | EnvCommentRecord | EnvBlankRecord
export interface EnvSyntax {
  sourceLength: number
  sourceFingerprint: number
  newline: '\n' | '\r\n'
  records: EnvRecord[]
}
export interface EnvDetachedAssignment {
  slotId: string
  raw: string
  key: string
  value: string
  keyRange: EnvRange
  valueRange: EnvRange
  quote: EnvQuote
}
export interface EnvModel { blocks: StructuredModel; syntax: EnvSyntax | null; detached: EnvDetachedAssignment[] }
export type EnvCompileResult =
  | { kind: 'ready'; model: EnvModel; text: string }
  | { kind: 'draft'; model: EnvModel; preview: string; issues: string[] }

export function envFingerprint(text: string): number {
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619)
  return hash >>> 0
}

export function withEnvBlocks(model: EnvModel, blocks: StructuredModel): EnvModel {
  return blocks === model.blocks ? model : { ...model, blocks }
}
