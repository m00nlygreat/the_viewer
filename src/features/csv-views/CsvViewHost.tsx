import { useState } from 'react'
import type { CsvColumnDefinition, CsvQueryDiagnostic, CsvTotal, CsvViewDefinition } from '../../domain/csv-views/model'
import type { CsvQueryState } from '../../app/csvViewController'
import { CsvGalleryView } from './CsvGalleryView'
import { CsvListView } from './CsvListView'
import { CsvQueryTable } from './CsvQueryTable'
import { CsvKanbanView } from './CsvKanbanView'
import { CsvCalendarView } from './CsvCalendarView'
import type { CsvSample } from '../../domain/csv-views/model'
import type { CsvViewController } from '../../app/csvViewController'
import { ArrowDownUp, Copy, Download, Filter, MoreHorizontal, Plus, Settings2, Trash2, Type, Upload } from 'lucide-react'

export interface CsvViewHostProps {
  view: CsvViewDefinition
  columns: CsvColumnDefinition[]
  query: CsvQueryState
  onLoadMore(): void
  onRetry(): void
  onEditView(): void
  onEditColumnType(columnId: string): void
  onManageViews(): void
  onChangeView(view: CsvViewDefinition): void
  onDuplicateView(): void
  onDeleteView(): void
  onExportView(): void
  editable: boolean
  controller: Pick<CsvViewController, 'queryScoped' | 'discoverGroups'>
  sample: CsvSample | null
  cacheToken: string | null
  theme: 'light' | 'dark'
  tabId?: string
}

export function CsvViewHost({ view, columns, query, onLoadMore, onRetry, onEditView, onEditColumnType, onManageViews, onChangeView, onDuplicateView, onDeleteView, onExportView, editable, controller, sample, cacheToken, theme, tabId }: CsvViewHostProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const columnMap = new Map(columns.map((column) => [column.id, column]))
  const scoped = view.layout.kind === 'kanban' || view.layout.kind === 'calendar'
  return <section id="csv-view-panel" className="csv-view-host" role="tabpanel" aria-labelledby={tabId ?? `csv-view-${view.id}-tab`}>
    <div className="csv-view-toolbar" aria-label={`${view.name} 도구 모음`}>
      <div className="csv-view-toolbar-chips">
        {layoutSummary(view, columnMap) && <span className="csv-view-chip summary" title={layoutSummary(view, columnMap)}><span className="csv-view-chip-text">{layoutSummary(view, columnMap)}</span></span>}
        {view.filter && <span className="csv-view-chip summary" title={filterSummary(view.filter, columnMap)}><Filter size={13} aria-hidden="true" /><span className="csv-view-chip-text">{filterSummary(view.filter, columnMap)}</span>{editable && <button type="button" className="csv-view-chip-remove" aria-label="필터 지우기" onClick={() => onChangeView({ ...view, filter: null, updatedAt: new Date().toISOString() })}>×</button>}</span>}
        {view.sort.map((sort) => <span className="csv-view-chip summary" key={sort.columnId} title={`${columnMap.get(sort.columnId)?.label ?? sort.columnId} ${sort.direction === 'asc' ? '오름차순' : '내림차순'}`}><ArrowDownUp size={13} aria-hidden="true" /><span className="csv-view-chip-text">{columnMap.get(sort.columnId)?.label ?? sort.columnId} {sort.direction === 'asc' ? '↑' : '↓'}</span>{editable && <button type="button" className="csv-view-chip-remove" aria-label={`${columnMap.get(sort.columnId)?.label ?? sort.columnId} 정렬 지우기`} onClick={() => onChangeView({ ...view, sort: view.sort.filter((item) => item.columnId !== sort.columnId), updatedAt: new Date().toISOString() })}>×</button>}</span>)}
        <button type="button" className="csv-view-chip ghost" onClick={onEditView}><Plus size={13} aria-hidden="true" />필터</button>
      </div>
      <div className="csv-view-toolbar-spacer" />
      <button type="button" className="csv-view-tool-button" onClick={() => { const columnId = view.columnIds[0] ?? columns[0]?.id; if (columnId) onEditColumnType(columnId) }} disabled={!columns.length}><Type size={15} aria-hidden="true" /><span>컬럼 타입</span></button>
      <button type="button" className="csv-view-tool-button" onClick={onEditView}><Settings2 size={15} aria-hidden="true" /><span>뷰 설정</span></button>
      <div className="csv-view-menu-wrap">
        <button type="button" className="csv-view-tool-button icon-only" aria-label="뷰 메뉴" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><MoreHorizontal size={17} aria-hidden="true" /></button>
        {menuOpen && <div className="csv-view-menu" role="menu">
          <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onEditView() }}><Settings2 size={14} aria-hidden="true" />뷰 설정 편집</button>
          {editable && <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onDuplicateView() }}><Copy size={14} aria-hidden="true" />복제</button>}
          {editable && <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onExportView() }}><Download size={14} aria-hidden="true" />뷰 다운로드 <small>.json</small></button>}
          <hr />
          <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onManageViews() }}><Settings2 size={14} aria-hidden="true" />보기 관리</button>
          <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onManageViews() }}><Upload size={14} aria-hidden="true" />뷰 가져오기</button>
          {editable && <><hr /><button type="button" role="menuitem" className="danger" onClick={() => { setMenuOpen(false); onDeleteView() }}><Trash2 size={14} aria-hidden="true" />뷰 삭제</button></>}
          <p>뷰 설정은 브라우저에 따로 저장됩니다. CSV 수정 상태와 무관합니다.</p>
        </div>}
      </div>
    </div>
    {view.layout.kind === 'kanban' && <CsvKanbanView view={view as CsvViewDefinition & { layout: Extract<CsvViewDefinition['layout'], { kind: 'kanban' }> }} columns={columns} sample={sample} controller={controller} />}
    {view.layout.kind === 'calendar' && <CsvCalendarView view={view as CsvViewDefinition & { layout: Extract<CsvViewDefinition['layout'], { kind: 'calendar' }> }} columns={columns} controller={controller} cacheToken={cacheToken} />}
    {!scoped && query.status === 'loading' && <>
      {view.layout.kind === 'grid' ? <div className="csv-view-loading-grid" role="status" aria-label="CSV 결과 조회 중"><table><thead><tr><th>#</th>{view.columnIds.map((id) => <th key={id}>{columnMap.get(id)?.label ?? id}</th>)}</tr></thead><tbody>{Array.from({ length: 10 }, (_, rowIndex) => <tr key={rowIndex}><td>{rowIndex + 1}</td>{view.columnIds.map((id, columnIndex) => <td key={id}><span style={{ width: `${34 + ((rowIndex * 17 + columnIndex * 23) % 48)}%` }} /></td>)}</tr>)}</tbody></table></div> : <div className="csv-view-state" role="status">조회 중…</div>}
      <footer className="csv-view-statusbar" role="status"><span>조회 중…</span><span className="csv-view-status-spacer" />표본과 원본 크기에 따라 시간이 걸릴 수 있습니다.</footer>
    </>}
    {!scoped && query.status === 'error' && <div className="csv-view-state" role="alert"><p>{query.error.message}</p><button type="button" className="secondary-button" onClick={onRetry}>다시 조회</button></div>}
    {!scoped && query.status === 'idle' && <div className="csv-view-state" role="status">조회 조건을 준비하고 있습니다.</div>}
    {!scoped && query.status === 'ready' && query.rows.length === 0 && <div className="csv-view-empty-state" role="status"><strong>조건에 맞는 행이 없습니다</strong><p>{view.filter ? `현재 필터: ${filterSummary(view.filter, columnMap)}. ` : '현재 조건에는 '}해석 실패와 빈 값은 일반 비교에서 제외됩니다.</p><div>{editable && view.filter && <button type="button" className="secondary-button" onClick={() => onChangeView({ ...view, filter: null, updatedAt: new Date().toISOString() })}>필터 해제</button>}<button type="button" className="secondary-button" onClick={onEditView}>{editable ? '뷰 설정' : '보기 추가'}</button></div></div>}
    {!scoped && query.status === 'ready' && query.rows.length > 0 && <>
      {view.layout.kind === 'grid' && <CsvQueryTable layout={view.layout} columns={columnMap} columnIds={view.columnIds} displayOverrides={view.displayOverrides} rows={query.rows} hasMore={query.hasMore} loadingMore={query.loadingMore} loadMoreError={query.loadMoreError} onLoadMore={onLoadMore} onRetryLoadMore={onRetry} theme={theme} onEditColumnType={onEditColumnType} />}
      {view.layout.kind === 'list' && <CsvListView layout={view.layout} columns={columnMap} columnIds={view.columnIds} displayOverrides={view.displayOverrides} rows={query.rows} hasMore={query.hasMore} loadingMore={query.loadingMore} loadMoreError={query.loadMoreError} onLoadMore={onLoadMore} onRetryLoadMore={onRetry} />}
      {view.layout.kind === 'gallery' && <CsvGalleryView layout={view.layout} columns={columnMap} columnIds={view.columnIds} displayOverrides={view.displayOverrides} rows={query.rows} hasMore={query.hasMore} loadingMore={query.loadingMore} loadMoreError={query.loadMoreError} onLoadMore={onLoadMore} onRetryLoadMore={onRetry} />}
    </>}
    {query.status === 'ready' && <footer className="csv-view-statusbar" role="status"><span>{query.rows.length.toLocaleString()}행 표시{query.hasMore ? ' · 더 보기 가능' : ''}</span><span>{totalLabel(query.total)}</span>{query.diagnostics.length > 0 && <span className="csv-view-status-warning">진단 {query.diagnostics.length}개 · {diagnosticLabel(query.diagnostics[0]!.code)}</span>}<span className="csv-view-status-spacer" />{query.loadingMore && <span>추가 행 불러오는 중…</span>}</footer>}
  </section>
}

function totalLabel(total: CsvTotal): string {
  if (total.status === 'exact') return `전체 ${formatCount(total.value)}행`
  if (total.status === 'estimated') return `표본 기준 약 ${formatCount(total.value)}행`
  return '전체 행 수는 아직 알 수 없음'
}

function formatCount(value: string): string {
  try { return BigInt(value).toLocaleString() }
  catch { return value }
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
