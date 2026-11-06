import type { MouseEvent, ReactNode } from 'react'

function AxisActionIcon({ axis, action, size }: { axis: 'row' | 'column'; action: 'add' | 'remove'; size: number }) {
  const isRow = axis === 'row'
  const isRemove = action === 'remove'
  return <svg width={size + 6} height={size + 6} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="2" y="2" width="15" height="15" rx="1.5" fill="var(--panel)" />
    {isRow
      ? <rect x="2.5" y="7.1" width="14" height="4.8" fill="currentColor" />
      : <rect x="7.1" y="2.5" width="4.8" height="14" fill="currentColor" />}
    <rect x="2" y="2" width="15" height="15" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
    {isRow
      ? <path d="M2 7h15M2 12h15" stroke="currentColor" strokeWidth="1.5" />
      : <path d="M7 2v15M12 2v15" stroke="currentColor" strokeWidth="1.5" />}
    {isRemove
      ? <path d="M14 18h8" stroke="#DC2626" strokeWidth="3.2" strokeLinecap="round" />
      : <path d="M18 14v8M14 18h8" stroke="#16A34A" strokeWidth="3.2" strokeLinecap="round" />}
  </svg>
}

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
  afterRemoveColumn?: ReactNode
  trailingContent?: ReactNode
  headerEditor?: HeaderEditor
  iconSize?: number
  preserveFocus?: boolean
  addRowDisabled?: boolean
  addColumnDisabled?: boolean
  removeRowDisabled?: boolean
  removeColumnDisabled?: boolean
  onAddRow: () => void
  onAddColumn: () => void
  onRemoveRow: () => void
  onRemoveColumn: () => void
  doneLabel?: string
  doneIcon?: ReactNode
  onDone?: () => void
}

export function GridStructureToolbar({
  className, leadingContent, beforeActions, afterRemoveColumn, trailingContent, headerEditor,
  iconSize = 18, preserveFocus = false, addRowDisabled = false, addColumnDisabled = false,
  removeRowDisabled = false, removeColumnDisabled = false,
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
    <button type="button" className="toolbar-button icon-only" disabled={addRowDisabled} aria-label="행 추가" title="행 추가" onMouseDown={keepFocus} onClick={onAddRow}><AxisActionIcon axis="row" action="add" size={iconSize} /></button>
    <button type="button" className="toolbar-button icon-only" disabled={addColumnDisabled} aria-label="열 추가" title="열 추가" onMouseDown={keepFocus} onClick={onAddColumn}><AxisActionIcon axis="column" action="add" size={iconSize} /></button>
    <button type="button" className="toolbar-button icon-only" disabled={removeRowDisabled} aria-label="선택한 행 삭제" title="선택한 행 삭제" onMouseDown={keepFocus} onClick={onRemoveRow}><AxisActionIcon axis="row" action="remove" size={iconSize} /></button>
    <button type="button" className="toolbar-button icon-only" disabled={removeColumnDisabled} aria-label="선택한 열 삭제" title="선택한 열 삭제" onMouseDown={keepFocus} onClick={onRemoveColumn}><AxisActionIcon axis="column" action="remove" size={iconSize} /></button>
    {afterRemoveColumn}
    {trailingContent}
    {onDone && <button type="button" className="toolbar-button" onMouseDown={keepFocus} onClick={onDone}>{doneIcon}{doneLabel}</button>}
  </div>
}
