import { useMemo, useState } from 'react'
import type { CsvColumnDefinition, CsvImportDecisions, CsvImportPreview } from '../../domain/csv-views/model'

export function CsvImportReviewDialog({ preview, columns, onCancel, onApply }: { preview: CsvImportPreview; columns: CsvColumnDefinition[]; onCancel(): void; onApply(decisions: CsvImportDecisions): void }) {
  const suggested = useMemo(() => Object.fromEntries(preview.columnMatches.map((match) => [match.importedColumnId, match.basis === 'header-and-position' ? match.sourceIndex! : 'skip' as const])), [preview])
  const [columnMap, setColumnMap] = useState<Record<string, number | 'skip'>>(suggested)
  const [viewIds, setViewIds] = useState(() => preview.bundle.views.map((view) => view.id))
  const [typeResolution, setTypeResolution] = useState<Record<string, 'keep-existing' | 'use-imported'>>(() => Object.fromEntries(preview.typeConflicts.map((item) => [item.columnId, 'keep-existing'])))
  const hasUnmappedSelectedView = useMemo(() => preview.bundle.views.filter((view) => viewIds.includes(view.id)).some((view) => {
    const referenced = [
      ...view.columnIds,
      ...view.sort.map((item) => item.columnId),
      ...(view.filter ? filterColumnIds(view.filter) : []),
      ...(view.layout.kind === 'list' ? [view.layout.titleColumnId, view.layout.subtitleColumnId, view.layout.trailingColumnId, view.layout.colorColumnId, view.layout.groupColumnId].filter((id): id is string => id !== null) : []),
      ...(view.layout.kind === 'gallery' ? [view.layout.titleColumnId, view.layout.coverColumnId].filter((id): id is string => id !== null) : []),
      ...(view.layout.kind === 'kanban' ? [view.layout.groupColumnId] : []),
      ...(view.layout.kind === 'calendar' ? [view.layout.dateColumnId] : [])
    ]
    return referenced.some((id) => columnMap[id] === undefined || columnMap[id] === 'skip')
  }), [columnMap, preview.bundle.views, viewIds])
  const apply = () => onApply({ columnMap, viewIds, typeResolution })
  return <div className="csv-view-editor-overlay"><section className="csv-view-editor csv-import-review" role="dialog" aria-modal="true" aria-labelledby="csv-import-review-title">
    <header><div><h2 id="csv-import-review-title">CSV 보기 가져오기</h2><p>{preview.bundle.source.fileName} · {preview.bundle.views.length}개 보기</p></div><button className="icon-button" type="button" aria-label="가져오기 취소" onClick={onCancel}>×</button></header>
    <div className="csv-view-editor-body">
      {preview.filledDefaults.length > 0 && <p className="inline-warning">누락된 선택 필드 {preview.filledDefaults.length}개를 기본값으로 채웁니다.</p>}
      <h3>컬럼 연결</h3>
      {preview.columnMatches.map((match) => {
        const imported = preview.bundle.profile.columns.find((column) => column.id === match.importedColumnId)!
        return <label className="csv-import-column-row" key={match.importedColumnId}><span>{imported.label}<small>{imported.sourceHeader ?? `열 ${imported.sourceIndex + 1}`} · {match.basis}</small></span><select aria-label={`${imported.label} 연결`} value={columnMap[imported.id] ?? 'skip'} onChange={(event) => setColumnMap((current) => ({ ...current, [imported.id]: event.currentTarget.value === 'skip' ? 'skip' : Number(event.currentTarget.value) }))}><option value="skip">건너뛰기</option>{columns.map((column) => <option key={column.id} value={column.sourceIndex}>{column.label} · {column.sourceHeader ?? `열 ${column.sourceIndex + 1}`}</option>)}</select></label>
      })}
      {preview.typeConflicts.length > 0 && <><h3>공통 타입 충돌</h3>{preview.typeConflicts.map((conflict) => <label className="csv-import-column-row" key={conflict.columnId}><span>{columns.find((column) => column.id === conflict.columnId)?.label}<small>{conflict.existing} → {conflict.imported}</small></span><select value={typeResolution[conflict.columnId] ?? 'keep-existing'} onChange={(event) => setTypeResolution((current) => ({ ...current, [conflict.columnId]: event.currentTarget.value as 'keep-existing' | 'use-imported' }))}><option value="keep-existing">현재 타입 유지</option><option value="use-imported">가져온 타입 적용</option></select></label>)}</>}
      <h3>가져올 보기</h3>
      {preview.bundle.views.map((view) => <label className="csv-view-check-row" key={view.id}><input type="checkbox" checked={viewIds.includes(view.id)} onChange={(event) => setViewIds((current) => event.currentTarget.checked ? [...current, view.id] : current.filter((id) => id !== view.id))} /><span>{view.name}</span><small>{view.layout.kind}{preview.idConflicts.includes(view.id) ? ' · 새 ID로 복제' : ''}</small></label>)}
      {hasUnmappedSelectedView && <p className="csv-view-error" role="alert">선택한 보기가 사용하는 컬럼을 모두 연결해야 적용할 수 있습니다.</p>}
    </div>
    <footer><button className="secondary-button" type="button" onClick={onCancel}>취소</button><button className="primary-button" type="button" disabled={hasUnmappedSelectedView || viewIds.length === 0} onClick={apply}>적용</button></footer>
  </section></div>
}

function filterColumnIds(filter: import('../../domain/csv-views/model').CsvFilter): string[] {
  if ('children' in filter) return filter.children.flatMap(filterColumnIds)
  if ('child' in filter) return filterColumnIds(filter.child)
  return 'columnId' in filter ? [filter.columnId] : []
}
