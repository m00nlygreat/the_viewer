import { container, newId, slot, type LooseBlock, type StructuredModel, type StructuredNode, type StructuredSlot } from './model'
import { uniqueKey } from './output'

export type Payload = { node: StructuredNode; slot?: never } | { slot: StructuredSlot; node?: never }
export type DragSource = { type: 'palette'; payload: Payload } | { type: 'node' | 'slot' | 'loose'; id: string }
export type DropTarget = { type: 'canvas'; x: number; y: number } | { type: 'socket'; id: string } | { type: 'insert'; id: string; index: number }

export function findNode(model: StructuredModel, id: string): StructuredNode | undefined {
  const walk = (node: StructuredNode | null | undefined): StructuredNode | undefined => {
    if (!node) return undefined
    if (node.id === id) return node
    if (node.kind !== 'scalar') for (const item of node.items) { const found = walk(item.node); if (found) return found }
    return undefined
  }
  return walk(model.root) ?? model.loose.map((item) => walk(item.node ?? item.slot?.node)).find(Boolean)
}
export function findSlot(model: StructuredModel, id: string): StructuredSlot | undefined {
  const walk = (node: StructuredNode | null | undefined): StructuredSlot | undefined => {
    if (!node || node.kind === 'scalar') return undefined
    for (const item of node.items) { if (item.id === id) return item; const found = walk(item.node); if (found) return found }
    return undefined
  }
  return walk(model.root) ?? model.loose.map((item) => item.slot?.id === id ? item.slot : walk(item.node ?? item.slot?.node)).find(Boolean)
}
export function findSlotParent(model: StructuredModel, id: string): StructuredNode | undefined {
  const walk = (node: StructuredNode | null | undefined): StructuredNode | undefined => {
    if (!node || node.kind === 'scalar') return undefined
    for (const item of node.items) {
      if (item.id === id) return node
      const found = walk(item.node)
      if (found) return found
    }
    return undefined
  }
  return walk(model.root) ?? model.loose.map((item) => walk(item.node ?? item.slot?.node)).find(Boolean)
}
export function payloadIds(payload: Payload): Set<string> {
  const ids = new Set<string>()
  const visit = (node: StructuredNode | null | undefined) => {
    if (!node) return
    ids.add(node.id)
    if (node.kind !== 'scalar') for (const item of node.items) { ids.add(item.id); visit(item.node) }
  }
  if (payload.slot) { ids.add(payload.slot.id); visit(payload.slot.node) } else visit(payload.node)
  return ids
}
export function sourcePayload(model: StructuredModel, source: DragSource): Payload | null {
  if (source.type === 'palette') return source.payload
  if (source.type === 'slot') { const item = findSlot(model, source.id); return item ? { slot: item } : null }
  if (source.type === 'node') { const node = findNode(model, source.id); return node ? { node } : null }
  const loose = model.loose.find((item) => item.id === source.id)
  return loose?.slot ? { slot: loose.slot } : loose?.node ? { node: loose.node } : null
}
function detach(model: StructuredModel, source: Exclude<DragSource, { type: 'palette' }>): Payload | null {
  if (source.type === 'loose') {
    const index = model.loose.findIndex((item) => item.id === source.id)
    if (index < 0) return null
    const [loose] = model.loose.splice(index, 1)
    return loose.slot ? { slot: loose.slot } : loose.node ? { node: loose.node } : null
  }
  const visit = (node: StructuredNode | null | undefined): Payload | null => {
    if (!node || node.kind === 'scalar') return null
    for (let i = 0; i < node.items.length; i++) {
      const item = node.items[i]
      if (source.type === 'slot' && item.id === source.id) return { slot: node.items.splice(i, 1)[0] }
      if (source.type === 'node' && item.node?.id === source.id) { const child = item.node; item.node = null; return { node: child } }
      const nested = visit(item.node)
      if (nested) return nested
    }
    return null
  }
  const rootResult = visit(model.root)
  if (rootResult) return rootResult
  for (let i = 0; i < model.loose.length; i++) {
    const loose = model.loose[i]
    if (source.type === 'slot' && loose.slot?.id === source.id) { model.loose.splice(i, 1); return { slot: loose.slot } }
    if (source.type === 'node' && loose.node?.id === source.id) { model.loose.splice(i, 1); return { node: loose.node } }
    if (source.type === 'node' && loose.slot?.node?.id === source.id) { const node = loose.slot.node; loose.slot.node = null; return { node } }
    const nested = visit(loose.node ?? loose.slot?.node)
    if (nested) return nested
  }
  return null
}
export function applyDrop(model: StructuredModel, source: DragSource, target: DropTarget): StructuredModel | null {
  const payload = sourcePayload(model, source)
  if (!payload || (source.type === 'node' && source.id === model.root?.id)) return null
  if (target.type !== 'canvas' && payloadIds(payload).has(target.id)) return null
  if (target.type === 'socket' && !payload.node) return null
  const next = structuredClone(model)
  if (source.type === 'loose' && target.type === 'canvas') {
    const item = next.loose.find((block) => block.id === source.id)
    if (!item || (item.x === target.x && item.y === target.y)) return null
    item.x = target.x; item.y = target.y
    return next
  }
  let adjusted = target.type === 'insert' ? target.index : 0
  if (source.type === 'slot' && target.type === 'insert') {
    const parent = findNode(next, target.id)
    if (parent && parent.kind !== 'scalar') {
      const index = parent.items.findIndex((item) => item.id === source.id)
      if (index >= 0 && index < adjusted) adjusted--
      if (index >= 0 && index === adjusted) return null
    }
  }
  const moved = source.type === 'palette' ? structuredClone(source.payload) : detach(next, source)
  if (!moved) return null
  if (target.type === 'canvas') {
    next.loose.push({ id: newId(), x: target.x, y: target.y, ...moved } as LooseBlock)
    return next
  }
  if (target.type === 'socket') {
    const targetSlot = findSlot(next, target.id)
    if (!targetSlot || targetSlot.node || !moved.node) return null
    targetSlot.node = moved.node
    return next
  }
  const parent = findNode(next, target.id)
  if (!parent || parent.kind === 'scalar') return null
  const inserted = moved.slot ?? slot(parent.kind === 'object' ? uniqueKey(parent) : null, moved.node ?? container('object'))
  if (parent.kind === 'array') { inserted.key = null; inserted.nameMissing = false }
  else if (inserted.key === null) { inserted.key = uniqueKey(parent); inserted.nameMissing = false }
  parent.items.splice(Math.max(0, Math.min(parent.items.length, adjusted)), 0, inserted)
  return next
}
export function removeSelection(model: StructuredModel, type: 'node' | 'slot' | 'loose', id: string): StructuredModel | null {
  if (id === model.root?.id) return null
  const next = structuredClone(model)
  return detach(next, { type, id }) ? next : null
}
