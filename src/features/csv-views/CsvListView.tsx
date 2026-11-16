import { formatCell, resolveDisplay } from '../../domain/csv-views/format'
import type { CsvColumnDefinition, CsvDisplayOverride, CsvQueryRow } from '../../domain/csv-views/model'
import type { CsvResultViewProps } from './CsvQueryTable'

export function CsvListView({ layout, columns, columnIds, displayOverrides, rows, hasMore, loadingMore, loadMoreError, onLoadMore, onRetryLoadMore }: CsvResultViewProps<Extract<import('../../domain/csv-views/model').CsvLayout, { kind: 'list' }>>) {
  const title = columns.get(layout.titleColumnId)
  const group = layout.groupColumnId ? columns.get(layout.groupColumnId) : undefined
  let currentGroup = ''
  return <div className="csv-view-list">
    {rows.map((row) => {
      const groupCell = group && layout.groupColumnId ? row.cells[layout.groupColumnId] : null
      const groupText = group && groupCell ? groupLabel(group, groupCell) : ''
      const showGroup = Boolean(group && groupText !== currentGroup)
      currentGroup = groupText
      const titleCell = row.cells[layout.titleColumnId]
      return <article className="csv-view-list-item" key={row.rowId}>
        {showGroup && <h3 className="csv-view-group-heading">{groupText}</h3>}
        <div className="csv-view-list-main"><strong>{format(title, displayOverrides[layout.titleColumnId], titleCell)}</strong>
          {layout.subtitleColumnId && <span className="csv-view-subtitle">{format(columns.get(layout.subtitleColumnId), displayOverrides[layout.subtitleColumnId], row.cells[layout.subtitleColumnId])}</span>}
          {layout.trailingColumnId && <span className="csv-view-trailing">{format(columns.get(layout.trailingColumnId), displayOverrides[layout.trailingColumnId], row.cells[layout.trailingColumnId])}</span>}
        </div>
        <div className="csv-view-list-values">{columnIds.filter((id) => ![layout.titleColumnId, layout.subtitleColumnId, layout.trailingColumnId].includes(id)).map((id) => <span key={id}><small>{displayOverrides[id]?.label ?? columns.get(id)?.label ?? id}</small>{format(columns.get(id), displayOverrides[id], row.cells[id])}</span>)}</div>
      </article>
    })}
    {hasMore && <div className="csv-query-more">{loadMoreError ? <><span role="alert">추가 항목을 불러오지 못했습니다.</span><button type="button" className="subtle-button" onClick={onRetryLoadMore}>다시 시도</button></> : <button type="button" className="subtle-button" onClick={onLoadMore} disabled={loadingMore}>{loadingMore ? '불러오는 중…' : '더 보기'}</button>}</div>}
  </div>
}

function format(column: CsvColumnDefinition | undefined, override: CsvDisplayOverride | undefined, cell: CsvQueryRow['cells'][string] | undefined): string {
  if (!column || !cell) return '누락'
  return formatCell(column, resolveDisplay(column, override), cell, override?.stateText ?? {}).text
}
function groupLabel(column: CsvColumnDefinition, cell: CsvQueryRow['cells'][string]): string {
  if (cell.state !== 'value') return { empty: '빈 값', missing: '누락', 'null-marker': '결측 표식', invalid: '해석 실패' }[cell.state] ?? ''
  if (column.type === 'select' && typeof cell.value === 'string') return column.parse.options.find((option) => option.id === cell.value)?.label ?? cell.value
  if (column.type === 'boolean' && typeof cell.value === 'boolean') return cell.value ? column.display.trueLabel : column.display.falseLabel
  return String(cell.value)
}
