import { beforeEach, describe, expect, it, vi } from 'vitest'

const memory = vi.hoisted(() => ({
  documents: new Map<string, unknown>(),
  settings: new Map<string, { key: string; value: unknown }>(),
  shares: new Map<string, unknown>(),
  transactions: [] as Array<{ stores: string[]; mode: string }>,
  failNextTransaction: false
}))

vi.mock('idb', () => ({ openDB: vi.fn(async () => ({
  transaction(stores: string | string[], mode: string) {
    const names = typeof stores === 'string' ? [stores] : stores
    memory.transactions.push({ stores: names, mode })
    const documents = new Map(memory.documents)
    const settings = new Map(memory.settings)
    const shares = new Map(memory.shares)
    const data = new Map([['documents', documents], ['settings', settings], ['shares', shares]])
    const tx = {
      get done() {
        return Promise.resolve().then(() => {
          if (memory.failNextTransaction) { memory.failNextTransaction = false; throw new Error('transaction failed') }
          memory.documents = documents
          memory.settings = settings
          memory.shares = shares
        })
      },
      objectStore(name: string) {
        const store = data.get(name)!
        return {
          getAll: async () => [...store.values()],
          get: async (key: string) => store.get(key),
          clear: async () => { store.clear() },
          put: async (record: { id?: string; key?: string; [key: string]: unknown }) => { store.set(record.id ?? record.key ?? '', record) },
          delete: async (key: string) => { store.delete(key) }
        }
      }
    }
    return tx
  },
  getAll: async (name: string) => [...(name === 'documents' ? memory.documents : name === 'settings' ? memory.settings : memory.shares).values()],
  put: async (name: string, record: { id?: string; key?: string; [key: string]: unknown }) => { (name === 'documents' ? memory.documents : name === 'settings' ? memory.settings : memory.shares).set(record.id ?? record.key ?? '', record) },
  delete: async (name: string, key: string) => { (name === 'documents' ? memory.documents : name === 'settings' ? memory.settings : memory.shares).delete(key) }
})) }))

import type { ViewerDocument } from '../src/domain/types'
import { replaceWorkspace, serializeStoredDocument, loadWorkspace } from '../src/platform/storage'

const document: ViewerDocument = {
  id: 'doc-1', name: 'note.md', format: 'md', mimeType: 'text/markdown', size: 4,
  initialBytes: new ArrayBuffer(4), savedBytes: new ArrayBuffer(4), sourceText: 'note', text: 'note',
  model: { text: 'note' }, mode: 'view', revision: 0, modelRevision: 0, textRevision: 0,
  parseState: 'ready', diagnostics: [], encoding: 'UTF-8', bom: false, savedText: 'note', isDirty: false,
  openedAt: 1, lastEditedAt: 1
}

beforeEach(() => {
  vi.stubGlobal('__APP_BASE__', '/')
  memory.documents.clear()
  memory.settings.clear()
  memory.shares.clear()
  memory.transactions = []
  memory.failNextTransaction = false
})

describe('workspace storage transaction', () => {
  it('replaces documents and folder metadata in one transaction while preserving unrelated stores', async () => {
    memory.documents.set(document.id, serializeStoredDocument(document))
    memory.settings.set('theme', { key: 'theme', value: 'dark' })
    memory.shares.set('ticket-1', { id: 'ticket-1' })
    const folder = { schemaVersion: 1 as const, folder: { id: 'folder-1', name: 'Notes', access: 'input' as const, expandedPaths: [''], activePath: null } }

    await replaceWorkspace(folder, true)
    expect(memory.documents.size).toBe(0)
    expect(memory.settings.get('workspace')?.value).toEqual(folder)
    expect(memory.settings.get('theme')?.value).toBe('dark')
    expect(memory.shares.has('ticket-1')).toBe(true)
    expect(memory.transactions).toEqual([{ stores: ['documents', 'settings'], mode: 'readwrite' }])
    await expect(loadWorkspace()).resolves.toEqual({ documents: [], folder })
    expect(memory.transactions[1]).toEqual({ stores: ['documents', 'settings'], mode: 'readonly' })
  })

  it('keeps the prior workspace when the replacement transaction fails', async () => {
    const previous = { schemaVersion: 1 as const, folder: { id: 'old-folder', name: 'Old', access: 'input' as const, expandedPaths: [''], activePath: null } }
    memory.documents.set(document.id, serializeStoredDocument(document))
    memory.settings.set('workspace', { key: 'workspace', value: previous })
    memory.shares.set('ticket-1', { id: 'ticket-1' })
    memory.failNextTransaction = true
    const next = { schemaVersion: 1 as const, folder: { id: 'new-folder', name: 'New', access: 'input' as const, expandedPaths: [''], activePath: null } }

    await expect(replaceWorkspace(next, true)).rejects.toThrow('transaction failed')
    expect(memory.documents.has(document.id)).toBe(true)
    expect(memory.settings.get('workspace')?.value).toEqual(previous)
    expect(memory.shares.has('ticket-1')).toBe(true)
  })

  it('deletes only workspace metadata when recovery is disabled', async () => {
    memory.settings.set('workspace', { key: 'workspace', value: { schemaVersion: 1 } })
    memory.settings.set('theme', { key: 'theme', value: 'light' })
    memory.shares.set('ticket-1', { id: 'ticket-1' })
    await replaceWorkspace(null, false)
    expect(memory.settings.has('workspace')).toBe(false)
    expect(memory.settings.get('theme')?.value).toBe('light')
    expect(memory.shares.has('ticket-1')).toBe(true)
  })
})
