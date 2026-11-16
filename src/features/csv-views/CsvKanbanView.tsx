import { useEffect, useMemo, useRef, useState } from 'react'
import { decodeGroupKey } from '../../domain/csv-views/query'
import { formatCell, resolveDisplay } from '../../domain/csv-views/format'
import { CsvQueryError } from '../../domain/csv-views/model'
import type { CsvColumnDefinition, CsvQueryRow, CsvSample, CsvViewDefinition } from '../../domain/csv-views/model'
import type { CsvViewController } from '../../app/csvViewController'

interface Props {
  view: CsvViewDefinition & { layout: Extract<CsvViewDefinition['layout'], { kind: 'kanban' }> }
  columns: CsvColumnDefinition[]
  sample: CsvSample | null
  controller: Pick<CsvViewController, 'queryScoped' | 'discoverGroups'>
}

export function CsvKanbanView({ view, columns, controller }: Props) {
  const [groups, setGroups] = useState<string[] | null>(null)
  const [complete, setComplete] = useState(true)
  const [visibleCount, setVisibleCount] = useState(8)
  const [error, setError] = useState<CsvQueryError | null>(null)
  const [retry, setRetry] = useState(0)
  const groupColumn = columns.find((column) => column.id === view.layout.groupColumnId)
  useEffect(() => {
    const abort = new AbortController()
    setGroups(null); setError(null); setVisibleCount(8)
    void controller.discoverGroups(view, view.layout.groupColumnId, 100, abort.signal).then((result) => {
      if (abort.signal.aborted) return
      setGroups([...result.keys].sort((left, right) => compareGroupKeys(groupColumn, left, right))); setComplete(result.complete)
    }).catch((reason: unknown) => {
      if (!abort.signal.aborted) setError(new CsvQueryError('internal', reason instanceof Error ? reason.message : '그룹 목록을 가져오지 못했습니다.'))
    })
    return () => abort.abort()
  }, [controller, groupColumn, retry, view])
  const visibleGroups = useMemo(() => (groups ?? []).filter((key) => !view.layout.hiddenGroupKeys.includes(key)).slice(0, visibleCount), [groups, view.layout.hiddenGroupKeys, visibleCount])
  return <div className="csv-kanban-wrap">
    <div className="csv-kanban-status" role="status">
      {groups === null && !error && '그룹 목록을 조회하고 있습니다…'}
      {error && <><span role="alert">{error.message}</span><button type="button" className="subtle-button" onClick={() => setRetry((value) => value + 1)}>다시 시도</button></>}
      {groups && <span>{complete ? `그룹 ${groups.length}개` : `그룹 후보 ${groups.length}개 · 전체 목록은 100개 초과`}</span>}
    </div>
    {groups?.length === 0 && <p className="csv-view-state">조건에 맞는 그룹이 없습니다.</p>}
    <div className="csv-kanban-columns">
      {groupColumn && visibleGroups.map((key) => <KanbanLane key={key} groupKey={key} label={labelForKey(groupColumn, key)} view={view} columns={columns} controller={controller} />)}
    </div>
    {groups && groups.length > visibleCount && <div className="csv-query-more"><button type="button" className="subtle-button" onClick={() => setVisibleCount((count) => Math.min(count + 8, 100))}>그룹 8개 더 보기</button></div>}
    {groups && !complete && <p className="csv-kanban-status">이 화면은 앞의 100개 후보까지만 표시합니다. 그룹 컬럼의 조건을 추가해 범위를 좁히세요.</p>}
  </div>
}

function KanbanLane({ groupKey, label, view, columns, controller }: {
  groupKey: string; label: string; view: Props['view']; columns: CsvColumnDefinition[]; controller: Props['controller']
}) {
  const [rows, setRows] = useState<CsvQueryRow[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const queryId = useRef(crypto.randomUUID())
  const controllerRef = useRef(controller)
  controllerRef.current = controller
  const abortRef = useRef<AbortController | null>(null)
  const load = (nextCursor: string | null, append: boolean) => {
    abortRef.current?.abort()
    const abort = new AbortController(); abortRef.current = abort
    setError(''); append ? setLoadingMore(true) : setLoading(true)
    void controllerRef.current.queryScoped(view, { kind: 'group', columnId: view.layout.groupColumnId, key: groupKey }, nextCursor, queryId.current, abort.signal).then((page) => {
      if (abort.signal.aborted) return
      setRows((existing) => append ? [...existing, ...page.rows] : page.rows)
      setCursor(page.nextCursor); setHasMore(page.hasMore)
      setLoading(false); setLoadingMore(false)
    }).catch((reason: unknown) => {
      if (abort.signal.aborted) return
      setError(reason instanceof Error ? reason.message : '그룹 항목을 조회하지 못했습니다.')
      setLoading(false); setLoadingMore(false)
    })
  }
  useEffect(() => { load(null, false); return () => abortRef.current?.abort() }, [groupKey, view])
  const columnMap = new Map(columns.map((column) => [column.id, column]))
  return <section className="csv-kanban-column" aria-label={`${label} 그룹`}>
    <header><strong>{label}</strong><span>{rows.length}{hasMore ? '+' : ''}</span></header>
    {loading && <p className="csv-view-state">조회 중…</p>}
    {error && <div className="csv-view-state" role="alert"><p>{error}</p><button type="button" className="subtle-button" onClick={() => load(cursor, Boolean(cursor))}>다시 시도</button></div>}
    {!loading && !error && rows.map((row) => <article className="csv-kanban-card" key={row.rowId}>
      {view.columnIds.map((id) => {
        const column = columnMap.get(id), cell = row.cells[id]
        if (!column || !cell) return null
        const formatted = formatCell(column, resolveDisplay(column, view.displayOverrides[id]), cell, view.displayOverrides[id]?.stateText ?? {})
        return <div key={id}><small>{view.displayOverrides[id]?.label ?? column.label}</small><span>{formatted.chips?.map((chip) => chip.text).join(' · ') ?? formatted.text}</span></div>
      })}
    </article>)}
    {hasMore && <button type="button" className="subtle-button" disabled={loadingMore} onClick={() => load(cursor, true)}>{loadingMore ? '불러오는 중…' : '더 보기'}</button>}
  </section>
}

function labelForKey(column: CsvColumnDefinition, key: string): string {
  const group = decodeGroupKey(key)
  if (!group) return '알 수 없는 그룹'
  if (group.state !== 'value') return ({ empty: '빈 값', missing: '누락', 'null-marker': '결측 표식', invalid: '해석 실패' })[group.state]
  if (column.type === 'select' && typeof group.value === 'string') return column.parse.options.find((option) => option.id === group.value)?.label ?? group.value
  if (column.type === 'boolean' && typeof group.value === 'boolean') return group.value ? column.display.trueLabel : column.display.falseLabel
  return String(group.value)
}

function compareGroupKeys(column: CsvColumnDefinition | undefined, left: string, right: string): number {
  const a = decodeGroupKey(left), b = decodeGroupKey(right)
  if (!a || !b) return left < right ? -1 : left > right ? 1 : 0
  const states = ['value', 'empty', 'missing', 'null-marker', 'invalid']
  const stateOrder = states.indexOf(a.state) - states.indexOf(b.state)
  if (stateOrder) return stateOrder
  if (a.state !== 'value' || b.state !== 'value') return 0
  if (column?.type === 'boolean') return Number(Boolean(a.value)) - Number(Boolean(b.value))
  if (column?.type === 'select' && typeof a.value === 'string' && typeof b.value === 'string') {
    const order = column.parse.options
    const index = (value: string) => order.findIndex((option) => option.id === value)
    const ai = index(a.value), bi = index(b.value)
    if (ai >= 0 || bi >= 0) { if (ai < 0) return 1; if (bi < 0) return -1; if (ai !== bi) return ai - bi }
  }
  return compareCodepoints(String(a.value), String(b.value))
}
function compareCodepoints(left: string, right: string): number {
  const a = Array.from(left, (char) => char.codePointAt(0)!), b = Array.from(right, (char) => char.codePointAt(0)!)
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) if (a[index] !== b[index]) return a[index]! - b[index]!
  return a.length - b.length
}
