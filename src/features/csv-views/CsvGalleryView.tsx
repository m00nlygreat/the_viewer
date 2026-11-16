import { formatCell, resolveDisplay } from '../../domain/csv-views/format'
import type { CsvColumnDefinition, CsvDisplayOverride, CsvQueryRow } from '../../domain/csv-views/model'
import type { CsvResultViewProps } from './CsvQueryTable'

export function CsvGalleryView({ layout, columns, columnIds, displayOverrides, rows, hasMore, loadingMore, loadMoreError, onLoadMore, onRetryLoadMore }: CsvResultViewProps<Extract<import('../../domain/csv-views/model').CsvLayout, { kind: 'gallery' }>>) {
  const title = columns.get(layout.titleColumnId)
  const cover = layout.coverColumnId ? columns.get(layout.coverColumnId) : undefined
  return <div className="csv-view-gallery-wrap"><div className="csv-view-gallery">
    {rows.map((row) => <article className="csv-view-card" key={row.rowId}>
      {cover && layout.coverColumnId && <div className="csv-view-card-cover">{format(cover, displayOverrides[layout.coverColumnId], row.cells[layout.coverColumnId])}</div>}
      <h2>{format(title, displayOverrides[layout.titleColumnId], row.cells[layout.titleColumnId])}</h2>
      {columnIds.filter((id) => id !== layout.titleColumnId && id !== layout.coverColumnId).map((id) => <div className="csv-view-card-field" key={id}><small>{displayOverrides[id]?.label ?? columns.get(id)?.label ?? id}</small><span>{format(columns.get(id), displayOverrides[id], row.cells[id])}</span></div>)}
    </article>)}
  </div>{hasMore && <div className="csv-query-more">{loadMoreError ? <><span role="alert">추가 카드를 불러오지 못했습니다.</span><button type="button" className="subtle-button" onClick={onRetryLoadMore}>다시 시도</button></> : <button type="button" className="subtle-button" onClick={onLoadMore} disabled={loadingMore}>{loadingMore ? '불러오는 중…' : '더 보기'}</button>}</div>}</div>
}

function format(column: CsvColumnDefinition | undefined, override: CsvDisplayOverride | undefined, cell: CsvQueryRow['cells'][string] | undefined): string {
  if (!column || !cell) return '누락'
  return formatCell(column, resolveDisplay(column, override), cell, override?.stateText ?? {}).text
}
