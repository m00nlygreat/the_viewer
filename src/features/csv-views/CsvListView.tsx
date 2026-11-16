import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { encodeGroupKey } from '../../domain/csv-views/query'
import { formatCell, resolveDisplay } from '../../domain/csv-views/format'
import type { CsvColumnDefinition, CsvDisplayOverride, CsvQueryRow } from '../../domain/csv-views/model'
import type { CsvResultViewProps } from './CsvQueryTable'

type ListLayout = Extract<import('../../domain/csv-views/model').CsvLayout, { kind: 'list' }>
type ListEntry =
  | { key: string; kind: 'group'; text: string; count: number; more: boolean }
  | { key: string; kind: 'row'; row: CsvQueryRow }

const ESTIMATED_ROW_HEIGHT = 112
const ESTIMATED_GROUP_HEIGHT = 48
const LIST_OVERSCAN = 5

export function CsvListView({ layout, columns, columnIds, displayOverrides, rows, hasMore, loadingMore, loadMoreError, onLoadMore, onRetryLoadMore }: CsvResultViewProps<ListLayout>) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const measuredHeights = useRef(new Map<string, number>())
  const firstRowId = rows[0]?.rowId ?? null
  const previousFirstRowId = useRef(firstRowId)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(560)
  const [measureRevision, setMeasureRevision] = useState(0)
  const title = columns.get(layout.titleColumnId)
  const group = layout.groupColumnId ? columns.get(layout.groupColumnId) : undefined

  const entries = useMemo(() => {
    const result: ListEntry[] = []
    if (!group || !layout.groupColumnId) return rows.map((row) => ({ key: `row:${row.rowId}`, kind: 'row' as const, row }))
    const grouped: Array<{ key: string; text: string; rows: CsvQueryRow[] }> = []
    for (const row of rows) {
      const cell = row.cells[layout.groupColumnId]
      const key = cell ? encodeGroupKey(cell) : 'missing'
      const previous = grouped[grouped.length - 1]
      if (previous?.key === key) previous.rows.push(row)
      else grouped.push({ key, text: groupLabel(group, cell), rows: [row] })
    }
    grouped.forEach((item, groupIndex) => {
      result.push({ key: `group:${groupIndex}:${item.key}`, kind: 'group', text: item.text, count: item.rows.length, more: hasMore && groupIndex === grouped.length - 1 })
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
        if (entry.kind === 'group') return <div className="csv-view-group-heading csv-view-list-virtual-entry" role="listitem" data-list-entry-key={entry.key} key={entry.key} style={{ top: offsets[index] }}><h3>{entry.text}</h3><span className="csv-view-group-count">{entry.count}{entry.more ? '+' : ''}</span></div>
        const rowStyle = colorStyle(layout.colorColumnId, entry.row, columns)
        return <article className="csv-view-list-item csv-view-list-virtual-entry" role="listitem" data-list-entry-key={entry.key} key={entry.key} style={{ top: offsets[index], ...rowStyle }}>
          <div className="csv-view-list-main"><strong>{format(title, displayOverrides[layout.titleColumnId], entry.row.cells[layout.titleColumnId])}</strong>
            {layout.subtitleColumnId && <span className="csv-view-subtitle">{format(columns.get(layout.subtitleColumnId), displayOverrides[layout.subtitleColumnId], entry.row.cells[layout.subtitleColumnId])}</span>}
            {layout.trailingColumnId && <span className="csv-view-trailing">{format(columns.get(layout.trailingColumnId), displayOverrides[layout.trailingColumnId], entry.row.cells[layout.trailingColumnId])}</span>}
          </div>
          <div className="csv-view-list-values">{columnIds.filter((id) => ![layout.titleColumnId, layout.subtitleColumnId, layout.trailingColumnId].includes(id)).map((id) => <span key={id}><small>{displayOverrides[id]?.label ?? columns.get(id)?.label ?? id}</small><CellDisplay column={columns.get(id)} override={displayOverrides[id]} cell={entry.row.cells[id]} /></span>)}</div>
        </article>
      })}
      {hasMore && <div className="csv-query-more csv-view-list-more" style={{ top: totalHeight }}>{loadMoreError ? <><span role="alert">추가 항목을 불러오지 못했습니다.</span><button type="button" className="subtle-button" onClick={onRetryLoadMore}>다시 시도</button></> : <button type="button" className="subtle-button" onClick={onLoadMore} disabled={loadingMore}>{loadingMore ? '불러오는 중…' : '더 보기'}</button>}</div>}
    </div>
  </div>
}

function CellDisplay({ column, override, cell }: { column: CsvColumnDefinition | undefined; override: CsvDisplayOverride | undefined; cell: CsvQueryRow['cells'][string] | undefined }) {
  if (!column || !cell) return <span className="csv-view-cell missing">누락</span>
  const formatted = formatCell(column, resolveDisplay(column, override), cell, override?.stateText ?? {})
  if (!formatted.chips) return <span className={`csv-view-cell ${formatted.tone}`}>{formatted.text}</span>
  return <span className={`csv-view-cell ${formatted.tone}`}>{formatted.chips.map((chip, index) => <span key={`${chip.text}-${index}`} className={`csv-view-chip${chip.unmatched ? ' unmatched' : ''}`} data-color={chip.color ?? undefined}>{chip.text}</span>)}</span>
}

function format(column: CsvColumnDefinition | undefined, override: CsvDisplayOverride | undefined, cell: CsvQueryRow['cells'][string] | undefined): string {
  if (!column || !cell) return '누락'
  return formatCell(column, resolveDisplay(column, override), cell, override?.stateText ?? {}).text
}

function groupLabel(column: CsvColumnDefinition, cell: CsvQueryRow['cells'][string] | undefined): string {
  if (!cell || cell.state !== 'value') return cell ? { empty: '빈 값', missing: '누락', 'null-marker': '결측 표식', invalid: '해석 실패' }[cell.state] ?? '' : '누락'
  if (column.type === 'select' && typeof cell.value === 'string') return column.parse.options.find((option) => option.id === cell.value)?.label ?? cell.value
  if (column.type === 'boolean' && typeof cell.value === 'boolean') return cell.value ? column.display.trueLabel : column.display.falseLabel
  return String(cell.value)
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
