import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ViewerDocument } from '../src/domain/types'
import { DocumentController } from '../src/domain/documentController'
import { createDocumentSaveService } from '../src/app/documentSave'

vi.mock('../src/platform/browserFiles', () => ({
  downloadLocalFile: vi.fn(),
  pickLocalSaveHandle: vi.fn(() => null),
  pickMatchingLocalSourceFile: vi.fn(),
  requestLocalFileWritePermission: vi.fn(),
  writeLocalFileHandle: vi.fn(async () => undefined)
}))

import { downloadLocalFile, writeLocalFileHandle } from '../src/platform/browserFiles'

function makeDocument(overrides: Partial<ViewerDocument> = {}): ViewerDocument {
  return {
    id: 'doc-1', name: 'note.md', format: 'md', mimeType: 'text/markdown', size: 4,
    initialBytes: new TextEncoder().encode('old').buffer, savedBytes: new TextEncoder().encode('old').buffer,
    sourceText: 'old', text: 'new', model: { text: 'new' }, mode: 'view', revision: 1, modelRevision: 1, textRevision: 1,
    parseState: 'ready', diagnostics: [], encoding: 'UTF-8', bom: false, savedText: 'old', isDirty: true,
    openedAt: 1, lastEditedAt: 1, ...overrides
  } as ViewerDocument
}

describe('document save service', () => {
  beforeEach(() => vi.clearAllMocks())

  it('saves a specific document by id and updates only its save baseline', async () => {
    const handle = { queryPermission: vi.fn(async () => 'granted') } as unknown as FileSystemFileHandle
    let current = makeDocument({ sourceFileHandle: handle })
    const publishDocument = vi.fn((document: ViewerDocument) => { current = document })
    const service = createDocumentSaveService({
      getDocument: (id) => id === current.id ? current : null,
      getPendingSerialization: () => undefined,
      publishDocument,
      controller: new DocumentController()
    })

    await expect(service.saveDocumentById('doc-1')).resolves.toEqual({ status: 'saved', documentId: 'doc-1', revision: 1 })
    expect(writeLocalFileHandle).toHaveBeenCalledTimes(1)
    expect(publishDocument).toHaveBeenCalledTimes(1)
    expect(current.isDirty).toBe(false)
  })

  it('returns a user action for an unlinked file and leaves the document dirty', async () => {
    let current = makeDocument({ fileSource: 'file-url' })
    const service = createDocumentSaveService({
      getDocument: (id) => id === current.id ? current : null,
      getPendingSerialization: () => undefined,
      publishDocument: (document) => { current = document },
      controller: new DocumentController()
    })

    const result = await service.saveDocumentById('doc-1')
    expect(result).toMatchObject({ status: 'needs-user-action', action: 'link-source' })
    expect(current.isDirty).toBe(true)
    expect(downloadLocalFile).not.toHaveBeenCalled()
  })
})
