import { useMemo, useState } from 'react'
import { Check, CircleAlert } from 'lucide-react'
import type { CsvColumnDefinition, CsvImportDecisions, CsvImportPreview, CsvViewDefinition } from '../../domain/csv-views/model'

const steps = ['검증', '컬럼 연결', '충돌 조정', '적용']

export function CsvImportReviewDialog({ preview, columns, onCancel, onApply }: { preview: CsvImportPreview; columns: CsvColumnDefinition[]; onCancel(): void; onApply(decisions: CsvImportDecisions): void }) {
  const suggested = useMemo(() => Object.fromEntries(preview.columnMatches.map((match) => [match.importedColumnId, match.basis === 'header-and-position' || match.basis === 'header' ? match.sourceIndex! : 'skip' as const])), [preview])
  const [step, setStep] = useState(2)
  const [columnMap, setColumnMap] = useState<Record<string, number | 'skip'>>(suggested)
  const [viewIds, setViewIds] = useState(() => preview.bundle.views.map((view) => view.id))
  const [typeResolution, setTypeResolution] = useState<Record<string, 'keep-existing' | 'use-imported'>>(() => Object.fromEntries(preview.typeConflicts.map((item) => [item.columnId, 'keep-existing'])))
  const hasUnmappedSelectedView = useMemo(() => preview.bundle.views.filter((view) => viewIds.includes(view.id)).some((view) => referencedColumnIds(view).some((id) => columnMap[id] === undefined || columnMap[id] === 'skip')), [columnMap, preview.bundle.views, viewIds])
  const referencedCount = new Set(preview.bundle.views.filter((view) => viewIds.includes(view.id)).flatMap(referencedColumnIds)).size
  const apply = () => onApply({ columnMap, viewIds, typeResolution })
  const next = () => setStep((current) => Math.min(4, current + 1))
  const back = () => setStep((current) => Math.max(2, current - 1))

  return <div className="csv-view-editor-overlay"><section className="csv-view-editor csv-import-review" role="dialog" aria-modal="true" aria-labelledby="csv-import-review-title">
    <header><div><h2 id="csv-import-review-title">뷰 가져오기</h2><p>{preview.bundle.source.fileName} · 스키마 v{preview.bundle.schemaVersion}</p></div><button className="icon-button" type="button" aria-label="가져오기 취소" onClick={onCancel}>×</button></header>
    <div className="csv-import-review-body">
      <ol className="csv-import-steps" aria-label="가져오기 단계">{steps.map((label, index) => {
        const stepNumber = index + 1
        return <li key={label} className={stepNumber === step ? 'active' : stepNumber < step ? 'complete' : ''} aria-current={stepNumber === step ? 'step' : undefined}><span>{stepNumber < step ? <Check size={13} /> : stepNumber}</span>{label}</li>
      })}</ol>
      <div className="csv-import-evidence"><span><Check size={14} />검증 완료 · 스키마 v{preview.bundle.schemaVersion}</span><span>뷰 <b>{preview.bundle.views.length}</b>개</span><span>선택 뷰 컬럼 <b>{referencedCount}</b>개 참조</span></div>
      {step === 2 && <section className="csv-import-step-panel" aria-labelledby="csv-import-columns-title">
        <h3 id="csv-import-columns-title">가져온 컬럼을 현재 파일에 연결하세요.</h3>
        {preview.columnMatches.length > 0 ? <div className="csv-import-table-wrap"><table className="csv-import-map-table"><thead><tr><th>가져온 컬럼</th><th>현재 파일 컬럼</th><th>연결 상태</th></tr></thead><tbody>{preview.columnMatches.map((match) => {
          const imported = preview.bundle.profile.columns.find((column) => column.id === match.importedColumnId)!
          const mapped = columnMap[imported.id]
          const status = mapped === undefined || mapped === 'skip' ? '연결 필요' : match.basis === 'header' || match.basis === 'header-and-position' ? '헤더 일치' : '직접 연결'
          return <tr key={match.importedColumnId}><td><strong>{imported.label}</strong><small>{imported.sourceHeader ?? `열 ${imported.sourceIndex + 1}`}</small></td><td><select aria-label={`${imported.label} 연결`} value={mapped ?? 'skip'} onChange={(event) => setColumnMap((current) => ({ ...current, [imported.id]: event.currentTarget.value === 'skip' ? 'skip' : Number(event.currentTarget.value) }))}><option value="skip">연결할 컬럼 선택…</option>{columns.map((column) => <option key={column.id} value={column.sourceIndex}>{column.label} · {column.sourceHeader ?? `열 ${column.sourceIndex + 1}`}</option>)}</select></td><td className={status === '헤더 일치' ? 'matched' : status === '연결 필요' ? 'needs-mapping' : ''}>{status}</td></tr>
        })}</tbody></table></div> : <p className="csv-import-empty">가져온 뷰가 사용하는 컬럼이 없습니다.</p>}
        {hasUnmappedSelectedView && <p className="csv-view-error" role="alert"><CircleAlert size={14} />선택한 보기가 사용하는 컬럼을 모두 연결해야 다음 단계로 갈 수 있습니다.</p>}
        {preview.filledDefaults.length > 0 && <p className="inline-warning">누락된 선택 필드 {preview.filledDefaults.length}개를 기본값으로 채웠습니다.</p>}
      </section>}
      {step === 3 && <section className="csv-import-step-panel" aria-labelledby="csv-import-conflicts-title">
        <h3 id="csv-import-conflicts-title">가져온 설정과 현재 파일의 차이를 확인하세요.</h3>
        {preview.typeConflicts.length > 0 ? <div className="csv-import-conflict-list">{preview.typeConflicts.map((conflict) => <fieldset className="csv-import-conflict" key={conflict.columnId}><legend>{columns.find((column) => column.id === conflict.columnId)?.label ?? conflict.columnId} · {conflict.imported} ↔ {conflict.existing}</legend><label><input type="radio" name={`type-${conflict.columnId}`} checked={typeResolution[conflict.columnId] !== 'use-imported'} onChange={() => setTypeResolution((current) => ({ ...current, [conflict.columnId]: 'keep-existing' }))} />현재 타입({conflict.existing}) 유지</label><label><input type="radio" name={`type-${conflict.columnId}`} checked={typeResolution[conflict.columnId] === 'use-imported'} onChange={() => setTypeResolution((current) => ({ ...current, [conflict.columnId]: 'use-imported' }))} />공통 스키마를 {conflict.imported}(으)로 변경</label></fieldset>)}</div> : <p className="csv-import-empty">공통 컬럼 타입 충돌이 없습니다.</p>}
        {preview.idConflicts.length > 0 && <p className="csv-import-info">같은 ID의 뷰 {preview.idConflicts.length}개는 새 ID로 복제됩니다.</p>}
      </section>}
      {step === 4 && <section className="csv-import-step-panel" aria-labelledby="csv-import-views-title">
        <h3 id="csv-import-views-title">가져올 뷰를 선택하세요.</h3>
        {preview.bundle.views.map((view) => <label className="csv-import-view-option" key={view.id}><input type="checkbox" checked={viewIds.includes(view.id)} onChange={(event) => setViewIds((current) => event.currentTarget.checked ? [...current, view.id] : current.filter((id) => id !== view.id))} /><span><strong>{view.name}</strong><small>{layoutLabel(view)}{preview.idConflicts.includes(view.id) ? ' · 새 ID로 복제' : ''}</small></span><span>{referencedColumnIds(view).length}개 컬럼</span></label>)}
        {viewIds.length === 0 && <p className="csv-view-error" role="alert">가져올 뷰를 하나 이상 선택하세요.</p>}
        <p className="csv-import-info">취소하면 설정은 저장되지 않습니다. 같은 ID의 뷰는 새 보기로 복제합니다.</p>
      </section>}
    </div>
    <footer><button className="secondary-button" type="button" onClick={onCancel}>취소</button><span className="csv-import-footer-spacer" />{step > 2 && <button className="secondary-button" type="button" onClick={back}>이전</button>}{step < 4 ? <button className="primary-button" type="button" disabled={step === 2 && (hasUnmappedSelectedView || viewIds.length === 0)} onClick={next}>다음</button> : <button className="primary-button" type="button" disabled={hasUnmappedSelectedView || viewIds.length === 0} onClick={apply}>적용</button>}</footer>
  </section></div>
}

function referencedColumnIds(view: CsvViewDefinition): string[] {
  return [...new Set([
    ...view.columnIds,
    ...view.sort.map((item) => item.columnId),
    ...filterColumnIds(view.filter),
    ...Object.keys(view.displayOverrides),
    ...(view.layout.kind === 'list' ? [view.layout.titleColumnId, view.layout.subtitleColumnId, view.layout.trailingColumnId, view.layout.colorColumnId, view.layout.groupColumnId, ...(view.layout.badgeColumnIds ?? [])].filter((id): id is string => id !== null) : []),
    ...(view.layout.kind === 'gallery' ? [view.layout.titleColumnId, view.layout.coverColumnId, view.layout.subtitleColumnId, ...(view.layout.badgeColumnIds ?? []), ...(view.layout.footerColumnIds ?? [])].filter((id): id is string => id !== null) : []),
    ...(view.layout.kind === 'kanban' ? [view.layout.groupColumnId, view.layout.titleColumnId, view.layout.subtitleColumnId, view.layout.trailingColumnId, ...(view.layout.footerColumnIds ?? [])].filter((id): id is string => id !== null) : []),
    ...(view.layout.kind === 'calendar' ? [view.layout.dateColumnId, view.layout.titleColumnId, view.layout.subtitleColumnId, view.layout.colorColumnId].filter((id): id is string => id !== null) : [])
  ])]
}

function filterColumnIds(filter: CsvViewDefinition['filter']): string[] {
  if (!filter) return []
  if ('children' in filter) return filter.children.flatMap((child) => filterColumnIds(child))
  if ('child' in filter) return filterColumnIds(filter.child)
  return 'columnId' in filter ? [filter.columnId] : []
}

function layoutLabel(view: CsvViewDefinition): string {
  return { grid: '표', list: '목록', gallery: '갤러리', kanban: '보드', calendar: '캘린더' }[view.layout.kind]
}
