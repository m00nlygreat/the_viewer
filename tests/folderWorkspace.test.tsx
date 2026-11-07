// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useFolderWorkspace } from '../src/app/useFolderWorkspace'
import { DocumentStore } from '../src/app/documentStore'
import type { DocumentSaveService } from '../src/app/documentSave'
import type { FolderEntry, FolderWorkspace } from '../src/domain/workspace'
import type { ViewerDocument } from '../src/domain/types'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let workspaceApi: ReturnType<typeof useFolderWorkspace>
let host: HTMLDivElement
let root: Root

function makeDocument(): Extract<ViewerDocument, { format: 'md' }> {
  return {
    id: 'doc-1', name: 'note.md', format: 'md', mimeType: 'text/markdown', size: 4,
    initialBytes: new ArrayBuffer(4), savedBytes: new ArrayBuffer(4), sourceText: 'old', text: 'new',
    model: { text: 'new' }, mode: 'view', revision: 1, modelRevision: 1, textRevision: 1,
    parseState: 'ready', diagnostics: [], encoding: 'UTF-8', bom: false, savedText: 'old', isDirty: true,
    openedAt: 1, lastEditedAt: 1, folderRef: { folderId: 'folder-1', path: 'note.md' }
  }
}

function renderWorkspace(documents: ViewerDocument[] = [], folder: FolderWorkspace | null = null, entries: FolderEntry[] = [], saveDocumentById: DocumentSaveService['saveDocumentById'] = async () => ({ status: 'cancelled', documentId: '' }), loadDocumentPayload: (id: string) => Promise<ViewerDocument> = async (id) => documents.find((item) => item.id === id)!, summaryStore?: DocumentStore, sourceFiles?: Map<string, File>): { onTransitionLock: ReturnType<typeof vi.fn>; onDocumentSelect: ReturnType<typeof vi.fn> } {
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
    initialSource: folder ? { kind: 'input' as const, files: sourceFiles ?? new Map([['note.md', new File(['body'], 'note.md')]]) } : null,
    initialEntries: entries,
    getDocuments: () => documents,
    ...(summaryStore ? {
      getDocumentSummaries: summaryStore.getListSnapshot,
      subscribeDocumentSummaries: summaryStore.subscribeList
    } : {}),
    getPendingSerializations: () => new Map<string, Promise<void>>(),
    loadDocumentPayload,
    saveService,
    onCommit: vi.fn(async () => undefined),
    onDocumentOpen: vi.fn(), onDocumentSelect, onAssetSelect: vi.fn(), onError: vi.fn(), onTransitionLock
  }
  function Harness() { workspaceApi = useFolderWorkspace(props); return null }
  act(() => root.render(<Harness />))
  return { onTransitionLock, onDocumentSelect }
}

afterEach(() => {
  vi.unstubAllGlobals()
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

  it('updates folder dirty paths from document list summary changes', () => {
    const document = makeDocument()
    const folder: FolderWorkspace = { id: 'folder-1', name: 'Notes', access: 'input', expandedPaths: [''], activePath: null }
    const store = new DocumentStore()
    store.replaceAll([document])
    renderWorkspace([document], folder, [], undefined, undefined, store)
    expect(workspaceApi.dirtyPaths.has('note.md')).toBe(true)

    act(() => { store.update({ ...document, isDirty: false }) })

    expect(workspaceApi.dirtyPaths.has('note.md')).toBe(false)
  })

  it('loads an unopened Markdown payload before resolving a reference to it', async () => {
    const folder: FolderWorkspace = { id: 'folder-1', name: 'Notes', access: 'input', expandedPaths: [''], activePath: null }
    const fullDocument = makeDocument()
    const stub = { ...fullDocument, text: '', sourceText: '', savedText: '', model: { text: '' }, payloadLoaded: false }
    const loadDocumentPayload = vi.fn(async () => fullDocument)
    renderWorkspace([stub], folder, [], undefined, loadDocumentPayload)

    const resolution = await workspaceApi.resolveReference('owner.md', '[[note]]', 'note.md', 'markdown', workspaceApi.generation, new AbortController().signal)

    expect(loadDocumentPayload).toHaveBeenCalledWith('doc-1')
    expect(resolution).toMatchObject({ status: 'markdown', path: 'note.md', text: 'new', revision: 1 })
  })

  it('shares an in-flight and cached read for the same Markdown reference', async () => {
    vi.stubGlobal('Worker', undefined)
    const readFileBytes = vi.fn(async () => new TextEncoder().encode('# Shared note').buffer)
    const file = { name: 'note.md', type: 'text/markdown', size: 13, arrayBuffer: readFileBytes } as unknown as File
    const folder: FolderWorkspace = { id: 'folder-1', name: 'Notes', access: 'input', expandedPaths: [''], activePath: null }
    renderWorkspace([], folder, [], undefined, undefined, undefined, new Map([['note.md', file]]))
    const generation = workspaceApi.generation
    const firstSignal = new AbortController().signal
    const secondSignal = new AbortController().signal

    const [first, second] = await Promise.all([
      workspaceApi.resolveReference('owner.md', '', './note.md', 'markdown', generation, firstSignal),
      workspaceApi.resolveReference('owner.md', '', './note.md', 'markdown', generation, secondSignal)
    ])
    const cached = await workspaceApi.resolveReference('owner.md', '', './note.md', 'markdown', generation, new AbortController().signal)

    expect(readFileBytes).toHaveBeenCalledTimes(1)
    expect(first).toEqual(second)
    expect(cached).toEqual(first)
    expect(first).toMatchObject({ status: 'markdown', path: 'note.md', text: '# Shared note' })
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
