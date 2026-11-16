import { useState } from 'react'
import { allowedOperators } from '../../domain/csv-views/query'
import type { CsvColumnDefinition, CsvFilter, CsvSaveResult, CsvStoredProfile, CsvViewDefinition, CsvLayout, CsvCellState } from '../../domain/csv-views/model'
import type { CsvQueryState } from '../../app/csvViewController'

export interface CsvViewBuilderProps {
  profile: import('../../domain/csv-views/model').CsvFileProfile
  initial: CsvViewDefinition
  preview: CsvQueryState
  onDraftChange(draft: CsvViewDefinition): void
  onApply(draft: CsvViewDefinition): Promise<CsvSaveResult>
  onCancel(): void
  onEditColumnType(columnId: string): void
}

export function CsvViewBuilder({ profile, initial, preview, onDraftChange, onApply, onCancel, onEditColumnType }: CsvViewBuilderProps) {
  const [draft, setDraft] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [conflict, setConflict] = useState<CsvStoredProfile | null>(null)
  const change = (next: CsvViewDefinition) => { setDraft(next); onDraftChange(next) }
  const available = profile.columns
  const listTitle = draft.layout.kind === 'list' ? draft.layout.titleColumnId : available[0]?.id ?? ''
  const galleryTitle = draft.layout.kind === 'gallery' ? draft.layout.titleColumnId : available[0]?.id ?? ''
  const updateLayout = (kind: CsvLayout['kind']) => {
    if (kind === 'grid') change({ ...draft, layout: { kind } })
    else if (kind === 'list') change({ ...draft, layout: { kind, titleColumnId: listTitle, subtitleColumnId: null, trailingColumnId: null, colorColumnId: null, groupColumnId: null } })
    else if (kind === 'gallery') change({ ...draft, layout: { kind, titleColumnId: galleryTitle, coverColumnId: null } })
    else if (kind === 'kanban') change({ ...draft, layout: { kind, groupColumnId: available.find((column) => column.type === 'select' || column.type === 'boolean')?.id ?? '', hiddenGroupKeys: [] } })
    else change({ ...draft, layout: { kind, dateColumnId: available.find((column) => column.type === 'date' || column.type === 'datetime')?.id ?? '' } })
  }
  const apply = async () => {
    setSaving(true); setConflict(null)
    try { const result = await onApply({ ...draft, updatedAt: new Date().toISOString() }); if (!result.ok && result.reason === 'conflict') setConflict(result.current) }
    finally { setSaving(false) }
  }

  return <div className="csv-view-editor-overlay"><section className="csv-view-editor" role="dialog" aria-modal="true" aria-labelledby="csv-view-editor-title">
    <header><div><h2 id="csv-view-editor-title">보기 만들기</h2><p>표시 컬럼과 조회 조건을 정합니다.</p></div><button type="button" className="icon-button" aria-label="편집 닫기" onClick={onCancel}>×</button></header>
    <div className="csv-view-editor-body">
      <label>이름<input value={draft.name} maxLength={128} onChange={(event) => change({ ...draft, name: event.currentTarget.value })} /></label>
      <label>레이아웃<select value={draft.layout.kind} onChange={(event) => updateLayout(event.currentTarget.value as CsvLayout['kind'])}><option value="grid">표</option><option value="list">리스트</option><option value="gallery">갤러리</option><option value="kanban">칸반</option><option value="calendar">캘린더</option></select></label>
      {draft.layout.kind === 'list' && <label>제목 컬럼<ColumnSelect columns={available} value={draft.layout.titleColumnId} onChange={(value) => change({ ...draft, layout: { kind: 'list', titleColumnId: value, subtitleColumnId: draft.layout.kind === 'list' ? draft.layout.subtitleColumnId : null, trailingColumnId: draft.layout.kind === 'list' ? draft.layout.trailingColumnId : null, colorColumnId: draft.layout.kind === 'list' ? draft.layout.colorColumnId : null, groupColumnId: draft.layout.kind === 'list' ? draft.layout.groupColumnId : null } })} /></label>}
      {draft.layout.kind === 'gallery' && <><label>제목 컬럼<ColumnSelect columns={available} value={draft.layout.titleColumnId} onChange={(value) => change({ ...draft, layout: { kind: 'gallery', titleColumnId: value, coverColumnId: draft.layout.kind === 'gallery' ? draft.layout.coverColumnId : null } })} /></label><label>표지 이미지<ColumnSelect columns={available.filter((column) => column.type === 'text' && column.display.as === 'image')} value={draft.layout.coverColumnId ?? ''} allowEmpty onChange={(value) => change({ ...draft, layout: { kind: 'gallery', titleColumnId: draft.layout.kind === 'gallery' ? draft.layout.titleColumnId : galleryTitle, coverColumnId: value || null } })} /></label></>}
      {draft.layout.kind === 'kanban' && <label>그룹 컬럼<ColumnSelect columns={available.filter((column) => column.type === 'select' || column.type === 'boolean')} value={draft.layout.groupColumnId} onChange={(value) => change({ ...draft, layout: { kind: 'kanban', groupColumnId: value, hiddenGroupKeys: [] } })} /></label>}
      {draft.layout.kind === 'calendar' && <label>날짜 컬럼<ColumnSelect columns={available.filter((column) => column.type === 'date' || column.type === 'datetime')} value={draft.layout.dateColumnId} onChange={(value) => change({ ...draft, layout: { kind: 'calendar', dateColumnId: value } })} /></label>}
      <fieldset className="csv-view-column-options"><legend>표시 컬럼</legend>{available.map((column) => <label key={column.id} className="csv-view-check-row"><input type="checkbox" checked={draft.columnIds.includes(column.id)} onChange={(event) => change({ ...draft, columnIds: event.currentTarget.checked ? [...draft.columnIds, column.id] : draft.columnIds.filter((id) => id !== column.id) })} /><span>{column.label}</span><small>{column.type}</small><button type="button" className="subtle-button" onClick={() => onEditColumnType(column.id)}>타입</button></label>)}</fieldset>
      <FilterEditor columns={available} draft={draft} onChange={change} />
      <label className="csv-view-sort-label">정렬<select value={draft.sort[0]?.columnId ?? ''} onChange={(event) => { const id = event.currentTarget.value; change({ ...draft, sort: id ? [{ columnId: id, direction: draft.sort[0]?.direction ?? 'asc' }] : [] }) }}><option value="">원본 순서</option>{available.filter((column) => column.type !== 'multiSelect').map((column) => <option key={column.id} value={column.id}>{column.label}</option>)}</select><select aria-label="정렬 방향" disabled={!draft.sort.length} value={draft.sort[0]?.direction ?? 'asc'} onChange={(event) => change({ ...draft, sort: draft.sort.map((item) => ({ ...item, direction: event.currentTarget.value as 'asc' | 'desc' })) })}><option value="asc">오름차순</option><option value="desc">내림차순</option></select></label>
      <p className="csv-view-preview-status">{preview.status === 'ready' ? `미리보기 ${preview.rows.length}행${preview.hasMore ? ' 이상' : ''}` : preview.status === 'loading' ? '미리보기 조회 중…' : preview.status === 'error' ? preview.error.message : '조건을 설정하면 미리보기를 확인할 수 있습니다.'}</p>
      {conflict && <div className="csv-view-conflict" role="alert"><strong>다른 탭에서 설정이 바뀌었습니다.</strong><span>초안은 유지했습니다. 현재 저장본 revision {conflict.record.profile.profileRevision}</span><button type="button" className="subtle-button" onClick={() => { void apply() }}>현재 저장본에 다시 적용</button></div>}
    </div>
    <footer><button type="button" className="secondary-button" onClick={onCancel}>취소</button><button type="button" className="primary-button" onClick={() => { void apply() }} disabled={saving || !draft.name.trim()}>{saving ? '저장 중…' : '적용'}</button></footer>
  </section></div>
}

function ColumnSelect({ columns, value, allowEmpty = false, onChange }: { columns: CsvColumnDefinition[]; value: string; allowEmpty?: boolean; onChange(value: string): void }) {
  return <select value={value} onChange={(event) => onChange(event.currentTarget.value)}>{allowEmpty && <option value="">없음</option>}{columns.map((column) => <option key={column.id} value={column.id}>{column.label}</option>)}</select>
}

function FilterEditor({ columns, draft, onChange }: { columns: CsvColumnDefinition[]; draft: CsvViewDefinition; onChange(draft: CsvViewDefinition): void }) {
  const filter = draft.filter && 'columnId' in draft.filter ? draft.filter : null
  const column = columns.find((item) => item.id === filter?.columnId)
  const operators = column ? allowedOperators(column.type) : []
  const updateOperator = (operator: string) => {
    if (!column) return
    onChange({ ...draft, filter: createLeafFilter(column, operator) })
  }
  const updateOptionIds = (optionIds: string[]) => {
    if (filter && 'optionIds' in filter) onChange({ ...draft, filter: { ...filter, optionIds } })
  }
  return <fieldset className="csv-view-filter"><legend>필터</legend><div>
    <select aria-label="필터 컬럼" value={filter?.columnId ?? ''} onChange={(event) => { const selected = columns.find((item) => item.id === event.currentTarget.value); const op = selected ? allowedOperators(selected.type)[0] : undefined; onChange({ ...draft, filter: selected && op ? createLeafFilter(selected, op) : null }) }}><option value="">필터 없음</option>{columns.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
    {filter && column && <><select aria-label="필터 연산자" value={filter.op} onChange={(event) => updateOperator(event.currentTarget.value)}>{operators.map((operator) => <option key={operator} value={operator}>{operator}</option>)}</select>
      {(filter.op === 'is' || filter.op === 'isNot') && <select aria-label="셀 상태" value={filter.state} onChange={(event) => onChange({ ...draft, filter: { ...filter, state: event.currentTarget.value as CsvCellState } })}>{(['value', 'empty', 'missing', 'null-marker', 'invalid'] as const).map((state) => <option key={state} value={state}>{state}</option>)}</select>}
      {['in', 'notIn', 'hasAny', 'hasAll'].includes(filter.op) && (column.type === 'select' || column.type === 'multiSelect') && <select aria-label="필터 선택지" multiple value={'optionIds' in filter ? filter.optionIds : []} onChange={(event) => updateOptionIds(Array.from(event.currentTarget.selectedOptions, (option) => option.value))}>{column.parse.options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select>}
      {'value' in filter && <><input aria-label="필터 값" value={filter.value} onChange={(event) => onChange({ ...draft, filter: { ...filter, value: event.currentTarget.value } })} />{(filter.op === 'contains' || filter.op === 'startsWith') && <select aria-label="대소문자 구분" value={filter.ignoreCase} onChange={(event) => onChange({ ...draft, filter: { ...filter, ignoreCase: event.currentTarget.value as 'none' | 'ascii' } })}><option value="none">대소문자 구분</option><option value="ascii">ASCII 무시</option></select>}</>}
      <small>빈 값·실패 셀은 일반 비교에서 제외됩니다.</small></>}
  </div></fieldset>
}

function createLeafFilter(column: CsvColumnDefinition, operator: string): CsvFilter | null {
  if (operator === 'is' || operator === 'isNot') return { op: operator, columnId: column.id, state: 'value' }
  if (operator === 'contains' || operator === 'startsWith') return { op: operator, columnId: column.id, value: '', ignoreCase: 'none' }
  if (operator === 'in' || operator === 'notIn' || operator === 'hasAny' || operator === 'hasAll') return { op: operator, columnId: column.id, optionIds: [] }
  if (['eq', 'neq', 'lt', 'lte', 'gt', 'gte'].includes(operator)) return { op: operator as 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte', columnId: column.id, value: '' }
  return null
}
