import { ChevronDown, Command, FileText, FolderOpen, LogOut, Moon, Redo2, Settings2, Share2, Sun, Undo2, Upload } from 'lucide-react'
import type { ViewerDocument } from '../domain/types'
import { safeDisplayFileName } from './displayName'

interface HeaderProps {
  document: ViewerDocument | null
  theme: 'light' | 'dark'
  canShare: boolean
  onModeChange: (mode: ViewerDocument['mode']) => void
  onThemeChange: (theme: 'light' | 'dark') => void
  onUndo: () => void
  onRedo: () => void
  onSave: () => void
  onShare: () => void
  onClose: () => void
  onPickFiles: () => void
  onOpenCommands: () => void
  onOpenSettings: () => void
}

export function DocumentHeader(props: HeaderProps) {
  const { document, theme, canShare, onModeChange, onThemeChange, onUndo, onRedo, onSave, onShare, onClose, onPickFiles, onOpenCommands, onOpenSettings } = props
  return <header className="topbar">
    <button className="mobile-menu icon-button" aria-label="열린 파일" onClick={onOpenCommands}><span className="visually-hidden">열린 파일</span><Command size={17} /></button>
    <div className="topbar-document"><span className="topbar-file-icon">{document ? <span className={`file-badge format-${document.format}`}>{document.format.toUpperCase()}</span> : <FileText size={16} />}</span><span className="topbar-name">{document ? safeDisplayFileName(document.name) : '작업 공간'}</span>{document?.isDirty && <span className="modified-pill">수정됨</span>}{document?.parentId && <span className="parent-tag">첨부에서 열림</span>}</div>
    <div className="topbar-actions">
      {document ? <>
        <button className="icon-button desktop-only" aria-label="실행 취소" title="실행 취소" onClick={onUndo}><Undo2 size={15} /></button>
        <button className="icon-button desktop-only" aria-label="다시 실행" title="다시 실행" onClick={onRedo}><Redo2 size={15} /></button>
        <div className="topbar-divider desktop-only" />
        <DocumentModeTabs document={document} placement="desktop" onModeChange={onModeChange} />
        <button className="icon-button theme-toggle" aria-label={`현재 ${theme === 'dark' ? '다크' : '라이트'} 테마; 테마 변경`} title="테마 전환" onClick={() => onThemeChange(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}</button>
        <button className="primary-button export-button" onClick={onSave}><Upload size={14} /><span>내보내기</span><ChevronDown size={12} /></button>
        {canShare && <button className="icon-button desktop-only" aria-label="시스템 공유" title="시스템 공유" onClick={onShare}><Share2 size={15} /></button>}
        <button className="icon-button close-current" aria-label="현재 파일 닫기" onClick={onClose}><LogOut size={15} /></button>
      </> : <>
        <button className="icon-button theme-toggle" aria-label="테마 설정" onClick={() => onThemeChange(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}</button>
        <button className="icon-button" aria-label="설정" onClick={onOpenSettings}><Settings2 size={16} /></button>
        <button className="primary-button" onClick={onPickFiles}><FolderOpen size={14} /><span>파일 열기</span></button>
      </>}
    </div>
  </header>
}

export function DocumentActionBar({ document, onModeChange, onUndo, onRedo, onSave }: Pick<HeaderProps, 'document' | 'onModeChange' | 'onUndo' | 'onRedo' | 'onSave'>) {
  if (!document) return null
  return <nav className="mobile-action-bar" aria-label="문서 동작">
    <DocumentModeTabs document={document} placement="mobile" onModeChange={onModeChange} />
    <button className="secondary-button mobile-history" aria-label="실행 취소" onClick={onUndo}><Undo2 size={17} /></button>
    <button className="secondary-button mobile-history" aria-label="다시 실행" onClick={onRedo}><Redo2 size={17} /></button>
    <button className="primary-button mobile-export" onClick={onSave}><Upload size={15} /> 내보내기</button>
  </nav>
}

function DocumentModeTabs({ document, placement, onModeChange }: { document: ViewerDocument; placement: 'desktop' | 'mobile'; onModeChange: HeaderProps['onModeChange'] }) {
  const modes: ViewerDocument['mode'][] = ['view', 'source']
  const label: Record<ViewerDocument['mode'], string> = { view: '보기', source: '원본' }
  return <div className="mode-switch" role="tablist" aria-label="문서 탭" onKeyDown={(event) => {
    const current = event.target instanceof HTMLButtonElement ? event.target.dataset.mode as ViewerDocument['mode'] | undefined : undefined
    const index = current ? modes.indexOf(current) : -1
    const next = event.key === 'ArrowRight' ? (index + 1) % modes.length : event.key === 'ArrowLeft' ? (index + modes.length - 1) % modes.length : event.key === 'Home' ? 0 : event.key === 'End' ? modes.length - 1 : -1
    if (next < 0) return
    event.preventDefault()
    const mode = modes[next]!
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-mode="${mode}"]`)?.focus()
    onModeChange(mode)
  }}>{modes.map((mode) => <button key={mode} id={`document-${document.id}-${placement}-tab-${mode}`} data-mode={mode} role="tab" aria-controls={`document-panel-${document.id}`} aria-selected={document.mode === mode} tabIndex={document.mode === mode ? 0 : -1} className={document.mode === mode ? 'active' : ''} onClick={() => onModeChange(mode)}>{label[mode]}</button>)}</div>
}
