import { applyDrop, removeSelection, type DragSource, type DropTarget } from '../structured/operations'
import type { StructuredModel } from '../structured/model'
import type { BlockEditorPolicy, BlockSelection } from './policy'

export function applyBlockDrop(model: StructuredModel, source: DragSource, target: DropTarget, policy: BlockEditorPolicy): StructuredModel | null {
  if (!policy.canDrop(model, source, target)) return null
  const changed = applyDrop(model, source, target)
  return changed && policy.acceptsGraph(changed) ? changed : null
}

export function removeBlockSelection(model: StructuredModel, selection: BlockSelection, policy: BlockEditorPolicy): StructuredModel | null {
  if (policy.canDelete && !policy.canDelete(model, selection)) return null
  const changed = removeSelection(model, selection.type, selection.id)
  return changed && policy.acceptsGraph(changed) ? changed : null
}
