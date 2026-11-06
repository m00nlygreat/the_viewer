import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Folder, FolderOpen, RefreshCw } from 'lucide-react'
import type { FolderEntry, FolderPath, FolderWorkspace } from '../domain/workspace'
import { getFormat } from '../domain/fileFormats'

export interface FolderTreeProps {
  folder: FolderWorkspace
  entriesByPath: ReadonlyMap<FolderPath, readonly FolderEntry[]>
  loadingPaths: ReadonlySet<FolderPath>
  errorsByPath: ReadonlyMap<FolderPath, string>
  activePath: FolderPath | null
  dirtyPaths: ReadonlySet<FolderPath>
  openPaths: ReadonlySet<FolderPath>
  onToggleDirectory: (path: FolderPath, expanded: boolean) => void
  onOpenPath: (path: FolderPath) => void
  onRefresh: (path: FolderPath) => void
  onCloseFolder?: () => void
  compact?: boolean
}

type VisibleNode = FolderEntry & { depth: number; missing?: boolean }

export function FolderTree({ folder, entriesByPath, loadingPaths, errorsByPath, activePath, dirtyPaths, openPaths, onToggleDirectory, onOpenPath, onRefresh, onCloseFolder, compact = false }: FolderTreeProps) {
  const [focusedPath, setFocusedPath] = useState('')
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const visible = useMemo(() => {
    const nodes: VisibleNode[] = []
    const childrenFor = (parent: string): VisibleNode[] => {
      const children = new Map<string, VisibleNode>((entriesByPath.get(parent) ?? []).map((entry) => [entry.path, { ...entry, depth: 0 }]))
      for (const path of openPaths) {
        const prefix = parent ? `${parent}/` : ''
        if (parent && !path.startsWith(prefix)) continue
        const relative = parent ? path.slice(prefix.length) : path
        const [name, ...rest] = relative.split('/')
        if (!name) continue
        const childPath = parent ? `${parent}/${name}` : name
        if (!children.has(childPath)) children.set(childPath, { path: childPath, name, kind: rest.length ? 'directory' : 'file', depth: 0, missing: true })
      }
      const collator = new Intl.Collator('ko', { numeric: true })
      return [...children.values()].sort((left, right) => Number(right.kind === 'directory') - Number(left.kind === 'directory') || collator.compare(left.name, right.name) || (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
    }
    const visit = (parent: string, depth: number) => {
      if (parent && !folder.expandedPaths.includes(parent)) return
      for (const entry of childrenFor(parent)) {
        nodes.push({ ...entry, depth })
        if (entry.kind === 'directory') visit(entry.path, depth + 1)
      }
    }
    visit('', 0)
    return nodes
  }, [entriesByPath, folder.expandedPaths, folder.name, openPaths])

  useEffect(() => {
    if (visible.some((item) => item.path === focusedPath)) return
    const ancestor = visible.find((item) => item.path === activePath)?.path ?? visible[0]?.path ?? ''
    setFocusedPath(ancestor)
    if (ancestor) requestAnimationFrame(() => buttons.current.get(ancestor)?.focus())
  }, [activePath, focusedPath, visible])

  const focus = (path: string) => { setFocusedPath(path); requestAnimationFrame(() => buttons.current.get(path)?.focus()) }
  const toggle = (node: VisibleNode) => {
    const expanded = !folder.expandedPaths.includes(node.path)
    if (!expanded && (focusedPath === node.path || (node.path === '' ? Boolean(focusedPath) : focusedPath.startsWith(`${node.path}/`)))) focus(node.path)
    onToggleDirectory(node.path, expanded)
  }
  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, node: VisibleNode, index: number) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      const target = event.key === 'Home' ? 0 : event.key === 'End' ? visible.length - 1 : Math.max(0, Math.min(visible.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))
      focus(visible[target]?.path ?? '')
      return
    }
    if (event.key === 'ArrowRight' && node.kind === 'directory') {
      event.preventDefault()
      if (!folder.expandedPaths.includes(node.path)) toggle(node)
      else if (visible[index + 1]?.depth === node.depth + 1) focus(visible[index + 1]!.path)
      return
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      if (node.kind === 'directory' && folder.expandedPaths.includes(node.path)) toggle(node)
      else if (node.path.includes('/')) focus(node.path.slice(0, node.path.lastIndexOf('/')))
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (node.kind === 'directory') toggle(node)
      else onOpenPath(node.path)
    }
  }

  const renderNode = (node: VisibleNode, index: number) => {
    const expanded = node.kind === 'directory' && folder.expandedPaths.includes(node.path)
    const children = visible.filter((item) => item.depth === node.depth + 1 && (item.path.includes('/') ? item.path.slice(0, item.path.lastIndexOf('/')) : '') === node.path)
    const format = node.kind === 'file' ? getFormat(node.name) : null
    const Icon = node.kind === 'directory' ? (expanded ? FolderOpen : Folder) : null
    return <div className="folder-tree-node" key={node.path}>
      <button
        ref={(element) => { if (element) buttons.current.set(node.path, element); else buttons.current.delete(node.path) }}
        type="button" role="treeitem" aria-level={node.depth + 1}
        aria-expanded={node.kind === 'directory' ? expanded : undefined}
        aria-selected={node.path === activePath}
        aria-label={node.path ? `${node.path}${dirtyPaths.has(node.path) ? ' · 수정됨' : ''}${node.missing ? ' · 폴더에서 사라짐' : ''}` : `${folder.name} 폴더`}
        title={node.path || folder.name} tabIndex={node.path === focusedPath || (!focusedPath && index === 0) ? 0 : -1}
        className={`folder-tree-row${node.path === activePath ? ' active' : ''}${node.missing ? ' missing' : ''}`}
        style={{ '--tree-depth': node.depth } as React.CSSProperties}
        onFocus={() => setFocusedPath(node.path)}
        onKeyDown={(event) => handleKeyDown(event, node, index)}
        onClick={() => node.kind === 'directory' ? toggle(node) : onOpenPath(node.path)}
      >
        {node.kind === 'directory' ? expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} /> : <span className="folder-tree-spacer" />}
        {Icon && <Icon size={14} className="folder-tree-icon" />}
        {format && <span className={`file-badge format-${format}`}>{format.toUpperCase()}</span>}
        <span className="folder-tree-name">{node.name}</span>
        {dirtyPaths.has(node.path) && <span className="dirty-dot" aria-label="수정됨" />}
      </button>
      {node.kind === 'directory' && expanded && <div role="group" className="folder-tree-group">
        {node.missing && <div className="folder-tree-error" role="status">폴더가 사라졌습니다. 열린 작업본은 유지됩니다.<button type="button" className="subtle-button" onClick={() => onRefresh(node.path.includes('/') ? node.path.slice(0, node.path.lastIndexOf('/')) : '')}>다시 확인</button></div>}
        {loadingPaths.has(node.path) && <div className="folder-tree-status" role="status">폴더를 읽고 있습니다…</div>}
        {errorsByPath.get(node.path) && <div className="folder-tree-error" role="alert"><span>{errorsByPath.get(node.path)}</span><button type="button" className="subtle-button" onClick={() => onRefresh(node.path)}>다시 시도</button></div>}
        {!loadingPaths.has(node.path) && !errorsByPath.has(node.path) && children.length === 0 && <div className="folder-tree-status">{entriesByPath.has(node.path) ? '비어 있는 폴더입니다.' : '폴더를 펼치면 항목을 읽습니다.'}</div>}
        {children.length > 0 && children.map((child) => {
          const childIndex = visible.findIndex((item) => item.path === child.path)
          return renderNode({ ...child, depth: node.depth + 1 }, childIndex)
        })}
      </div>}
      {node.kind === 'file' && node.missing && <div className="folder-tree-error folder-tree-file-error" role="status"><span>파일이 폴더에서 사라졌습니다. 열린 작업본은 유지됩니다.</span><button type="button" className="subtle-button" onClick={() => onRefresh(node.path.includes('/') ? node.path.slice(0, node.path.lastIndexOf('/')) : '')}>새로고침</button></div>}
      {node.kind === 'file' && errorsByPath.get(node.path) && <div className="folder-tree-error folder-tree-file-error" role="alert"><span>{errorsByPath.get(node.path)}</span><button type="button" className="subtle-button" onClick={() => onOpenPath(node.path)}>다시 열기</button></div>}
    </div>
  }

  if (compact) {
    const rootFiles = (entriesByPath.get('') ?? []).filter((entry) => entry.kind === 'file')
    return <div className="folder-tree folder-tree-compact">
      <div className="folder-tree-toolbar"><button type="button" className="icon-button" aria-label="폴더 새로고침" title="새로고침" onClick={() => onRefresh('')}><RefreshCw size={14} /></button></div>
      <div className="folder-tree-file-rail" role="list" aria-label={`${folder.name} 폴더의 파일`}>
        {rootFiles.map((entry) => {
          const format = getFormat(entry.name)
          const extension = entry.name.match(/\.([^.]+)$/u)?.[1]
          const badge = format ? format.toUpperCase() : (extension ?? entry.name).slice(0, 4).toUpperCase() || 'FILE'
          return <div role="listitem" key={entry.path}>
            <button type="button" className={`folder-tree-rail-file${format ? ` format-${format}` : ''}${entry.path === activePath ? ' active' : ''}`} aria-label={`${entry.name} 열기`} aria-current={entry.path === activePath ? 'page' : undefined} title={entry.path} onClick={() => onOpenPath(entry.path)}>
              <span className={`file-badge${format ? ` format-${format}` : ''}`}>{badge}</span>
              {dirtyPaths.has(entry.path) && <span className="folder-tree-rail-dirty" aria-label="수정됨" />}
            </button>
          </div>
        })}
      </div>
    </div>
  }

  const rootNodes = visible.filter((item) => item.depth === 0)
  return <div className="folder-tree">
    <div className="folder-tree-toolbar"><span>폴더</span><div className="folder-tree-toolbar-actions">{onCloseFolder && <button type="button" className="subtle-button folder-tree-close" aria-label="폴더 닫기" title="폴더 닫기" onClick={onCloseFolder}>폴더 닫기</button>}<button type="button" className="icon-button" aria-label="폴더 새로고침" title="새로고침" onClick={() => onRefresh('')}><RefreshCw size={13} /></button></div></div>
    <div className="folder-tree-root"><FolderOpen size={14} className="folder-tree-icon" /><span title={folder.name}>{folder.name}</span></div>
    {loadingPaths.has('') && <div className="folder-tree-status" role="status">폴더를 읽고 있습니다…</div>}
    {errorsByPath.get('') && <div className="folder-tree-error" role="alert"><span>{errorsByPath.get('')}</span><button type="button" className="subtle-button" onClick={() => onRefresh('')}>다시 시도</button></div>}
    {!loadingPaths.has('') && !errorsByPath.has('') && rootNodes.length === 0 && <div className="folder-tree-status">{entriesByPath.has('') ? '비어 있는 폴더입니다.' : '폴더를 새로고침해 항목을 읽으세요.'}</div>}
    <div role="tree" aria-label={`${folder.name} 폴더`}>
      {rootNodes.map((node) => renderNode(node, visible.findIndex((item) => item.path === node.path)))}
    </div>
  </div>
}
