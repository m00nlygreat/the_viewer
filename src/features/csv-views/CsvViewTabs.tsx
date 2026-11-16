import type { KeyboardEvent } from 'react'
import type { CsvLayout, CsvViewSelection } from '../../domain/csv-views/model'

export interface CsvViewTabsProps {
  views: { id: string; name: string; layout: CsvLayout['kind'] }[]
  selection: CsvViewSelection
  canAddView: boolean
  onSelect(selection: CsvViewSelection): void
  onAddView(): void
  onManageViews(): void
}

export function CsvViewTabs({ views, selection, canAddView, onSelect, onAddView, onManageViews }: CsvViewTabsProps) {
  const selectedView = selection.kind === 'custom' ? selection.viewId : null
  const handleKey = (event: KeyboardEvent<HTMLDivElement>, ids: string[], current: string, select: (id: string) => void) => {
    const index = ids.indexOf(current)
    const next = event.key === 'ArrowRight' ? (index + 1) % ids.length : event.key === 'ArrowLeft' ? (index + ids.length - 1) % ids.length : event.key === 'Home' ? 0 : event.key === 'End' ? ids.length - 1 : -1
    if (next < 0 || !ids.length) return
    event.preventDefault()
    const target = ids[next]!
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-csv-view-tab="${CSS.escape(target)}"]`)?.focus()
    select(target)
  }
  const customIds = views.map((view) => view.id)
  const builtinIds = ['view', 'source']
  return <div className="csv-view-tab-row">
    <div className="csv-view-tab-list" role="tablist" aria-label="사용자 CSV 보기" onKeyDown={(event) => handleKey(event, customIds, selectedView ?? customIds[0] ?? '', (id) => onSelect({ kind: 'custom', viewId: id }))}>
      {views.map((view) => <button key={view.id} id={`csv-view-${view.id}-tab`} data-csv-view-tab={view.id} role="tab" aria-controls="csv-view-panel" aria-selected={selectedView === view.id} tabIndex={selectedView === view.id ? 0 : -1} className={selectedView === view.id ? 'active' : ''} onClick={() => onSelect({ kind: 'custom', viewId: view.id })} title={`${view.name} · ${view.layout}`}>{view.name}</button>)}
      <button type="button" className="csv-view-add" onClick={onAddView} disabled={!canAddView} aria-label="보기 추가" title={canAddView ? '보기 추가' : '파일 설정을 준비 중입니다.'}>+</button>
    </div>
    <div className="csv-view-builtin-tabs" role="tablist" aria-label="기본 CSV 탭" onKeyDown={(event) => handleKey(event, builtinIds, selection.kind === 'builtin' ? selection.mode : 'view', (id) => onSelect({ kind: 'builtin', mode: id as 'view' | 'source' }))}>
      {(['view', 'source'] as const).map((mode) => <button key={mode} id={`csv-view-builtin-${mode}-tab`} data-csv-view-tab={mode} role="tab" aria-controls="csv-view-panel" aria-selected={selection.kind === 'builtin' && selection.mode === mode} tabIndex={selection.kind === 'builtin' && selection.mode === mode ? 0 : -1} className={selection.kind === 'builtin' && selection.mode === mode ? 'active' : ''} onClick={() => onSelect({ kind: 'builtin', mode })}>{mode === 'view' ? '보기' : '원본'}</button>)}
    </div>
    <button className="csv-view-manage" type="button" onClick={onManageViews}>보기 관리</button>
  </div>
}
