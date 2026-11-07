import type { StructuredModel } from '../structured/model'
import type { DragSource, DropTarget } from '../structured/operations'

export interface BlockSelection { type: 'node' | 'slot' | 'loose'; id: string }

export interface BlockEditorPolicy {
  canDrop(model: StructuredModel, source: DragSource, target: DropTarget): boolean
  acceptsGraph(model: StructuredModel): boolean
  canDelete?(model: StructuredModel, selection: BlockSelection): boolean
}

export const structuredBlockPolicy: BlockEditorPolicy = {
  canDrop: () => true,
  acceptsGraph: () => true
}
