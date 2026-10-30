import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import { Columns3, Search } from 'lucide-react'
import {
  CompactSelection,
  DataEditor,
  GridCellKind,
  emptyGridSelection,
  type DataEditorProps,
  type EditListItem,
  type GridCell,
  type GridColumn,
  type GridSelection,
  type Item,
} from '@glideapps/glide-data-grid'
import '@glideapps/glide-data-grid/dist/index.css'
import type { CsvModel, ViewerDocument } from '../domain/types'
import { createGridTheme, GRID_BASE_FONT_STYLE, GRID_FONT_FAMILY, GRID_HEADER_FONT_STYLE } from './gridTheme'
import { applyGridCellUpdates } from './gridModel'
import { readCsvEditorState, saveCsvEditorState } from './csvEditorState'
import { GridStructureToolbar } from './GridStructureToolbar'

interface Props { document: ViewerDocument; model: CsvModel; onChange: (model: CsvModel, group?: 'typing' | 'command') => void; theme: 'light' | 'dark' }

const CSV_HEADER_HEIGHT = 34
const CSV_ROW_HEIGHT = 38
const CSV_MIN_COLUMN_WIDTH = 80
const CSV_DEFAULT_COLUMN_WIDTH = 164
const CSV_MAX_COLUMN_WIDTH = 640
const CSV_COLUMN_PADDING = 32
const CSV_FONT_FAMILY = GRID_FONT_FAMILY
const CSV_BASE_FONT_STYLE = GRID_BASE_FONT_STYLE
const CSV_HEADER_FONT_STYLE = GRID_HEADER_FONT_STYLE
const CSV_CELL_FONT = `${CSV_BASE_FONT_STYLE} ${CSV_FONT_FAMILY}`
const CSV_HEADER_FONT = `${CSV_HEADER_FONT_STYLE} ${CSV_FONT_FAMILY}`

function approximateTextWidth(text: string): number {
  return Array.from(text).reduce((width, character) => width + ((character.codePointAt(0) ?? 0) > 0x2e7f ? 13 : 7), 0)
}

function columnTitle(headers: readonly string[], column: number): string { return headers[column] || `열 ${column + 1}` }

function autoFitColumnWidths(headers: readonly string[], rows: readonly (readonly string[])[], columnsCount: number, sort: { column: number; direction: 1 | -1 } | null): number[] {
  const canvas = typeof document === 'undefined' ? null : document.createElement('canvas')
  const context = canvas?.getContext('2d') ?? null
  const widths = Array.from({ length: columnsCount }, () => CSV_MIN_COLUMN_WIDTH)
  if (!context) {
    for (let column = 0; column < columnsCount; column++) {
      let contentWidth = approximateTextWidth(columnTitle(headers, column))
      for (const row of rows) {
        contentWidth = Math.max(contentWidth, approximateTextWidth(row[column] ?? ''))
        if (contentWidth + CSV_COLUMN_PADDING >= CSV_MAX_COLUMN_WIDTH) break
      }
      widths[column] = Math.min(CSV_MAX_COLUMN_WIDTH, Math.max(CSV_MIN_COLUMN_WIDTH, Math.ceil(contentWidth + CSV_COLUMN_PADDING)))
    }
    return widths
  }

  for (let column = 0; column < columnsCount; column++) {
    const title = columnTitle(headers, column)
    const header = sort?.column === column ? `${title} ${sort.direction === 1 ? '▲' : '▼'}` : title
    context.font = CSV_HEADER_FONT
    let contentWidth = context.measureText(header).width
    context.font = CSV_CELL_FONT
    for (const row of rows) {
      const value = row[column] ?? ''
      if (value) contentWidth = Math.max(contentWidth, context.measureText(value).width)
      if (contentWidth + CSV_COLUMN_PADDING >= CSV_MAX_COLUMN_WIDTH) break
    }
    widths[column] = Math.min(CSV_MAX_COLUMN_WIDTH, Math.max(CSV_MIN_COLUMN_WIDTH, Math.ceil(contentWidth + CSV_COLUMN_PADDING)))
  }
  return widths
}

// Glide 6.0.4 alpha exposes fillHandle at runtime before including it in its public prop types.
const SpreadsheetGrid = DataEditor as unknown as ComponentType<DataEditorProps & { fillHandle?: boolean }>

export function CsvEditor({ document, model, onChange, theme }: Props) {
  const saved = readCsvEditorState(document.id)
  const [query, setQuery] = useState(() => saved?.query ?? '')
  const [sort, setSort] = useState<{ column: number; direction: 1 | -1 } | null>(() => saved?.sort ?? null)
  const [gridSelection, setGridSelection] = useState<GridSelection>(() => saved?.gridSelection ?? emptyGridSelection)
  const [editingHeader, setEditingHeader] = useState<number | null>(() => saved?.editingHeader ?? null)
  const [headerDraft, setHeaderDraft] = useState(() => saved?.headerDraft ?? '')
  const canEdit = document.parseState === 'ready' && document.modelRevision === document.revision
  const rows = model.rows
  const columnsCount = rows.reduce((count, row) => Math.max(count, row.length), Math.max(model.headers.length, 1))
  const [columnWidths, setColumnWidths] = useState<number[]>(() => saved?.columnWidths ?? autoFitColumnWidths(model.headers, rows, columnsCount, null))
  const savedView = useRef({ query, sort, gridSelection, columnWidths, editingHeader, headerDraft })
  savedView.current = { query, sort, gridSelection, columnWidths, editingHeader, headerDraft }
  useEffect(() => () => saveCsvEditorState(document.id, savedView.current), [document.id])
  const visible = useMemo(() => {
    const filtered = rows.map((row, index) => ({ row, index })).filter(({ row }) => !query || row.some((value) => value.toLocaleLowerCase().includes(query.toLocaleLowerCase())))
    if (sort) filtered.sort((a, b) => (a.row[sort.column] ?? '').localeCompare(b.row[sort.column] ?? '', undefined, { numeric: true, sensitivity: 'base' }) * sort.direction)
    return filtered
  }, [rows, query, sort])
  const activeCell = gridSelection.current?.cell ?? [0, 0]
  const activeColumn = Math.max(0, Math.min(columnsCount - 1, activeCell[0]))
  const activeRow = Math.max(0, Math.min(Math.max(visible.length - 1, 0), activeCell[1]))
  const activeSourceRow = visible[activeRow]?.index ?? activeRow
  const selectedRange = gridSelection.current?.range

  const gridColumns = useMemo<GridColumn[]>(() => Array.from({ length: columnsCount }, (_, column) => {
    const title = columnTitle(model.headers, column)
    const sortedTitle = sort?.column === column ? `${title} ${sort.direction === 1 ? '▲' : '▼'}` : title
    return { title: sortedTitle, width: columnWidths[column] ?? CSV_DEFAULT_COLUMN_WIDTH }
  }), [columnWidths, columnsCount, model.headers, sort])

  const gridTheme = useMemo(() => createGridTheme(theme, {
      fontFamily: CSV_FONT_FAMILY,
      headerFontStyle: CSV_HEADER_FONT_STYLE,
      baseFontStyle: CSV_BASE_FONT_STYLE,
      markerFontStyle: "11px 'Geist Mono Variable', 'Noto Sans Mono', monospace",
      editorFontSize: '13px',
    }), [theme])

  const getCellContent = useCallback(([column, row]: Item): GridCell => {
    const value = visible[row]?.row[column] ?? ''
    return { kind: GridCellKind.Text, data: value, displayData: value, readonly: !canEdit, allowOverlay: canEdit }
  }, [canEdit, visible])

  const applyTextEdits = useCallback((edits: readonly { location: Item; value: string }[], group: 'typing' | 'command' = 'typing') => {
    if (edits.length === 0) return
    const updates: Array<{ row: number; column: number; value: string }> = []
    for (const { location: [column, viewRow], value } of edits) {
      const sourceRow = visible[viewRow]?.index
      if (sourceRow === undefined || column < 0 || column >= columnsCount) continue
      updates.push({ row: sourceRow, column, value })
    }
    const nextRows = applyGridCellUpdates(rows, updates)
    if (nextRows !== rows && canEdit) onChange({ ...model, rows: nextRows }, group)
  }, [canEdit, columnsCount, model, onChange, rows, visible])

  const applyGridEdits = useCallback((edits: readonly EditListItem[]) => {
    applyTextEdits(edits.map(({ location, value }) => ({
      location,
      value: value.kind === GridCellKind.Text ? value.data : ('data' in value ? String(value.data ?? '') : ''),
    })), 'typing')
    return true
  }, [applyTextEdits])

  const pasteValues = useCallback((target: Item, values: readonly (readonly string[])[]) => {
    if (!canEdit || values.length === 0) return false
    const [startColumn, startViewRow] = target
    if (startColumn < 0 || startColumn >= columnsCount || startViewRow < 0) return false
    const updates: Array<{ row: number; column: number; value: string }> = []
    let nextNewRow = rows.length
    values.forEach((line, rowOffset) => {
      const viewRow = startViewRow + rowOffset
      const sourceRow = visible[viewRow]?.index ?? nextNewRow++
      line.forEach((value, columnOffset) => updates.push({ row: sourceRow, column: startColumn + columnOffset, value }))
    })
    const next = applyGridCellUpdates(rows, updates, { allowAddRows: true, minColumns: columnsCount, materializeBlankCells: true })
    if (next !== rows) {
      const pastedColumnCount = values.reduce((count, line) => Math.max(count, startColumn + line.length), columnsCount)
      const nextColumnCount = Math.max(columnsCount, pastedColumnCount)
      if (nextColumnCount > columnsCount) setColumnWidths((current) => [...current, ...Array(nextColumnCount - current.length).fill(CSV_DEFAULT_COLUMN_WIDTH)])
      onChange({ ...model, rows: next }, 'command')
    }
    return false
  }, [canEdit, columnsCount, model, onChange, rows, visible])

  const clearSelection = useCallback((selection: GridSelection) => {
    const range = selection.current?.range
    if (range) {
      const edits: { location: Item; value: string }[] = []
      for (let row = range.y; row < range.y + range.height; row++) {
        for (let column = range.x; column < range.x + range.width; column++) edits.push({ location: [column, row], value: '' })
      }
      applyTextEdits(edits, 'command')
    }
    return true
  }, [applyTextEdits])

  useEffect(() => {
    const current = gridSelection.current
    if (!visible.length) {
      if (current) setGridSelection(emptyGridSelection)
      return
    }
    if (sort && sort.column >= columnsCount) setSort(null)
    if (editingHeader !== null && editingHeader >= columnsCount) setEditingHeader(null)
    if (!current) return
    const [column, row] = current.cell
    const range = current.range
    const outside = column < 0 || column >= columnsCount || row < 0 || row >= visible.length || range.x < 0 || range.y < 0 || range.x + range.width > columnsCount || range.y + range.height > visible.length
    if (outside) {
      const nextCell: Item = [Math.max(0, Math.min(columnsCount - 1, column)), Math.max(0, Math.min(visible.length - 1, row))]
      setGridSelection({ current: { cell: nextCell, range: { x: nextCell[0], y: nextCell[1], width: 1, height: 1 }, rangeStack: [] }, columns: CompactSelection.empty(), rows: CompactSelection.empty() })
    }
  }, [columnsCount, editingHeader, gridSelection, sort, visible.length])

  const addRow = () => { if (canEdit) onChange({ ...model, rows: [...rows, Array(columnsCount).fill('')] }) }
  const addColumn = () => {
    if (!canEdit) return
    setColumnWidths((current) => [...current, CSV_DEFAULT_COLUMN_WIDTH])
    onChange({
      ...model,
      headers: [...model.headers, `열 ${model.headers.length + 1}`],
      headerRow: [...model.headerRow, ''],
      rows: rows.map((row) => [...row, '']),
    })
  }
  const removeActiveRow = () => {
    if (!canEdit) return
    const sourceRow = visible[activeRow]?.index
    if (sourceRow !== undefined) onChange({ ...model, rows: rows.filter((_, index) => index !== sourceRow) })
  }
  const removeActiveColumn = () => {
    if (!canEdit) return
    setColumnWidths((current) => current.filter((_, index) => index !== activeColumn))
    onChange({
      ...model,
      headers: model.headers.filter((_, index) => index !== activeColumn),
      headerRow: model.headerRow.filter((_, index) => index !== activeColumn),
      rows: rows.map((row) => row.filter((_, index) => index !== activeColumn)),
    })
  }
  const setHeaderStatus = (checked: boolean) => {
    if (!canEdit || checked === model.hasHeader) return
    if (checked) {
      const headers = model.rows[0] ?? model.headerRow
      onChange({ ...model, headers: [...headers], headerRow: [...headers], rows: model.rows.slice(1), hasHeader: true })
    } else {
      const headerRow = [...model.headers]
      onChange({ ...model, headerRow, rows: [headerRow, ...model.rows], hasHeader: false })
    }
  }
  const sortColumn = (column: number) => setSort((current) => current?.column === column ? { column, direction: current.direction === 1 ? -1 : 1 } : { column, direction: 1 })
  const handleHeaderClick = (column: number, event: Parameters<NonNullable<DataEditorProps['onHeaderClicked']>>[1]) => {
    if (!canEdit) return
    if (event.isDoubleClick && model.hasHeader) {
      setEditingHeader(column)
      setHeaderDraft(model.headers[column] ?? '')
      return
    }
    if (!event.isDoubleClick) sortColumn(column)
  }
  const commitHeader = () => {
    if (!canEdit || editingHeader === null) return
    const headers = [...model.headers]
    headers[editingHeader] = headerDraft
    onChange({ ...model, headers })
    setEditingHeader(null)
  }
  const autoFitColumns = () => setColumnWidths(autoFitColumnWidths(model.headers, rows, columnsCount, sort))
  const resizeColumn = (_column: GridColumn, newSize: number, columnIndex: number) => {
    setColumnWidths((current) => {
      const next = [...current]
      next[columnIndex] = Math.min(CSV_MAX_COLUMN_WIDTH, Math.max(CSV_MIN_COLUMN_WIDTH, newSize))
      return next
    })
  }
  const gridSelectionChanged = (selection: GridSelection) => setGridSelection(selection)
  const selectedRows = selectedRange?.height ?? 1
  const selectedColumns = selectedRange?.width ?? 1

  return (
    <section className="csv-workspace" aria-label={`${document.name} 표`}>
      <GridStructureToolbar
        className="csv-toolbar"
        leadingContent={<label className="search-box"><Search size={14} /><input aria-label="표 검색" placeholder="검색" value={query} onChange={(event) => setQuery(event.target.value)} /></label>}
        headerEditor={editingHeader === null ? undefined : { value: headerDraft, className: 'csv-header-editor', label: '열 이름 변경', onChange: setHeaderDraft, onCommit: commitHeader, onCancel: () => setEditingHeader(null) }}
        beforeActions={<div className="toolbar-separator" />}
        afterAddColumn={<button type="button" className="toolbar-button csv-autofit-button" aria-label="열 너비 자동 맞춤" title="열 너비 자동 맞춤" onClick={autoFitColumns}><Columns3 size={14} /><span>너비 맞춤</span></button>}
        trailingContent={<>
          <div className="toolbar-spacer" />
          <label className="csv-select-label">구분자
          <select aria-label="CSV 구분자" disabled={!canEdit} value={model.delimiter} onChange={(event) => onChange({ ...model, delimiter: event.target.value })}>
            <option value=",">쉼표</option><option value=";">세미콜론</option><option value="\t">탭</option>
          </select>
          </label>
          <label className="csv-toggle"><input type="checkbox" disabled={!canEdit} checked={model.hasHeader} onChange={(event) => setHeaderStatus(event.target.checked)} /> 첫 행 머리글</label>
        </>}
        addRowDisabled={!canEdit}
        addColumnDisabled={!canEdit}
        removeRowDisabled={!canEdit}
        removeColumnDisabled={!canEdit}
        addColumnLabel="열"
        onAddRow={addRow}
        onAddColumn={addColumn}
        onRemoveRow={removeActiveRow}
        onRemoveColumn={removeActiveColumn}
      />
      {model.errors.length > 0 && <div className="inline-warning" role="status">CSV 진단 {model.errors.length}개 · 첫 오류: {model.errors[0]}</div>}
      <div className="csv-grid">
        <SpreadsheetGrid
          className="csv-data-grid"
          columns={gridColumns}
          rows={visible.length}
          getCellContent={getCellContent}
          getCellsForSelection={true}
          gridSelection={gridSelection}
          onGridSelectionChange={gridSelectionChanged}
          onColumnResize={resizeColumn}
          onCellsEdited={applyGridEdits}
          onPaste={pasteValues}
          onDelete={clearSelection}
          onHeaderClicked={handleHeaderClick}
          trailingRowOptions={{ tint: true, hint: '새 행' }}
          onRowAppended={async () => { addRow(); return 'bottom' as const }}
          fillHandle={true}
          rangeSelect="rect"
          rowSelect="none"
          columnSelect="none"
          rowMarkers="number"
          rowHeight={CSV_ROW_HEIGHT}
          headerHeight={CSV_HEADER_HEIGHT}
          minColumnWidth={CSV_MIN_COLUMN_WIDTH}
          maxColumnWidth={CSV_MAX_COLUMN_WIDTH}
          width="100%"
          height="100%"
          theme={gridTheme}
        />
        {visible.length === 0 && query && <div className="csv-empty-overlay">검색 결과가 없습니다.</div>}
      </div>
      <div className="csv-statusbar">
        <span>{visible.length.toLocaleString()} / {rows.length.toLocaleString()}행</span><span>{columnsCount}열</span><span>{model.delimiter === '\t' ? 'TAB' : model.delimiter === ';' ? 'SEMICOLON' : 'CSV'}</span><span>{model.encoding}{model.bom ? ' · BOM' : ''}</span>
        <div className="toolbar-spacer" />
        <span>{columnTitle(model.headers, activeColumn)} · 행 {activeSourceRow + 1}</span>
        {(selectedRows > 1 || selectedColumns > 1) && <span>{selectedRows} × {selectedColumns} 선택</span>}
      </div>
    </section>
  )
}
