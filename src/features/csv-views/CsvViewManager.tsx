import { useRef, useState } from 'react'
import type { CsvSaveResult } from '../../domain/csv-views/model'

export interface CsvViewManagerProps {
  views: { id: string; name: string; layout: import('../../domain/csv-views/model').CsvLayout['kind'] }[]
  onRename(viewId: string, name: string): Promise<CsvSaveResult>
  onDuplicate(viewId: string): Promise<CsvSaveResult>
  onDelete(viewId: string): Promise<CsvSaveResult>
  onReorder(viewOrder: string[]): Promise<CsvSaveResult>
  onExport(viewIds: string[] | 'all'): void
  onImport(file: File): void
  onClose(): void
}

export function CsvViewManager({ views, onRename, onDuplicate, onDelete, onReorder, onExport, onImport, onClose }: CsvViewManagerProps) {
  const input = useRef<HTMLInputElement>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const beginRename = (view: CsvViewManagerProps['views'][number]) => { setEditingId(view.id); setName(view.name) }
  const move = (index: number, delta: number) => {
    const target = index + delta
    if (target < 0 || target >= views.length) return
    const order = views.map((view) => view.id); [order[index], order[target]] = [order[target]!, order[index]!]
    void onReorder(order)
  }
  const saveRename = async () => {
    if (!editingId || !name.trim()) return
    const result = await onRename(editingId, name.trim())
    if (result.ok) setEditingId(null)
  }

  return <div className="csv-view-editor-overlay"><section className="csv-view-editor csv-view-manager" role="dialog" aria-modal="true" aria-labelledby="csv-view-manager-title">
    <header><div><h2 id="csv-view-manager-title">보기 관리</h2><p>순서, 이름, JSON 설정을 관리합니다.</p></div><button type="button" className="icon-button" aria-label="보기 관리 닫기" onClick={onClose}>×</button></header>
    <div className="csv-view-editor-body">
      <div className="csv-view-manager-list">{views.map((view, index) => <div className="csv-view-manager-row" key={view.id}>
        {editingId === view.id ? <><input aria-label="보기 이름" maxLength={128} value={name} onChange={(event) => setName(event.currentTarget.value)} /><button type="button" className="subtle-button" onClick={() => { void saveRename() }}>저장</button></> : <><span><strong>{view.name}</strong><small>{view.layout}</small></span><button type="button" className="subtle-button" onClick={() => beginRename(view)}>이름 변경</button></>}
        <button type="button" className="subtle-button" aria-label={`${view.name} 위로`} onClick={() => move(index, -1)} disabled={index === 0}>↑</button>
        <button type="button" className="subtle-button" aria-label={`${view.name} 아래로`} onClick={() => move(index, 1)} disabled={index === views.length - 1}>↓</button>
        <button type="button" className="subtle-button" onClick={() => { void onDuplicate(view.id) }}>복제</button>
        <button type="button" className="subtle-button danger-text" onClick={() => { if (window.confirm(`“${view.name}” 보기를 삭제할까요?`)) void onDelete(view.id) }}>삭제</button>
      </div>)}</div>
      <div className="csv-view-manager-actions"><button type="button" className="secondary-button" onClick={() => onExport('all')}>모든 보기 내보내기</button><button type="button" className="secondary-button" onClick={() => onExport(views.map((view) => view.id))}>모든 보기 묶음 다운로드</button><button type="button" className="secondary-button" onClick={() => input.current?.click()}>JSON 가져오기</button><input ref={input} className="visually-hidden" type="file" accept="application/json,.json" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) onImport(file) }} /></div>
    </div>
  </section></div>
}
