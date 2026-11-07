import type { StructuredModel, StructuredSlot } from '../structured/model'
import { envFingerprint, withEnvBlocks, type EnvAssignmentRecord, type EnvCompileResult, type EnvDetachedAssignment, type EnvModel, type EnvQuote } from './model'
import { parseEnv } from './parse'

const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

export interface EnvInspection { issues: string[]; duplicates: string[]; loose: string[] }

export function inspectEnv(model: EnvModel): EnvInspection {
  const issues: string[] = [], duplicates: string[] = [], loose: string[] = []
  const root = model.blocks.root
  if (!root || root.kind !== 'object') issues.push('ENV 루트는 프로퍼티 목록이어야 합니다.')
  else {
    const seen = new Set<string>()
    for (const item of root.items) {
      const label = item.key ?? '이름 없음'
      if (!item.key || item.nameMissing) issues.push(`이름이 비어 있습니다: ${label}`)
      else if (!KEY_PATTERN.test(item.key)) issues.push(`변수 이름이 올바르지 않습니다: ${item.key}`)
      if (!item.node) issues.push(`값이 비어 있습니다: ${label}`)
      else if (item.node.kind !== 'scalar' || item.node.dataType !== 'string') issues.push(`문자열 값만 사용할 수 있습니다: ${label}`)
      if (item.key && seen.has(item.key)) duplicates.push(item.key)
      if (item.key) seen.add(item.key)
    }
  }
  for (const block of model.blocks.loose) {
    const item = block.slot
    const node = block.node ?? item?.node
    if (item) loose.push(item.key ?? '이름 없음')
    else if (node?.kind === 'scalar') loose.push(node.raw || '값')
    else loose.push('블록')
  }
  return { issues, duplicates: [...new Set(duplicates)], loose }
}

function draft(model: EnvModel, issues: string[], source: string): EnvCompileResult {
  const note = issues.map((issue) => `# ${issue}`).join('\n')
  return { kind: 'draft', model, preview: source + (note ? `${source && !source.endsWith('\n') ? '\n' : ''}${note}\n` : ''), issues }
}

function tokenForValue(value: string, preferred: EnvQuote): { token: string; quote: EnvQuote } | null {
  const candidates: Array<{ quote: EnvQuote; token: string }> = []
  const quoted = (quote: Exclude<EnvQuote, 'none'>) => {
    const delimiter = quote === 'single' ? "'" : quote === 'double' ? '"' : '`'
    if (value.includes(delimiter)) return null
    const inner = quote === 'double' ? value.replace(/\n/g, '\\n') : value
    return { quote, token: `${delimiter}${inner}${delimiter}` }
  }
  const order: EnvQuote[] = [preferred, 'none', 'double', 'single', 'backtick']
  for (const quote of order) {
    if (quote === 'none') {
      if (!/[\r\n]|^\s|\s$|#/.test(value) && !/^['"`]/.test(value)) candidates.push({ quote: 'none', token: value })
    } else {
      const candidate = quoted(quote)
      if (candidate) candidates.push(candidate)
    }
  }
  for (const candidate of candidates) {
    try {
      const parsed = parseEnv(`VALUE=${candidate.token}`)
      const node = parsed.blocks.root?.kind === 'object' ? parsed.blocks.root.items[0]?.node : null
      if (node?.kind === 'scalar' && node.raw === value) return candidate
    } catch { /* Try the next dotenv spelling. */ }
  }
  return null
}

function replaceRanges(raw: string, changes: Array<{ from: number; to: number; value: string }>): string | null {
  const ordered = [...changes].sort((a, b) => b.from - a.from)
  let prior = raw.length
  let result = raw
  for (const change of ordered) {
    if (change.from < 0 || change.to < change.from || change.to > prior) return null
    result = result.slice(0, change.from) + change.value + result.slice(change.to)
    prior = change.from
  }
  return result
}

function recordSource(source: string, record: EnvAssignmentRecord): EnvDetachedAssignment {
  return {
    slotId: record.slotId,
    raw: source.slice(record.range.from, record.range.to),
    key: record.key,
    value: record.value,
    keyRange: { from: record.keyRange.from - record.range.from, to: record.keyRange.to - record.range.from },
    valueRange: { from: record.valueRange.from - record.range.from, to: record.valueRange.to - record.range.from },
    quote: record.quote
  }
}

function patchDeclaration(base: EnvDetachedAssignment, key: string, value: string): string | null {
  const changes: Array<{ from: number; to: number; value: string }> = []
  if (key !== base.key) changes.push({ ...base.keyRange, value: key })
  if (value !== base.value) {
    const encoded = tokenForValue(value, base.quote)
    if (!encoded) return null
    changes.push({ ...base.valueRange, value: encoded.token })
  }
  return replaceRanges(base.raw, changes)
}

function newDeclaration(key: string, value: string, newline: string): string | null {
  const encoded = tokenForValue(value, 'none')
  if (!encoded) return null
  return `${key}=${encoded.token}${newline}`
}

function itemValue(item: StructuredSlot): string | null {
  return item.node?.kind === 'scalar' && item.node.dataType === 'string' ? item.node.raw : null
}

function normalizedDraftModel(previous: EnvModel, nextBlocks: StructuredModel): EnvModel {
  return withEnvBlocks(previous, nextBlocks)
}

export function compileEnv(previous: EnvModel, nextBlocks: StructuredModel, source: string): EnvCompileResult {
  const current = normalizedDraftModel(previous, nextBlocks)
  const syntax = previous.syntax
  if (!syntax || syntax.sourceLength !== source.length || syntax.sourceFingerprint !== envFingerprint(source)) return draft(current, ['ENV 원문이 바뀌어 구문 범위를 적용할 수 없습니다.'], source)
  const inspection = inspectEnv(current)
  if (inspection.issues.length) return draft(current, inspection.issues, source)
  const root = nextBlocks.root
  if (!root || root.kind !== 'object') return draft(current, ['ENV 루트는 고정된 프로퍼티 목록이어야 합니다.'], source)
  const previousById = new Map(syntax.records.filter((record): record is EnvAssignmentRecord => record.type === 'assignment').map((record) => [record.slotId, record]))
  const detachedById = new Map(previous.detached.map((item) => [item.slotId, item]))
  const looseSlots = nextBlocks.loose.flatMap((block) => block.slot ? [block.slot] : [])
  const nextDetached: EnvDetachedAssignment[] = []
  for (const item of looseSlots) {
    const original = previousById.get(item.id)
    const base = detachedById.get(item.id) ?? (original ? recordSource(source, original) : null)
    if (base) nextDetached.push(base)
  }
  const target = root.items.map((item, index) => {
    const value = itemValue(item)!
    const original = previousById.get(item.id)
    const base = detachedById.get(item.id) ?? (original ? recordSource(source, original) : null)
    const raw = base ? patchDeclaration(base, item.key!, value) : newDeclaration(item.key!, value, syntax.newline)
    return { item, raw, index }
  })
  if (target.some((item) => item.raw === null)) return draft(current, ['이 값을 .env 문법으로 안전하게 표현할 수 없습니다.'], source)

  const oldAssignments = syntax.records.filter((record): record is EnvAssignmentRecord => record.type === 'assignment')
  const isSameLayout = root.items.length === oldAssignments.length && root.items.every((item, index) => item.id === oldAssignments[index]?.slotId)
  const sourceUnchanged = isSameLayout && target.every(({ item }, index) => {
    const record = oldAssignments[index]!
    return item.key === record.key && itemValue(item) === record.value
  })
  if (sourceUnchanged) return { kind: 'ready', model: { ...current, detached: nextDetached }, text: source }

  const rootIds = new Set(root.items.map((item) => item.id))
  const sourceTargets = target.filter((entry) => rootIds.has(entry.item.id) && previousById.has(entry.item.id))
  const lastAssignmentIndex = syntax.records.reduce((last, record, index) => record.type === 'assignment' ? index : last, -1)
  let sourceTargetIndex = 0
  let targetCursor = 0
  const output: string[] = []
  const pushTarget = (raw: string) => {
    const previousOutput = output.at(-1)
    if (previousOutput && !previousOutput.endsWith('\n')) output[output.length - 1] = `${previousOutput}${syntax.newline}`
    output.push(raw)
  }
  const flushTargetUntil = (position: number) => {
    while (targetCursor < position) pushTarget(target[targetCursor++]!.raw!)
  }
  for (let recordIndex = 0; recordIndex < syntax.records.length; recordIndex += 1) {
    const record = syntax.records[recordIndex]!
    if (record.type === 'assignment') {
      if (rootIds.has(record.slotId)) {
        const replacement = sourceTargets[sourceTargetIndex++]
        if (replacement) {
          flushTargetUntil(replacement.index)
          pushTarget(replacement.raw!)
          targetCursor = replacement.index + 1
        }
      }
    } else {
      if (lastAssignmentIndex >= 0 && recordIndex > lastAssignmentIndex) flushTargetUntil(target.length)
      output.push(source.slice(record.range.from, record.range.to))
    }
  }
  flushTargetUntil(target.length)
  let text = output.join('')
  const hadFinalNewline = source.endsWith('\n')
  if (!hadFinalNewline && text.endsWith('\n') && target.at(-1)?.raw?.endsWith('\n')) text = text.slice(0, -syntax.newline.length)
  let reparsed: EnvModel
  try { reparsed = parseEnv(text) }
  catch { return draft(current, ['변경 결과를 .env 문법으로 다시 읽을 수 없습니다.'], source) }
  const parsedRoot = reparsed.blocks.root
  if (!parsedRoot || parsedRoot.kind !== 'object' || parsedRoot.items.length !== root.items.length || parsedRoot.items.some((item, index) => item.key !== root.items[index]?.key || itemValue(item) !== itemValue(root.items[index]!))) {
    return draft(current, ['변경 결과가 ENV 캔버스와 일치하지 않습니다.'], source)
  }
  const mapped = parsedRoot.items.map((parsed, index) => {
    const targetSlot = root.items[index]!
    const parsedNode = parsed.node
    const targetNode = targetSlot.node
    return { ...parsed, id: targetSlot.id, node: parsedNode?.kind === 'scalar' && targetNode?.kind === 'scalar' ? { ...parsedNode, id: targetNode.id } : parsedNode }
  })
  let assignmentIndex = 0
  const records = reparsed.syntax!.records.map((record) => {
    if (record.type !== 'assignment') return record
    const slotId = root.items[assignmentIndex]?.id ?? record.slotId
    assignmentIndex += 1
    return { ...record, slotId }
  })
  const model: EnvModel = {
    blocks: { ...nextBlocks, root: { ...parsedRoot, id: root.id, items: mapped } },
    syntax: { ...reparsed.syntax!, records },
    detached: nextDetached
  }
  return { kind: 'ready', model, text }
}

export function emptyEnvModel(): EnvModel {
  const model: StructuredModel = { root: { id: crypto.randomUUID(), kind: 'object', items: [] }, loose: [] }
  return { blocks: model, syntax: { sourceLength: 0, sourceFingerprint: envFingerprint(''), newline: '\n', records: [] }, detached: [] }
}
