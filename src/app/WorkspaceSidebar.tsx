import { memo } from 'react'
import { Command, FilePlus2, FolderOpen, PanelLeftClose, PanelLeftOpen, Settings2, X } from 'lucide-react'
import type { FolderEntry, FolderPath, FolderWorkspace } from '../domain/workspace'
import { safeDisplayFileName } from './displayName'
import type { DocumentListItem } from './documentStore'
import { FolderTree } from './FolderTree'

interface Props {
  documents: readonly DocumentListItem[]
  activeId: string
  collapsed: boolean
  onToggleCollapsed: () => void
  onPickFiles: () => void
  onOpenCommands: () => void
  onSelectDocument: (id: string) => void
  onCloseDocument: (id: string) => void
  onOpenSettings: () => void
  folder?: FolderWorkspace | null
  folderTree?: {
    entriesByPath: ReadonlyMap<FolderPath, readonly FolderEntry[]>
    loadingPaths: ReadonlySet<FolderPath>
    errorsByPath: ReadonlyMap<FolderPath, string>
    activePath: FolderPath | null
    dirtyPaths: ReadonlySet<FolderPath>
    openPaths: ReadonlySet<FolderPath>
    onToggleDirectory: (path: FolderPath, expanded: boolean) => void
    onOpenPath: (path: FolderPath) => void
    onRefresh: (path: FolderPath) => void
  }
  onOpenFolder?: () => void
  onCloseFolder?: () => void
  folderPickingAvailable?: boolean
}

export const WorkspaceSidebar = memo(function WorkspaceSidebar({ documents, activeId, collapsed, onToggleCollapsed, onPickFiles, onOpenCommands, onSelectDocument, onCloseDocument, onOpenSettings, folder = null, folderTree, onOpenFolder, onCloseFolder, folderPickingAvailable = true }: Props) {
  const additionalDocuments = folder ? documents.filter((item) => item.folderRef?.folderId !== folder.id) : documents
  return <aside id="document-sidebar" className={`sidebar${collapsed ? ' collapsed' : ''}`}>
    <div className="sidebar-brand"><img src={`${__APP_BASE__}icons/viewer.svg`} alt="" /><span>The Viewer</span><button className="sidebar-toggle" aria-label={collapsed ? '사이드바 펼치기' : '사이드바 접기'} title={collapsed ? '사이드바 펼치기' : '사이드바 접기'} aria-controls="document-sidebar" aria-expanded={!collapsed} onClick={onToggleCollapsed}>{collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}</button></div>
    <button className="sidebar-open" aria-label="파일 열기" title="파일 열기" onClick={onPickFiles}><FilePlus2 size={15} /><span>파일 열기</span><kbd><span>⌘</span><span>O</span></kbd></button>
    <button className="sidebar-folder-open" aria-label={folder ? '다른 폴더 열기' : '폴더 열기'} title={folder ? '다른 폴더 열기' : '폴더 열기'} onClick={onOpenFolder} disabled={!folderPickingAvailable}><FolderOpen size={15} /><span>{folder ? '다른 폴더 열기' : '폴더 열기'}</span></button>
    <button className="sidebar-command" aria-label="명령 메뉴" title="명령 메뉴" onClick={onOpenCommands}><Command size={14} /><span>명령 메뉴</span><kbd><span>⌘</span><span>K</span></kbd></button>
    <div className="sidebar-section-divider" role="separator" />
    {folder && folderTree && <div className="sidebar-folder-area">
      <FolderTree folder={folder} {...folderTree} onCloseFolder={onCloseFolder} compact={collapsed} />
    </div>}
    <nav className={`document-nav${folder ? ' document-nav-folder' : ''}${folder && !additionalDocuments.length ? ' document-nav-empty' : ''}`} aria-label={folder ? '추가로 연 파일' : '열린 파일'}>
      {folder && additionalDocuments.length > 0 && <div className="sidebar-list-heading">추가로 연 파일</div>}
      {additionalDocuments.map((item) => <div className={`document-nav-row${item.id === activeId ? ' active' : ''}`} key={item.id}>
        <button className="document-nav-select" aria-label={`${item.name}${item.isDirty ? ' · 수정됨' : ''}`} title={`${item.name}${item.isDirty ? ' · 수정됨' : ''}`} onClick={() => onSelectDocument(item.id)}><span className="document-nav-badge"><span className={`file-badge format-${item.format}`}>{item.contentKind === 'plain-text' ? 'TXT' : item.contentKind === 'unsupported' ? '?' : item.format.toUpperCase()}</span>{item.isDirty && <i className="document-nav-badge-dot" aria-hidden="true" />}</span><span className="document-nav-name">{safeDisplayFileName(item.name)}</span>{item.isDirty && <i className="dirty-dot" aria-hidden="true" />}</button>
        <button className="document-nav-close" aria-label={`${item.name} 닫기`} onClick={() => onCloseDocument(item.id)}><X size={13} /></button>
      </div>)}
      {!additionalDocuments.length && !folder && <div className="sidebar-empty">열린 파일이 없습니다.</div>}
    </nav>
    <div className="sidebar-bottom"><button className="sidebar-settings" aria-label="설정" title="설정" onClick={onOpenSettings}><Settings2 size={14} /><span className="sidebar-settings-label">설정</span><span className="sidebar-version">v{__APP_VERSION__}</span></button></div>
  </aside>
})
