import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { encodeGroupKey } from '../../domain/csv-views/query'
import type { CsvColumnDefinition, CsvQueryRow } from '../../domain/csv-views/model'
import type { CsvResultViewProps } from './CsvQueryTable'
import { csvQueryNextStep } from '../../domain/csv-views/errorGuidance'
import { CsvCellDisplay } from './CsvCellDisplay'

type ListLayout = Extract<import('../../domain/csv-views/model').CsvLayout, { kind: 'list' }>
type ListEntry =
  | { key: string; kind: 'group'; text: string; count: number; more: boolean; special: boolean }
  | { key: string; kind: 'row'; row: CsvQueryRow }
type GroupBucket = { key: string; text: string; rows: CsvQueryRow[]; special: boolean }

const ESTIMATED_ROW_HEIGHT = 68
const ESTIMATED_GROUP_HEIGHT = 30
const LIST_OVERSCAN = 5

export function CsvListView({ layout, columns, displayOverrides, rows, hasMore, loadingMore, loadMoreError, onLoadMore, onRetryLoadMore, onAdjustQuery }: CsvResultViewProps<ListLayout>) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const measuredHeights = useRef(new Map<string, number>())
  const firstRowId = rows[0]?.rowId ?? null
  const previousFirstRowId = useRef(firstRowId)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(560)
  const [measureRevision, setMeasureRevision] = useState(0)
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null)
  const group = layout.groupColumnId ? columns.get(layout.groupColumnId) : undefined

  const entries = useMemo(() => {
    const result: ListEntry[] = []
    if (!group || !layout.groupColumnId) return rows.map((row) => ({ key: `row:${row.rowId}`, kind: 'row' as const, row }))
    const grouped = new Map<string, GroupBucket>()
    for (const row of rows) {
      const cell = row.cells[layout.groupColumnId]
      const key = cell ? listGroupKey(group, cell) : 'missing'
      const previous = grouped.get(key)
      if (previous) previous.rows.push(row)
      else grouped.set(key, { key, text: groupLabel(group, cell), rows: [row], special: isSpecialGroup(group, cell) })
    }
    const groups = [...grouped.values()]
    groups.forEach((item, groupIndex) => {
      result.push({ key: `group:${groupIndex}:${item.key}`, kind: 'group', text: item.text, count: item.rows.length, more: hasMore && groupIndex === groups.length - 1, special: item.special })
      result.push(...item.rows.map((row) => ({ key: `row:${row.rowId}`, kind: 'row' as const, row })))
    })
    return result
  }, [group, hasMore, layout.groupColumnId, rows])

  useEffect(() => {
    const validKeys = new Set(entries.map((entry) => entry.key))
    for (const key of measuredHeights.current.keys()) if (!validKeys.has(key)) measuredHeights.current.delete(key)
  }, [entries])

  useEffect(() => {
    if (previousFirstRowId.current === firstRowId) return
    previousFirstRowId.current = firstRowId
    setScrollTop(0)
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [firstRowId])

  const offsets: number[] = []
  let totalHeight = 0
  for (const entry of entries) {
    offsets.push(totalHeight)
    totalHeight += measuredHeights.current.get(entry.key) ?? (entry.kind === 'group' ? ESTIMATED_GROUP_HEIGHT : ESTIMATED_ROW_HEIGHT)
  }
  let firstVisible = 0
  while (firstVisible < entries.length && offsets[firstVisible]! + (measuredHeights.current.get(entries[firstVisible]!.key) ?? (entries[firstVisible]!.kind === 'group' ? ESTIMATED_GROUP_HEIGHT : ESTIMATED_ROW_HEIGHT)) < scrollTop) firstVisible++
  const start = Math.max(0, firstVisible - LIST_OVERSCAN)
  let end = firstVisible
  while (end < entries.length && offsets[end]! < scrollTop + viewportHeight) end++
  end = Math.min(entries.length, end + LIST_OVERSCAN)

  useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const updateSize = () => setViewportHeight(element.clientHeight)
    updateSize()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateSize)
    observer?.observe(element)
    return () => observer?.disconnect()
  }, [])

  useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element) return
    let changed = false
    for (const node of element.querySelectorAll<HTMLElement>('[data-list-entry-key]')) {
      const key = node.dataset.listEntryKey
      if (!key) continue
      const height = node.getBoundingClientRect().height
      if (height > 0 && Math.abs((measuredHeights.current.get(key) ?? 0) - height) > 1) { measuredHeights.current.set(key, height); changed = true }
    }
    if (changed) setMeasureRevision((value) => value + 1)
  }, [end, entries, measureRevision, start])

  return <div ref={scrollRef} className="csv-view-list-scroll" role="region" aria-label="CSV 조회 결과" onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
    <div className="csv-view-list-virtual" role="list" style={{ height: totalHeight + (hasMore ? 68 : 0) }}>
      {entries.slice(start, end).map((entry, relativeIndex) => {
        const index = start + relativeIndex
        if (entry.kind === 'group') return <div className={`csv-view-group-heading${entry.special ? ' warn' : ''} csv-view-list-virtual-entry`} role="listitem" data-list-entry-key={entry.key} key={entry.key} style={{ top: offsets[index] }}><h3>{entry.text}</h3><span className="csv-view-group-count">{entry.count}{entry.more ? '+' : ''}</span></div>
        const rowStyle = colorStyle(layout.colorColumnId, entry.row, columns)
        return <article className={`csv-view-list-item csv-view-list-virtual-entry${selectedRowId === entry.row.rowId ? ' selected' : ''}`} role="listitem" aria-selected={selectedRowId === entry.row.rowId} tabIndex={0} data-list-entry-key={entry.key} key={entry.key} style={{ top: offsets[index], ...rowStyle }} onClick={() => setSelectedRowId(entry.row.rowId)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedRowId(entry.row.rowId) } }}>
          {layout.colorColumnId && <span className="csv-view-list-dot" aria-hidden="true" />}
          <div className="csv-view-list-main"><div className="csv-view-list-title"><b><CsvCellDisplay column={columns.get(layout.titleColumnId)} override={displayOverrides[layout.titleColumnId]} cell={entry.row.cells[layout.titleColumnId]} /></b><span className="csv-view-list-record">#{entry.row.recordNo}</span></div>
            {(layout.subtitleColumnId || (layout.badgeColumnIds?.length ?? 0) > 0) && <div className="csv-view-list-sub">{layout.subtitleColumnId && <CsvCellDisplay column={columns.get(layout.subtitleColumnId)} override={displayOverrides[layout.subtitleColumnId]} cell={entry.row.cells[layout.subtitleColumnId]} />}{(layout.badgeColumnIds ?? []).map((id) => <span className="csv-view-list-badge" key={id}><CsvCellDisplay column={columns.get(id)} override={displayOverrides[id]} cell={entry.row.cells[id]} /></span>)}</div>}
          </div>
          {layout.trailingColumnId && <div className="csv-view-list-side"><span className="csv-view-list-amount"><CsvCellDisplay column={columns.get(layout.trailingColumnId)} override={displayOverrides[layout.trailingColumnId]} cell={entry.row.cells[layout.trailingColumnId]} /></span></div>}
        </article>
      })}
      {hasMore && <div className="csv-query-more csv-view-list-more" style={{ top: totalHeight }}>{loadMoreError ? <><span role="alert">{loadMoreError.message} {csvQueryNextStep(loadMoreError)}</span><button type="button" className="subtle-button" onClick={onRetryLoadMore}>다시 조회</button><button type="button" className="subtle-button" onClick={onAdjustQuery}>조건 수정</button></> : <button type="button" className="subtle-button" onClick={onLoadMore} disabled={loadingMore}>{loadingMore ? '불러오는 중…' : '더 보기'}</button>}</div>}
    </div>
  </div>
}

function groupLabel(column: CsvColumnDefinition, cell: CsvQueryRow['cells'][string] | undefined): string {
  if (!cell || cell.state !== 'value') return cell ? { empty: '빈 값', missing: '누락', 'null-marker': '결측 표식', invalid: '해석 실패' }[cell.state] ?? '' : '누락'
  if (column.type === 'select' && typeof cell.value === 'string') return column.parse.options.find((option) => option.id === cell.value)?.label ?? `선택지 밖 값 · ${cell.value}`
  if (column.type === 'boolean' && typeof cell.value === 'boolean') return cell.value ? column.display.trueLabel : column.display.falseLabel
  if ((column.type === 'date' || column.type === 'datetime') && typeof cell.value === 'string') {
    const day = cell.value.slice(0, 10)
    const date = new Date(`${day}T00:00:00Z`)
    if (!Number.isNaN(date.getTime())) return `${Number(day.slice(5, 7))}월 ${Number(day.slice(8, 10))}일 (${['일', '월', '화', '수', '목', '금', '토'][date.getUTCDay()]})${day === new Date().toISOString().slice(0, 10) ? ' · 오늘' : ''}`
  }
  return String(cell.value)
}

function listGroupKey(column: CsvColumnDefinition, cell: CsvQueryRow['cells'][string]): string {
  if (cell.state === 'value' && (column.type === 'date' || column.type === 'datetime') && typeof cell.value === 'string') return encodeGroupKey({ ...cell, value: cell.value.slice(0, 10) })
  return encodeGroupKey(cell)
}

function isSpecialGroup(column: CsvColumnDefinition, cell: CsvQueryRow['cells'][string] | undefined): boolean {
  if (!cell || cell.state !== 'value') return true
  return column.type === 'select' && typeof cell.value === 'string' && !column.parse.options.some((option) => option.id === cell.value)
}

function colorStyle(columnId: string | null, row: CsvQueryRow, columns: ReadonlyMap<string, CsvColumnDefinition>): CSSProperties {
  if (!columnId) return {}
  const column = columns.get(columnId)
  const cell = row.cells[columnId]
  if (!column || !cell || cell.state !== 'value') return {}
  let color: string | null = null
  if (column.type === 'select' && typeof cell.value === 'string') color = column.parse.options.find((option) => option.id === cell.value)?.color ?? null
  else if (column.type === 'boolean' && typeof cell.value === 'boolean') color = cell.value ? 'green' : 'gray'
  const colorValue: Record<string, string> = { gray: '#858a93', red: '#d86a70', orange: '#dc8b51', yellow: '#ceb64e', green: '#58a77a', teal: '#50aaa5', blue: '#668dd1', purple: '#9876ca', pink: '#d379ad' }
  return color ? { ['--csv-list-color' as string]: colorValue[color] ?? colorValue.gray } : {}
}
