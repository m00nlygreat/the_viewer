import { useState } from 'react'
import { ChevronDown, ChevronUp, GripVertical } from 'lucide-react'
import { allowedOperators, displayColumnIds, filterColumns } from '../../domain/csv-views/query'
import { resolveDisplay } from '../../domain/csv-views/format'
import { csvQueryNextStep } from '../../domain/csv-views/errorGuidance'
import type { CsvColumnDefinition, CsvFilter, CsvSaveResult, CsvStoredProfile, CsvViewDefinition, CsvLayout, CsvCellState, CsvSort } from '../../domain/csv-views/model'
import type { CsvQueryState } from '../../app/csvViewController'
import { CsvDataTable } from './CsvQueryTable'
import { CsvMockupIcon } from './CsvMockupIcon'
import { CsvViewLayoutPreview } from './CsvViewLayoutPreview'

export interface CsvViewBuilderProps {
  profile: import('../../domain/csv-views/model').CsvFileProfile
  sourceName: string
  initial: CsvViewDefinition
  mode: 'create' | 'edit'
  preview: CsvQueryState
  sourceAvailable?: boolean
  fileBacked?: boolean
  onDraftChange(draft: CsvViewDefinition): void
  onApply(draft: CsvViewDefinition): Promise<CsvSaveResult>
  onCancel(): void
  onEditColumnType(columnId: string): void
}

const layoutOptions = [
  { kind: 'grid', label: '표' },
  { kind: 'list', label: '리스트' },
  { kind: 'gallery', label: '갤러리' },
  { kind: 'kanban', label: '칸반' },
  { kind: 'calendar', label: '캘린더' },
] as const

export function CsvViewBuilder({ profile, sourceName, initial, mode, preview, sourceAvailable = true, fileBacked = false, onDraftChange, onApply, onCancel, onEditColumnType }: CsvViewBuilderProps) {
  const [draft, setDraft] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [conflict, setConflict] = useState<CsvStoredProfile | null>(null)
  const [draggedColumnId, setDraggedColumnId] = useState<string | null>(null)
  const change = (next: CsvViewDefinition) => { setDraft(next); onDraftChange(next) }
  const available = profile.columns
  const listTitle = draft.layout.kind === 'list' ? draft.layout.titleColumnId : available[0]?.id ?? ''
  const galleryTitle = draft.layout.kind === 'gallery' ? draft.layout.titleColumnId : available[0]?.id ?? ''
  const updateLayout = (kind: CsvLayout['kind']) => {
    if (kind === 'grid') change({ ...draft, layout: { kind } })
    else if (kind === 'list') change({ ...draft, layout: { kind, titleColumnId: listTitle, subtitleColumnId: null, trailingColumnId: null, colorColumnId: null, groupColumnId: null, badgeColumnIds: [] } })
    else if (kind === 'gallery') change({ ...draft, layout: { kind, titleColumnId: galleryTitle, coverColumnId: null, subtitleColumnId: null, badgeColumnIds: [], footerColumnIds: [] } })
    else if (kind === 'kanban') change({ ...draft, layout: { kind, groupColumnId: available.find((column) => column.type === 'select' || column.type === 'boolean')?.id ?? '', hiddenGroupKeys: [], titleColumnId: null, subtitleColumnId: null, trailingColumnId: null, footerColumnIds: [] } })
    else change({ ...draft, layout: { kind, dateColumnId: available.find((column) => column.type === 'date' || column.type === 'datetime')?.id ?? '', titleColumnId: null, subtitleColumnId: null, colorColumnId: null } })
  }
  const updateListLayout = (patch: Partial<Extract<CsvLayout, { kind: 'list' }>>) => {
    if (draft.layout.kind === 'list') change({ ...draft, layout: { ...draft.layout, ...patch } })
  }
  const updateGalleryLayout = (patch: Partial<Extract<CsvLayout, { kind: 'gallery' }>>) => {
    if (draft.layout.kind === 'gallery') change({ ...draft, layout: { ...draft.layout, ...patch } })
  }
  const updateKanbanLayout = (patch: Partial<Extract<CsvLayout, { kind: 'kanban' }>>) => {
    if (draft.layout.kind === 'kanban') change({ ...draft, layout: { ...draft.layout, ...patch } })
  }
  const updateCalendarLayout = (patch: Partial<Extract<CsvLayout, { kind: 'calendar' }>>) => {
    if (draft.layout.kind === 'calendar') change({ ...draft, layout: { ...draft.layout, ...patch } })
  }
  const activeDisplayColumnIds = displayColumnIds(draft, available.map((column) => column.id))
  const toggleColumn = (columnId: string, selected: boolean) => {
    const next = selected ? [...activeDisplayColumnIds, columnId] : activeDisplayColumnIds.filter((id) => id !== columnId)
    if (next.length) change({ ...draft, columnIds: next })
  }
  const moveColumn = (columnId: string, offset: -1 | 1) => {
    const columnIds = activeDisplayColumnIds
    const index = columnIds.indexOf(columnId)
    const target = index + offset
    if (index < 0 || target < 0 || target >= columnIds.length) return
    const next = [...columnIds]
    ;[next[index], next[target]] = [next[target]!, next[index]!]
    change({ ...draft, columnIds: next })
  }
  const reorderColumn = (columnId: string, targetId: string) => {
    const columnIds = activeDisplayColumnIds
    const from = columnIds.indexOf(columnId)
    const to = columnIds.indexOf(targetId)
    if (from < 0 || to < 0 || from === to) return
    const next = [...columnIds]
    const [moved] = next.splice(from, 1)
    if (moved) next.splice(to, 0, moved)
    change({ ...draft, columnIds: next })
  }
  const orderedColumns = [...draft.columnIds.flatMap((id) => { const column = available.find((item) => item.id === id); return column ? [column] : [] }), ...available.filter((column) => !draft.columnIds.includes(column.id))]
  const hasDisplayColumns = draft.layout.kind === 'grid' || draft.layout.kind === 'gallery'
  const apply = async () => {
    setSaving(true); setConflict(null)
    try { const result = await onApply({ ...draft, updatedAt: new Date().toISOString() }); if (!result.ok && result.reason === 'conflict') setConflict(result.current) }
    finally { setSaving(false) }
  }

  return <div className="csv-view-editor-overlay"><section className="csv-view-editor csv-view-builder" role="dialog" aria-modal="true" aria-labelledby="csv-view-editor-title">
    <header><div><h2 id="csv-view-editor-title">{mode === 'edit' ? '뷰 설정' : '보기 추가'}</h2><p>{sourceName}</p></div><button type="button" className="icon-button" aria-label="편집 닫기" onClick={onCancel}>×</button></header>
    <div className="csv-view-builder-body">
      <div className="csv-view-builder-settings">
        <label className="csv-builder-field">이름<input value={draft.name} maxLength={128} onChange={(event) => change({ ...draft, name: event.currentTarget.value })} /></label>
        <fieldset className="csv-builder-layout"><legend>레이아웃</legend><div className="csv-view-layout-options">{layoutOptions.map(({ kind, label }) => <button type="button" key={kind} className={`csv-view-layout-option${draft.layout.kind === kind ? ' active' : ''}`} aria-pressed={draft.layout.kind === kind} onClick={() => updateLayout(kind)}><CsvMockupIcon name={kind} size={19} /><span>{label}</span></button>)}</div></fieldset>
        {draft.layout.kind === 'list' && <fieldset className="csv-view-layout-fields"><legend>항목 구성</legend><div className="csv-view-layout-field-grid">
          <label>제목<ColumnSelect columns={available} value={draft.layout.titleColumnId} onChange={(value) => updateListLayout({ titleColumnId: value })} /></label>
          <label>보조 정보<ColumnSelect columns={available} value={draft.layout.subtitleColumnId ?? ''} allowEmpty onChange={(value) => updateListLayout({ subtitleColumnId: value || null })} /></label>
          <label>오른쪽 값<ColumnSelect columns={available} value={draft.layout.trailingColumnId ?? ''} allowEmpty onChange={(value) => updateListLayout({ trailingColumnId: value || null })} /></label>
          <label>색 표시<ColumnSelect columns={available.filter((column) => column.type === 'select' || column.type === 'boolean')} value={draft.layout.colorColumnId ?? ''} allowEmpty onChange={(value) => updateListLayout({ colorColumnId: value || null })} /></label>
          <label>묶음<ColumnSelect columns={available.filter((column) => column.type !== 'multiSelect')} value={draft.layout.groupColumnId ?? ''} allowEmpty onChange={(value) => updateListLayout({ groupColumnId: value || null })} /></label>
        </div><RoleColumnEditor label="배지" columns={available.filter((column) => column.type === 'select' || column.type === 'boolean')} selected={draft.layout.badgeColumnIds ?? []} onChange={(ids) => updateListLayout({ badgeColumnIds: ids })} /><small>제목·보조 정보와 오른쪽 값 아래에 선택한 배지를 표시합니다.</small></fieldset>}
        {draft.layout.kind === 'gallery' && <fieldset className="csv-view-layout-fields"><legend>카드 구성</legend><div className="csv-view-layout-field-grid"><label>카드 제목<ColumnSelect columns={available} value={draft.layout.titleColumnId} onChange={(value) => updateGalleryLayout({ titleColumnId: value })} /></label><label>보조 정보<ColumnSelect columns={available} value={draft.layout.subtitleColumnId ?? ''} allowEmpty onChange={(value) => updateGalleryLayout({ subtitleColumnId: value || null })} /></label><label>표지 이미지<ColumnSelect columns={available.filter((column) => isImageColumn(column, draft.displayOverrides[column.id]))} value={draft.layout.coverColumnId ?? ''} allowEmpty onChange={(value) => updateGalleryLayout({ coverColumnId: value || null })} /></label></div><RoleColumnEditor label="배지" columns={available.filter((column) => column.type === 'select' || column.type === 'boolean')} selected={draft.layout.badgeColumnIds ?? []} onChange={(ids) => updateGalleryLayout({ badgeColumnIds: ids })} /><RoleColumnEditor label="하단 컬럼" columns={available} selected={draft.layout.footerColumnIds ?? []} onChange={(ids) => updateGalleryLayout({ footerColumnIds: ids })} /></fieldset>}
        {draft.layout.kind === 'kanban' && <fieldset className="csv-view-layout-fields"><legend>카드 구성</legend><label className="csv-builder-field">그룹 컬럼 <span className="csv-view-required">필수</span><ColumnSelect columns={available.filter((column) => column.type === 'select' || column.type === 'boolean')} value={draft.layout.groupColumnId} onChange={(value) => updateKanbanLayout({ groupColumnId: value })} /></label><div className="csv-view-layout-field-grid"><label>제목<ColumnSelect columns={available} value={draft.layout.titleColumnId ?? ''} allowEmpty onChange={(value) => updateKanbanLayout({ titleColumnId: value || null })} /></label><label>보조 정보<ColumnSelect columns={available} value={draft.layout.subtitleColumnId ?? ''} allowEmpty onChange={(value) => updateKanbanLayout({ subtitleColumnId: value || null })} /></label><label>오른쪽 값<ColumnSelect columns={available} value={draft.layout.trailingColumnId ?? ''} allowEmpty onChange={(value) => updateKanbanLayout({ trailingColumnId: value || null })} /></label></div><RoleColumnEditor label="하단 컬럼" columns={available} selected={draft.layout.footerColumnIds ?? []} onChange={(ids) => updateKanbanLayout({ footerColumnIds: ids })} /><small>단일 선택 또는 참/거짓 컬럼이 그룹을 만듭니다.</small></fieldset>}
        {draft.layout.kind === 'calendar' && <fieldset className="csv-view-layout-fields"><legend>캘린더 구성</legend><label className="csv-builder-field">날짜 컬럼 <span className="csv-view-required">필수</span><ColumnSelect columns={available.filter((column) => column.type === 'date' || column.type === 'datetime')} value={draft.layout.dateColumnId} onChange={(value) => updateCalendarLayout({ dateColumnId: value })} /></label><div className="csv-view-layout-field-grid"><label>제목<ColumnSelect columns={available} value={draft.layout.titleColumnId ?? ''} allowEmpty onChange={(value) => updateCalendarLayout({ titleColumnId: value || null })} /></label><label>보조 정보<ColumnSelect columns={available} value={draft.layout.subtitleColumnId ?? ''} allowEmpty onChange={(value) => updateCalendarLayout({ subtitleColumnId: value || null })} /></label><label>색 표시<ColumnSelect columns={available.filter((column) => column.type === 'select' || column.type === 'boolean')} value={draft.layout.colorColumnId ?? ''} allowEmpty onChange={(value) => updateCalendarLayout({ colorColumnId: value || null })} /></label></div><small>날짜가 해석되지 않은 행은 캘린더 아래에서 확인할 수 있습니다.</small></fieldset>}
        {hasDisplayColumns && <fieldset className="csv-view-column-options"><legend>표시 컬럼 <small>드래그로 순서를 바꿉니다.</small></legend><div className="csv-view-column-list">{orderedColumns.map((column) => {
          const selectedIndex = activeDisplayColumnIds.indexOf(column.id)
          const filterUse = filterColumns(draft.filter).includes(column.id)
          const sortIndex = draft.sort.findIndex((item) => item.columnId === column.id)
          return <div key={column.id} className={`csv-view-column-row${selectedIndex < 0 ? ' off' : ''}${draggedColumnId === column.id ? ' dragging' : ''}`} draggable={selectedIndex >= 0} onDragStart={(event) => { if (selectedIndex < 0) return; setDraggedColumnId(column.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', column.id) }} onDragOver={(event) => { if (draggedColumnId) event.preventDefault() }} onDrop={(event) => { event.preventDefault(); const sourceId = event.dataTransfer.getData('text/plain') || draggedColumnId; if (sourceId) reorderColumn(sourceId, column.id); setDraggedColumnId(null) }} onDragEnd={() => setDraggedColumnId(null)}><label><GripVertical className="csv-view-column-grip" size={14} aria-hidden="true" /><input type="checkbox" checked={selectedIndex >= 0} disabled={selectedIndex >= 0 && activeDisplayColumnIds.length === 1} onChange={(event) => toggleColumn(column.id, event.currentTarget.checked)} /><span className="csv-column-type-mark">{column.type === 'integer' || column.type === 'decimal' ? '#' : column.type === 'boolean' ? '✓' : column.type === 'date' || column.type === 'datetime' ? '◷' : 'T'}</span><span className="csv-view-column-name">{column.label}</span><small>{column.type}</small></label>{selectedIndex < 0 && (filterUse || sortIndex >= 0) && <small className="csv-view-column-dependency">숨김 · {filterUse ? '필터' : '정렬'}에 사용</small>}{selectedIndex >= 0 && <div className="csv-view-column-actions"><button type="button" className="icon-button" aria-label={`${column.label} 위로`} disabled={selectedIndex === 0} onClick={() => moveColumn(column.id, -1)}><ChevronUp size={14} /></button><button type="button" className="icon-button" aria-label={`${column.label} 아래로`} disabled={selectedIndex === activeDisplayColumnIds.length - 1} onClick={() => moveColumn(column.id, 1)}><ChevronDown size={14} /></button></div>}<button type="button" className="csv-view-column-type" onClick={() => onEditColumnType(column.id)}>타입</button></div>
        })}</div></fieldset>}
        <FilterEditor columns={available} draft={draft} onChange={change} />
        <SortEditor columns={available} sort={draft.sort} onChange={(sort) => change({ ...draft, sort })} />
        {conflict && <div className="csv-view-conflict" role="alert"><strong>다른 탭에서 설정이 바뀌었습니다.</strong><span>초안은 유지했습니다. 현재 저장본 revision {conflict.record.profile.profileRevision}</span><button type="button" className="subtle-button" onClick={() => { void apply() }}>현재 저장본에 다시 적용</button></div>}
      </div>
      <CsvBuilderPreview draft={draft} preview={preview} columns={available} sourceAvailable={sourceAvailable} fileBacked={fileBacked} />
    </div>
    <footer><span className="csv-view-builder-note">{mode === 'edit' ? '저장하면 이 뷰만 바뀝니다. CSV 데이터와 수정 상태에는 영향이 없습니다.' : '새 뷰는 기존 탭 왼쪽에 추가됩니다.'}</span><button type="button" className="secondary-button" onClick={onCancel}>취소</button><button type="button" className="primary-button" onClick={() => { void apply() }} disabled={saving || !draft.name.trim()}>{saving ? '저장 중…' : mode === 'create' ? '추가' : '저장'}</button></footer>
  </section></div>
}

function CsvBuilderPreview({ draft, preview, columns, sourceAvailable, fileBacked }: { draft: CsvViewDefinition; preview: CsvQueryState; columns: CsvColumnDefinition[]; sourceAvailable: boolean; fileBacked: boolean }) {
  const columnMap = new Map(columns.map((column) => [column.id, column]))
  return <div className="csv-view-builder-preview">
    <div className="csv-view-builder-preview-head"><CsvMockupIcon name={draft.layout.kind} size={13} /><strong>미리보기</strong><span className="csv-view-preview-limit">{!sourceAvailable ? '원본 미연결' : preview.status === 'ready' ? `${preview.rows.length}행 확보${preview.hasMore ? ' · 추가 행 있음' : ''}` : preview.status === 'loading' ? '조건에 맞는 행 조회 중' : fileBacked ? '표본 200행 기준' : '현재 작업본 처음 200행'}</span><span className="csv-view-preview-limit-note">저장 전 결과는 제한된 미리보기입니다</span></div>
    {!sourceAvailable ? <div className="csv-view-preview-state" role="status">원본 CSV를 다시 연결한 뒤 조건을 미리 볼 수 있습니다. 지금은 뷰 설정을 편집하고 저장할 수 있습니다.</div>
      : preview.status === 'error' ? <div className="csv-view-preview-state" role="alert"><span><strong>미리보기를 불러오지 못했습니다</strong><small>{preview.error.message} {csvQueryNextStep(preview.error)}</small></span></div>
        : preview.status === 'loading' ? <div className="csv-view-preview-state" role="status">미리보기 조회 중…</div>
          : preview.status === 'ready' && preview.rows.length === 0 ? <div className="csv-view-preview-state">조건에 맞는 행이 없습니다.</div>
            : preview.status === 'ready' && draft.layout.kind === 'grid' ? <div className="csv-view-preview-table-wrap"><CsvDataTable className="csv-view-preview-table" columns={displayColumnIds(draft, columns.map((column) => column.id)).flatMap((id) => { const column = columnMap.get(id); return column ? [{ id, column, label: draft.displayOverrides[id]?.label ?? column.label }] : [] })} rows={preview.rows.slice(0, 200)} totalRows={preview.rows.length} displayOverrides={draft.displayOverrides} compact /></div>
              : preview.status === 'ready' ? <div className="csv-view-preview-layout-wrap"><CsvViewLayoutPreview view={draft} columns={columns} rows={preview.rows.slice(0, 40)} /></div>
                : <div className="csv-view-preview-state">조건을 설정하면 제한된 결과를 미리 볼 수 있습니다.</div>}
  </div>
}

function ColumnSelect({ columns, value, allowEmpty = false, onChange }: { columns: CsvColumnDefinition[]; value: string; allowEmpty?: boolean; onChange(value: string): void }) {
  return <select value={value} onChange={(event) => onChange(event.currentTarget.value)}>{allowEmpty && <option value="">없음</option>}{columns.map((column) => <option key={column.id} value={column.id}>{column.label}</option>)}</select>
}

function isImageColumn(column: CsvColumnDefinition, override: CsvViewDefinition['displayOverrides'][string] | undefined): boolean {
  if (column.type !== 'text') return false
  const display = resolveDisplay(column, override)
  return 'as' in display && display.as === 'image'
}

function RoleColumnEditor({ label, columns, selected, onChange }: { label: string; columns: CsvColumnDefinition[]; selected: string[]; onChange(ids: string[]): void }) {
  const [candidateId, setCandidateId] = useState('')
  const available = columns.filter((column) => !selected.includes(column.id))
  const add = () => {
    if (!candidateId || !available.some((column) => column.id === candidateId)) return
    onChange([...selected, candidateId])
    setCandidateId('')
  }
  return <fieldset className="csv-view-role-field"><legend>{label}</legend>
    {selected.length > 0 && <ul className="csv-view-role-selected">{selected.map((id) => {
      const column = columns.find((item) => item.id === id)
      return <li key={id}><span title={column?.label ?? id}>{column?.label ?? id}</span><button type="button" className="subtle-button" aria-label={`${column?.label ?? id} ${label} 제거`} onClick={() => onChange(selected.filter((selectedId) => selectedId !== id))}>제거</button></li>
    })}</ul>}
    {available.length > 0 ? <div className="csv-view-role-add"><label className="visually-hidden" htmlFor={`role-${label}-column`}>{label} 컬럼 추가</label><select id={`role-${label}-column`} aria-label={`${label} 컬럼 추가`} value={candidateId} onChange={(event) => setCandidateId(event.currentTarget.value)}><option value="">컬럼 선택</option>{available.map((column) => <option key={column.id} value={column.id}>{column.label}</option>)}</select><button type="button" className="subtle-button" onClick={add} disabled={!candidateId}>추가</button></div> : <small>{selected.length ? '추가할 컬럼이 없습니다.' : '연결할 컬럼이 없습니다.'}</small>}
  </fieldset>
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
