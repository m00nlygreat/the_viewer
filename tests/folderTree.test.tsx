// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FolderTree } from '../src/app/FolderTree'
import type { FolderWorkspace } from '../src/domain/workspace'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLDivElement

function renderTree() {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1 })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const onToggleDirectory = vi.fn()
  const onOpenPath = vi.fn()
  const onRefresh = vi.fn()
  const folder: FolderWorkspace = { id: 'folder-1', name: 'Notes', access: 'input', expandedPaths: [''], activePath: null }
  const entriesByPath = new Map([['', [{ path: 'sub', name: 'sub', kind: 'directory' as const }, { path: 'note.md', name: 'note.md', kind: 'file' as const }]]])
  act(() => root.render(<FolderTree
    folder={folder}
    entriesByPath={entriesByPath}
    loadingPaths={new Set()} errorsByPath={new Map()} activePath={null} dirtyPaths={new Set()} openPaths={new Set(['missing.md'])}
    onToggleDirectory={onToggleDirectory} onOpenPath={onOpenPath} onRefresh={onRefresh}
  />))
  return { onToggleDirectory, onOpenPath, onRefresh }
}

afterEach(() => {
  if (root) act(() => root.unmount())
  host?.remove()
  vi.unstubAllGlobals()
})

describe('folder tree controls', () => {
  it('exposes tree semantics, missing open files and keyboard expansion', () => {
    const callbacks = renderTree()
    expect(host.querySelector('[role="tree"]')).not.toBeNull()
    expect(host.querySelector('[role="treeitem"][aria-label="missing.md · 폴더에서 사라짐"]')).not.toBeNull()
    const child = host.querySelector<HTMLButtonElement>('[role="treeitem"][aria-label="sub"]')!
    act(() => child.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
    expect(callbacks.onToggleDirectory).toHaveBeenCalledWith('sub', true)
  })

  it('opens a file and refreshes the parent of a missing entry', () => {
    const callbacks = renderTree()
    const file = host.querySelector<HTMLButtonElement>('[role="treeitem"][aria-label="note.md"]')!
    act(() => file.click())
    expect(callbacks.onOpenPath).toHaveBeenCalledWith('note.md')
    const refresh = host.querySelector<HTMLButtonElement>('.folder-tree-file-error button')!
    act(() => refresh.click())
    expect(callbacks.onRefresh).toHaveBeenCalledWith('')
  })
})
