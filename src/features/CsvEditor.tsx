import { useCallback, useEffect, useMemo, useState, type ComponentType } from 'react'
import { Plus, Search, Trash2 } from 'lucide-react'
import {
  CompactSelection,
  DataEditor,
  GridCellKind,
  emptyGridSelection,
  getDefaultTheme,
  type DataEditorProps,
  type EditListItem,
  type GridCell,
  type GridColumn,
  type GridSelection,
  type Item,
  type Theme as GridTheme,
} from '@glideapps/glide-data-grid'
import '@glideapps/glide-data-grid/dist/index.css'
import type { CsvModel, ViewerDocument } from '../domain/types'

interface Props { document: ViewerDocument; model: CsvModel; onChange: (model: CsvModel) => void; theme: 'light' | 'dark' }

const CSV_HEADER_HEIGHT = 34
const CSV_ROW_HEIGHT = 38

function columnTitle(headers: readonly string[], column: number): string { return headers[column] || `열 ${column + 1}` }

// Glide 6.0.4 alpha exposes fillHandle at runtime before including it in its public prop types.
const SpreadsheetGrid = DataEditor as unknown as ComponentType<DataEditorProps & { fillHandle?: boolean }>

export function CsvEditor({ document, model, onChange, theme }: Props) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<{ column: number; direction: 1 | -1 } | null>(null)
  const [gridSelection, setGridSelection] = useState<GridSelection>(emptyGridSelection)
  const [editingHeader, setEditingHeader] = useState<number | null>(null)
  const [headerDraft, setHeaderDraft] = useState('')
  const rows = model.rows
  const visible = useMemo(() => {
    const filtered = rows.map((row, index) => ({ row, index })).filter(({ row }) => !query || row.some((value) => value.toLocaleLowerCase().includes(query.toLocaleLowerCase())))
    if (sort) filtered.sort((a, b) => (a.row[sort.column] ?? '').localeCompare(b.row[sort.column] ?? '', undefined, { numeric: true, sensitivity: 'base' }) * sort.direction)
    return filtered
  }, [rows, query, sort])
  const columnsCount = Math.max(model.headers.length, ...rows.map((row) => row.length), 1)
  const activeCell = gridSelection.current?.cell ?? [0, 0]
  const activeColumn = Math.max(0, Math.min(columnsCount - 1, activeCell[0]))
  const activeRow = Math.max(0, Math.min(Math.max(visible.length - 1, 0), activeCell[1]))
  const activeSourceRow = visible[activeRow]?.index ?? activeRow
  const selectedRange = gridSelection.current?.range

  const gridColumns = useMemo<GridColumn[]>(() => Array.from({ length: columnsCount }, (_, column) => {
    const title = columnTitle(model.headers, column)
    const sortedTitle = sort?.column === column ? `${title} ${sort.direction === 1 ? '▲' : '▼'}` : title
    return { title: sortedTitle, width: 164, grow: 1 }
  }), [columnsCount, model.headers, sort])

  const gridTheme = useMemo<GridTheme>(() => {
    const light = theme === 'light'
    return {
      ...getDefaultTheme(),
      accentColor: light ? '#4A52C4' : '#A4AAF7',
      accentLight: light ? 'rgba(74, 82, 196, 0.16)' : 'rgba(164, 170, 247, 0.20)',
      accentFg: light ? '#FCFCFD' : '#0B0B0C',
      textDark: light ? '#1C1D21' : '#E6E6E8',
      textMedium: light ? '#3D3E44' : '#C9CACE',
      textLight: light ? '#62636A' : '#8A8B91',
      textBubble: light ? '#1C1D21' : '#E6E6E8',
      bgIconHeader: light ? '#F4F4F6' : '#0E0E10',
      fgIconHeader: light ? '#62636A' : '#8A8B91',
      textHeader: light ? '#62636A' : '#8A8B91',
      textHeaderSelected: light ? '#1C1D21' : '#F2F2F3',
      bgCell: light ? '#FCFCFD' : '#0B0B0C',
      bgCellMedium: light ? '#F4F4F6' : '#0E0E10',
      bgHeader: light ? '#F4F4F6' : '#0E0E10',
      bgHeaderHasFocus: light ? '#E6E6EB' : '#1D1E21',
      bgHeaderHovered: light ? '#E6E6EB' : '#1D1E21',
      bgBubble: light ? '#E6E6EB' : '#1D1E21',
      bgBubbleSelected: light ? '#D9DBF7' : '#353859',
      bgSearchResult: light ? '#D9DBF7' : '#353859',
      borderColor: light ? '#E4E4E8' : '#1E1F22',
      horizontalBorderColor: light ? '#EEEEF1' : '#17181B',
      headerBottomBorderColor: light ? '#E4E4E8' : '#1E1F22',
      drilldownBorder: light ? '#4A52C4' : '#5B63D3',
      linkColor: light ? '#4A52C4' : '#A4AAF7',
      fontFamily: "'Geist Variable', 'Noto Sans KR Variable', sans-serif",
      headerFontStyle: "500 12px 'Geist Variable', 'Noto Sans KR Variable', sans-serif",
      baseFontStyle: "13px 'Geist Variable', 'Noto Sans KR Variable', sans-serif",
      markerFontStyle: "11px 'Geist Mono Variable', 'Noto Sans Mono', monospace",
      editorFontSize: '13px',
    }
  }, [theme])

  const getCellContent = useCallback(([column, row]: Item): GridCell => {
    const value = visible[row]?.row[column] ?? ''
    return { kind: GridCellKind.Text, data: value, displayData: value, allowOverlay: true }
  }, [visible])

  const applyTextEdits = useCallback((edits: readonly { location: Item; value: string }[]) => {
    if (edits.length === 0) return
    const next = [...rows]
    const changedRows = new Map<number, string[]>()
    let changed = false
    for (const { location: [column, viewRow], value } of edits) {
      const sourceRow = visible[viewRow]?.index
      if (sourceRow === undefined || column < 0 || column >= columnsCount) continue
      let nextRow = changedRows.get(sourceRow)
      if (!nextRow) {
        nextRow = [...next[sourceRow]]
        changedRows.set(sourceRow, nextRow)
        next[sourceRow] = nextRow
      }
      while (nextRow.length <= column) nextRow.push('')
      if (nextRow[column] !== value) { nextRow[column] = value; changed = true }
    }
    if (changed) onChange({ ...model, rows: next })
  }, [columnsCount, model, onChange, rows, visible])

  const applyGridEdits = useCallback((edits: readonly EditListItem[]) => {
    applyTextEdits(edits.map(({ location, value }) => ({
      location,
      value: value.kind === GridCellKind.Text ? value.data : ('data' in value ? String(value.data ?? '') : ''),
    })))
    return true
  }, [applyTextEdits])

  const pasteValues = useCallback((target: Item, values: readonly (readonly string[])[]) => {
    if (values.length === 0) return false
    const [startColumn, startViewRow] = target
    if (startColumn < 0 || startColumn >= columnsCount || startViewRow < 0) return false
    const next = rows.map((row) => [...row])
    let changed = false
    values.forEach((line, rowOffset) => {
      const viewRow = startViewRow + rowOffset
      let sourceRow = visible[viewRow]?.index
      if (sourceRow === undefined) {
        sourceRow = next.length
        next.push(Array(columnsCount).fill(''))
      }
      while (next[sourceRow].length < startColumn + line.length) next[sourceRow].push('')
      line.forEach((value, columnOffset) => {
        const column = startColumn + columnOffset
        if (next[sourceRow][column] !== value) { next[sourceRow][column] = value; changed = true }
      })
    })
    if (changed) onChange({ ...model, rows: next })
    return false
  }, [columnsCount, model, onChange, rows, visible])

  const clearSelection = useCallback((selection: GridSelection) => {
    const range = selection.current?.range
    if (range) {
      const edits: { location: Item; value: string }[] = []
      for (let row = range.y; row < range.y + range.height; row++) {
        for (let column = range.x; column < range.x + range.width; column++) edits.push({ location: [column, row], value: '' })
      }
      applyTextEdits(edits)
    }
    return true
  }, [applyTextEdits])

  useEffect(() => {
    const cell = gridSelection.current?.cell
    if (visible.length === 0) {
      if (cell) setGridSelection(emptyGridSelection)
      return
    }
    if (!cell || cell[0] >= columnsCount || cell[1] >= visible.length) {
      const nextCell: Item = [0, 0]
      setGridSelection({ current: { cell: nextCell, range: { x: 0, y: 0, width: 1, height: 1 }, rangeStack: [] }, columns: CompactSelection.empty(), rows: CompactSelection.empty() })
    }
  }, [columnsCount, gridSelection, visible.length])

  const addRow = () => onChange({ ...model, rows: [...rows, Array(columnsCount).fill('')] })
  const addColumn = () => onChange({
    ...model,
    headers: [...model.headers, `열 ${model.headers.length + 1}`],
    headerRow: [...model.headerRow, ''],
    rows: rows.map((row) => [...row, '']),
  })
  const removeActiveRow = () => {
    const sourceRow = visible[activeRow]?.index
    if (sourceRow !== undefined) onChange({ ...model, rows: rows.filter((_, index) => index !== sourceRow) })
  }
  const removeActiveColumn = () => onChange({
    ...model,
    headers: model.headers.filter((_, index) => index !== activeColumn),
    headerRow: model.headerRow.filter((_, index) => index !== activeColumn),
    rows: rows.map((row) => row.filter((_, index) => index !== activeColumn)),
  })
  const setHeaderStatus = (checked: boolean) => {
    if (checked === model.hasHeader) return
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
    if (event.isDoubleClick && model.hasHeader) {
      setEditingHeader(column)
      setHeaderDraft(model.headers[column] ?? '')
      return
    }
    if (!event.isDoubleClick) sortColumn(column)
  }
  const commitHeader = () => {
    if (editingHeader === null) return
    const headers = [...model.headers]
    headers[editingHeader] = headerDraft
    onChange({ ...model, headers })
    setEditingHeader(null)
  }
  const gridSelectionChanged = (selection: GridSelection) => setGridSelection(selection)
  const selectedRows = selectedRange?.height ?? 1
  const selectedColumns = selectedRange?.width ?? 1

  return (
    <section className="csv-workspace" aria-label={`${document.name} 표`}>
      <div className="csv-toolbar">
        <label className="search-box"><Search size={14} /><input aria-label="표 검색" placeholder="검색" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        {editingHeader !== null && <input className="csv-header-editor" autoFocus aria-label="열 이름 변경" value={headerDraft} onChange={(event) => setHeaderDraft(event.target.value)} onBlur={commitHeader} onKeyDown={(event) => {
          if (event.key === 'Enter') { event.preventDefault(); (event.target as HTMLInputElement).blur() }
          if (event.key === 'Escape') { event.preventDefault(); setEditingHeader(null) }
        }} />}
        <div className="toolbar-separator" />
        <button className="toolbar-button" onClick={addRow}><Plus size={14} /> 행 추가</button>
        <button className="toolbar-button" onClick={addColumn}><Plus size={14} /> 열</button>
        <button className="toolbar-button icon-only" aria-label="선택한 행 삭제" title="선택한 행 삭제" onClick={removeActiveRow}><Trash2 size={14} /></button>
        <button className="toolbar-button icon-only" aria-label="선택한 열 삭제" title="선택한 열 삭제" onClick={removeActiveColumn}><Trash2 size={14} /></button>
        <div className="toolbar-spacer" />
        <label className="csv-select-label">구분자
          <select aria-label="CSV 구분자" value={model.delimiter} onChange={(event) => onChange({ ...model, delimiter: event.target.value })}>
            <option value=",">쉼표</option><option value=";">세미콜론</option><option value="\t">탭</option>
          </select>
        </label>
        <label className="csv-toggle"><input type="checkbox" checked={model.hasHeader} onChange={(event) => setHeaderStatus(event.target.checked)} /> 첫 행 머리글</label>
      </div>
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
          minColumnWidth={132}
          maxColumnWidth={640}
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
