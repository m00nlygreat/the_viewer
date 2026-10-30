import { Plus, Trash2 } from 'lucide-react'
import type { MouseEvent, ReactNode } from 'react'

interface HeaderEditor {
  value: string
  className?: string
  label: string
  onChange: (value: string) => void
  onCommit: () => void
  onCancel: () => void
}

interface Props {
  className: string
  leadingContent?: ReactNode
  beforeActions?: ReactNode
  afterAddColumn?: ReactNode
  trailingContent?: ReactNode
  headerEditor?: HeaderEditor
  iconSize?: number
  preserveFocus?: boolean
  addRowDisabled?: boolean
  addColumnDisabled?: boolean
  removeRowDisabled?: boolean
  removeColumnDisabled?: boolean
  addColumnLabel?: string
  onAddRow: () => void
  onAddColumn: () => void
  onRemoveRow: () => void
  onRemoveColumn: () => void
  doneLabel?: string
  doneIcon?: ReactNode
  onDone?: () => void
}

export function GridStructureToolbar({
  className, leadingContent, beforeActions, afterAddColumn, trailingContent, headerEditor,
  iconSize = 14, preserveFocus = false, addRowDisabled = false, addColumnDisabled = false,
  removeRowDisabled = false, removeColumnDisabled = false, addColumnLabel = '열 추가',
  onAddRow, onAddColumn, onRemoveRow, onRemoveColumn, doneLabel, doneIcon, onDone
}: Props) {
  const keepFocus = preserveFocus ? (event: MouseEvent<HTMLButtonElement>) => event.preventDefault() : undefined
  return <div className={className}>
    {leadingContent}
    {headerEditor && <input
      className={headerEditor.className}
      autoFocus
      aria-label={headerEditor.label}
      value={headerEditor.value}
      onChange={(event) => headerEditor.onChange(event.target.value)}
      onBlur={headerEditor.onCommit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') { event.preventDefault(); (event.target as HTMLInputElement).blur() }
        if (event.key === 'Escape') { event.preventDefault(); headerEditor.onCancel() }
      }}
    />}
    {beforeActions}
    <button type="button" className="toolbar-button" disabled={addRowDisabled} onMouseDown={keepFocus} onClick={onAddRow}><Plus size={iconSize} /> 행 추가</button>
    <button type="button" className="toolbar-button" disabled={addColumnDisabled} onMouseDown={keepFocus} onClick={onAddColumn}><Plus size={iconSize} /> {addColumnLabel}</button>
    {afterAddColumn}
    <button type="button" className="toolbar-button icon-only" disabled={removeRowDisabled} aria-label="선택한 행 삭제" title="선택한 행 삭제" onMouseDown={keepFocus} onClick={onRemoveRow}><Trash2 size={iconSize} /></button>
    <button type="button" className="toolbar-button icon-only" disabled={removeColumnDisabled} aria-label="선택한 열 삭제" title="선택한 열 삭제" onMouseDown={keepFocus} onClick={onRemoveColumn}><Trash2 size={iconSize} /></button>
    {trailingContent}
    {onDone && <button type="button" className="toolbar-button" onMouseDown={keepFocus} onClick={onDone}>{doneIcon}{doneLabel}</button>}
  </div>
}
