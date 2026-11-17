import { useEffect, useMemo, useRef, useState } from 'react'
import { formatCell, resolveDisplay } from '../../domain/csv-views/format'
import { evaluateFilter } from '../../domain/csv-views/query'
import { parseCell } from '../../domain/csv-views/typing'
import { CSV_POLICY } from '../../domain/csv-views/policy'
import { csvQueryNextStep } from '../../domain/csv-views/errorGuidance'
import { CsvQueryError } from '../../domain/csv-views/model'
import type { CsvColumnDefinition, CsvQueryRow, CsvSample, CsvViewDefinition } from '../../domain/csv-views/model'
import type { CsvViewController } from '../../app/csvViewController'

interface Props {
  view: CsvViewDefinition & { layout: Extract<CsvViewDefinition['layout'], { kind: 'calendar' }> }
  columns: CsvColumnDefinition[]
  sample: CsvSample | null
  controller: Pick<CsvViewController, 'queryScoped'>
  cacheToken: string | null
  onShowTable(): void
  onEditView(): void
}

interface CachedCalendarPage { rows: CsvQueryRow[]; cursor: string | null; hasMore: boolean }
const calendarPageCache = new Map<string, CachedCalendarPage>()

export function CsvCalendarView({ view, columns, sample, controller, cacheToken, onShowTable, onEditView }: Props) {
  const [month, setMonth] = useState(() => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)))
  const [rows, setRows] = useState<CsvQueryRow[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<CsvQueryError | null>(null)
  const [monthMoreError, setMonthMoreError] = useState<CsvQueryError | null>(null)
  const [dayLoading, setDayLoading] = useState<Record<string, boolean>>({})
  const [dayCursors, setDayCursors] = useState<Record<string, string | null>>({})
  const [dayStarted, setDayStarted] = useState<Record<string, boolean>>({})
  const [dayRows, setDayRows] = useState<Record<string, CsvQueryRow[]>>({})
  const [dayErrors, setDayErrors] = useState<Record<string, CsvQueryError | null>>({})
  const [dayVisibleCounts, setDayVisibleCounts] = useState<Record<string, number>>({})
  const [retryMonth, setRetryMonth] = useState(0)
  const dayAborters = useRef(new Map<string, AbortController>())
  const dayQueryIds = useRef(new Map<string, string>())
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
    dayQueryIds.current.clear()
    setRows(cached?.rows ?? []); setCursor(cached?.cursor ?? null); setHasMore(cached?.hasMore ?? false); setLoading(!cached); setLoadingMore(false); setError(null); setMonthMoreError(null); setDayCursors({}); setDayStarted({}); setDayLoading({}); setDayRows({}); setDayErrors({}); setDayVisibleCounts({})
    if (cached) return () => abort.abort()
    void controller.queryScoped(view, calendarScope(view.layout.dateColumnId, dateColumn?.type === 'datetime', range.start, range.end), null, id, abort.signal).then((page) => {
      if (abort.signal.aborted) return
      setRows(page.rows); setCursor(page.nextCursor); setHasMore(page.hasMore); setLoading(false)
      if (cacheKey) rememberCalendarPage(cacheKey, { rows: page.rows, cursor: page.nextCursor, hasMore: page.hasMore })
    }).catch((reason: unknown) => {
      if (abort.signal.aborted) return
      setError(reason instanceof CsvQueryError ? reason : new CsvQueryError('internal', reason instanceof Error ? reason.message : '캘린더 항목을 조회하지 못했습니다.')); setLoading(false)
    })
    return () => { abort.abort(); activeAbort.current?.abort(); for (const child of dayAborters.current.values()) child.abort(); dayAborters.current.clear() }
  }, [cacheKey, controller, view, month, dateColumn?.type, retryMonth])
  const byDay = useMemo(() => {
    const result = new Map<string, CsvQueryRow[]>()
    for (const row of mergeRows(rows, Object.values(dayRows).flat())) {
      const cell = row.cells[view.layout.dateColumnId]
      if (cell?.state !== 'value' || typeof cell.value !== 'string') continue
      const key = cell.value.slice(0, 10)
      const bucket = result.get(key) ?? []; bucket.push(row); result.set(key, bucket)
    }
    return result
  }, [dayRows, rows, view.layout.dateColumnId])
  const columnsById = useMemo(() => new Map(columns.map((column) => [column.id, column])), [columns])
  const invalidDateCount = useMemo(() => sampleDateFailures(sample, dateColumn, view.filter, columnsById), [columnsById, dateColumn, sample, view.filter])
  const loadMoreMonth = () => {
    if (!cursor) return
    const abort = new AbortController(); activeAbort.current = abort; setLoadingMore(true); setMonthMoreError(null)
    void controller.queryScoped(view, calendarScope(view.layout.dateColumnId, dateColumn?.type === 'datetime', range.start, range.end), cursor, queryId.current, abort.signal).then((page) => {
      if (abort.signal.aborted) return
      setRows((current) => mergeRows(current, page.rows))
      setCursor(page.nextCursor); setHasMore(page.hasMore); setLoadingMore(false)
    }).catch((reason: unknown) => { if (!abort.signal.aborted) { setMonthMoreError(reason instanceof CsvQueryError ? reason : new CsvQueryError('internal', reason instanceof Error ? reason.message : '캘린더 항목을 더 가져오지 못했습니다.')); setLoadingMore(false) } })
  }
  const loadDay = (day: string) => {
    if (dayStarted[day] && !dayCursors[day]) return
    dayAborters.current.get(day)?.abort()
    const abort = new AbortController(); dayAborters.current.set(day, abort); setDayLoading((current) => ({ ...current, [day]: true }))
    const dayId = dayQueryIds.current.get(day) ?? crypto.randomUUID()
    dayQueryIds.current.set(day, dayId)
    const dayCursor = dayCursors[day] ?? null
    void controller.queryScoped(view, calendarScope(view.layout.dateColumnId, dateColumn?.type === 'datetime', day, nextDay(day)), dayCursor, dayId, abort.signal).then((page) => {
      if (abort.signal.aborted) return
      setDayRows((current) => ({ ...current, [day]: mergeRows(current[day] ?? [], page.rows) }))
      setDayCursors((current) => ({ ...current, [day]: page.nextCursor }))
      setDayStarted((current) => ({ ...current, [day]: true }))
      setDayLoading((current) => ({ ...current, [day]: false }))
      setDayErrors((current) => ({ ...current, [day]: null }))
    }).catch((reason: unknown) => { if (!abort.signal.aborted) { setDayErrors((current) => ({ ...current, [day]: reason instanceof CsvQueryError ? reason : new CsvQueryError('internal', reason instanceof Error ? reason.message : `${day} 항목을 가져오지 못했습니다.`) })); setDayLoading((current) => ({ ...current, [day]: false })) } })
  }
  const showMoreForDay = (day: string) => {
    const loaded = byDay.get(day)?.length ?? 0
    const shown = dayVisibleCounts[day] ?? CSV_POLICY.calendarInitialEventsPerDay
    if (loaded > shown) {
      setDayVisibleCounts((current) => ({ ...current, [day]: Math.min(shown + CSV_POLICY.calendarMoreEventsPerClick, CSV_POLICY.maxCalendarRowsPerDay) }))
      return
    }
    if (!dayStarted[day] || (dayCursors[day] && (dayRows[day]?.length ?? 0) < CSV_POLICY.maxCalendarRowsPerDay)) loadDay(day)
  }
  const dayCells = range.days.map((day) => ({ day, key: isoDay(day) }))
  return <div className="csv-calendar-wrap">
    <nav className="csv-calendar-nav" aria-label="캘린더 월 이동"><button type="button" className="subtle-button" onClick={() => setMonth((value) => new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() - 1, 1)))}>이전 달</button><strong>{month.getUTCFullYear()}년 {month.getUTCMonth() + 1}월</strong><button type="button" className="subtle-button" onClick={() => setMonth((value) => new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 1)))}>다음 달</button></nav>
    {dateColumn && <div className="csv-calendar-diagnostics" role="status"><span>{sample ? `날짜 해석 실패 ${invalidDateCount}행${sample.reachedEof ? '' : ` · 표본 ${sample.records.length}행 기준`}` : '날짜 해석 실패 건수를 준비하고 있습니다.'}</span><button type="button" className="subtle-button" onClick={onShowTable}>표로 보기</button></div>}
    {loading && <p className="csv-view-state" role="status">기간 조회 중…</p>}
    {error && <div className="csv-view-error" role="alert"><p>{error.message}</p><small>{csvQueryNextStep(error)}</small><div><button type="button" className="subtle-button" onClick={() => setRetryMonth((value) => value + 1)}>다시 조회</button><button type="button" className="subtle-button" onClick={onEditView}>조건 좁히기</button></div></div>}
    {!loading && <div className="csv-calendar-grid" role="grid" aria-label="월간 CSV 캘린더">
      {['월', '화', '수', '목', '금', '토', '일'].map((label) => <div className="csv-calendar-weekday" role="columnheader" key={label}>{label}</div>)}
      {dayCells.map(({ day, key }) => <section className={`csv-calendar-day${day.getUTCMonth() === month.getUTCMonth() ? '' : ' outside'}`} role="gridcell" aria-label={key} key={key}>
        <header><time dateTime={key}>{day.getUTCDate()}</time><span>{byDay.get(key)?.length ?? 0}</span></header>
        {(byDay.get(key) ?? []).slice(0, dayVisibleCounts[key] ?? CSV_POLICY.calendarInitialEventsPerDay).map((row) => <CalendarEvent key={row.rowId} row={row} view={view} columns={columns} />)}
        {dayErrors[key] && <div className="csv-calendar-day-error" role="alert"><span>{dayErrors[key]?.message}</span><button type="button" className="subtle-button" onClick={() => loadDay(key)}>다시 시도</button><button type="button" className="subtle-button" onClick={onEditView}>조건 좁히기</button></div>}
        {((byDay.get(key)?.length ?? 0) > (dayVisibleCounts[key] ?? CSV_POLICY.calendarInitialEventsPerDay) || !dayStarted[key] || Boolean(dayCursors[key] && (dayRows[key]?.length ?? 0) < CSV_POLICY.maxCalendarRowsPerDay)) && <button type="button" className="subtle-button csv-calendar-day-more" disabled={dayLoading[key]} onClick={() => showMoreForDay(key)}>{dayLoading[key] ? '조회 중…' : (byDay.get(key)?.length ?? 0) > (dayVisibleCounts[key] ?? CSV_POLICY.calendarInitialEventsPerDay) ? `+${(byDay.get(key)?.length ?? 0) - (dayVisibleCounts[key] ?? CSV_POLICY.calendarInitialEventsPerDay)} 더 보기` : dayStarted[key] ? '날짜 더 불러오기' : '날짜 전체 조회'}</button>}
        {dayStarted[key] && (dayRows[key]?.length ?? 0) >= CSV_POLICY.maxCalendarRowsPerDay && dayCursors[key] && <small>날짜별 {CSV_POLICY.maxCalendarRowsPerDay}행을 표시했습니다. 더 찾으려면 조건을 좁히세요.</small>}
      </section>)}
    </div>}
    {hasMore && <div className="csv-query-more">{monthMoreError ? <><span role="alert">{monthMoreError.message} {csvQueryNextStep(monthMoreError)}</span><button type="button" className="subtle-button" disabled={loadingMore} onClick={loadMoreMonth}>다시 시도</button><button type="button" className="subtle-button" onClick={onEditView}>조건 좁히기</button></> : <button type="button" className="subtle-button" disabled={loadingMore} onClick={loadMoreMonth}>{loadingMore ? '불러오는 중…' : '기간 결과 더 보기'}</button>}</div>}
  </div>
}

function sampleDateFailures(sample: CsvSample | null, dateColumn: CsvColumnDefinition | undefined, filter: CsvViewDefinition['filter'], columns: ReadonlyMap<string, CsvColumnDefinition>): number {
  if (!sample || !dateColumn) return 0
  return sample.records.reduce((count, record) => {
    const cell = parseCell(dateColumn, record[dateColumn.sourceIndex])
    if (cell.state !== 'invalid') return count
    if (filter && !evaluateFilter(filter, columns, (columnId) => {
      const column = columns.get(columnId)
      return column ? parseCell(column, record[column.sourceIndex]) : { state: 'missing' }
    })) return count
    return count + 1
  }, 0)
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
