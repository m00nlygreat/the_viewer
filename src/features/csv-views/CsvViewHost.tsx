import { useEffect, useRef, useState } from 'react'
import type { CsvColumnDefinition, CsvQueryDiagnostic, CsvQueryRow, CsvTotal, CsvViewDefinition } from '../../domain/csv-views/model'
import type { CsvQueryState } from '../../app/csvViewController'
import { csvQueryNextStep } from '../../domain/csv-views/errorGuidance'
import { CsvGalleryView } from './CsvGalleryView'
import { CsvListView } from './CsvListView'
import { CsvDataTable, CsvQueryTable } from './CsvQueryTable'
import { CsvKanbanView } from './CsvKanbanView'
import { CsvCalendarView } from './CsvCalendarView'
import type { CsvSample } from '../../domain/csv-views/model'
import type { CsvViewController } from '../../app/csvViewController'
import { ArrowDown, ArrowDownUp, ArrowUp, Copy, Download, Filter, LockKeyhole, MoreHorizontal, Plus, Search, Settings2, Trash2, Type, Upload, X } from 'lucide-react'

export interface CsvViewHostProps {
  view: CsvViewDefinition
  columns: CsvColumnDefinition[]
  query: CsvQueryState
  onLoadMore(): void
  onRetry(): void
  onEditView(): void
  onEditColumnType(columnId: string): void
  onManageViews(): void
  onReconnect(): void
  onShowTable(): void
  onReturnCalendar?(): void
  onImportViews?(): void
  onChangeView(view: CsvViewDefinition): void
  onDuplicateView(): void
  onDeleteView(): void
  onExportView(): void
  editable: boolean
  fileBacked?: boolean
  fileDefaultView?: boolean
  temporaryCalendarTable?: boolean
  sourceAvailable?: boolean
  controller: Pick<CsvViewController, 'queryScoped' | 'discoverGroups' | 'count' | 'cancel'>
  sample: CsvSample | null
  cacheToken: string | null
  tabId?: string
}

export function CsvViewHost({ view, columns, query, onLoadMore, onRetry, onEditView, onEditColumnType, onManageViews, onReconnect, onShowTable, onReturnCalendar, onImportViews, onChangeView, onDuplicateView, onDeleteView, onExportView, editable, fileBacked = false, fileDefaultView = false, temporaryCalendarTable = false, sourceAvailable = true, controller, sample, cacheToken, tabId }: CsvViewHostProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [exactCount, setExactCount] = useState<string | null>(null)
  const [counting, setCounting] = useState(false)
  const [countError, setCountError] = useState('')
  const countRun = useRef(0)
  const columnMap = new Map(columns.map((column) => [column.id, column]))
  const scoped = view.layout.kind === 'kanban' || view.layout.kind === 'calendar'
  const filterKey = JSON.stringify(view.filter)
  useEffect(() => { countRun.current += 1; setExactCount(null); setCountError(''); setCounting(false) }, [view.id, filterKey, view.layout.kind])
  const countRows = async () => {
    const run = ++countRun.current
    setCounting(true); setCountError('')
    try { const count = await controller.count(view); if (countRun.current === run) setExactCount(count) }
    catch (reason) { if (countRun.current === run && !(reason instanceof Error && 'code' in reason && reason.code === 'cancelled')) setCountError(reason instanceof Error ? reason.message : '건수를 계산하지 못했습니다.') }
    finally { if (countRun.current === run) setCounting(false) }
  }
  return <section id="csv-view-panel" className="csv-view-host" role="tabpanel" aria-labelledby={tabId ?? `csv-view-${view.id}-tab`}>
    {fileBacked && <div className="csv-file-view-banner" role="note">{fileDefaultView ? <><LockKeyhole size={14} aria-hidden="true" /><span>큰 CSV는 파일에서 필요한 부분만 읽는 원본 순서 표로 엽니다. 셀 편집·Undo·원본 저장은 지원하지 않습니다.</span></> : <><strong>읽기 전용 파일 기반 CSV</strong><span>CSV 원문 편집과 Undo는 사용할 수 없습니다.</span></>}</div>}
    <div className={`csv-view-toolbar${fileDefaultView ? ' csv-view-toolbar-default-file' : ''}`} aria-label={`${view.name} 도구 모음`}>
      {fileDefaultView ? <><div className="csv-view-toolbar-search"><Search size={14} aria-hidden="true" /><span>검색은 사용자 뷰의 필터로 만듭니다</span></div><div className="csv-view-toolbar-spacer" /><button type="button" className="csv-view-tool-button" onClick={() => { const columnId = view.columnIds[0] ?? columns[0]?.id; if (columnId) onEditColumnType(columnId) }} disabled={!columns.length}><Type size={15} aria-hidden="true" /><span>컬럼 타입</span></button><button type="button" className="csv-view-tool-button" onClick={onEditView}><Plus size={15} aria-hidden="true" /><span>이 표로 보기 추가</span></button></>
      : <>
      <div className="csv-view-toolbar-chips">
        {layoutSummary(view, columnMap) && <span className="csv-view-chip summary" title={layoutSummary(view, columnMap)}><span className="csv-view-chip-text">{layoutSummary(view, columnMap)}</span></span>}
        {view.filter && <span className="csv-view-chip summary" title={filterSummary(view.filter, columnMap)}><Filter size={13} aria-hidden="true" /><span className="csv-view-chip-text">{filterSummary(view.filter, columnMap)}</span>{editable && <button type="button" className="csv-view-chip-remove" aria-label="필터 지우기" onClick={() => onChangeView({ ...view, filter: null, updatedAt: new Date().toISOString() })}><X size={12} aria-hidden="true" /></button>}</span>}
        {view.sort.map((sort) => <span className="csv-view-chip summary" key={sort.columnId} title={`${columnMap.get(sort.columnId)?.label ?? sort.columnId} ${sort.direction === 'asc' ? '오름차순' : '내림차순'}`}><ArrowDownUp size={13} aria-hidden="true" /><span className="csv-view-chip-text">{columnMap.get(sort.columnId)?.label ?? sort.columnId} {sort.direction === 'asc' ? <ArrowUp size={12} aria-hidden="true" /> : <ArrowDown size={12} aria-hidden="true" />}</span>{editable && <button type="button" className="csv-view-chip-remove" aria-label={`${columnMap.get(sort.columnId)?.label ?? sort.columnId} 정렬 지우기`} onClick={() => onChangeView({ ...view, sort: view.sort.filter((item) => item.columnId !== sort.columnId), updatedAt: new Date().toISOString() })}><X size={12} aria-hidden="true" /></button>}</span>)}
        {editable && <button type="button" className="csv-view-chip ghost" onClick={onEditView}><Plus size={13} aria-hidden="true" />필터</button>}
      </div>
      <div className="csv-view-toolbar-spacer" />
      <button type="button" className="csv-view-tool-button" onClick={() => { const columnId = view.columnIds[0] ?? columns[0]?.id; if (columnId) onEditColumnType(columnId) }} disabled={!columns.length}><Type size={15} aria-hidden="true" /><span>컬럼 타입</span></button>
      {!temporaryCalendarTable && <button type="button" className="csv-view-tool-button" onClick={onEditView}><Settings2 size={15} aria-hidden="true" /><span>뷰 설정</span></button>}
      {temporaryCalendarTable && onReturnCalendar && <button type="button" className="csv-view-tool-button" onClick={onReturnCalendar}><span>캘린더로 돌아가기</span></button>}
      {!temporaryCalendarTable && <div className="csv-view-menu-wrap">
        <button type="button" className="csv-view-tool-button icon-only" aria-label="뷰 메뉴" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><MoreHorizontal size={17} aria-hidden="true" /></button>
        {menuOpen && <div className="csv-view-menu" role="menu">
          <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onEditView() }}><Settings2 size={14} aria-hidden="true" />뷰 설정 편집</button>
          {editable && <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onDuplicateView() }}><Copy size={14} aria-hidden="true" />복제</button>}
          {editable && <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onExportView() }}><Download size={14} aria-hidden="true" />뷰 다운로드 <small>.json</small></button>}
          <hr />
          <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onManageViews() }}><Settings2 size={14} aria-hidden="true" />보기 관리</button>
          <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); (onImportViews ?? onManageViews)() }}><Upload size={14} aria-hidden="true" />뷰 가져오기</button>
          {editable && <><hr /><button type="button" role="menuitem" className="danger" onClick={() => { setMenuOpen(false); onDeleteView() }}><Trash2 size={14} aria-hidden="true" />뷰 삭제</button></>}
          <p>뷰 설정은 브라우저에 따로 저장됩니다. CSV 수정 상태와 무관합니다.</p>
        </div>}
      </div>}
      </>}
    </div>
    {!sourceAvailable ? <section className="csv-view-state" role="status"><strong>원본 CSV 파일을 다시 연결해 주세요.</strong><p>보기 설정은 보관되어 있습니다. 원본 연결 전에는 조회와 미리보기를 사용할 수 없습니다.</p><div><button className="secondary-button" type="button" onClick={onReconnect}>CSV 다시 열기</button><button className="subtle-button" type="button" onClick={onManageViews}>보기 관리</button>{editable && <button className="subtle-button" type="button" onClick={onEditView}>뷰 설정</button>}</div></section> : <>
    {view.layout.kind === 'kanban' && <CsvKanbanView view={view as CsvViewDefinition & { layout: Extract<CsvViewDefinition['layout'], { kind: 'kanban' }> }} columns={columns} sample={sample} controller={controller} onEditView={onEditView} />}
    {view.layout.kind === 'calendar' && <CsvCalendarView view={view as CsvViewDefinition & { layout: Extract<CsvViewDefinition['layout'], { kind: 'calendar' }> }} columns={columns} sample={sample} controller={controller} cacheToken={cacheToken} onShowTable={onShowTable} onEditView={onEditView} />}
    {!scoped && query.status === 'loading' && <>
      {view.layout.kind === 'grid' ? <div className="csv-view-loading-grid" role="status" aria-label="CSV 결과 조회 중"><CsvDataTable columns={view.columnIds.flatMap((id) => { const column = columnMap.get(id); return column ? [{ id, column, label: view.displayOverrides[id]?.label ?? column.label }] : [] })} rows={[]} displayOverrides={view.displayOverrides} loadingRows={10} /></div> : <div className="csv-view-state" role="status">조회 중…</div>}
      <footer className="csv-view-statusbar" role="status"><span>조회 중…</span><span className="csv-view-status-spacer" />표본과 원본 크기에 따라 시간이 걸릴 수 있습니다.</footer>
    </>}
    {!scoped && query.status === 'error' && <div className="csv-view-state" role="alert"><p>{query.error.message}</p><small>{csvQueryNextStep(query.error)}</small><div><button type="button" className="secondary-button" onClick={onRetry}>다시 조회</button><button type="button" className="subtle-button" onClick={onEditView}>조건 수정</button></div></div>}
    {!scoped && query.status === 'idle' && <div className="csv-view-state" role="status">조회 조건을 준비하고 있습니다.</div>}
    {!scoped && query.status === 'ready' && query.rows.length === 0 && <div className="csv-view-empty-state" role="status"><strong>조건에 맞는 행이 없습니다</strong><p>{view.filter ? `현재 필터: ${filterSummary(view.filter, columnMap)}. ` : '현재 조건에는 '}해석 실패와 빈 값은 일반 비교에서 제외됩니다.</p><div>{editable && view.filter && <button type="button" className="secondary-button" onClick={() => onChangeView({ ...view, filter: null, updatedAt: new Date().toISOString() })}>필터 해제</button>}<button type="button" className="secondary-button" onClick={onEditView}>{editable ? '뷰 설정' : '보기 추가'}</button></div></div>}
    {!scoped && query.status === 'ready' && query.rows.length > 0 && <>
      {view.layout.kind === 'grid' && <CsvQueryTable key={query.queryId} layout={view.layout} columns={columnMap} columnIds={view.columnIds} displayOverrides={view.displayOverrides} rows={query.rows} sort={view.sort} hasMore={query.hasMore} loadingMore={query.loadingMore} loadMoreError={query.loadMoreError} onLoadMore={onLoadMore} onRetryLoadMore={onRetry} onAdjustQuery={onEditView} onEditColumnType={onEditColumnType} />}
      {view.layout.kind === 'list' && <CsvListView layout={view.layout} columns={columnMap} columnIds={view.columnIds} displayOverrides={view.displayOverrides} rows={query.rows} hasMore={query.hasMore} loadingMore={query.loadingMore} loadMoreError={query.loadMoreError} onLoadMore={onLoadMore} onRetryLoadMore={onRetry} onAdjustQuery={onEditView} />}
      {view.layout.kind === 'gallery' && <CsvGalleryView layout={view.layout} columns={columnMap} columnIds={view.columnIds} displayOverrides={view.displayOverrides} rows={query.rows} hasMore={query.hasMore} loadingMore={query.loadingMore} loadMoreError={query.loadMoreError} onLoadMore={onLoadMore} onRetryLoadMore={onRetry} onAdjustQuery={onEditView} />}
    </>}
    {query.status === 'loading' && <footer className="csv-view-statusbar" role="status"><span>조회 중…</span><span className="csv-view-status-spacer" /><button type="button" className="csv-view-status-action" onClick={() => controller.cancel()}>취소</button></footer>}
    {query.status === 'ready' && <footer className="csv-view-statusbar" role="status"><span>{resultLabel(query, sample, exactCount)}</span>{view.layout.kind === 'grid' && <QueryStateSummary rows={query.rows} scope={query.total.status === 'exact' || sample?.reachedEof ? '결과 기준' : '확보 행 기준'} />}{query.diagnostics.length > 0 && <span className="csv-view-status-warning">진단 {query.diagnostics.length}개 · {diagnosticLabel(query.diagnostics[0]!.code)}</span>}{countError && <span className="csv-view-status-warning" title={countError}>{countError}</span>}<span className="csv-view-status-spacer" />{query.loadingMore ? <><span>추가 행 불러오는 중…</span><button type="button" className="csv-view-status-action" onClick={() => controller.cancel()}>취소</button></> : <button type="button" className="csv-view-status-action" onClick={() => { if (counting) controller.cancel(); else void countRows() }}>{counting ? '건수 계산 취소' : exactCount ? '건수 다시 세기' : '건수 세기'}</button>}</footer>}
    {scoped && !temporaryCalendarTable && <footer className="csv-view-statusbar" role="status"><span>{view.layout.kind === 'calendar' ? '월간 날짜 범위를 조회합니다.' : '필터에 맞는 그룹을 조회합니다.'}</span><span>{exactCount !== null ? `전체 ${formatCount(exactCount)}행 (정확)` : '정확한 전체 건수 미계산'}</span>{countError && <span className="csv-view-status-warning" title={countError}>{countError}</span>}<span className="csv-view-status-spacer" /><button type="button" className="csv-view-status-action" onClick={() => { if (counting) controller.cancel(); else void countRows() }}>{counting ? '건수 계산 취소' : exactCount ? '건수 다시 세기' : '건수 세기'}</button></footer>}
    </>}
  </section>
}

function totalLabel(total: CsvTotal): string {
  if (total.status === 'exact') return `전체 ${formatCount(total.value)}행`
  if (total.status === 'estimated') return `표본 기준 약 ${formatCount(total.value)}행`
  return '전체 행 수는 아직 알 수 없음'
}

function resultLabel(query: Extract<CsvQueryState, { status: 'ready' }>, sample: CsvSample | null, exactCount: string | null): string {
  if (exactCount !== null) return `결과 ${query.rows.length.toLocaleString()}행 확보 · 전체 ${formatCount(exactCount)}행 (정확)`
  if (query.total.status === 'exact') return `결과 ${query.rows.length.toLocaleString()}행 / 전체 ${formatCount(query.total.value)}행 (현재 작업본, 정확)`
  if (query.total.status === 'unknown' && sample?.reachedEof) return `결과 ${query.rows.length.toLocaleString()}행 / 전체 ${sample.records.length.toLocaleString()}행 (현재 작업본, 정확)`
  return `결과 ${query.rows.length.toLocaleString()}행 확보${query.hasMore ? ' · 다음 페이지 있음' : ''} · ${totalLabel(query.total)}`
}

function formatCount(value: string): string {
  try { return BigInt(value).toLocaleString() }
  catch { return value }
}

function QueryStateSummary({ rows, scope }: { rows: CsvQueryRow[]; scope: string }) {
  const counts = rows.reduce((total, row) => {
    for (const cell of Object.values(row.cells)) if (cell) total[cell.state] += 1
    return total
  }, { value: 0, empty: 0, missing: 0, 'null-marker': 0, invalid: 0 })
  return <><span className={counts.invalid ? 'csv-view-status-warning' : undefined}>해석 실패 {counts.invalid}</span><span>빈 값 {counts.empty} · 누락 {counts.missing} · 결측 {counts['null-marker']}</span><span className="csv-view-status-scope">{scope}</span></>
}

function diagnosticLabel(code: CsvQueryDiagnostic['code']): string {
  return ({ 'record-too-wide': '컬럼 수 초과', 'record-too-short': '컬럼 누락', 'quote-error': '따옴표 오류', 'cell-too-large': '셀 크기 초과', 'result-bytes-exceeded': '결과 크기 초과', 'source-changed': '원본 변경', 'parse-incomplete': '일부 해석 실패' })[code]
}

function layoutSummary(view: CsvViewDefinition, columns: ReadonlyMap<string, CsvColumnDefinition>): string {
  if (view.layout.kind === 'list' && view.layout.groupColumnId) return `묶음 · ${columns.get(view.layout.groupColumnId)?.label ?? view.layout.groupColumnId}`
  if (view.layout.kind === 'kanban') return `그룹 · ${columns.get(view.layout.groupColumnId)?.label ?? view.layout.groupColumnId}`
  if (view.layout.kind === 'calendar') return `날짜 · ${columns.get(view.layout.dateColumnId)?.label ?? view.layout.dateColumnId}`
  return ''
}

function filterSummary(filter: NonNullable<CsvViewDefinition['filter']>, columns: ReadonlyMap<string, CsvColumnDefinition>): string {
  if ('children' in filter) return filter.children.map((child) => filterSummary(child, columns)).join(filter.op === 'and' ? ' 그리고 ' : ' 또는 ')
  if ('child' in filter) return `아님 (${filterSummary(filter.child, columns)})`
  const label = columns.get(filter.columnId)?.label ?? filter.columnId
  if ('state' in filter) {
    const state = { value: '값 있음', empty: '빈 값', missing: '원본 컬럼 없음', 'null-marker': 'null 표식', invalid: '해석 실패' }[filter.state]
    return `${label} ${filter.op === 'is' ? '상태' : '상태 아님'} ${state}`
  }
  if ('optionIds' in filter) {
    const column = columns.get(filter.columnId)
    const values = column && (column.type === 'select' || column.type === 'multiSelect') ? filter.optionIds.map((id) => column.parse.options.find((option) => option.id === id)?.label ?? id).join(', ') : filter.optionIds.join(', ')
    const operation = { in: '다음 중', notIn: '다음 아님', hasAny: '하나 포함', hasAll: '모두 포함' }[filter.op]
    return `${label} ${operation} ${values}`
  }
  const operation: Record<string, string> = { eq: '같음', neq: '다름', lt: '<', lte: '≤', gt: '>', gte: '≥', contains: '포함', startsWith: '접두어' }
  return `${label} ${operation[filter.op] ?? filter.op} ${filter.value}`
}
