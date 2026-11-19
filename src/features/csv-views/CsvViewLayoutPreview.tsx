import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { displayColumnIds, encodeGroupKey } from '../../domain/csv-views/query'
import type { CsvCell, CsvColumnDefinition, CsvQueryRow, CsvViewDefinition } from '../../domain/csv-views/model'
import { CsvCellDisplay } from './CsvCellDisplay'
import { CsvGalleryView } from './CsvGalleryView'
import { CsvListView } from './CsvListView'

const previewPage = {
  hasMore: false,
  loadingMore: false,
  loadMoreError: null,
  onLoadMore: () => undefined,
  onRetryLoadMore: () => undefined,
  onAdjustQuery: () => undefined,
}

export function CsvViewLayoutPreview({ view, columns, rows }: { view: CsvViewDefinition; columns: CsvColumnDefinition[]; rows: CsvQueryRow[] }) {
  const columnMap = useMemo(() => new Map(columns.map((column) => [column.id, column])), [columns])
  const displayIds = displayColumnIds(view, columns.map((column) => column.id))
  if (view.layout.kind === 'list') {
    return <CsvListView layout={view.layout} columns={columnMap} columnIds={displayIds} displayOverrides={view.displayOverrides} rows={rows} {...previewPage} />
  }
  if (view.layout.kind === 'gallery') {
    return <CsvGalleryView layout={view.layout} columns={columnMap} columnIds={displayIds} displayOverrides={view.displayOverrides} rows={rows} {...previewPage} />
  }
  if (view.layout.kind === 'kanban') return <KanbanPreview layout={view.layout} displayOverrides={view.displayOverrides} columns={columnMap} rows={rows} />
  if (view.layout.kind === 'calendar') return <CalendarPreview layout={view.layout} displayOverrides={view.displayOverrides} columns={columnMap} rows={rows} />
  return null
}

function KanbanPreview({ layout, displayOverrides, columns, rows }: { layout: Extract<CsvViewDefinition['layout'], { kind: 'kanban' }>; displayOverrides: CsvViewDefinition['displayOverrides']; columns: ReadonlyMap<string, CsvColumnDefinition>; rows: CsvQueryRow[] }) {
  const groupColumn = columns.get(layout.groupColumnId)
  if (!groupColumn) return <PreviewEmpty>그룹 컬럼을 선택하면 카드가 표시됩니다.</PreviewEmpty>
  const grouped = new Map<string, { cell: CsvCell; rows: CsvQueryRow[] }>()
  for (const row of rows) {
    const cell = row.cells[layout.groupColumnId] ?? { state: 'missing' as const }
    const key = encodeGroupKey(cell)
    const bucket = grouped.get(key)
    if (bucket) bucket.rows.push(row)
    else grouped.set(key, { cell, rows: [row] })
  }
  const groups = [...grouped].filter(([key, group]) => {
    const value = group.cell.state === 'value' ? group.cell.value : null
    const registered = group.cell.state === 'value' && groupColumn.type === 'select' && typeof value === 'string'
      ? groupColumn.parse.options.some((option) => option.id === value)
      : group.cell.state === 'value' && groupColumn.type !== 'select'
    return !registered || !layout.hiddenGroupKeys.includes(key)
  })
  return <div className="csv-kanban-wrap csv-view-preview-layout csv-view-preview-kanban">
    <div className="csv-kanban-status">표본에서 {groups.length}개 그룹을 미리 봅니다.</div>
    <div className="csv-kanban-columns">
      {groups.slice(0, 4).map(([key, group]) => {
        const color = selectColor(groupColumn, group.cell)
        const value = group.cell.state === 'value' ? group.cell.value : null
        const registered = group.cell.state === 'value' && groupColumn.type === 'select' && typeof value === 'string'
          ? groupColumn.parse.options.some((option) => option.id === value)
          : group.cell.state === 'value' && groupColumn.type !== 'select'
        const special = !registered
        const titleId = layout.titleColumnId
        return <section className={`csv-kanban-column${special ? ' special' : ''}`} aria-label={`${groupLabel(groupColumn, group.cell)} 그룹`} key={key}>
          <header>{color ? <span className="csv-kanban-group-chip" data-color={color}>{groupColumn.type === 'select' ? <CsvCellDisplay column={groupColumn} cell={group.cell} /> : groupLabel(groupColumn, group.cell)}</span> : <strong>{groupLabel(groupColumn, group.cell)}</strong>}<span className="csv-kanban-count">{group.rows.length}</span></header>
          <div className="csv-kanban-lane-body">
            {group.rows.slice(0, 3).map((row) => <article className="csv-kanban-card" key={row.rowId}>
              <strong className="csv-kanban-card-title">{titleId ? <CsvCellDisplay column={columns.get(titleId)} override={displayOverrides[titleId]} cell={row.cells[titleId]} /> : `레코드 ${row.recordNo}`}</strong>
              {layout.subtitleColumnId && <span className="csv-kanban-card-subtitle"><CsvCellDisplay column={columns.get(layout.subtitleColumnId)} override={displayOverrides[layout.subtitleColumnId]} cell={row.cells[layout.subtitleColumnId]} /></span>}
              {(layout.trailingColumnId || layout.groupColumnId) && <div className="csv-kanban-card-row"><span className="csv-kanban-record-no">#{row.recordNo}</span>{layout.trailingColumnId && <strong><CsvCellDisplay column={columns.get(layout.trailingColumnId)} override={displayOverrides[layout.trailingColumnId]} cell={row.cells[layout.trailingColumnId]} /></strong>}</div>}
              {(layout.footerColumnIds?.length ?? 0) > 0 && <div className="csv-kanban-card-footer">{layout.footerColumnIds?.map((id) => <span key={id}><CsvCellDisplay column={columns.get(id)} override={displayOverrides[id]} cell={row.cells[id]} /></span>)}</div>}
            </article>)}
            {group.rows.length > 3 && <small className="csv-view-preview-more">표본에서 {group.rows.length - 3}행 더 있음</small>}
          </div>
        </section>
      })}
      {groups.length > 4 && <div className="csv-kanban-addgroup">표본 기준 그룹 {groups.length - 4}개 더 있음</div>}
    </div>
  </div>
}

function CalendarPreview({ layout, displayOverrides, columns, rows }: { layout: Extract<CsvViewDefinition['layout'], { kind: 'calendar' }>; displayOverrides: CsvViewDefinition['displayOverrides']; columns: ReadonlyMap<string, CsvColumnDefinition>; rows: CsvQueryRow[] }) {
  const [month, setMonth] = useState(() => previewMonth(rows, layout.dateColumnId))
  const [visibleCounts, setVisibleCounts] = useState<Record<string, number>>({})
  const dateColumn = columns.get(layout.dateColumnId)
  const range = calendarPreviewRange(month)
  const byDay = new Map<string, CsvQueryRow[]>()
  let invalidDateCount = 0
  for (const row of rows) {
    const cell = row.cells[layout.dateColumnId]
    if (cell?.state === 'invalid') { invalidDateCount += 1; continue }
    if (cell?.state !== 'value' || typeof cell.value !== 'string') continue
    const day = cell.value.slice(0, 10)
    const bucket = byDay.get(day) ?? []
    bucket.push(row); byDay.set(day, bucket)
  }
  if (!dateColumn) return <PreviewEmpty>날짜 컬럼을 선택하면 일정이 표시됩니다.</PreviewEmpty>
  const today = isoDay(new Date())
  return <div className="csv-calendar-wrap csv-view-preview-calendar">
    <nav className="csv-calendar-nav" aria-label="미리보기 월 이동">
      <button type="button" className="csv-calendar-icon-button" aria-label="이전 달" onClick={() => { setVisibleCounts({}); setMonth((value) => new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() - 1, 1))) }}><ChevronLeft size={14} aria-hidden="true" /></button>
      <strong>{month.getUTCFullYear()}년 {month.getUTCMonth() + 1}월</strong>
      <button type="button" className="csv-calendar-icon-button" aria-label="다음 달" onClick={() => { setVisibleCounts({}); setMonth((value) => new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 1))) }}><ChevronRight size={14} aria-hidden="true" /></button>
      <button type="button" className="secondary-button csv-calendar-today" onClick={() => { const now = new Date(); setVisibleCounts({}); setMonth(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))) }}>오늘</button>
      <span className="csv-calendar-range-label">{range.start} ~ {range.end} · 표본 미리보기</span>
    </nav>
    <div className="csv-calendar-grid" role="grid" aria-label="캘린더 미리보기">
      {['일', '월', '화', '수', '목', '금', '토'].map((label) => <div className="csv-calendar-weekday" role="columnheader" key={label}>{label}</div>)}
      {range.days.map((day) => {
        const key = isoDay(day)
        const items = byDay.get(key) ?? []
        const visible = visibleCounts[key] ?? 2
        return <section className={`csv-calendar-day${day.getUTCMonth() === month.getUTCMonth() ? '' : ' outside'}${key === today ? ' today' : ''}`} role="gridcell" aria-label={key} key={key}>
          <header><time dateTime={key}>{day.getUTCDate()}</time><span>{items.length}</span></header>
          {items.slice(0, visible).map((row) => <PreviewCalendarEvent row={row} layout={layout} displayOverrides={displayOverrides} columns={columns} key={row.rowId} />)}
          {items.length > visible && <button type="button" className="subtle-button csv-calendar-day-more" onClick={() => setVisibleCounts((current) => ({ ...current, [key]: visible + 2 }))}>+{items.length - visible} 더 보기</button>}
        </section>
      })}
    </div>
    <div className="csv-calendar-diagnostics"><span>표본 날짜 해석 실패 {invalidDateCount}행</span></div>
  </div>
}

function PreviewCalendarEvent({ row, layout, displayOverrides, columns }: { row: CsvQueryRow; layout: Extract<CsvViewDefinition['layout'], { kind: 'calendar' }>; displayOverrides: CsvViewDefinition['displayOverrides']; columns: ReadonlyMap<string, CsvColumnDefinition> }) {
  const titleId = layout.titleColumnId ?? null
  const colorColumn = layout.colorColumnId ? columns.get(layout.colorColumnId) : undefined
  const colorCell = layout.colorColumnId ? row.cells[layout.colorColumnId] : undefined
  const color = colorColumn && colorCell?.state === 'value' ? selectColor(colorColumn, colorCell) : null
  const colors: Record<string, string> = { gray: '#858a93', red: '#d86a70', orange: '#dc8b51', yellow: '#ceb64e', green: '#58a77a', teal: '#50aaa5', blue: '#668dd1', purple: '#9876ca', pink: '#d379ad' }
  const style = color ? { ['--csv-calendar-color' as string]: colors[color] ?? colors.gray } : undefined
  return <article className="csv-calendar-event" style={style} title={`레코드 ${row.recordNo}`}>
    <strong>{titleId ? <CsvCellDisplay column={columns.get(titleId)} override={displayOverrides[titleId]} cell={row.cells[titleId]} /> : `레코드 ${row.recordNo}`}</strong>
    {layout.subtitleColumnId && <span><CsvCellDisplay column={columns.get(layout.subtitleColumnId)} override={displayOverrides[layout.subtitleColumnId]} cell={row.cells[layout.subtitleColumnId]} /></span>}
  </article>
}

function selectColor(column: CsvColumnDefinition, cell: CsvCell): string | null {
  if (cell.state !== 'value') return null
  if (column.type === 'select' && typeof cell.value === 'string') return column.parse.options.find((option) => option.id === cell.value)?.color ?? null
  if (column.type === 'boolean' && typeof cell.value === 'boolean') return cell.value ? 'green' : 'gray'
  return null
}

function groupLabel(column: CsvColumnDefinition, cell: CsvCell): string {
  if (cell.state !== 'value') return { empty: '빈 값', missing: '누락', 'null-marker': '결측 표식', invalid: '해석 실패' }[cell.state]
  if (column.type === 'select' && typeof cell.value === 'string') return column.parse.options.find((option) => option.id === cell.value)?.label ?? `선택지 밖 값 · ${cell.value}`
  if (column.type === 'boolean' && typeof cell.value === 'boolean') return cell.value ? column.display.trueLabel : column.display.falseLabel
  return String(cell.value)
}

function PreviewEmpty({ children }: { children: string }) { return <div className="csv-view-preview-state"><span>{children}</span></div> }

function calendarPreviewRange(month: Date): { start: string; end: string; days: Date[] } {
  const first = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1))
  const last = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0))
  const start = new Date(first); start.setUTCDate(first.getUTCDate() - first.getUTCDay())
  const end = new Date(last); end.setUTCDate(last.getUTCDate() + 7 - last.getUTCDay())
  const days: Date[] = []
  for (const day = new Date(start); day < end; day.setUTCDate(day.getUTCDate() + 1)) days.push(new Date(day))
  return { start: isoDay(start), end: isoDay(end), days }
}

function isoDay(date: Date): string { return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}` }

function previewMonth(rows: CsvQueryRow[], dateColumnId: string): Date {
  const firstDate = rows.map((row) => row.cells[dateColumnId]).find((cell) => cell?.state === 'value' && typeof cell.value === 'string')
  const value = firstDate?.state === 'value' ? firstDate.value : null
  if (typeof value === 'string') {
    const date = new Date(`${value.slice(0, 10)}T00:00:00Z`)
    if (!Number.isNaN(date.getTime())) return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
  }
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}
