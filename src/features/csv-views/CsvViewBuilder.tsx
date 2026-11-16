import { useState } from 'react'
import { allowedOperators } from '../../domain/csv-views/query'
import type { CsvColumnDefinition, CsvFilter, CsvSaveResult, CsvStoredProfile, CsvViewDefinition, CsvLayout, CsvCellState, CsvSort } from '../../domain/csv-views/model'
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
      <SortEditor columns={available} sort={draft.sort} onChange={(sort) => change({ ...draft, sort })} />
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
  const filter = draft.filter
  const setFilter = (next: CsvFilter | null) => onChange({ ...draft, filter: next })
  const firstFilter = () => columns[0] ? createDefaultFilter(columns[0]) : null
  const addFilter = () => { const next = firstFilter(); if (next) setFilter(filter ? { op: 'and', children: [filter, next] } : next) }
  return <fieldset className="csv-view-filter"><legend>필터 조건</legend>
    {!filter ? <><p>조건을 추가해 원본 전체 행을 필터링합니다.</p><button type="button" className="subtle-button" disabled={!columns.length} onClick={addFilter}>조건 추가</button></> : <>
      <FilterNodeEditor filter={filter} columns={columns} onChange={setFilter} onRemove={() => setFilter(null)} />
      <div className="csv-view-filter-actions">
        <button type="button" className="subtle-button" onClick={() => { const next = firstFilter(); if (next) setFilter({ op: 'and', children: [filter, next] }) }}>AND 그룹으로 묶기</button>
        <button type="button" className="subtle-button" onClick={() => { const next = firstFilter(); if (next) setFilter({ op: 'or', children: [filter, next] }) }}>OR 그룹으로 묶기</button>
        <button type="button" className="subtle-button" onClick={() => setFilter('child' in filter ? filter.child : { op: 'not', child: filter })}>{'child' in filter ? 'NOT 해제' : 'NOT 적용'}</button>
        <button type="button" className="subtle-button" onClick={() => setFilter(null)}>필터 지우기</button>
      </div>
      <small>빈 값·실패 셀은 일반 비교에서 제외됩니다.</small>
    </>}
  </fieldset>
}

function FilterNodeEditor({ filter, columns, onChange, onRemove }: { filter: CsvFilter; columns: CsvColumnDefinition[]; onChange(filter: CsvFilter): void; onRemove(): void }) {
  if ('children' in filter) return <div className="csv-filter-group">
    <div className="csv-filter-node-heading">
      <select aria-label="필터 그룹 연산" value={filter.op} onChange={(event) => onChange({ ...filter, op: event.currentTarget.value as 'and' | 'or' })}><option value="and">모두 만족 (AND)</option><option value="or">하나 만족 (OR)</option></select>
      <button type="button" className="subtle-button" onClick={() => { const child = columns[0] ? createDefaultFilter(columns[0]) : null; if (child) onChange({ ...filter, children: [...filter.children, child] }) }} disabled={!columns.length}>조건 추가</button>
      <button type="button" className="subtle-button" onClick={() => { const child = columns[0] ? createDefaultFilter(columns[0]) : null; if (child) onChange({ ...filter, children: [...filter.children, { op: 'and', children: [child, child] }] }) }} disabled={!columns.length}>하위 그룹 추가</button>
      <button type="button" className="icon-button" aria-label="그룹 삭제" onClick={onRemove}>×</button>
    </div>
    {filter.children.map((child, index) => <FilterNodeEditor key={index} filter={child} columns={columns} onChange={(next) => onChange({ ...filter, children: filter.children.map((item, childIndex) => childIndex === index ? next : item) })} onRemove={() => {
      if (filter.children.length <= 2) onChange(filter.children.find((_, childIndex) => childIndex !== index) ?? filter)
      else onChange({ ...filter, children: filter.children.filter((_, childIndex) => childIndex !== index) })
    }} />)}
  </div>
  if ('child' in filter) return <div className="csv-filter-not"><strong>NOT</strong><FilterNodeEditor filter={filter.child} columns={columns} onChange={(child) => onChange({ op: 'not', child })} onRemove={onRemove} /><button type="button" className="icon-button" aria-label="부정 조건 삭제" onClick={onRemove}>×</button></div>
  const column = columns.find((item) => item.id === filter.columnId)
  const operators = column ? allowedOperators(column.type) : []
  return <div className="csv-filter-leaf">
    <select aria-label="필터 컬럼" value={filter.columnId} onChange={(event) => { const next = columns.find((item) => item.id === event.currentTarget.value); if (next) onChange(createDefaultFilter(next)) }}>{columns.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
    {column && <><select aria-label="필터 연산자" value={filter.op} onChange={(event) => { const next = createLeafFilter(column, event.currentTarget.value); if (next) onChange(next) }}>{operators.map((operator) => <option key={operator} value={operator}>{operator}</option>)}</select>
      {(filter.op === 'is' || filter.op === 'isNot') && <select aria-label="셀 상태" value={filter.state} onChange={(event) => onChange({ ...filter, state: event.currentTarget.value as CsvCellState })}>{(['value', 'empty', 'missing', 'null-marker', 'invalid'] as const).map((state) => <option key={state} value={state}>{state}</option>)}</select>}
      {['in', 'notIn', 'hasAny', 'hasAll'].includes(filter.op) && (column.type === 'select' || column.type === 'multiSelect') && <select aria-label="필터 선택지" multiple value={'optionIds' in filter ? filter.optionIds : []} onChange={(event) => { if ('optionIds' in filter) onChange({ ...filter, optionIds: Array.from(event.currentTarget.selectedOptions, (option) => option.value) }) }}>{column.parse.options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select>}
      {'value' in filter && <><input aria-label="필터 값" value={filter.value} onChange={(event) => onChange({ ...filter, value: event.currentTarget.value })} />{(filter.op === 'contains' || filter.op === 'startsWith') && <select aria-label="대소문자 구분" value={filter.ignoreCase} onChange={(event) => onChange({ ...filter, ignoreCase: event.currentTarget.value as 'none' | 'ascii' })}><option value="none">대소문자 구분</option><option value="ascii">ASCII 무시</option></select>}</>}
    </>}
    <button type="button" className="icon-button" aria-label="조건 삭제" onClick={onRemove}>×</button>
  </div>
}

function SortEditor({ columns, sort, onChange }: { columns: CsvColumnDefinition[]; sort: CsvSort[]; onChange(sort: CsvSort[]): void }) {
  const sortable = columns.filter((column) => column.type !== 'multiSelect')
  const add = () => { const next = sortable.find((column) => !sort.some((item) => item.columnId === column.id)); if (next) onChange([...sort, { columnId: next.id, direction: 'asc' }]) }
  const move = (index: number, offset: -1 | 1) => { const target = index + offset; if (target < 0 || target >= sort.length) return; const next = [...sort]; [next[index], next[target]] = [next[target]!, next[index]!]; onChange(next) }
  return <fieldset className="csv-view-sort"><legend>정렬 키</legend>
    {sort.length === 0 && <p>원본 순서를 사용합니다.</p>}
    {sort.map((item, index) => <div className="csv-view-sort-row" key={`${item.columnId}-${index}`}>
      <span>{index + 1}.</span><select aria-label={`정렬 컬럼 ${index + 1}`} value={item.columnId} onChange={(event) => onChange(sort.map((current, currentIndex) => currentIndex === index ? { ...current, columnId: event.currentTarget.value } : current))}>{sortable.filter((column) => column.id === item.columnId || !sort.some((other, otherIndex) => otherIndex !== index && other.columnId === column.id)).map((column) => <option key={column.id} value={column.id}>{column.label}</option>)}</select>
      <select aria-label={`정렬 방향 ${index + 1}`} value={item.direction} onChange={(event) => onChange(sort.map((current, currentIndex) => currentIndex === index ? { ...current, direction: event.currentTarget.value as 'asc' | 'desc' } : current))}><option value="asc">오름차순</option><option value="desc">내림차순</option></select>
      <button type="button" className="subtle-button" disabled={index === 0} onClick={() => move(index, -1)} aria-label={`정렬 키 ${index + 1} 위로`}>↑</button><button type="button" className="subtle-button" disabled={index === sort.length - 1} onClick={() => move(index, 1)} aria-label={`정렬 키 ${index + 1} 아래로`}>↓</button>
      <button type="button" className="icon-button" aria-label={`정렬 키 ${index + 1} 삭제`} onClick={() => onChange(sort.filter((_, currentIndex) => currentIndex !== index))}>×</button>
    </div>)}
    <button type="button" className="subtle-button" disabled={sort.length >= sortable.length} onClick={add}>정렬 키 추가</button>
  </fieldset>
}

function createDefaultFilter(column: CsvColumnDefinition): CsvFilter { return { op: 'is', columnId: column.id, state: 'value' } }

function createLeafFilter(column: CsvColumnDefinition, operator: string): CsvFilter | null {
  if (operator === 'is' || operator === 'isNot') return { op: operator, columnId: column.id, state: 'value' }
  if (operator === 'contains' || operator === 'startsWith') return { op: operator, columnId: column.id, value: '', ignoreCase: 'none' }
  if (operator === 'in' || operator === 'notIn' || operator === 'hasAny' || operator === 'hasAll') return { op: operator, columnId: column.id, optionIds: [] }
  if (['eq', 'neq', 'lt', 'lte', 'gt', 'gte'].includes(operator)) return { op: operator as 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte', columnId: column.id, value: '' }
  return null
}
