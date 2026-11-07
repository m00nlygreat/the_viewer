import { beforeEach, describe, expect, it, vi } from 'vitest'

const memory = vi.hoisted(() => ({
  documents: new Map<string, unknown>(),
  documentPayloads: new Map<string, unknown>(),
  documentBlobs: new Map<string, unknown>(),
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
    const documentPayloads = new Map(memory.documentPayloads)
    const documentBlobs = new Map(memory.documentBlobs)
    const settings = new Map(memory.settings)
    const shares = new Map(memory.shares)
    const data = new Map([['documents', documents], ['documentPayloads', documentPayloads], ['documentBlobs', documentBlobs], ['settings', settings], ['shares', shares]])
    const tx = {
      get done() {
        return Promise.resolve().then(() => {
          if (memory.failNextTransaction) { memory.failNextTransaction = false; throw new Error('transaction failed') }
          memory.documents = documents
          memory.documentPayloads = documentPayloads
          memory.documentBlobs = documentBlobs
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
  getAll: async (name: string) => [...(name === 'documents' ? memory.documents : name === 'documentPayloads' ? memory.documentPayloads : name === 'documentBlobs' ? memory.documentBlobs : name === 'settings' ? memory.settings : memory.shares).values()],
  get: async (name: string, key: string) => (name === 'documents' ? memory.documents : name === 'documentPayloads' ? memory.documentPayloads : name === 'documentBlobs' ? memory.documentBlobs : name === 'settings' ? memory.settings : memory.shares).get(key),
  put: async (name: string, record: { id?: string; key?: string; [key: string]: unknown }) => { (name === 'documents' ? memory.documents : name === 'documentPayloads' ? memory.documentPayloads : name === 'documentBlobs' ? memory.documentBlobs : name === 'settings' ? memory.settings : memory.shares).set(record.id ?? record.key ?? '', record) },
  delete: async (name: string, key: string) => { (name === 'documents' ? memory.documents : name === 'documentPayloads' ? memory.documentPayloads : name === 'documentBlobs' ? memory.documentBlobs : name === 'settings' ? memory.settings : memory.shares).delete(key) }
})) }))

import type { ViewerDocument } from '../src/domain/types'
import { completeShareTicketFile, readShareTicket, readShareTicketFile, replaceWorkspace, serializeStoredDocument, splitStoredDocumentRecord, splitStoredPayloadRecord, loadWorkspace, readRawWorkspaceDocument, readWorkspaceDocumentPayload, retryLoadWorkspaceDocument, saveDocument, saveDocumentMode } from '../src/platform/storage'

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
  memory.documentPayloads.clear()
  memory.documentBlobs.clear()
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
    expect(memory.transactions).toEqual([{ stores: ['documents', 'documentPayloads', 'documentBlobs', 'settings'], mode: 'readwrite' }])
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

  it('isolates one malformed record and keeps it available for retry or raw recovery', async () => {
    const corrupt = { id: 'broken-document', schemaVersion: 99, text: 'preserve this source' }
    memory.documents.set(document.id, serializeStoredDocument(document))
    memory.documents.set(corrupt.id, corrupt)

    const workspace = await loadWorkspace()
    expect(workspace.documents.map((item) => item.id)).toEqual([document.id])
    expect(workspace.issues).toHaveLength(1)
    expect(workspace.issues?.[0]?.id).toBe(corrupt.id)
    await expect(retryLoadWorkspaceDocument(corrupt.id)).rejects.toThrow(/저장 버전/u)
    await expect(readRawWorkspaceDocument(corrupt.id)).resolves.toEqual(corrupt)
  })

  it('persists display mode separately from the recovered document payload', async () => {
    memory.documents.set(document.id, serializeStoredDocument(document))

    await saveDocumentMode(document.id, 'source')

    expect((memory.documents.get(document.id) as ViewerDocument).mode).toBe('view')
    expect((await loadWorkspace()).documents[0]?.mode).toBe('source')
  })

  it('loads document summaries first and restores the full payload only on demand', async () => {
    await saveDocument(document)

    const summary = memory.documents.get(document.id) as Record<string, unknown>
    const payload = memory.documentPayloads.get(document.id) as Record<string, unknown>
    const blobs = memory.documentBlobs.get(document.id) as Record<string, unknown>
    expect(summary.payloadRef).toBe(true)
    expect(summary).not.toHaveProperty('text')
    expect(summary).not.toHaveProperty('model')
    expect(payload).not.toHaveProperty('savedBytes')
    expect(payload).not.toHaveProperty('initialBytes')
    expect(blobs.savedBytes).toBeInstanceOf(ArrayBuffer)
    expect(memory.documentPayloads.size).toBe(1)

    const workspace = await loadWorkspace()
    expect(workspace.documents[0]).toMatchObject({ id: document.id, payloadLoaded: false, text: '', isDirty: false })

    const restored = await readWorkspaceDocumentPayload(document.id)
    expect(restored).toMatchObject({ payloadLoaded: true, text: document.text, sourceText: document.sourceText, savedText: document.savedText, model: document.model })
    expect(new Uint8Array(restored.savedBytes)).toEqual(new Uint8Array(document.savedBytes))
  })

  it('splits legacy document records and version 2 payloads without losing byte baselines', () => {
    const legacy = splitStoredDocumentRecord(serializeStoredDocument(document))
    expect(legacy?.summary.payloadRef).toBe(true)
    expect(legacy?.payload).not.toHaveProperty('savedBytes')
    expect(new Uint8Array(legacy!.blobs.savedBytes)).toEqual(new Uint8Array(document.savedBytes))
    expect(new Uint8Array(legacy!.blobs.initialBytes!)).toEqual(new Uint8Array(document.initialBytes!))

    const version2 = splitStoredPayloadRecord({ ...serializeStoredDocument(document), id: document.id })
    expect(version2?.payload).not.toHaveProperty('savedBytes')
    expect(new Uint8Array(version2!.blobs.savedBytes)).toEqual(new Uint8Array(document.savedBytes))
  })

  it('does not rewrite unchanged saved bytes or email attachments during later recovery saves', async () => {
    const attachment = new Uint8Array([1, 3, 5, 7])
    const email: Extract<ViewerDocument, { format: 'eml' }> = {
      ...document,
      id: 'email-1', name: 'mail.eml', format: 'eml', mimeType: 'message/rfc822',
      model: { subject: 'before', from: [], to: [], cc: [], date: '', text: '', html: '', attachments: [{ filename: 'part.bin', mimeType: 'application/octet-stream', content: attachment }], headers: [] }
    }
    await saveDocument(email)
    const firstBlobRecord = memory.documentBlobs.get(email.id)
    const payload = memory.documentPayloads.get(email.id) as { model: { attachments: Array<Record<string, unknown>> } }
    expect(payload.model.attachments[0]).not.toHaveProperty('content')
    expect(new Uint8Array((firstBlobRecord as { emailAttachmentContents: ArrayBuffer[] }).emailAttachmentContents[0])).toEqual(attachment)

    await saveDocument({ ...email, model: { ...email.model, subject: 'after' } })

    expect(memory.documentBlobs.get(email.id)).toBe(firstBlobRecord)
    const restored = await readWorkspaceDocumentPayload(email.id)
    expect(restored.format === 'eml' && restored.model.subject).toBe('after')
    expect(restored.format === 'eml' && restored.model.attachments[0]?.content).toEqual(attachment)

    const emailWithoutAttachments = { ...email, id: 'email-empty', model: { ...email.model, attachments: [] } }
    await saveDocument(emailWithoutAttachments)
    const restoredEmpty = await readWorkspaceDocumentPayload(emailWithoutAttachments.id)
    expect(restoredEmpty.format === 'eml' && restoredEmpty.model.attachments).toEqual([])
  })

  it('reads one modern share payload at a time and deletes each payload after completion', async () => {
    const bytes0 = new Uint8Array([1, 2, 3]).buffer
    const bytes1 = new Uint8Array([4, 5]).buffer
    memory.shares.set('ticket-stream', { id: 'ticket-stream', kind: 'ticket', files: [{ name: 'one.csv', type: 'text/csv' }, { name: 'two.ics', type: 'text/calendar' }], completed: [false, false], createdAt: Date.now() })
    memory.shares.set('ticket-stream:file:0', { id: 'ticket-stream:file:0', kind: 'payload', ticketId: 'ticket-stream', index: 0, bytes: bytes0 })
    memory.shares.set('ticket-stream:file:1', { id: 'ticket-stream:file:1', kind: 'payload', ticketId: 'ticket-stream', index: 1, bytes: bytes1 })

    const ticket = await readShareTicket('ticket-stream')
    expect(ticket?.files).toEqual([{ name: 'one.csv', type: 'text/csv' }, { name: 'two.ics', type: 'text/calendar' }])
    expect(ticket?.completed).toEqual([false, false])
    expect(Array.from(new Uint8Array((await readShareTicketFile('ticket-stream', 0))!.bytes))).toEqual([1, 2, 3])
    await completeShareTicketFile('ticket-stream', 0)
    expect(memory.shares.has('ticket-stream:file:0')).toBe(false)
    expect((await readShareTicket('ticket-stream'))?.completed).toEqual([true, false])
    expect(await readShareTicketFile('ticket-stream', 0)).toBeNull()

    await completeShareTicketFile('ticket-stream', 1)
    expect(memory.shares.has('ticket-stream')).toBe(false)
    expect(memory.shares.has('ticket-stream:file:1')).toBe(false)
  })

  it('still reads legacy inline share tickets and expires stored payload rows', async () => {
    const legacyBytes = new Uint8Array([8, 9]).buffer
    memory.shares.set('ticket-legacy', { id: 'ticket-legacy', files: [{ name: 'legacy.csv', type: 'text/csv', bytes: legacyBytes }], createdAt: Date.now() })
    const legacy = await readShareTicket('ticket-legacy')
    expect(legacy?.files).toEqual([{ name: 'legacy.csv', type: 'text/csv' }])
    expect(Array.from(new Uint8Array((await readShareTicketFile('ticket-legacy', 0))!.bytes))).toEqual([8, 9])

    memory.shares.set('ticket-expired', { id: 'ticket-expired', kind: 'ticket', files: [{ name: 'old.csv', type: 'text/csv' }], completed: [false], createdAt: 0 })
    memory.shares.set('ticket-expired:file:0', { id: 'ticket-expired:file:0', kind: 'payload', ticketId: 'ticket-expired', index: 0, bytes: legacyBytes })
    expect(await readShareTicket('ticket-expired')).toBeNull()
    expect(memory.shares.has('ticket-expired')).toBe(false)
    expect(memory.shares.has('ticket-expired:file:0')).toBe(false)
  })
})
