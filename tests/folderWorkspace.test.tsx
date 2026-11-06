// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useFolderWorkspace } from '../src/app/useFolderWorkspace'
import type { DocumentSaveService } from '../src/app/documentSave'
import type { FolderEntry, FolderWorkspace } from '../src/domain/workspace'
import type { ViewerDocument } from '../src/domain/types'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let workspaceApi: ReturnType<typeof useFolderWorkspace>
let host: HTMLDivElement
let root: Root

function makeDocument(): ViewerDocument {
  return {
    id: 'doc-1', name: 'note.md', format: 'md', mimeType: 'text/markdown', size: 4,
    initialBytes: new ArrayBuffer(4), savedBytes: new ArrayBuffer(4), sourceText: 'old', text: 'new',
    model: { text: 'new' }, mode: 'view', revision: 1, modelRevision: 1, textRevision: 1,
    parseState: 'ready', diagnostics: [], encoding: 'UTF-8', bom: false, savedText: 'old', isDirty: true,
    openedAt: 1, lastEditedAt: 1, folderRef: { folderId: 'folder-1', path: 'note.md' }
  }
}

function renderWorkspace(documents: ViewerDocument[] = [], folder: FolderWorkspace | null = null, entries: FolderEntry[] = [], saveDocumentById: DocumentSaveService['saveDocumentById'] = async () => ({ status: 'cancelled', documentId: '' })): { onTransitionLock: ReturnType<typeof vi.fn>; onDocumentSelect: ReturnType<typeof vi.fn> } {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const onTransitionLock = vi.fn()
  const onDocumentSelect = vi.fn()
  const saveService: DocumentSaveService = {
    prepareSourceSave: vi.fn(), saveDocumentById, continueDocumentSave: vi.fn(), confirmDownload: vi.fn()
  }
  const props = {
    initialFolder: folder,
    initialSource: folder ? { kind: 'input' as const, files: new Map([['note.md', new File(['body'], 'note.md')]]) } : null,
    initialEntries: entries,
    getDocuments: () => documents,
    getPendingSerializations: () => new Map<string, Promise<void>>(),
    saveService,
    onCommit: vi.fn(async () => undefined),
    onDocumentOpen: vi.fn(), onDocumentSelect, onAssetSelect: vi.fn(), onError: vi.fn(), onTransitionLock
  }
  function Harness() { workspaceApi = useFolderWorkspace(props); return null }
  act(() => root.render(<Harness />))
  return { onTransitionLock, onDocumentSelect }
}

afterEach(() => {
  if (root) act(() => root.unmount())
  host?.remove()
})

describe('folder workspace coordination', () => {
  it('skips the save dialog when there are no dirty documents and unlocks on cancel', async () => {
    const callbacks = renderWorkspace()
    await act(async () => { workspaceApi.openFolder(); await Promise.resolve(); await Promise.resolve() })
    expect(workspaceApi.phase).toBe('ready-to-pick')
    expect(callbacks.onTransitionLock).toHaveBeenLastCalledWith(true)
    act(() => workspaceApi.cancelTransition())
    expect(workspaceApi.phase).toBe('idle')
    expect(callbacks.onTransitionLock).toHaveBeenLastCalledWith(false)
  })

  it('captures dirty non-active documents before offering a transition', async () => {
    const document = makeDocument()
    renderWorkspace([document])
    await act(async () => { workspaceApi.openFolder(); await Promise.resolve(); await Promise.resolve() })
    expect(workspaceApi.phase).toBe('confirming')
    expect(workspaceApi.rows.map((row) => row.document.id)).toEqual(['doc-1'])
    act(() => workspaceApi.cancelTransition())
  })

  it('selects an already open folder document without creating another session', async () => {
    const document = { ...makeDocument(), isDirty: false, text: 'old', savedText: 'old' }
    const folder: FolderWorkspace = { id: 'folder-1', name: 'Notes', access: 'input', expandedPaths: [''], activePath: null }
    const callbacks = renderWorkspace([document], folder, [{ path: 'note.md', name: 'note.md', kind: 'file' }])
    await act(async () => { await workspaceApi.openPath('note.md') })
    expect(callbacks.onDocumentSelect).toHaveBeenCalledWith('doc-1')
  })

  it('reconfirms a newer revision and allows that revision to be saved', async () => {
    const documents = [makeDocument()]
    let attempt = 0
    const save = vi.fn<DocumentSaveService['saveDocumentById']>(async () => {
      attempt += 1
      if (attempt === 1) {
        documents[0] = { ...documents[0]!, revision: 2, modelRevision: 2, textRevision: 2, text: 'newer', model: { text: 'newer' } }
        return { status: 'failed' as const, documentId: 'doc-1', message: '바뀐 문서' }
      }
      documents[0] = { ...documents[0]!, savedText: 'newer', isDirty: false }
      return { status: 'saved' as const, documentId: 'doc-1', revision: 2 }
    })
    renderWorkspace(documents, null, [], save)
    await act(async () => { workspaceApi.openFolder(); await Promise.resolve(); await Promise.resolve() })
    await act(async () => { await workspaceApi.saveAll() })
    expect(workspaceApi.phase).toBe('confirming')
    expect(workspaceApi.rows[0]?.document.revision).toBe(2)
    await act(async () => { await workspaceApi.saveAll() })
    expect(workspaceApi.phase).toBe('ready-to-pick')
    expect(save).toHaveBeenCalledTimes(2)
  })
})
