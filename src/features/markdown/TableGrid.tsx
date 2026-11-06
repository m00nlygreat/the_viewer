import { Check } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentType, type RefAttributes } from 'react'
import {
  DataEditor,
  GridCellKind,
  emptyGridSelection,
  type DataEditorProps,
  type DataEditorRef,
  type EditListItem,
  type GridCell,
  type GridColumn,
  type GridSelection,
  type Item,
} from '@glideapps/glide-data-grid'
import '@glideapps/glide-data-grid/dist/index.css'
import { markdownLinkAttributes, renderMarkdown } from '../../domain/markdown'
import { useOutsideClick } from '../../components/useOutsideClick'
import type { MarkdownTableState } from './tableState'
import type { MarkdownTableModel } from '../../domain/formats/markdownTable'
import { createGridTheme, GRID_BASE_FONT_STYLE, GRID_FONT_FAMILY, GRID_HEADER_FONT_STYLE } from '../gridTheme'
import { applyGridCellUpdates } from '../gridModel'
import { GridStructureToolbar } from '../GridStructureToolbar'
import { collectMarkdownReferences, prepareObsidianReferences, type MarkdownReference } from '../../domain/markdownReferences'
import { LocalReferenceWidgetView } from './LocalReferenceWidget'
import { createRoot, type Root } from 'react-dom/client'

interface Props { table: MarkdownTableState }

const TABLE_ROW_HEIGHT = 36
const TABLE_HEADER_HEIGHT = 34
let nextMarkdownColumnId = 0

function createMarkdownColumnId(): string {
  nextMarkdownColumnId += 1
  return `markdown-column-${nextMarkdownColumnId}`
}

function renderMarkdownTable(source: string): { html: string; byToken: ReadonlyMap<string, MarkdownReference> } {
  const prepared = prepareObsidianReferences(source)
  let marker = 'MARKDOWN_TABLE_BREAK_TOKEN'
  while (prepared.source.includes(marker)) marker += '_'
  const markedSource = prepared.source.replace(/<br\s*\/?\s*>/giu, marker)
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

  return { html: template.innerHTML, byToken: prepared.byToken }
}

function sameReferenceTarget(reference: string, target: string): boolean {
  if (reference === target) return true
  try { return decodeURIComponent(target) === reference } catch { return false }
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
  const rendered = useMemo(() => renderMarkdownTable(snapshot.source), [snapshot.source])
  useEffect(() => {
    const rows = content.current?.querySelectorAll('tr')
    rows?.forEach((row) => {
      row.querySelectorAll('th, td').forEach((cell, column) => {
        if (cell instanceof HTMLElement) cell.style.textAlign = snapshot.model.alignments[column] ?? 'left'
      })
    })
  }, [snapshot.model.alignments, snapshot.source])

  useEffect(() => {
    const host = content.current
    const context = snapshot.context
    if (!host || !context?.folderId || !context.services) return
    const sourceReferences = collectMarkdownReferences(snapshot.source)
    const references = sourceReferences.map((reference) => ({ ...reference, from: reference.from + snapshot.from, to: reference.to + snapshot.from }))
    const mounted: Root[] = []
    const used = new Set<number>()
    for (const link of Array.from(host.querySelectorAll('a[href]'))) {
      const href = link.getAttribute('href') ?? ''
      if (/^https?:/iu.test(markdownLinkAttributes(href)?.href ?? '')) continue
      const tokenReference = rendered.byToken.get(href)
      const index = tokenReference ? sourceReferences.indexOf(tokenReference) : references.findIndex((reference, candidate) => !used.has(candidate) && sameReferenceTarget(reference.target, href) && (reference.kind === 'link' || reference.kind === 'obsidian-link'))
      if (index < 0) { link.replaceWith(document.createTextNode(link.textContent ?? href)); continue }
      used.add(index)
      const placeholder = document.createElement('span')
      placeholder.className = 'markdown-preview-reference'
      link.replaceWith(placeholder)
      const root = createRoot(placeholder)
      root.render(<LocalReferenceWidgetView reference={references[index]!} context={context} />)
      mounted.push(root)
    }
    for (const image of Array.from(host.querySelectorAll('.blocked-image[data-image-target]'))) {
      const target = image.getAttribute('data-image-target') ?? ''
      const tokenReference = rendered.byToken.get(target)
      const index = tokenReference ? sourceReferences.indexOf(tokenReference) : references.findIndex((reference, candidate) => !used.has(candidate) && sameReferenceTarget(reference.target, target) && (reference.kind === 'image' || reference.kind === 'obsidian-embed'))
      if (index < 0) continue
      used.add(index)
      const placeholder = document.createElement('span')
      placeholder.className = 'markdown-preview-reference'
      image.replaceWith(placeholder)
      const root = createRoot(placeholder)
      root.render(<LocalReferenceWidgetView reference={references[index]!} context={context} />)
      mounted.push(root)
    }
    return () => { for (const root of mounted) root.unmount() }
  }, [rendered.byToken, snapshot.context, snapshot.from, snapshot.source])

  return <section className="cm-md-table-preview" onDoubleClick={() => table.setEditing(true)}>
    <div className="cm-md-table-frame">
      <div className="cm-md-table-actions">
        <button type="button" className="toolbar-button" aria-label="표 편집" title="표 편집" onMouseDown={(event) => event.preventDefault()} onClick={() => table.setEditing(true)}>표 편집</button>
      </div>
      <div ref={content} className="cm-md-table-content" dangerouslySetInnerHTML={{ __html: rendered.html }} />
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
  const columnCount = model.rows.reduce((count, row) => Math.max(count, row.length), Math.max(model.headers.length, 1))
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

  const gridTheme = useMemo(() => createGridTheme(theme, {
    fontFamily: GRID_FONT_FAMILY,
    headerFontStyle: `${GRID_HEADER_FONT_STYLE} ${GRID_FONT_FAMILY}`,
    baseFontStyle: `${GRID_BASE_FONT_STYLE} ${GRID_FONT_FAMILY}`
  }), [theme])

  const getCellContent = ([column, row]: Item): GridCell => {
    const value = model.rows[row]?.[column] ?? ''
    return { kind: GridCellKind.Text, data: value, displayData: value, allowOverlay: true }
  }

  const saveRows = (rows: string[][], group: 'typing' | 'command' = 'typing') => table.replaceModel({ ...model, rows }, group)

  const applyGridEdits = (edits: readonly EditListItem[]) => {
    if (!edits.length) return true
    const updates = edits.map(({ location: [column, row], value }) => ({
      row,
      column,
      value: value.kind === GridCellKind.Text ? value.data : ('data' in value ? String(value.data ?? '') : '')
    }))
    const rows = applyGridCellUpdates(model.rows, updates, { allowAddRows: true, minColumns: columnCount, materializeBlankCells: true })
    if (rows !== model.rows) saveRows(rows)
    return true
  }

  const pasteValues = (target: Item, values: readonly (readonly string[])[]) => {
    const [startColumn, startRow] = target
    if (startColumn < 0 || startColumn >= columnCount || startRow < 0 || values.length === 0) return false
    const updates = values.flatMap((line, rowOffset) => line.map((value, columnOffset) => ({ row: startRow + rowOffset, column: startColumn + columnOffset, value })))
    const rows = applyGridCellUpdates(model.rows, updates, { allowAddRows: true, minColumns: columnCount, materializeBlankCells: true })
    if (rows !== model.rows) saveRows(rows, 'command')
    return false
  }

  const clearSelection = (nextSelection: GridSelection) => {
    const range = nextSelection.current?.range
    if (range) {
      const updates: Array<{ row: number; column: number; value: string }> = []
      for (let row = range.y; row < range.y + range.height; row += 1) {
        for (let column = range.x; column < range.x + range.width; column += 1) {
          if (model.rows[row] && column < columnCount) updates.push({ row, column, value: '' })
        }
      }
      const rows = applyGridCellUpdates(model.rows, updates)
      if (rows !== model.rows) saveRows(rows, 'command')
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
    <GridStructureToolbar
      className="cm-md-table-editor-toolbar"
      leadingContent={<span>표 편집</span>}
      headerEditor={editingHeader === null ? undefined : { value: headerDraft, label: '열 이름 변경', onChange: setHeaderDraft, onCommit: commitHeader, onCancel: () => setEditingHeader(null) }}
      trailingContent={<span className="toolbar-spacer" />}
      preserveFocus
      removeRowDisabled={!model.rows.length}
      removeColumnDisabled={columnCount <= 1}
      onAddRow={addRow}
      onAddColumn={addColumn}
      onRemoveRow={removeActiveRow}
      onRemoveColumn={removeActiveColumn}
      doneLabel="완료"
      doneIcon={<Check size={13} />}
      onDone={() => table.setEditing(false)}
    />
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
