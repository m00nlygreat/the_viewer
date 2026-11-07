import 'fake-indexeddb/auto'
import { deleteDB } from 'idb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ViewerDocument } from '../src/domain/types'

const databaseName = 'the-viewer:/'

function makeLegacyDocument(id: string) {
  const text = `restored ${id}`
  const bytes = new TextEncoder().encode(text).buffer
  return {
    id, name: `${id}.md`, format: 'md', mimeType: 'text/markdown', size: bytes.byteLength,
    initialBytes: bytes.slice(0), savedBytes: bytes.slice(0), sourceText: text, text,
    model: { text }, mode: 'view', revision: 2, modelRevision: 2, textRevision: 2,
    parseState: 'ready', diagnostics: [], encoding: 'UTF-8', bom: false, savedText: text, isDirty: false,
    openedAt: 2, lastEditedAt: 3
  }
}

async function seedDatabase(version: 1 | 2, document: ReturnType<typeof makeLegacyDocument>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(databaseName, version)
    request.onerror = () => reject(request.error)
    request.onupgradeneeded = () => {
      const db = request.result
      const documents = db.createObjectStore('documents', { keyPath: 'id' })
      documents.createIndex('by-opened', 'openedAt')
      db.createObjectStore('settings', { keyPath: 'key' })
      db.createObjectStore('shares', { keyPath: 'id' })
      if (version === 2) db.createObjectStore('documentPayloads', { keyPath: 'id' })
    }
    request.onsuccess = () => {
      const db = request.result
      const stores = version === 1 ? ['documents'] : ['documents', 'documentPayloads']
      const transaction = db.transaction(stores, 'readwrite')
      if (version === 1) transaction.objectStore('documents').put({ ...document, schemaVersion: 1 })
      else {
        const summary = { ...document, schemaVersion: 2, payloadRef: true } as Record<string, unknown>
        for (const key of ['model', 'text', 'sourceText', 'savedText', 'savedBytes', 'initialBytes']) delete summary[key]
        transaction.objectStore('documents').put(summary)
        transaction.objectStore('documentPayloads').put({ ...document, schemaVersion: 2 })
      }
      transaction.oncomplete = () => { db.close(); resolve() }
      transaction.onerror = () => { db.close(); reject(transaction.error) }
      transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error('legacy seed transaction aborted')) }
    }
  })
}

describe('IndexedDB schema upgrades', () => {
  afterEach(async () => {
    await deleteDB(databaseName)
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  it.each([1, 2] as const)('upgrades v%s data into split payloads without losing source or byte baselines', async (version) => {
    const legacy = makeLegacyDocument(`legacy-v${version}`)
    await seedDatabase(version, legacy)
    vi.resetModules()
    vi.stubGlobal('__APP_BASE__', '/')
    const storage = await import('../src/platform/storage')

    const workspace = await storage.loadWorkspace()
    expect(workspace.issues).toBeUndefined()
    expect(workspace.documents).toMatchObject([{ id: legacy.id, payloadLoaded: false }])

    const restored = await storage.readWorkspaceDocumentPayload(legacy.id)
    expect(restored).toMatchObject({ id: legacy.id, text: legacy.text, sourceText: legacy.sourceText, savedText: legacy.savedText, payloadLoaded: true })
    expect(new Uint8Array(restored.initialBytes!)).toEqual(new Uint8Array(legacy.initialBytes))
    expect(new Uint8Array(restored.savedBytes)).toEqual(new Uint8Array(legacy.savedBytes))
  })

  it('reopens v3 document payload and saved mode after the storage module reloads', async () => {
    vi.stubGlobal('__APP_BASE__', '/')
    const firstStorage = await import('../src/platform/storage')
    const text = 'persist through module reload'
    const bytes = new TextEncoder().encode(text).buffer
    const document = {
      id: 'saved-v3', name: 'saved.md', format: 'md', mimeType: 'text/markdown', size: bytes.byteLength,
      initialBytes: bytes.slice(0), savedBytes: bytes.slice(0), sourceText: text, text, model: { text },
      mode: 'view', revision: 0, modelRevision: 0, textRevision: 0, parseState: 'ready', diagnostics: [],
      encoding: 'UTF-8', bom: false, savedText: text, isDirty: false, openedAt: 4, lastEditedAt: 4
    } satisfies Extract<ViewerDocument, { format: 'md' }>
    await firstStorage.saveDocument(document)
    await firstStorage.saveDocumentMode(document.id, 'source')

    vi.resetModules()
    const reopenedStorage = await import('../src/platform/storage')
    const workspace = await reopenedStorage.loadWorkspace()
    expect(workspace.documents).toMatchObject([{ id: document.id, mode: 'source', payloadLoaded: false }])
    const restored = await reopenedStorage.readWorkspaceDocumentPayload(document.id)
    expect(restored).toMatchObject({ text, sourceText: text, savedText: text, payloadLoaded: true })
    expect(new Uint8Array(restored.savedBytes)).toEqual(new Uint8Array(bytes))
  })
})
