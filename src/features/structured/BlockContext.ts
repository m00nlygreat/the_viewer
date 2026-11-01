import { createContext, useContext, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import type { DragSource, DropTarget, Payload } from '../../domain/structured/operations'
import type { StructuredModel } from '../../domain/structured/model'

export type Selection = { type: 'node' | 'slot' | 'loose'; id: string }
export interface BlockContextValue {
  model: StructuredModel
  selected: Selection | null
  editing: Selection | null
  collapsed: Set<string>
  expanded: Set<string>
  hover: DropTarget | null
  draggingIds: Set<string>
  readonly: boolean
  focusedNodeId: string | null
  startDrag: (event: ReactPointerEvent<HTMLElement>, source: DragSource, select: Selection | null) => void
  startPaletteKey: (event: ReactKeyboardEvent<HTMLElement>, payload: Payload) => void
  select: (selection: Selection | null) => void
  edit: (selection: Selection | null) => void
  mutate: (update: (model: StructuredModel) => void, group?: 'typing' | 'command') => void
  toggleCollapsed: (id: string) => void
  toggleExpanded: (id: string) => void
  focusNode: (id: string, path: string[], depth: number) => void
}
export const BlockContext = createContext<BlockContextValue | null>(null)
export function useBlocks() {
  const context = useContext(BlockContext)
  if (!context) throw new Error('블록 편집기 컨텍스트가 없습니다.')
  return context
}
