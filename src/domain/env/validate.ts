import { isStructuredModel, hasStructuredModelEnvelope } from '../structured/validate'
import type { StructuredNode, StructuredSlot } from '../structured/model'
import type { EnvModel, EnvRecord } from './model'

const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/

function isEnvStringNode(node: StructuredNode | null | undefined): boolean {
  return node === null || node === undefined || (node.kind === 'scalar' && node.dataType === 'string' && node.sourceFormat === undefined && node.sourceRange === undefined && node.dateKind === undefined && node.displayHint === undefined)
}

function isEnvSlot(slot: StructuredSlot): boolean {
  return (slot.key === null || typeof slot.key === 'string') && isEnvStringNode(slot.node)
}

export function hasEnvModelEnvelope(value: unknown): value is EnvModel {
  return typeof value === 'object' && value !== null && 'blocks' in value && hasStructuredModelEnvelope((value as EnvModel).blocks) &&
    ((value as EnvModel).syntax === null || typeof (value as EnvModel).syntax === 'object') && Array.isArray((value as EnvModel).detached)
}

function validRange(value: unknown, limit: number): value is { from: number; to: number } {
  if (!value || typeof value !== 'object') return false
  const range = value as { from?: unknown; to?: unknown }
  return Number.isSafeInteger(range.from) && Number.isSafeInteger(range.to) && typeof range.from === 'number' && typeof range.to === 'number' && range.from >= 0 && range.to >= range.from && range.to <= limit
}

function validRecord(record: EnvRecord, length: number): boolean {
  if (!record || !validRange(record.range, length)) return false
  if (record.type === 'blank' || record.type === 'comment') return true
  return record.type === 'assignment' && typeof record.slotId === 'string' && record.slotId.length > 0 && typeof record.key === 'string' && typeof record.value === 'string' &&
    ENV_KEY.test(record.key) && validRange(record.keyRange, length) && validRange(record.valueRange, length) && record.keyRange.from >= record.range.from && record.keyRange.to <= record.range.to &&
    record.valueRange.from >= record.keyRange.to && record.valueRange.to <= record.range.to && ['none', 'single', 'double', 'backtick'].includes(record.quote)
}

export function isEnvModel(value: unknown): value is EnvModel {
  if (!hasEnvModelEnvelope(value) || !isStructuredModel(value.blocks) || value.blocks.unsupported !== undefined) return false
  const root = value.blocks.root
  if (root !== null && (root.kind !== 'object' || root.items.some((item) => !isEnvSlot(item)))) return false
  if ((root === null) !== (value.syntax === null) || (root === null && (value.blocks.loose.length > 0 || value.detached.length > 0))) return false
  for (const loose of value.blocks.loose) {
    if (Boolean(loose.node) === Boolean(loose.slot)) return false
    const node = loose.node ?? loose.slot?.node
    if (!isEnvStringNode(node) || (loose.slot && !isEnvSlot(loose.slot))) return false
  }
  if (value.syntax !== null) {
    const syntax = value.syntax
    if (!Number.isSafeInteger(syntax.sourceLength) || syntax.sourceLength < 0 || !Number.isInteger(syntax.sourceFingerprint) || syntax.sourceFingerprint < 0 || syntax.sourceFingerprint > 0xffffffff || (syntax.newline !== '\n' && syntax.newline !== '\r\n') || !Array.isArray(syntax.records)) return false
    let cursor = 0
    const ids = new Set<string>()
    for (const record of syntax.records) {
      if (!validRecord(record, syntax.sourceLength) || record.range.from !== cursor) return false
      cursor = record.range.to
      if (record.type === 'assignment') { if (ids.has(record.slotId)) return false; ids.add(record.slotId) }
    }
    if (cursor !== syntax.sourceLength) return false
  }
  const detachedIds = new Set<string>()
  for (const item of value.detached) {
    if (!item || typeof item.slotId !== 'string' || !item.slotId || detachedIds.has(item.slotId) || typeof item.raw !== 'string' || typeof item.key !== 'string' || typeof item.value !== 'string' ||
      !ENV_KEY.test(item.key) || !validRange(item.keyRange, item.raw.length) || !validRange(item.valueRange, item.raw.length) || item.keyRange.from >= item.keyRange.to ||
      item.raw.slice(item.keyRange.from, item.keyRange.to) !== item.key || item.valueRange.from < item.keyRange.to || !['none', 'single', 'double', 'backtick'].includes(item.quote)) return false
    detachedIds.add(item.slotId)
  }
  const looseSlotIds = new Set(value.blocks.loose.flatMap((block) => block.slot ? [block.slot.id] : []))
  const syntaxSlotIds = new Set(value.syntax?.records.flatMap((record) => record.type === 'assignment' ? [record.slotId] : []) ?? [])
  if (value.detached.some((item) => !looseSlotIds.has(item.slotId) || syntaxSlotIds.has(item.slotId))) return false
  return true
}
