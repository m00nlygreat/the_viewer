import { useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown, ArrowUp, Plus, Search, Trash2 } from 'lucide-react'
import Papa from 'papaparse'
import type { CsvModel, ViewerDocument } from '../domain/types'

interface Props { document: ViewerDocument; model: CsvModel; onChange: (model: CsvModel) => void }

const CSV_HEADER_HEIGHT = 34

export function CsvEditor({ document, model, onChange }: Props) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<{ column: number; direction: 1 | -1 } | null>(null)
  const [active, setActive] = useState<[number, number]>([0, 0])
  const [editing, setEditing] = useState<[number, number] | null>(null)
  const [editValue, setEditValue] = useState('')
  const [editingHeader, setEditingHeader] = useState<number | null>(null)
  const discardEdit = useRef(false)
  const restoreCellFocus = useRef(false)
  const scroll = useRef<HTMLDivElement>(null)
  const rows = model.rows
  const visible = useMemo(() => {
    const filtered = rows.map((row, index) => ({ row, index })).filter(({ row }) => !query || row.some((value) => value.toLocaleLowerCase().includes(query.toLocaleLowerCase())))
    if (sort) filtered.sort((a, b) => a.row[sort.column]?.localeCompare(b.row[sort.column] ?? '', undefined, { numeric: true, sensitivity: 'base' }) * sort.direction)
    return filtered
  }, [rows, query, sort])
  const virtualizer = useVirtualizer({ count: visible.length, getScrollElement: () => scroll.current, estimateSize: () => 38, overscan: 10, scrollMargin: CSV_HEADER_HEIGHT, scrollPaddingStart: CSV_HEADER_HEIGHT })
  const dirty = document.isDirty
  const columns = Math.max(model.headers.length, ...rows.map((row) => row.length), 1)
  const template = `repeat(${columns}, minmax(132px, 1fr))`
  const focusCell = (column: number, visibleIndex: number) => {
    const row = visible[visibleIndex]
    if (!row) return
    setActive([row.index, Math.max(0, Math.min(columns - 1, column))])
    virtualizer.scrollToIndex(visibleIndex)
    requestAnimationFrame(() => globalThis.document.getElementById(`csv-cell-${row.index}-${Math.max(0, Math.min(columns - 1, column))}`)?.focus())
  }
  const moveCell = (rowIndex: number, column: number, rowDelta: number, columnDelta: number, wrap: boolean) => {
    if (!visible.length) return
    const currentIndex = Math.max(0, visible.findIndex((item) => item.index === rowIndex))
    let nextIndex = currentIndex + rowDelta
    let nextColumn = column + columnDelta
    if (wrap && nextColumn >= columns) { nextIndex += Math.floor(nextColumn / columns); nextColumn %= columns }
    if (wrap && nextColumn < 0) { nextIndex += Math.floor(nextColumn / columns); nextColumn = (nextColumn % columns + columns) % columns }
    nextIndex = Math.max(0, Math.min(visible.length - 1, nextIndex))
    focusCell(nextColumn, nextIndex)
  }
  const commit = (rowIndex: number, column: number, value: string) => {
    const next = rows.map((row) => [...row])
    while (next[rowIndex].length <= column) next[rowIndex].push('')
    next[rowIndex][column] = value
    onChange({ ...model, rows: next })
    setEditing(null)
  }
  const beginEdit = (rowIndex: number, column: number, value: string) => { discardEdit.current = false; setEditValue(value); setEditing([rowIndex, column]) }
  const finishEdit = (rowIndex: number, column: number) => {
    if (discardEdit.current) { discardEdit.current = false; setEditing(null); return }
    if (editing?.[0] === rowIndex && editing[1] === column) commit(rowIndex, column, editValue)
  }
  const addRow = () => onChange({ ...model, rows: [...rows, Array(columns).fill('')] })
  const addColumn = () => onChange({ ...model, headers: [...model.headers, `열 ${model.headers.length + 1}`], rows: rows.map((row) => [...row, '']) })
  const removeActiveRow = () => onChange({ ...model, rows: rows.filter((_, index) => index !== active[0]) })
  const removeActiveColumn = () => onChange({ ...model, headers: model.headers.filter((_, index) => index !== active[1]), rows: rows.map((row) => row.filter((_, index) => index !== active[1])) })
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
  const pasteCells = (event: React.ClipboardEvent) => {
    const content = event.clipboardData.getData('text/plain')
    if (!content.includes('\t') && !content.includes('\n')) return
    event.preventDefault()
    const parsed = Papa.parse<string[]>(content, { delimiter: '\t', skipEmptyLines: true }).data
    const next = rows.map((row) => [...row])
    parsed.forEach((line, rowOffset) => line.forEach((value, columnOffset) => {
      const rowIndex = active[0] + rowOffset
      while (next.length <= rowIndex) next.push(Array(columns).fill(''))
      while (next[rowIndex].length <= active[1] + columnOffset) next[rowIndex].push('')
      next[rowIndex][active[1] + columnOffset] = value
    }))
    onChange({ ...model, rows: next })
  }

  return (
    <section className="csv-workspace" aria-label={`${document.name} 표`}>
      <div className="csv-toolbar">
        <label className="search-box"><Search size={14} /><input aria-label="표 검색" placeholder="검색" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
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
      <div className="csv-grid" ref={scroll} role="grid" aria-rowcount={visible.length + 1} aria-colcount={columns}>
        <div className="csv-head" role="row" style={{ gridTemplateColumns: template }}>
          {Array.from({ length: columns }, (_, column) => {
            const title = model.headers[column] || `열 ${column + 1}`
            return <div className="csv-heading" role="columnheader" key={column}>
              {model.hasHeader && editingHeader === column ? <input autoFocus aria-label={`${title} 머리글 이름`} value={model.headers[column] ?? ''} onChange={(event) => { const headers = [...model.headers]; headers[column] = event.target.value; onChange({ ...model, headers }) }} onBlur={() => setEditingHeader(null)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === 'Escape') setEditingHeader(null) }} /> : <button onDoubleClick={() => { if (model.hasHeader) setEditingHeader(column) }} onClick={() => setSort(sort?.column === column ? { column, direction: sort.direction === 1 ? -1 : 1 } : { column, direction: 1 })}><span>{title}</span>{sort?.column === column && (sort.direction === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}</button>}
            </div>
          })}
        </div>
        <div className="csv-rows" role="rowgroup" onPaste={pasteCells}>
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const item = visible[virtualRow.index]
              return <div className="csv-row" role="row" key={`${item.index}-${virtualRow.key}`} style={{ gridTemplateColumns: template, transform: `translateY(${virtualRow.start - CSV_HEADER_HEIGHT}px)` }}>
                {Array.from({ length: columns }, (_, column) => {
                  const isActive = active[0] === item.index && active[1] === column
                  const isEditing = editing?.[0] === item.index && editing[1] === column
                  return <div id={`csv-cell-${item.index}-${column}`} role="gridcell" tabIndex={isActive ? 0 : -1} aria-selected={isActive} className={`csv-cell${isActive ? ' active' : ''}${dirty && isActive ? ' changed' : ''}`} key={column}
                    onFocus={() => setActive([item.index, column])} onClick={() => setActive([item.index, column])} onDoubleClick={() => { setActive([item.index, column]); beginEdit(item.index, column, item.row[column] ?? '') }}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) return
                      if (event.key === 'Enter' || event.key === 'F2') { event.preventDefault(); beginEdit(item.index, column, item.row[column] ?? '') }
                      if (event.key === 'Tab') { event.preventDefault(); moveCell(item.index, column, 0, event.shiftKey ? -1 : 1, true) }
                      else if (event.key === 'ArrowRight') { event.preventDefault(); moveCell(item.index, column, 0, 1, false) }
                      else if (event.key === 'ArrowLeft') { event.preventDefault(); moveCell(item.index, column, 0, -1, false) }
                      else if (event.key === 'ArrowDown') { event.preventDefault(); moveCell(item.index, column, 1, 0, false) }
                      else if (event.key === 'ArrowUp') { event.preventDefault(); moveCell(item.index, column, -1, 0, false) }
                    }}>
                    {isEditing ? <input autoFocus aria-label={`${titleFor(model, column)} 편집`} value={editValue} onChange={(event) => setEditValue(event.target.value)} onBlur={() => { finishEdit(item.index, column); if (restoreCellFocus.current) { restoreCellFocus.current = false; requestAnimationFrame(() => globalThis.document.getElementById(`csv-cell-${item.index}-${column}`)?.focus()) } }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); restoreCellFocus.current = true; (event.target as HTMLInputElement).blur() } if (event.key === 'Escape') { discardEdit.current = true; restoreCellFocus.current = true; (event.target as HTMLInputElement).blur() } }} /> : <span>{item.row[column] ?? ''}</span>}
                  </div>
                })}
              </div>
            })}
            {visible.length === 0 && <div className="csv-empty">검색 결과가 없습니다.</div>}
          </div>
        </div>
      </div>
      <div className="csv-statusbar">
        <span>{visible.length.toLocaleString()} / {rows.length.toLocaleString()}행</span><span>{columns}열</span><span>{model.delimiter === '\t' ? 'TAB' : model.delimiter === ';' ? 'SEMICOLON' : 'CSV'}</span><span>{model.encoding}{model.bom ? ' · BOM' : ''}</span>
        <div className="toolbar-spacer" /><span>{model.headers[active[1]] || `열 ${active[1] + 1}`} · 행 {active[0] + 1}</span>
      </div>
    </section>
  )
}

function titleFor(model: CsvModel, column: number): string { return model.headers[column] || `열 ${column + 1}` }
