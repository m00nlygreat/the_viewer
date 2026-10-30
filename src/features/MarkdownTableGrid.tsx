import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentType, type RefAttributes } from 'react'
import { Check, Plus, Trash2 } from 'lucide-react'
import {
  DataEditor,
  GridCellKind,
  emptyGridSelection,
  getDefaultTheme,
  type DataEditorProps,
  type DataEditorRef,
  type EditListItem,
  type GridCell,
  type GridColumn,
  type GridSelection,
  type Item,
  type Theme as GridTheme,
} from '@glideapps/glide-data-grid'
import '@glideapps/glide-data-grid/dist/index.css'
import { renderMarkdown } from '../domain/markdown'
import { useOutsideClick } from '../components/useOutsideClick'
import type { MarkdownTableState } from '../components/markdownTableState'
import type { MarkdownTableModel } from '../domain/formats/markdownTable'

interface Props { table: MarkdownTableState }

const TABLE_ROW_HEIGHT = 36
const TABLE_HEADER_HEIGHT = 34
let nextMarkdownColumnId = 0

function createMarkdownColumnId(): string {
  nextMarkdownColumnId += 1
  return `markdown-column-${nextMarkdownColumnId}`
}

function renderMarkdownTable(source: string): string {
  let marker = 'MARKDOWN_TABLE_BREAK_TOKEN'
  while (source.includes(marker)) marker += '_'
  const markedSource = source.replace(/<br\s*\/?\s*>/giu, marker)
  const template = document.createElement('template')
  template.innerHTML = renderMarkdown(markedSource)

  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT)
  const replacements: Text[] = []
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    if (!node.data.includes(marker)) continue
    if (node.parentElement?.closest('code, pre')) {
      node.data = node.data.replaceAll(marker, '<br>')
      continue
    }
    replacements.push(node)
  }

  for (const node of replacements) {
    const pieces = node.data.split(marker)
    const fragment = document.createDocumentFragment()
    pieces.forEach((piece, index) => {
      if (piece) fragment.append(document.createTextNode(piece))
      if (index < pieces.length - 1) fragment.append(document.createElement('br'))
    })
    node.replaceWith(fragment)
  }

  return template.innerHTML
}

// Glide 6.0.4 alpha exposes fillHandle at runtime before including it in its public prop types.
const SpreadsheetGrid = DataEditor as unknown as ComponentType<DataEditorProps & { fillHandle?: boolean } & RefAttributes<DataEditorRef>>

export function MarkdownTableBlock({ table }: Props) {
  const snapshot = useSyncExternalStore(table.subscribe, table.getSnapshot, table.getSnapshot)
  if (!snapshot.editing) {
    return <RenderedMarkdownTable table={table} />
  }
  return <MarkdownTableEditor table={table} model={snapshot.model} theme={snapshot.theme} />
}

function RenderedMarkdownTable({ table }: Props) {
  const snapshot = useSyncExternalStore(table.subscribe, table.getSnapshot, table.getSnapshot)
  const content = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const rows = content.current?.querySelectorAll('tr')
    rows?.forEach((row) => {
      row.querySelectorAll('th, td').forEach((cell, column) => {
        if (cell instanceof HTMLElement) cell.style.textAlign = snapshot.model.alignments[column] ?? 'left'
      })
    })
  }, [snapshot.model.alignments, snapshot.source])

  return <section className="cm-md-table-preview" onDoubleClick={() => table.setEditing(true)}>
    <div className="cm-md-table-frame">
      <div className="cm-md-table-actions">
        <button type="button" className="toolbar-button" aria-label="표 편집" title="표 편집" onMouseDown={(event) => event.preventDefault()} onClick={() => table.setEditing(true)}>표 편집</button>
      </div>
      <div ref={content} className="cm-md-table-content" dangerouslySetInnerHTML={{ __html: renderMarkdownTable(snapshot.source) }} />
    </div>
  </section>
}

function MarkdownTableEditor({ table, model, theme }: { table: MarkdownTableState; model: MarkdownTableModel; theme: 'light' | 'dark' }) {
  const gridRef = useRef<DataEditorRef>(null)
  const editorRoot = useOutsideClick<HTMLElement>(true, () => table.setEditing(false))
  const [selection, setSelection] = useState<GridSelection>(() => ({
    ...emptyGridSelection,
    current: { cell: [0, 0], range: { x: 0, y: 0, width: 1, height: 1 }, rangeStack: [] }
  }))
  const [editingHeader, setEditingHeader] = useState<number | null>(null)
  const [headerDraft, setHeaderDraft] = useState('')
  const columnCount = Math.max(model.headers.length, ...model.rows.map((row) => row.length), 1)
  const columnIds = useRef<string[]>([])
  while (columnIds.current.length < columnCount) columnIds.current.push(createMarkdownColumnId())
  if (columnIds.current.length > columnCount) columnIds.current = columnIds.current.slice(0, columnCount)
  const activeCell = selection.current?.cell ?? [0, 0]
  const activeColumn = Math.max(0, Math.min(columnCount - 1, activeCell[0]))
  const activeRow = Math.max(0, Math.min(Math.max(model.rows.length - 1, 0), activeCell[1]))
  const selectedRange = selection.current?.range
  const headerKey = JSON.stringify(model.headers)

  const columns = useMemo<GridColumn[]>(() => {
    const headers = JSON.parse(headerKey) as string[]
    return Array.from({ length: columnCount }, (_, column) => ({
      title: headers[column] || `열 ${column + 1}`,
      id: columnIds.current[column]!
    }))
  }, [columnCount, headerKey])

  useLayoutEffect(() => {
    let focusFrame = 0
    let confirmFocusFrame = 0
    focusFrame = window.requestAnimationFrame(() => {
      confirmFocusFrame = window.requestAnimationFrame(() => gridRef.current?.focus())
    })
    return () => {
      window.cancelAnimationFrame(focusFrame)
      window.cancelAnimationFrame(confirmFocusFrame)
    }
  }, [])

  useLayoutEffect(() => {
    const keepEnterInGrid = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.isComposing) return
      const root = editorRoot.current
      const content = root?.closest('.cm-content')
      const target = event.target
      if (!root || !content || !(target instanceof Node) || root.contains(target) || !content.contains(target)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      gridRef.current?.focus()
    }
    document.addEventListener('keydown', keepEnterInGrid, true)
    return () => document.removeEventListener('keydown', keepEnterInGrid, true)
  }, [editorRoot])

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

  const getCellContent = ([column, row]: Item): GridCell => {
    const value = model.rows[row]?.[column] ?? ''
    return { kind: GridCellKind.Text, data: value, displayData: value, allowOverlay: true }
  }

  const saveRows = (rows: string[][], group: 'typing' | 'command' = 'typing') => table.replaceModel({ ...model, rows }, group)

  const applyGridEdits = (edits: readonly EditListItem[]) => {
    if (!edits.length) return true
    const rows = model.rows.map((row) => [...row])
    for (const { location: [column, row], value } of edits) {
      if (row < 0 || column < 0 || column >= columnCount) continue
      while (rows.length <= row) rows.push(Array(columnCount).fill(''))
      while (rows[row]!.length <= column) rows[row]!.push('')
      rows[row]![column] = value.kind === GridCellKind.Text ? value.data : ('data' in value ? String(value.data ?? '') : '')
    }
    saveRows(rows)
    return true
  }

  const pasteValues = (target: Item, values: readonly (readonly string[])[]) => {
    const [startColumn, startRow] = target
    if (startColumn < 0 || startColumn >= columnCount || startRow < 0 || values.length === 0) return false
    const rows = model.rows.map((row) => [...row])
    values.forEach((line, rowOffset) => {
      const rowIndex = startRow + rowOffset
      while (rows.length <= rowIndex) rows.push(Array(columnCount).fill(''))
      while (rows[rowIndex]!.length < startColumn + line.length) rows[rowIndex]!.push('')
      line.forEach((value, columnOffset) => { rows[rowIndex]![startColumn + columnOffset] = value })
    })
    saveRows(rows, 'command')
    return false
  }

  const clearSelection = (nextSelection: GridSelection) => {
    const range = nextSelection.current?.range
    if (range) {
      const rows = model.rows.map((row) => [...row])
      for (let row = range.y; row < range.y + range.height; row += 1) {
        for (let column = range.x; column < range.x + range.width; column += 1) {
          if (rows[row] && column < columnCount) rows[row]![column] = ''
        }
      }
      saveRows(rows, 'command')
    }
    return true
  }

  const addRow = () => saveRows([...model.rows, Array(columnCount).fill('')], 'command')
  const addColumn = () => table.replaceModel({
    ...model,
    headers: [...model.headers, `열 ${columnCount + 1}`],
    alignments: [...model.alignments, null],
    rows: model.rows.map((row) => [...row, ''])
  }, 'command')
  const removeActiveRow = () => {
    if (model.rows.length) saveRows(model.rows.filter((_, index) => index !== activeRow), 'command')
  }
  const removeActiveColumn = () => {
    if (columnCount <= 1) return
    columnIds.current = columnIds.current.filter((_, index) => index !== activeColumn)
    table.replaceModel({
      ...model,
      headers: model.headers.filter((_, index) => index !== activeColumn),
      alignments: model.alignments.filter((_, index) => index !== activeColumn),
      rows: model.rows.map((row) => row.filter((_, index) => index !== activeColumn))
    }, 'command')
  }
  const headerClicked: DataEditorProps['onHeaderClicked'] = (column, event) => {
    if (!event.isDoubleClick) return
    setEditingHeader(column)
    setHeaderDraft(model.headers[column] ?? '')
  }
  const commitHeader = () => {
    if (editingHeader === null) return
    const headers = [...model.headers]
    headers[editingHeader] = headerDraft
    table.replaceModel({ ...model, headers }, 'typing')
    setEditingHeader(null)
  }

  return <section ref={editorRoot} className="cm-md-table-editor" aria-label="Markdown 표 편집기">
    <div className="cm-md-table-editor-toolbar">
      <span>표 편집</span>
      {editingHeader !== null && <input autoFocus aria-label="열 이름 변경" value={headerDraft} onChange={(event) => setHeaderDraft(event.target.value)} onBlur={commitHeader} onKeyDown={(event) => {
        if (event.key === 'Enter') { event.preventDefault(); (event.target as HTMLInputElement).blur() }
        if (event.key === 'Escape') { event.preventDefault(); setEditingHeader(null) }
      }} />}
      <button type="button" className="toolbar-button" onMouseDown={(event) => event.preventDefault()} onClick={addRow}><Plus size={13} /> 행 추가</button>
      <button type="button" className="toolbar-button" onMouseDown={(event) => event.preventDefault()} onClick={addColumn}><Plus size={13} /> 열 추가</button>
      <button type="button" className="toolbar-button icon-only" aria-label="선택한 행 삭제" title="선택한 행 삭제" disabled={!model.rows.length} onMouseDown={(event) => event.preventDefault()} onClick={removeActiveRow}><Trash2 size={13} /></button>
      <button type="button" className="toolbar-button icon-only" aria-label="선택한 열 삭제" title="선택한 열 삭제" disabled={columnCount <= 1} onMouseDown={(event) => event.preventDefault()} onClick={removeActiveColumn}><Trash2 size={13} /></button>
      <span className="toolbar-spacer" />
      <button type="button" className="toolbar-button" onMouseDown={(event) => event.preventDefault()} onClick={() => table.setEditing(false)}><Check size={13} /> 완료</button>
    </div>
    <div className="cm-md-table-grid" style={{ height: `${Math.min(360, Math.max(164, (model.rows.length + 1) * TABLE_ROW_HEIGHT + TABLE_HEADER_HEIGHT))}px` }}>
      <SpreadsheetGrid
        ref={gridRef}
        className="cm-md-table-data-grid"
        columns={columns}
        rows={model.rows.length}
        getCellContent={getCellContent}
        getCellsForSelection={true}
        gridSelection={selection}
        onGridSelectionChange={setSelection}
        onCellsEdited={applyGridEdits}
        onPaste={pasteValues}
        onDelete={clearSelection}
        onHeaderClicked={headerClicked}
        trailingRowOptions={{ tint: true, hint: '새 행' }}
        onRowAppended={async () => { addRow(); return 'bottom' as const }}
        fillHandle={true}
        rangeSelect="rect"
        rowSelect="none"
        columnSelect="none"
        rowMarkers="number"
        rowHeight={TABLE_ROW_HEIGHT}
        headerHeight={TABLE_HEADER_HEIGHT}
        minColumnWidth={80}
        maxColumnWidth={640}
        maxColumnAutoWidth={640}
        width="100%"
        height="100%"
        theme={gridTheme}
      />
    </div>
    <div className="cm-md-table-editor-status"><span>{model.rows.length}행 · {columnCount}열</span><span>{selectedRange?.height ?? 1} × {selectedRange?.width ?? 1} 선택</span></div>
  </section>
}
