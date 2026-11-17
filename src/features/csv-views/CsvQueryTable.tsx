import { useEffect, useMemo, useRef, useState } from 'react'
import type { CsvColumnDefinition, CsvColumnType, CsvDisplayOverride, CsvQueryError, CsvQueryRow, CsvSort } from '../../domain/csv-views/model'
import { csvQueryNextStep } from '../../domain/csv-views/errorGuidance'
import { CsvCellDisplay } from './CsvCellDisplay'

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

export interface CsvTableColumn { id: string; column: CsvColumnDefinition; label: string; sort?: CsvSort }

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
  const moreRef = useRef<HTMLTableRowElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(560)
  const tableColumns = useMemo(() => columnIds.flatMap((id) => {
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

  useEffect(() => {
    const root = scrollRef.current, target = moreRef.current
    if (!root || !target || !hasMore || loadingMore || loadMoreError || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => { if (entry?.isIntersecting) onLoadMore() }, { root, rootMargin: '120px 0px' })
    observer.observe(target)
    return () => observer.disconnect()
  }, [end, hasMore, loadMoreError, loadingMore, onLoadMore, rows.length])

  return <div ref={scrollRef} className="csv-query-table-scroll" role="region" aria-label="조회 결과 표" onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
    <CsvDataTable columns={tableColumns} rows={visibleRows} totalRows={rows.length} startIndex={start} displayOverrides={displayOverrides} onEditColumnType={onEditColumnType} more={hasMore ? {
      ref: moreRef, loading: loadingMore, error: loadMoreError, onLoadMore, onRetry: onRetryLoadMore, onAdjust: onAdjustQuery
    } : undefined} />
  </div>
}

export function CsvDataTable({ columns, rows, displayOverrides, className = 'csv-query-table', compact = false, totalRows = rows.length, startIndex = 0, onEditColumnType, more, rowNumbers = true, loadingRows = 0 }: {
  columns: CsvTableColumn[]
  rows: CsvQueryRow[]
  displayOverrides: Record<string, CsvDisplayOverride>
  className?: string
  compact?: boolean
  totalRows?: number
  startIndex?: number
  onEditColumnType?(columnId: string): void
  more?: { ref?: React.RefObject<HTMLTableRowElement | null>; loading: boolean; error: CsvQueryError | null; onLoadMore(): void; onRetry(): void; onAdjust(): void }
  rowNumbers?: boolean
  loadingRows?: number
}) {
  const rowHeight = compact ? 30 : ROW_HEIGHT
  const colSpan = columns.length + (rowNumbers ? 1 : 0)
  return <table className={`${className}${compact ? ' compact' : ''}`}>
    <thead><tr>
      {rowNumbers && <th className="rn" scope="col" title="원본 레코드 번호">#</th>}
      {columns.map(({ id, column, label, sort }) => <th scope="col" key={id}>
        <div className="csv-query-header">
          {onEditColumnType ? <button className="csv-query-type-button" type="button" title={`${typeLabels[column.type]} · ${column.typeSource === 'user' ? '사용자 지정' : '추천'}`} aria-label={`${label} 컬럼 타입 설정`} onClick={() => onEditColumnType(id)}>
            <span className="csv-query-type-icon" aria-hidden="true">{typeMarks[column.type]}</span><span>{label}</span>
          </button> : <span className="csv-query-type-label"><span className="csv-query-type-icon" aria-hidden="true">{typeMarks[column.type]}</span><span>{label}</span></span>}
          {sort && <svg className="csv-query-sort" role="img" aria-label={sort.direction === 'asc' ? '오름차순 정렬' : '내림차순 정렬'} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><title>{sort.direction === 'asc' ? '오름차순 정렬' : '내림차순 정렬'}</title><path d={sort.direction === 'asc' ? 'M12 19V5M6 11l6-6 6 6' : 'M12 5v14M6 13l6 6 6-6'} /></svg>}
        </div>
      </th>)}
    </tr></thead>
    <tbody>
      {loadingRows > 0 && Array.from({ length: loadingRows }, (_, rowIndex) => <tr className="loading" key={`loading-${rowIndex}`}>
        {rowNumbers && <td className="rn">{rowIndex + 1}</td>}
        {columns.map(({ id }) => <td key={id}><span className="csv-query-skeleton" style={{ width: `${34 + ((rowIndex * 17 + columns.findIndex((column) => column.id === id) * 23) % 48)}%` }} /></td>)}
      </tr>)}
      {startIndex > 0 && <tr className="csv-query-spacer" aria-hidden="true"><td colSpan={Math.max(1, colSpan)} style={{ height: startIndex * rowHeight }} /></tr>}
      {rows.map((row) => <tr key={row.rowId}>
        {rowNumbers && <td className="rn">{row.recordNo}</td>}
        {columns.map(({ id, column }) => <td key={id} className={`csv-query-cell${row.cells[id]?.state === 'invalid' ? ' cell-invalid' : ''}`}>
          <CsvCellDisplay column={column} override={displayOverrides[id]} cell={row.cells[id]} compact={compact} />
        </td>)}
      </tr>)}
      {startIndex + rows.length < totalRows && <tr className="csv-query-spacer" aria-hidden="true"><td colSpan={Math.max(1, colSpan)} style={{ height: (totalRows - startIndex - rows.length) * rowHeight }} /></tr>}
      {more && <tr className="csv-query-more-row" ref={more.ref}>
        {rowNumbers && <td className="rn">…</td>}
        <td colSpan={Math.max(1, columns.length)}>
          {more.error ? <div className="csv-query-more-content" role="alert"><span>{more.error.message} {csvQueryNextStep(more.error)}</span><button type="button" className="subtle-button" onClick={more.onRetry}>다시 조회</button><button type="button" className="subtle-button" onClick={more.onAdjust}>조건 수정</button></div>
            : <button type="button" className="csv-query-more-button" onClick={more.onLoadMore} disabled={more.loading}>{more.loading ? '다음 행 불러오는 중…' : '다음 행 불러오기'}</button>}
        </td>
      </tr>}
    </tbody>
  </table>
}
