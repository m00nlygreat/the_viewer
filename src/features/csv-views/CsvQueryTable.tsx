import { useEffect, useMemo, useRef, useState } from 'react'
import { formatCell, resolveDisplay } from '../../domain/csv-views/format'
import type { CsvCell, CsvColumnDefinition, CsvColumnType, CsvDisplayOverride, CsvQueryError, CsvQueryRow, CsvSort } from '../../domain/csv-views/model'
import { csvQueryNextStep } from '../../domain/csv-views/errorGuidance'

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
  onAdjustQuery(): void
}

const ROW_HEIGHT = 34
const OVERSCAN = 8
const typeMarks: Record<CsvColumnType, string> = { text: 'Aa', integer: '12', decimal: '1.5', boolean: '☑', date: 'D', datetime: 'DT', select: '◉', multiSelect: '≡' }
const typeLabels: Record<CsvColumnType, string> = { text: '텍스트', integer: '정수', decimal: '소수', boolean: '참/거짓', date: '날짜', datetime: '날짜·시간', select: '단일 선택', multiSelect: '다중 선택' }

interface Props extends CsvResultViewProps<{ kind: 'grid' }> {
  sort?: CsvSort[]
  onEditColumnType(columnId: string): void
}

export function CsvQueryTable({ columns, columnIds, displayOverrides, rows, sort = [], hasMore, loadingMore, loadMoreError, onLoadMore, onRetryLoadMore, onAdjustQuery, onEditColumnType }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(560)
  const gridColumns = useMemo(() => columnIds.flatMap((id) => {
    const column = columns.get(id)
    return column ? [{ id, column, label: displayOverrides[id]?.label ?? column.label, sort: sort.find((item) => item.columnId === id) }] : []
  }), [columnIds, columns, displayOverrides, sort])
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const end = Math.min(rows.length, start + Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN * 2)
  const visibleRows = rows.slice(start, end)

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const updateSize = () => setViewportHeight(element.clientHeight)
    updateSize()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateSize)
    observer?.observe(element)
    return () => observer?.disconnect()
  }, [])

  return <div ref={scrollRef} className="csv-query-table-scroll" role="region" aria-label="조회 결과 표" onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
    <table className="csv-query-table">
      <thead><tr>
        <th className="rn" scope="col" title="원본 레코드 번호">#</th>
        {gridColumns.map(({ id, column, label, sort: columnSort }) => <th scope="col" key={id}>
          <div className="csv-query-header">
            <button className="csv-query-type-button" type="button" title={`${typeLabels[column.type]} · ${column.typeSource === 'user' ? '사용자 지정' : '추천'}`} aria-label={`${label} 컬럼 타입 설정`} onClick={() => onEditColumnType(id)}>
              <span className="csv-query-type-icon" aria-hidden="true">{typeMarks[column.type]}</span><span>{label}</span>
            </button>
            {columnSort && <span className="csv-query-sort" title={columnSort.direction === 'asc' ? '오름차순 정렬' : '내림차순 정렬'} aria-label={columnSort.direction === 'asc' ? '오름차순 정렬' : '내림차순 정렬'}>{columnSort.direction === 'asc' ? '↑' : '↓'}</span>}
          </div>
        </th>)}
      </tr></thead>
      <tbody>
        {start > 0 && <tr className="csv-query-spacer" aria-hidden="true"><td colSpan={gridColumns.length + 1} style={{ height: start * ROW_HEIGHT }} /></tr>}
        {visibleRows.map((row) => <tr key={row.rowId}>
          <td className="rn">{row.recordNo}</td>
          {gridColumns.map(({ id, column }) => <td key={id} className={cellClass(column, displayOverrides[id], row.cells[id])}>
            <QueryCell column={column} override={displayOverrides[id]} cell={row.cells[id]} />
          </td>)}
        </tr>)}
        {end < rows.length && <tr className="csv-query-spacer" aria-hidden="true"><td colSpan={gridColumns.length + 1} style={{ height: (rows.length - end) * ROW_HEIGHT }} /></tr>}
        {hasMore && <tr className="csv-query-more-row">
          <td className="rn">…</td>
          <td colSpan={Math.max(1, gridColumns.length)}>
            {loadMoreError ? <div className="csv-query-more-content" role="alert"><span>{loadMoreError.message} {csvQueryNextStep(loadMoreError)}</span><button type="button" className="subtle-button" onClick={onRetryLoadMore}>다시 조회</button><button type="button" className="subtle-button" onClick={onAdjustQuery}>조건 수정</button></div>
              : <button type="button" className="csv-query-more-button" onClick={onLoadMore} disabled={loadingMore}>{loadingMore ? '다음 행 불러오는 중…' : '다음 행 불러오기'}</button>}
          </td>
        </tr>}
      </tbody>
    </table>
  </div>
}

function cellClass(column: CsvColumnDefinition, override: CsvDisplayOverride | undefined, cell: CsvCell | undefined): string {
  if (!cell) return 'csv-query-cell missing'
  const formatted = formatCell(column, resolveDisplay(column, override), cell, override?.stateText ?? {})
  return ['csv-query-cell', formatted.tone, formatted.align === 'end' ? 'numeric' : '', column.type === 'date' || column.type === 'datetime' ? 'date' : '', cell.state === 'invalid' ? 'cell-invalid' : ''].filter(Boolean).join(' ')
}

function QueryCell({ column, override, cell }: { column: CsvColumnDefinition; override: CsvDisplayOverride | undefined; cell: CsvCell | undefined }) {
  if (!cell) return <span className="csv-query-state missing">누락</span>
  const display = resolveDisplay(column, override)
  const formatted = formatCell(column, display, cell, override?.stateText ?? {})
  const title = cell.state === 'invalid' ? `해석 실패 · ${cell.code}` : cell.state === 'null-marker' ? `결측 표식 · ${cell.raw}` : undefined
  if (cell.state === 'value' && column.type === 'boolean' && 'as' in display && display.as === 'check' && typeof cell.value === 'boolean') {
    return <span className={`csv-query-boolean${cell.value ? ' on' : ''}`} aria-label={cell.value ? '참' : '거짓'}><span className="box">{cell.value ? '✓' : ''}</span></span>
  }
  if (formatted.chips) return <span className="csv-query-options" title={title}>{formatted.chips.map((chip, index) => <span key={`${chip.text}-${index}`} className={optionClass(column, chip.unmatched)} data-color={chip.color ?? undefined}>{chip.text}</span>)}</span>
  return <span className={`csv-query-state ${formatted.tone}`} title={title}>{formatted.text}</span>
}

function optionClass(column: CsvColumnDefinition, unmatched: boolean): string {
  const kind = column.type === 'select' ? 'single' : 'multiple'
  return `csv-query-option ${kind}${unmatched ? ' unmatched' : ''}`
}
