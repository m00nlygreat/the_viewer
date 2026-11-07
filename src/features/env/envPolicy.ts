import type { BlockEditorPolicy } from '../../domain/block-editor/policy'
import type { StructuredModel, StructuredNode } from '../../domain/structured/model'
import { sourcePayload, type DragSource, type DropTarget } from '../../domain/structured/operations'

function isStringNode(node: StructuredNode | null | undefined): boolean {
  return !node || (node.kind === 'scalar' && node.dataType === 'string')
}

function accepts(model: StructuredModel): boolean {
  if (model.unsupported !== undefined || !model.root || model.root.kind !== 'object') return false
  if (model.root.items.some((item) => (item.key !== null && typeof item.key !== 'string') || !isStringNode(item.node))) return false
  return model.loose.every((block) => {
    if (Boolean(block.node) === Boolean(block.slot)) return false
    if (block.node) return isStringNode(block.node)
    return Boolean(block.slot && (block.slot.key === null || typeof block.slot.key === 'string') && isStringNode(block.slot.node))
  })
}

function canDrop(model: StructuredModel, source: DragSource, target: DropTarget): boolean {
  const payload = sourcePayload(model, source)
  if (!payload) return false
  if (payload.node && !isStringNode(payload.node)) return false
  if (payload.slot && !isStringNode(payload.slot.node)) return false
  if (target.type === 'socket' && payload.slot) return false
  if (target.type === 'insert' && (model.root?.kind !== 'object' || target.id !== model.root.id)) return false
  return true
}

export const envPolicy: BlockEditorPolicy = { canDrop, acceptsGraph: accepts, canDelete: () => true }
