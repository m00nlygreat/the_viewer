import type { CsvColumnDefinition, CsvViewDefinition } from '../../domain/csv-views/model'
import type { CsvQueryState } from '../../app/csvViewController'
import { CsvGalleryView } from './CsvGalleryView'
import { CsvListView } from './CsvListView'
import { CsvQueryTable } from './CsvQueryTable'
import { CsvKanbanView } from './CsvKanbanView'
import { CsvCalendarView } from './CsvCalendarView'
import type { CsvSample } from '../../domain/csv-views/model'
import type { CsvViewController } from '../../app/csvViewController'

export interface CsvViewHostProps {
  view: CsvViewDefinition
  columns: CsvColumnDefinition[]
  query: CsvQueryState
  onLoadMore(): void
  onRetry(): void
  onEditView(): void
  controller: Pick<CsvViewController, 'queryScoped' | 'discoverGroups'>
  sample: CsvSample | null
  cacheToken: string | null
  theme: 'light' | 'dark'
  tabId?: string
}

export function CsvViewHost({ view, columns, query, onLoadMore, onRetry, onEditView, controller, sample, cacheToken, theme, tabId }: CsvViewHostProps) {
  const columnMap = new Map(columns.map((column) => [column.id, column]))
  const scoped = view.layout.kind === 'kanban' || view.layout.kind === 'calendar'
  return <section id="csv-view-panel" className="csv-view-host" role="tabpanel" aria-labelledby={tabId ?? `csv-view-${view.id}-tab`}>
    <div className="csv-view-heading"><div><h1>{view.name}</h1><p>{view.layout.kind === 'grid' ? '표' : view.layout.kind === 'list' ? '리스트' : view.layout.kind === 'gallery' ? '갤러리' : view.layout.kind === 'kanban' ? '칸반' : '캘린더'} 보기</p></div><button type="button" className="subtle-button" onClick={onEditView}>보기 편집</button></div>
    {view.layout.kind === 'kanban' && <CsvKanbanView view={view as CsvViewDefinition & { layout: Extract<CsvViewDefinition['layout'], { kind: 'kanban' }> }} columns={columns} sample={sample} controller={controller} />}
    {view.layout.kind === 'calendar' && <CsvCalendarView view={view as CsvViewDefinition & { layout: Extract<CsvViewDefinition['layout'], { kind: 'calendar' }> }} columns={columns} controller={controller} cacheToken={cacheToken} />}
    {!scoped && query.status === 'loading' && <div className="csv-view-state" role="status">조회 중…</div>}
    {!scoped && query.status === 'error' && <div className="csv-view-state" role="alert"><p>{query.error.message}</p><button type="button" className="secondary-button" onClick={onRetry}>다시 조회</button></div>}
    {!scoped && query.status === 'idle' && <div className="csv-view-state" role="status">조회 조건을 준비하고 있습니다.</div>}
    {!scoped && query.status === 'ready' && query.rows.length === 0 && <div className="csv-view-state" role="status">조건에 맞는 행이 없습니다.</div>}
    {!scoped && query.status === 'ready' && query.rows.length > 0 && <>
      {view.layout.kind === 'grid' && <CsvQueryTable layout={view.layout} columns={columnMap} columnIds={view.columnIds} displayOverrides={view.displayOverrides} rows={query.rows} hasMore={query.hasMore} loadingMore={query.loadingMore} loadMoreError={query.loadMoreError} onLoadMore={onLoadMore} onRetryLoadMore={onRetry} theme={theme} />}
      {view.layout.kind === 'list' && <CsvListView layout={view.layout} columns={columnMap} columnIds={view.columnIds} displayOverrides={view.displayOverrides} rows={query.rows} hasMore={query.hasMore} loadingMore={query.loadingMore} loadMoreError={query.loadMoreError} onLoadMore={onLoadMore} onRetryLoadMore={onRetry} />}
      {view.layout.kind === 'gallery' && <CsvGalleryView layout={view.layout} columns={columnMap} columnIds={view.columnIds} displayOverrides={view.displayOverrides} rows={query.rows} hasMore={query.hasMore} loadingMore={query.loadingMore} loadMoreError={query.loadMoreError} onLoadMore={onLoadMore} onRetryLoadMore={onRetry} />}
    </>}
  </section>
}
