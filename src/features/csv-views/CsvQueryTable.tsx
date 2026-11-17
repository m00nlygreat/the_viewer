import { useCallback, useMemo } from 'react'
import {
  DataEditor,
  GridCellKind,
  type GridCell,
  type GridColumn,
  type Item,
} from '@glideapps/glide-data-grid'
import '@glideapps/glide-data-grid/dist/index.css'
import { createGridTheme } from '../gridTheme'
import { formatCell, resolveDisplay } from '../../domain/csv-views/format'
import type { CsvCell, CsvColumnDefinition, CsvDisplayOverride, CsvQueryError, CsvQueryRow } from '../../domain/csv-views/model'

export interface CsvResultViewProps<L> {
  layout: L
  columns: ReadonlyMap<string, CsvColumnDefinition>
  columnIds: string[]
  displayOverrides: Record<string, CsvDisplayOverride>
  rows: CsvQueryRow[]
  hasMore: boolean
  loadingMore: boolean
  loadMoreError: CsvQueryError | null
  onLoadMore(): void
  onRetryLoadMore(): void
}

type GridProps = CsvResultViewProps<{ kind: 'grid' }> & { theme: 'light' | 'dark' }
const typeMarks = { text: 'T', integer: '#', decimal: '1.2', boolean: '✓', date: '◷', datetime: '◷', select: '▾', multiSelect: '≡' } as const

export function CsvQueryTable({ columns, columnIds, displayOverrides, rows, hasMore, loadingMore, loadMoreError, onLoadMore, onRetryLoadMore, theme, onEditColumnType }: GridProps & { onEditColumnType(columnId: string): void }) {
  const gridColumns = useMemo<GridColumn[]>(() => columnIds.map((id) => {
    const column = columns.get(id)
    const label = displayOverrides[id]?.label ?? column?.label ?? id
    return { title: `${column ? typeMarks[column.type] : '·'} ${label}`, width: 180 }
  }), [columnIds, columns, displayOverrides])
  const gridTheme = useMemo(() => createGridTheme(theme), [theme])
  const getCellContent = useCallback(([columnIndex, rowIndex]: Item): GridCell => {
    const id = columnIds[columnIndex]
    const row = rows[rowIndex]
    const column = id ? columns.get(id) : undefined
    const cell = id && row ? row.cells[id] : undefined
    const value = renderCellText(column, id ? displayOverrides[id] : undefined, cell)
    return { kind: GridCellKind.Text, data: value, displayData: value, readonly: true, allowOverlay: true, contentAlign: column && ['integer', 'decimal'].includes(column.type) ? 'right' : 'left' }
  }, [columnIds, columns, displayOverrides, rows])

  return <div className="csv-query-table-scroll" role="region" aria-label="조회 결과 표">
    <div className="csv-query-table-grid">
      <DataEditor
        className="csv-query-grid-editor"
        columns={gridColumns}
        rows={rows.length}
        getCellContent={getCellContent}
        getCellsForSelection={true}
        rowMarkers="none"
        rowSelect="none"
        columnSelect="none"
        rangeSelect="rect"
        rowHeight={40}
        headerHeight={36}
        width="100%"
        height="100%"
        theme={gridTheme}
        onHeaderClicked={(columnIndex) => { const id = columnIds[columnIndex]; if (id) onEditColumnType(id) }}
      />
    </div>
    {hasMore && <div className="csv-query-more">{loadMoreError ? <><span role="alert">추가 행을 불러오지 못했습니다.</span><button type="button" className="subtle-button" onClick={onRetryLoadMore}>다시 시도</button></> : <button type="button" className="subtle-button" onClick={onLoadMore} disabled={loadingMore}>{loadingMore ? '불러오는 중…' : '더 보기'}</button>}</div>}
  </div>
}

function renderCellText(column: CsvColumnDefinition | undefined, override: CsvDisplayOverride | undefined, cell: CsvCell | undefined): string {
  if (!column || !cell) return '누락'
  const formatted = formatCell(column, resolveDisplay(column, override), cell, override?.stateText ?? {})
  if (formatted.chips) return formatted.chips.map((chip) => chip.unmatched ? `${chip.text} · 미등록` : chip.text).join(' · ')
  return formatted.text
}
