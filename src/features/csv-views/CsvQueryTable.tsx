import { formatCell, resolveDisplay } from '../../domain/csv-views/format'
import type { CsvCell, CsvColumnDefinition, CsvDisplayOverride, CsvQueryError, CsvQueryRow } from '../../domain/csv-views/model'

export interface CsvResultViewProps<L> {
  layout: L
  columns: ReadonlyMap<string, CsvColumnDefinition>
  columnIds: string[]
  displayOverrides: Record<string, CsvDisplayOverride>
  rows: CsvQueryRow[]
  hasMore: boolean
  loadingMore: boolean
  loadMoreError: CsvQueryError | null
  onLoadMore(): void
  onRetryLoadMore(): void
}

export function CsvQueryTable({ columns, columnIds, displayOverrides, rows, hasMore, loadingMore, loadMoreError, onLoadMore, onRetryLoadMore }: CsvResultViewProps<{ kind: 'grid' }>) {
  return <div className="csv-query-table-scroll" role="region" aria-label="조회 결과 표">
    <table className="csv-query-table"><thead><tr>{columnIds.map((id) => <th key={id} scope="col">{displayOverrides[id]?.label ?? columns.get(id)?.label ?? id}</th>)}</tr></thead>
      <tbody>{rows.map((row) => <tr key={row.rowId}>{columnIds.map((id) => <td key={id}>{renderCell(columns.get(id), displayOverrides[id], row.cells[id])}</td>)}</tr>)}</tbody>
    </table>
    {hasMore && <div className="csv-query-more">{loadMoreError ? <><span role="alert">추가 행을 불러오지 못했습니다.</span><button type="button" className="subtle-button" onClick={onRetryLoadMore}>다시 시도</button></> : <button type="button" className="subtle-button" onClick={onLoadMore} disabled={loadingMore}>{loadingMore ? '불러오는 중…' : '더 보기'}</button>}</div>}
  </div>
}

function renderCell(column: CsvColumnDefinition | undefined, override: CsvDisplayOverride | undefined, cell: CsvCell | undefined) {
  if (!column || !cell) return <span className="csv-view-cell missing">누락</span>
  const formatted = formatCell(column, resolveDisplay(column, override), cell, override?.stateText ?? {})
  return <span className={`csv-view-cell ${formatted.tone}`} title={formatted.tone === 'invalid' ? '해석 실패' : undefined} style={{ textAlign: formatted.align === 'end' ? 'right' : 'left' }}>
    {formatted.chips ? formatted.chips.map((chip, index) => <span key={`${chip.text}-${index}`} className={`csv-view-chip${chip.unmatched ? ' unmatched' : ''}`} data-color={chip.color ?? undefined}>{chip.text}</span>) : formatted.text}
  </span>
}
