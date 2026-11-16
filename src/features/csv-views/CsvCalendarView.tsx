import { useEffect, useMemo, useRef, useState } from 'react'
import { formatCell, resolveDisplay } from '../../domain/csv-views/format'
import type { CsvColumnDefinition, CsvQueryRow, CsvViewDefinition } from '../../domain/csv-views/model'
import type { CsvViewController } from '../../app/csvViewController'

interface Props {
  view: CsvViewDefinition & { layout: Extract<CsvViewDefinition['layout'], { kind: 'calendar' }> }
  columns: CsvColumnDefinition[]
  controller: Pick<CsvViewController, 'queryScoped'>
  cacheToken: string | null
}

interface CachedCalendarPage { rows: CsvQueryRow[]; cursor: string | null; hasMore: boolean }
const calendarPageCache = new Map<string, CachedCalendarPage>()

export function CsvCalendarView({ view, columns, controller, cacheToken }: Props) {
  const [month, setMonth] = useState(() => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)))
  const [rows, setRows] = useState<CsvQueryRow[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [dayLoading, setDayLoading] = useState<Record<string, boolean>>({})
  const [dayCursors, setDayCursors] = useState<Record<string, string | null>>({})
  const [dayStarted, setDayStarted] = useState<Record<string, boolean>>({})
  const dayAborters = useRef(new Map<string, AbortController>())
  const queryId = useRef(crypto.randomUUID())
  const activeAbort = useRef<AbortController | null>(null)
  const dateColumn = columns.find((column) => column.id === view.layout.dateColumnId)
  const range = monthRange(month)
  const cacheKey = cacheToken ? JSON.stringify([cacheToken, view.id, view.filter, view.sort, view.layout.dateColumnId, range.start, range.end]) : null
  useEffect(() => {
    activeAbort.current?.abort()
    const abort = new AbortController(); activeAbort.current = abort
    const id = crypto.randomUUID(); queryId.current = id
    const cached = cacheKey ? calendarPageCache.get(cacheKey) : undefined
    for (const child of dayAborters.current.values()) child.abort()
    dayAborters.current.clear()
    setRows(cached?.rows ?? []); setCursor(cached?.cursor ?? null); setHasMore(cached?.hasMore ?? false); setLoading(!cached); setLoadingMore(false); setError(''); setDayCursors({}); setDayStarted({}); setDayLoading({})
    if (cached) return () => abort.abort()
    void controller.queryScoped(view, calendarScope(view.layout.dateColumnId, dateColumn?.type === 'datetime', range.start, range.end), null, id, abort.signal).then((page) => {
      if (abort.signal.aborted) return
      setRows(page.rows); setCursor(page.nextCursor); setHasMore(page.hasMore); setLoading(false)
      if (cacheKey) rememberCalendarPage(cacheKey, { rows: page.rows, cursor: page.nextCursor, hasMore: page.hasMore })
    }).catch((reason: unknown) => {
      if (abort.signal.aborted) return
      setError(reason instanceof Error ? reason.message : '캘린더 항목을 조회하지 못했습니다.'); setLoading(false)
    })
    return () => { abort.abort(); activeAbort.current?.abort(); for (const child of dayAborters.current.values()) child.abort(); dayAborters.current.clear() }
  }, [cacheKey, controller, view, month, dateColumn?.type])
  const byDay = useMemo(() => {
    const result = new Map<string, CsvQueryRow[]>()
    for (const row of rows) {
      const cell = row.cells[view.layout.dateColumnId]
      if (cell?.state !== 'value' || typeof cell.value !== 'string') continue
      const key = cell.value.slice(0, 10)
      const bucket = result.get(key) ?? []; bucket.push(row); result.set(key, bucket)
    }
    return result
  }, [rows, view.layout.dateColumnId])
  const loadMoreMonth = () => {
    if (!cursor) return
    const abort = new AbortController(); activeAbort.current = abort; setLoadingMore(true); setError('')
    void controller.queryScoped(view, calendarScope(view.layout.dateColumnId, dateColumn?.type === 'datetime', range.start, range.end), cursor, queryId.current, abort.signal).then((page) => {
      if (abort.signal.aborted) return
      setRows((current) => mergeRows(current, page.rows))
      setCursor(page.nextCursor); setHasMore(page.hasMore); setLoadingMore(false)
    }).catch((reason: unknown) => { if (!abort.signal.aborted) { setError(reason instanceof Error ? reason.message : '캘린더 항목을 더 가져오지 못했습니다.'); setLoadingMore(false) } })
  }
  const loadDay = (day: string) => {
    if (dayStarted[day] && !dayCursors[day]) return
    dayAborters.current.get(day)?.abort()
    const abort = new AbortController(); dayAborters.current.set(day, abort); setDayLoading((current) => ({ ...current, [day]: true }))
    const dayId = `day:${day}`
    const dayCursor = dayCursors[day] ?? null
    void controller.queryScoped(view, calendarScope(view.layout.dateColumnId, dateColumn?.type === 'datetime', day, nextDay(day)), dayCursor, dayId, abort.signal).then((page) => {
      if (abort.signal.aborted) return
      setRows((current) => mergeRows(current, page.rows))
      setDayCursors((current) => ({ ...current, [day]: page.nextCursor }))
      setDayStarted((current) => ({ ...current, [day]: true }))
      setDayLoading((current) => ({ ...current, [day]: false }))
    }).catch((reason: unknown) => { if (!abort.signal.aborted) { setError(reason instanceof Error ? reason.message : `${day} 항목을 가져오지 못했습니다.`); setDayLoading((current) => ({ ...current, [day]: false })) } })
  }
  const dayCells = range.days.map((day) => ({ day, key: isoDay(day) }))
  return <div className="csv-calendar-wrap">
    <nav className="csv-calendar-nav" aria-label="캘린더 월 이동"><button type="button" className="subtle-button" onClick={() => setMonth((value) => new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() - 1, 1)))}>이전 달</button><strong>{month.getUTCFullYear()}년 {month.getUTCMonth() + 1}월</strong><button type="button" className="subtle-button" onClick={() => setMonth((value) => new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 1)))}>다음 달</button></nav>
    {loading && <p className="csv-view-state" role="status">기간 조회 중…</p>}
    {error && <p className="csv-view-error" role="alert">{error}</p>}
    {!loading && <div className="csv-calendar-grid" role="grid" aria-label="월간 CSV 캘린더">
      {['월', '화', '수', '목', '금', '토', '일'].map((label) => <div className="csv-calendar-weekday" role="columnheader" key={label}>{label}</div>)}
      {dayCells.map(({ day, key }) => <section className={`csv-calendar-day${day.getUTCMonth() === month.getUTCMonth() ? '' : ' outside'}`} role="gridcell" aria-label={key} key={key}>
        <header><time dateTime={key}>{day.getUTCDate()}</time><span>{byDay.get(key)?.length ?? 0}</span></header>
        {(byDay.get(key) ?? []).map((row) => <CalendarEvent key={row.rowId} row={row} view={view} columns={columns} />)}
        <button type="button" className="subtle-button csv-calendar-day-more" disabled={dayLoading[key] || Boolean(dayStarted[key] && !dayCursors[key])} onClick={() => loadDay(key)}>{dayLoading[key] ? '조회 중…' : dayStarted[key] && !dayCursors[key] ? '날짜 조회 완료' : dayStarted[key] ? '날짜 더 보기' : '이 날짜 조회'}</button>
      </section>)}
    </div>}
    {hasMore && <div className="csv-query-more"><button type="button" className="subtle-button" disabled={loadingMore} onClick={loadMoreMonth}>{loadingMore ? '불러오는 중…' : '기간 결과 더 보기'}</button></div>}
  </div>
}

function CalendarEvent({ row, view, columns }: { row: CsvQueryRow; view: Props['view']; columns: CsvColumnDefinition[] }) {
  const ids = view.columnIds.length ? view.columnIds : [view.layout.dateColumnId]
  return <article className="csv-calendar-event" title={`레코드 ${row.recordNo}`}>{ids.slice(0, 3).map((id) => {
    const column = columns.find((item) => item.id === id), cell = row.cells[id]
    if (!column || !cell) return null
    const formatted = formatCell(column, resolveDisplay(column, view.displayOverrides[id]), cell, view.displayOverrides[id]?.stateText ?? {})
    return <span key={id}>{formatted.chips?.map((chip) => chip.text).join(' · ') ?? formatted.text}</span>
  })}</article>
}

function monthRange(month: Date): { start: string; end: string; days: Date[] } {
  const first = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1))
  const last = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0))
  const start = new Date(first); start.setUTCDate(first.getUTCDate() - ((first.getUTCDay() + 6) % 7))
  const end = new Date(last); end.setUTCDate(last.getUTCDate() + (7 - ((last.getUTCDay() + 6) % 7)))
  const days: Date[] = []
  for (const date = new Date(start); date < end; date.setUTCDate(date.getUTCDate() + 1)) days.push(new Date(date))
  return { start: isoDay(start), end: isoDay(end), days }
}
function calendarScope(columnId: string, datetime: boolean, start: string, end: string): { kind: 'calendar'; columnId: string; start: string; end: string } {
  return { kind: 'calendar', columnId, start: datetime ? `${start}T00:00:00Z` : start, end: datetime ? `${end}T00:00:00Z` : end }
}
function nextDay(day: string): string { const date = new Date(`${day}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + 1); return isoDay(date) }
function isoDay(date: Date): string { return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}` }
function mergeRows(current: CsvQueryRow[], next: CsvQueryRow[]): CsvQueryRow[] {
  const byId = new Map(current.map((row) => [row.rowId, row])); for (const row of next) byId.set(row.rowId, row); return [...byId.values()]
}
function rememberCalendarPage(key: string, value: CachedCalendarPage): void {
  calendarPageCache.delete(key); calendarPageCache.set(key, value)
  while (calendarPageCache.size > 4) calendarPageCache.delete(calendarPageCache.keys().next().value!)
}
