import { X } from 'lucide-react'
import { useFocusTrap } from '../components/useFocusTrap'
import type { FolderWorkspace } from '../domain/workspace'
import { FolderTree, type FolderTreeProps } from './FolderTree'

interface Props { folder: FolderWorkspace; tree: Omit<FolderTreeProps, 'folder'>; onClose: () => void }

export function FolderTreeDrawer({ folder, tree, onClose }: Props) {
  const dialog = useFocusTrap<HTMLElement>()
  return <div className="folder-drawer-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section ref={dialog} className="folder-drawer" role="dialog" aria-modal="true" aria-label="폴더 탐색">
      <header><strong>폴더 탐색</strong><button type="button" className="icon-button" aria-label="폴더 탐색 닫기" onClick={onClose}><X size={15} /></button></header>
      <div className="folder-drawer-content"><FolderTree folder={folder} {...tree} /></div>
    </section>
  </div>
}
