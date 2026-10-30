import { Command, FilePlus2, FolderOpen, PanelLeftClose, PanelLeftOpen, Settings2, X } from 'lucide-react'
import type { ViewerDocument } from '../domain/types'
import { safeDisplayFileName } from './displayName'

interface Props {
  documents: readonly ViewerDocument[]
  activeId: string
  collapsed: boolean
  onToggleCollapsed: () => void
  onPickFiles: () => void
  onOpenCommands: () => void
  onSelectDocument: (id: string) => void
  onCloseDocument: (id: string) => void
  onOpenSettings: () => void
}

export function WorkspaceSidebar({ documents, activeId, collapsed, onToggleCollapsed, onPickFiles, onOpenCommands, onSelectDocument, onCloseDocument, onOpenSettings }: Props) {
  return <aside id="document-sidebar" className={`sidebar${collapsed ? ' collapsed' : ''}`}>
    <div className="sidebar-brand"><img src={`${__APP_BASE__}icons/viewer.svg`} alt="" /><span>The Viewer</span><button className="sidebar-toggle" aria-label={collapsed ? '사이드바 펼치기' : '사이드바 접기'} title={collapsed ? '사이드바 펼치기' : '사이드바 접기'} aria-controls="document-sidebar" aria-expanded={!collapsed} onClick={onToggleCollapsed}>{collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}</button></div>
    <button className="sidebar-open" aria-label="파일 열기" title="파일 열기" onClick={onPickFiles}><FolderOpen size={15} /><span>파일 열기</span><kbd>⌘ O</kbd></button>
    <button className="sidebar-command" aria-label="명령 메뉴" title="명령 메뉴" onClick={onOpenCommands}><Command size={14} /><span>명령 메뉴</span><kbd>⌘ K</kbd></button>
    <div className="sidebar-section-title"><span>열린 파일</span><button aria-label="파일 열기" onClick={onPickFiles}><FilePlus2 size={14} /></button></div>
    <nav className="document-nav" aria-label="열린 파일">
      {documents.map((item) => <div className={`document-nav-row${item.id === activeId ? ' active' : ''}`} key={item.id}>
        <button className="document-nav-select" aria-label={item.name} title={item.name} onClick={() => onSelectDocument(item.id)}><span className={`file-badge format-${item.format}`}>{item.format.toUpperCase()}</span><span className="document-nav-name">{safeDisplayFileName(item.name)}</span>{item.isDirty && <i className="dirty-dot" aria-label="수정됨" />}</button>
        <button className="document-nav-close" aria-label={`${item.name} 닫기`} onClick={() => onCloseDocument(item.id)}><X size={13} /></button>
      </div>)}
      {!documents.length && <div className="sidebar-empty">열린 파일이 없습니다.</div>}
    </nav>
    <div className="sidebar-bottom"><button className="sidebar-settings" aria-label="설정" title="설정" onClick={onOpenSettings}><Settings2 size={14} /><span className="sidebar-settings-label">설정</span><span className="sidebar-version">v{__APP_VERSION__}</span></button></div>
  </aside>
}
