import type { CsvResultViewProps } from './CsvQueryTable'
import { csvQueryNextStep } from '../../domain/csv-views/errorGuidance'
import { CsvCellDisplay } from './CsvCellDisplay'

export function CsvGalleryView({ layout, columns, columnIds, displayOverrides, rows, hasMore, loadingMore, loadMoreError, onLoadMore, onRetryLoadMore, onAdjustQuery }: CsvResultViewProps<Extract<import('../../domain/csv-views/model').CsvLayout, { kind: 'gallery' }>>) {
  const title = columns.get(layout.titleColumnId)
  const cover = layout.coverColumnId ? columns.get(layout.coverColumnId) : undefined
  return <div className="csv-view-gallery-wrap"><div className="csv-view-gallery">
    {rows.map((row) => <article className="csv-view-card" key={row.rowId}>
      {cover && layout.coverColumnId && <div className="csv-view-card-cover"><CsvCellDisplay column={cover} override={displayOverrides[layout.coverColumnId]} cell={row.cells[layout.coverColumnId]} /></div>}
      <div className="csv-view-card-head"><div><h2><CsvCellDisplay column={title} override={displayOverrides[layout.titleColumnId]} cell={row.cells[layout.titleColumnId]} /></h2>{layout.subtitleColumnId && <p className="csv-view-card-subtitle"><CsvCellDisplay column={columns.get(layout.subtitleColumnId)} override={displayOverrides[layout.subtitleColumnId]} cell={row.cells[layout.subtitleColumnId]} /></p>}</div><span className="csv-view-card-record">#{row.recordNo}</span></div>
      {(layout.badgeColumnIds?.length ?? 0) > 0 && <div className="csv-view-card-badges">{(layout.badgeColumnIds ?? []).map((id) => <span key={id}><CsvCellDisplay column={columns.get(id)} override={displayOverrides[id]} cell={row.cells[id]} /></span>)}</div>}
      <dl className="csv-view-card-fields">{columnIds.filter((id) => ![layout.titleColumnId, layout.subtitleColumnId, layout.coverColumnId, ...(layout.badgeColumnIds ?? []), ...(layout.footerColumnIds ?? [])].includes(id)).map((id) => <div className="csv-view-card-field" key={id}><dt>{displayOverrides[id]?.label ?? columns.get(id)?.label ?? id}</dt><dd><CsvCellDisplay column={columns.get(id)} override={displayOverrides[id]} cell={row.cells[id]} /></dd></div>)}</dl>
      {(layout.footerColumnIds?.length ?? 0) > 0 && <div className="csv-view-card-footer">{(layout.footerColumnIds ?? []).map((id) => <span key={id}><small>{displayOverrides[id]?.label ?? columns.get(id)?.label ?? id}</small><CsvCellDisplay column={columns.get(id)} override={displayOverrides[id]} cell={row.cells[id]} /></span>)}</div>}
    </article>)}
    {hasMore && (loadMoreError
      ? <section className="csv-view-load-more-tile error" role="alert"><strong>추가 조회를 완료하지 못했습니다</strong><span>{loadMoreError.message} {csvQueryNextStep(loadMoreError)}</span><div><button type="button" className="subtle-button" onClick={onRetryLoadMore}>다시 조회</button><button type="button" className="subtle-button" onClick={onAdjustQuery}>조건 수정</button></div></section>
      : <button type="button" className="csv-view-load-more-tile" disabled={loadingMore} onClick={onLoadMore}><strong>{loadingMore ? '불러오는 중…' : '추가 조회'}</strong><span>{loadingMore ? '다음 결과를 가져오고 있습니다.' : '다음 카드 묶음을 불러옵니다.'}</span></button>)}
  </div></div>
}
