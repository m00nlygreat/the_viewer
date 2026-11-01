import { sourceFingerprint, type SourceRange, type StructuredFormat, type StructuredModel, type StructuredNode, type StructuredScalar } from './model'
import { serializeStructured } from './output'

interface ScalarChange { before: StructuredScalar; after: StructuredScalar }

function singleScalarChange(before: StructuredNode | null, after: StructuredNode | null): ScalarChange | null {
  let change: ScalarChange | null = null
  let valid = true
  const compare = (oldNode: StructuredNode | null, newNode: StructuredNode | null) => {
    if (!valid || !oldNode || !newNode) { if (oldNode !== newNode) valid = false; return }
    if (oldNode.id !== newNode.id || oldNode.kind !== newNode.kind) { valid = false; return }
    if (oldNode.kind === 'scalar' && newNode.kind === 'scalar') {
      if (oldNode.dataType !== newNode.dataType || oldNode.sourceFormat !== newNode.sourceFormat) { valid = false; return }
      if (oldNode.raw !== newNode.raw) {
        if (change) valid = false
        else change = { before: oldNode, after: newNode }
      } else if (oldNode.dateKind !== newNode.dateKind) valid = false
      return
    }
    if (oldNode.kind === 'scalar' || newNode.kind === 'scalar' || oldNode.items.length !== newNode.items.length) { valid = false; return }
    oldNode.items.forEach((oldSlot, index) => {
      const newSlot = newNode.items[index]
      if (oldSlot.id !== newSlot.id || oldSlot.key !== newSlot.key || oldSlot.nameMissing !== newSlot.nameMissing) { valid = false; return }
      compare(oldSlot.node, newSlot.node)
    })
  }
  compare(before, after)
  return valid ? change : null
}

function eachNode(model: StructuredModel, visit: (node: StructuredNode) => void): void {
  const stack: StructuredNode[] = []
  if (model.root) stack.push(model.root)
  for (const block of model.loose) {
    const node = block.node ?? block.slot?.node
    if (node) stack.push(node)
  }
  while (stack.length) {
    const node = stack.pop()!
    visit(node)
    if (node.kind !== 'scalar') for (const item of node.items) if (item.node) stack.push(item.node)
  }
}

function scalarSource(node: StructuredScalar, format: StructuredFormat): string {
  if (format !== 'toml') return serializeStructured({ root: node, loose: [] }, format)
  const prefix = 'value = '
  const output = serializeStructured({ root: { id: 'source-root', kind: 'object', items: [{ id: 'source-slot', key: 'value', node }] }, loose: [] }, 'toml')
  if (!output.startsWith(prefix)) throw new Error('TOML 값을 직렬화하지 못했습니다.')
  return output.slice(prefix.length)
}

/** Replace one unchanged-location scalar while preserving surrounding source text. */
export function patchSingleScalarSource(before: StructuredModel, after: StructuredModel, text: string, format: StructuredFormat): { model: StructuredModel; text: string } | null {
  const change = singleScalarChange(before.root, after.root)
  const range = change?.before.sourceRange
  if (!change || !range || range.format !== format || !Number.isSafeInteger(range.from) || !Number.isSafeInteger(range.to) || range.from < 0 || range.to < range.from || range.to > text.length) return null
  if (sourceFingerprint(text, range.from, range.to) !== range.fingerprint) return null
  const token = text.slice(range.from, range.to)
  const encoded = scalarSource(change.after, format)
  let suffix = ''
  if (format === 'yaml' && /[\r\n]$/.test(token)) {
    const newline = token.endsWith('\r\n') ? '\r\n' : token.endsWith('\n') ? '\n' : '\r'
    const firstLine = token.split(/\r\n|\r|\n/, 1)[0]
    const blockHeader = firstLine.match(/^[|>](?:[1-9][+-]?|[+-][1-9]?)?[ \t]*(#[^\r\n]*)?[ \t]*$/)
    if (!blockHeader) return null
    suffix = `${blockHeader[1] ? ` ${blockHeader[1]}` : ''}${newline}`
  }
  const replacement = encoded + suffix
  const updatedText = text.slice(0, range.from) + replacement + text.slice(range.to)
  const delta = replacement.length - (range.to - range.from)
  const previousRanges = new Map<string, SourceRange>()
  eachNode(before, (node) => { if (node.kind === 'scalar' && node.sourceRange) previousRanges.set(node.id, node.sourceRange) })
  const model = structuredClone(after)
  eachNode(model, (node) => {
    if (node.kind !== 'scalar') return
    const previous = previousRanges.get(node.id)
    if (!previous || previous.format !== format) { delete node.sourceRange; return }
    if (node.id === change.before.id) {
      node.sourceRange = { from: range.from, to: range.from + encoded.length, format, fingerprint: sourceFingerprint(encoded, 0, encoded.length) }
    } else if (previous.to <= range.from) node.sourceRange = { ...previous }
    else if (previous.from >= range.to) node.sourceRange = { ...previous, from: previous.from + delta, to: previous.to + delta }
    else delete node.sourceRange
  })
  return { model, text: updatedText }
}

/** A structural rewrite creates new locations; stale ranges must not be reused. */
export function withoutSourceRanges(model: StructuredModel): StructuredModel {
  const copy = structuredClone(model)
  eachNode(copy, (node) => { if (node.kind === 'scalar') delete node.sourceRange })
  return copy
}
