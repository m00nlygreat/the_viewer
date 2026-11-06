import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { useFocusTrap } from '../components/useFocusTrap'
import type { FolderTransitionPhase } from '../domain/folderTransition'
import type { PreparedDocumentSave, SaveAction, DocumentSaveResult } from './documentSave'
import type { ViewerDocument } from '../domain/types'

export interface TransitionRow { document: ViewerDocument; plan?: PreparedDocumentSave; action?: SaveAction; result?: DocumentSaveResult }
interface Props {
  phase: FolderTransitionPhase
  rows: readonly TransitionRow[]
  closing: boolean
  busyRowId?: string
  onSaveAll: () => void
  onDiscard: () => void
  onCancel: () => void
  onContinue: (row: TransitionRow) => void
  onConfirmDownload: (row: TransitionRow) => void
}

export function FolderTransitionDialog({ phase, rows, closing, busyRowId, onSaveAll, onDiscard, onCancel, onContinue, onConfirmDownload }: Props) {
  const dialog = useFocusTrap<HTMLElement>()
  const initialFocus = useRef<HTMLButtonElement>(null)
  const confirming = phase === 'confirming' || phase === 'saving'
  useEffect(() => { if (confirming) initialFocus.current?.focus() }, [confirming])
  if (!confirming) return null
  return <div className="overlay folder-transition-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}>
    <section ref={dialog} className="folder-transition-dialog" role="dialog" aria-modal="true" aria-labelledby="folder-transition-title" onKeyDown={(event) => { if (event.key === 'Escape' && phase !== 'saving') { event.preventDefault(); onCancel() } }}>
      <header className="dialog-header"><div><h2 id="folder-transition-title">{closing ? '폴더 닫기' : '폴더 열기'}</h2><p>열린 문서의 변경 사항을 확인하세요.</p></div><button type="button" className="icon-button" aria-label="닫기" onClick={onCancel}><X size={16} /></button></header>
      {confirming && <div className="folder-transition-body">
        <div className="folder-transition-count">수정된 문서 {rows.length}개</div>
        {rows.length === 0 && <p className="small-muted">저장할 변경 사항이 없습니다.</p>}
        <ul className="folder-transition-rows">{rows.map((row) => <li key={row.document.id}>
          <div className="folder-transition-copy"><strong>{row.document.name}</strong><small>{row.document.folderRef?.path ?? (row.document.parentId ? '이메일 첨부' : '추가로 연 파일')} · {row.document.format.toUpperCase()} · revision {row.document.revision}</small>
            {row.result?.status === 'failed' && <small className="folder-transition-error">{row.result.message}</small>}
            {row.result?.status === 'download-started' && <small>다운로드가 시작되었습니다. 파일을 확인한 뒤 계속하세요.</small>}
          </div>
          {busyRowId === row.document.id ? <span className="small-muted">처리 중…</span> : row.result?.status === 'download-started' ? <button type="button" className="secondary-button" disabled={phase === 'saving'} onClick={() => onConfirmDownload(row)}>파일을 확인하고 계속</button> : row.action && row.plan ? <button type="button" className="secondary-button" disabled={phase === 'saving'} onClick={() => onContinue(row)}>{row.action === 'grant-write' ? '쓰기 권한 허용' : row.action === 'link-source' ? '원본 파일 연결' : '저장 위치 선택'}</button> : row.result?.status === 'saved' ? <span className="ready-label">저장됨</span> : <span className="small-muted">저장 대기</span>}
        </li>)}</ul>
      </div>}
      <footer className="dialog-actions">
        <button type="button" className="secondary-button" disabled={phase === 'saving'} onClick={onCancel}>취소</button><button type="button" className="secondary-button" disabled={phase === 'saving'} onClick={onDiscard}>저장하지 않고 계속</button><button ref={initialFocus} type="button" className="primary-button" disabled={phase === 'saving'} onClick={onSaveAll}>모두 저장</button>
      </footer>
    </section>
  </div>
}
