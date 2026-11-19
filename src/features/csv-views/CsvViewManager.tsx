import { useRef, useState } from 'react'
import { Copy, Download, GripVertical, Pencil, Plus, Trash2, Upload } from 'lucide-react'
import type { CsvSaveResult, CsvViewDefinition } from '../../domain/csv-views/model'
import { CsvMockupIcon } from './CsvMockupIcon'

export interface CsvViewManagerProps {
  fileName: string
  views: Pick<CsvViewDefinition, 'id' | 'name' | 'layout' | 'updatedAt' | 'columnIds' | 'filter' | 'sort'>[]
  activeViewId: string | null
  onAdd(): void
  onRename(viewId: string, name: string): Promise<CsvSaveResult>
  onDuplicate(viewId: string): Promise<CsvSaveResult>
  onDelete(viewId: string): Promise<CsvSaveResult>
  onReorder(viewOrder: string[]): Promise<CsvSaveResult>
  onExport(viewIds: string[] | 'all'): void
  onImport(file: File): void
  onClose(): void
}

const layoutLabels: Record<CsvViewDefinition['layout']['kind'], string> = { grid: '표', list: '리스트', gallery: '갤러리', kanban: '칸반', calendar: '캘린더' }

export function CsvViewManager({ fileName, views, activeViewId, onAdd, onRename, onDuplicate, onDelete, onReorder, onExport, onImport, onClose }: CsvViewManagerProps) {
  const input = useRef<HTMLInputElement>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [failure, setFailure] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const beginRename = (view: CsvViewManagerProps['views'][number]) => { setEditingId(view.id); setName(view.name); setFailure('') }
  const move = (index: number, delta: number) => {
    const target = index + delta
    if (target < 0 || target >= views.length) return
    const order = views.map((view) => view.id)
    ;[order[index], order[target]] = [order[target]!, order[index]!]
    void onReorder(order)
  }
  const dropBefore = (targetId: string) => {
    if (!draggingId || draggingId === targetId) return
    const order = views.map((view) => view.id)
    const from = order.indexOf(draggingId), target = order.indexOf(targetId)
    if (from < 0 || target < 0) return
    order.splice(from, 1); order.splice(target, 0, draggingId)
    void onReorder(order)
    setDraggingId(null)
  }
  const saveRename = async () => {
    if (!editingId || !name.trim()) return
    setBusyId(editingId); setFailure('')
    try {
      const result = await onRename(editingId, name.trim())
      if (result.ok) setEditingId(null)
      else setFailure(saveFailure(result))
    } catch (error) { setFailure(error instanceof Error ? error.message : '보기 이름을 저장하지 못했습니다.') }
    finally { setBusyId(null) }
  }
  const run = async (viewId: string, action: () => Promise<CsvSaveResult>) => {
    setBusyId(viewId); setFailure('')
    try { const result = await action(); if (!result.ok) setFailure(saveFailure(result)) }
    catch (error) { setFailure(error instanceof Error ? error.message : '보기 설정을 저장하지 못했습니다.') }
    finally { setBusyId(null) }
  }

  return <div className="csv-view-editor-overlay"><section className="csv-view-editor csv-view-manager" role="dialog" aria-modal="true" aria-labelledby="csv-view-manager-title">
    <header><div><h2 id="csv-view-manager-title">보기 관리</h2><p>{fileName} · 뷰 {views.length}개</p></div><button type="button" className="icon-button" aria-label="보기 관리 닫기" onClick={onClose}>×</button></header>
    <div className="csv-view-manager-body">
      <div className="csv-view-manager-list">{views.map((view, index) => {
        const updated = new Date(view.updatedAt)
        const updatedLabel = Number.isNaN(updated.getTime()) ? '수정일 알 수 없음' : `수정 ${new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric' }).format(updated)}`
        const meta = `${layoutLabels[view.layout.kind]} · 컬럼 ${view.columnIds.length} · 필터 ${view.filter ? 1 : 0} · 정렬 ${view.sort.length} · ${updatedLabel}`
        const busy = busyId === view.id
        return <div className={`csv-view-manager-row${activeViewId === view.id ? ' active' : ''}${draggingId === view.id ? ' dragging' : ''}`} key={view.id} onDragOver={(event) => { if (draggingId) event.preventDefault() }} onDrop={(event) => { event.preventDefault(); dropBefore(view.id) }}>
          <span className="csv-view-manager-grip-handle" draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', view.id); setDraggingId(view.id) }} onDragEnd={() => setDraggingId(null)}><GripVertical className="csv-view-manager-grip" size={16} aria-hidden="true" /></span>
          <CsvMockupIcon className="csv-view-manager-layout" name={view.layout.kind} size={15} />
          <div className="csv-view-manager-copy">
            {editingId === view.id ? <div className="csv-view-manager-rename"><input aria-label="보기 이름" maxLength={128} value={name} onChange={(event) => setName(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === 'Enter') void saveRename(); if (event.key === 'Escape') setEditingId(null) }} /><button type="button" className="subtle-button" disabled={busy || !name.trim()} onClick={() => { void saveRename() }}>저장</button></div> : <><strong>{view.name}</strong><small>{meta}</small></>}
          </div>
          {editingId !== view.id && <div className="csv-view-manager-actions-row">
            <button type="button" className="icon-button" title="이름 변경" aria-label={`${view.name} 이름 변경`} onClick={() => beginRename(view)}><Pencil size={14} /></button>
            <button type="button" className="icon-button" title="복제" aria-label={`${view.name} 복제`} disabled={busy} onClick={() => { void run(view.id, () => onDuplicate(view.id)) }}><Copy size={14} /></button>
            <button type="button" className="icon-button" title="뷰 다운로드" aria-label={`${view.name} 다운로드`} onClick={() => onExport([view.id])}><Download size={14} /></button>
            <button type="button" className="icon-button danger-text" title="삭제" aria-label={`${view.name} 삭제`} disabled={busy} onClick={() => { if (window.confirm(`“${view.name}” 보기를 삭제할까요?`)) void run(view.id, () => onDelete(view.id)) }}><Trash2 size={14} /></button>
            <span className="csv-view-manager-order"><button type="button" className="subtle-button" aria-label={`${view.name} 위로`} onClick={() => move(index, -1)} disabled={index === 0}>↑</button><button type="button" className="subtle-button" aria-label={`${view.name} 아래로`} onClick={() => move(index, 1)} disabled={index === views.length - 1}>↓</button></span>
          </div>}
        </div>
      })}
        <div className="csv-view-manager-add-row"><button type="button" className="secondary-button" onClick={onAdd}><Plus size={14} />보기 추가</button></div>
      </div>
      <p className="csv-view-manager-note">뷰 설정은 이 브라우저에 파일별로 보관되며 CSV 저장·수정 상태와 별개입니다. 같은 파일을 다시 열면 자동으로 연결됩니다. 다른 기기로 옮기려면 JSON으로 내려받으세요. CSV 행 데이터·로컬 경로는 포함되지 않습니다.</p>
      {failure && <p className="csv-view-error" role="alert">{failure}</p>}
      <input ref={input} className="visually-hidden" type="file" accept="application/json,.json" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) onImport(file) }} />
    </div>
    <footer><button type="button" className="secondary-button" onClick={() => input.current?.click()}><Upload size={14} />뷰 가져오기</button><button type="button" className="secondary-button" onClick={() => onExport('all')}><Download size={14} />모든 뷰 다운로드</button><span className="csv-view-manager-spacer" /><button type="button" className="primary-button" onClick={onClose}>완료</button></footer>
  </section></div>
}

function saveFailure(result: Exclude<CsvSaveResult, { ok: true }>): string {
  return result.reason === 'invalid' ? result.issues.map((issue) => issue.detail ?? issue.code).join(' · ') : result.reason === 'storage' ? result.error.message : '다른 탭에서 설정이 변경되었습니다.'
}
