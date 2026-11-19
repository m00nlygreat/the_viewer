import type { KeyboardEvent } from 'react'
import type { CsvLayout, CsvViewSelection } from '../../domain/csv-views/model'
import { CsvMockupIcon } from './CsvMockupIcon'

export interface CsvViewTabsProps {
  views: { id: string; name: string; layout: CsvLayout['kind'] }[]
  selection: CsvViewSelection
  canAddView: boolean
  placement: 'desktop' | 'mobile'
  onSelect(selection: CsvViewSelection): void
  onAddView(): void
}

export function CsvViewTabs({ views, selection, canAddView, placement, onSelect, onAddView }: CsvViewTabsProps) {
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
  return <div className={`csv-view-tab-row csv-view-tab-row-${placement}`}>
    <div className="csv-view-tab-list" role="tablist" aria-label="사용자 CSV 보기" onKeyDown={(event) => handleKey(event, customIds, selectedView ?? customIds[0] ?? '', (id) => onSelect({ kind: 'custom', viewId: id }))}>
      {views.map((view) => {
        return <button key={view.id} id={`csv-view-${view.id}-tab`} data-csv-view-tab={view.id} role="tab" aria-controls="csv-view-panel" aria-selected={selectedView === view.id} tabIndex={selectedView === view.id ? 0 : -1} className={selectedView === view.id ? 'active' : ''} onClick={() => onSelect({ kind: 'custom', viewId: view.id })} title={`${view.name} · ${view.layout}`}><CsvMockupIcon name={view.layout} size={13} /><span className="csv-view-tab-label">{view.name}</span></button>
      })}
    </div>
    <button type="button" className="csv-view-add" onClick={onAddView} disabled={!canAddView} title={canAddView ? '보기 추가' : '파일 설정을 준비 중입니다.'}><CsvMockupIcon name="plus" size={13} />보기 추가</button>
    <span className="csv-view-tab-separator" aria-hidden="true" />
    <div className="csv-view-builtin-tabs" role="tablist" aria-label="기본 CSV 탭" onKeyDown={(event) => handleKey(event, builtinIds, selection.kind === 'builtin' ? selection.mode : 'view', (id) => onSelect({ kind: 'builtin', mode: id as 'view' | 'source' }))}>
      {(['view', 'source'] as const).map((mode) => <button key={mode} id={`csv-view-builtin-${mode}-tab`} data-csv-view-tab={mode} role="tab" aria-controls="csv-view-panel" aria-selected={selection.kind === 'builtin' && selection.mode === mode} tabIndex={selection.kind === 'builtin' && selection.mode === mode ? 0 : -1} className={selection.kind === 'builtin' && selection.mode === mode ? 'active' : ''} onClick={() => onSelect({ kind: 'builtin', mode })}>{mode === 'view' ? '보기' : '원본'}</button>)}
    </div>
  </div>
}
