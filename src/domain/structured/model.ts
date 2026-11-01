export type StructuredFormat = 'json' | 'yaml' | 'toml'
export type ScalarType = 'string' | 'number' | 'boolean' | 'null' | 'native-date-time'
export interface SourceRange { from: number; to: number; format: StructuredFormat; fingerprint: number }
export interface StructuredScalar {
  id: string
  kind: 'scalar'
  dataType: ScalarType
  raw: string
  sourceFormat?: StructuredFormat
  dateKind?: 'offset-date-time' | 'local-date-time' | 'local-date' | 'local-time'
  displayHint?: 'date' | 'color'
  sourceRange?: SourceRange
}
export interface StructuredSlot { id: string; key: string | null; nameMissing?: boolean; node: StructuredNode | null }
export interface StructuredContainer { id: string; kind: 'object' | 'array'; items: StructuredSlot[] }
export type StructuredNode = StructuredScalar | StructuredContainer
export interface LooseBlock { id: string; x: number; y: number; node?: StructuredNode; slot?: StructuredSlot }
export interface StructuredModel { root: StructuredNode | null; loose: LooseBlock[]; unsupported?: string }
export interface StructuredOutput { preview: string; text: string | null; issues: string[]; omissions: string[] }

export const newId = () => globalThis.crypto.randomUUID()
export const scalar = (dataType: ScalarType, raw: string): StructuredScalar => ({ id: newId(), kind: 'scalar', dataType, raw })
export const container = (kind: 'object' | 'array'): StructuredContainer => ({ id: newId(), kind, items: [] })
export const slot = (key: string | null, node: StructuredNode | null): StructuredSlot => ({ id: newId(), key, node })
export const isStructuredFormat = (format: string): format is StructuredFormat => format === 'json' || format === 'yaml' || format === 'toml'

export function sourceFingerprint(text: string, from: number, to: number): number {
  let hash = 2166136261
  for (let index = from; index < to; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619)
  return hash >>> 0
}

export function sameStructuredNode(a: StructuredNode | null, b: StructuredNode | null): boolean {
  if (!a || !b) return a === b
  if (a.id !== b.id || a.kind !== b.kind) return false
  if (a.kind === 'scalar' && b.kind === 'scalar') return a.dataType === b.dataType && a.raw === b.raw && a.sourceFormat === b.sourceFormat && a.dateKind === b.dateKind
  if (a.kind === 'scalar' || b.kind === 'scalar' || a.items.length !== b.items.length) return false
  return a.items.every((item, index) => { const other = b.items[index]; return item.id === other.id && item.key === other.key && item.nameMissing === other.nameMissing && sameStructuredNode(item.node, other.node) })
}
