import { describe, expect, it, vi } from 'vitest'
import { parseCsv } from '../src/domain/formats/csv'
import type { ViewerDocument } from '../src/domain/types'
import { DocumentStore } from '../src/app/documentStore'

function makeDocument(id: string, overrides: Partial<ViewerDocument> = {}): Extract<ViewerDocument, { format: 'csv' }> {
  const text = 'name,value\nalpha,1'
  const bytes = new TextEncoder().encode(text).buffer
  return {
    id, name: `${id}.csv`, format: 'csv', mimeType: 'text/csv', size: bytes.byteLength,
    initialBytes: bytes.slice(0), savedBytes: bytes.slice(0), sourceText: text, text,
    model: parseCsv(text, 'UTF-8', false, '\n'), mode: 'view', revision: 0, modelRevision: 0, textRevision: 0,
    parseState: 'ready', diagnostics: [], encoding: 'UTF-8', bom: false, savedText: text, isDirty: false,
    openedAt: 1, lastEditedAt: 1, ...overrides
  } as Extract<ViewerDocument, { format: 'csv' }>
}

describe('document store', () => {
  it('notifies only the changed document when its list summary is stable', () => {
    const store = new DocumentStore()
    const first = makeDocument('first')
    const second = makeDocument('second')
    store.replaceAll([first, second])
    const list = store.getListSnapshot()
    const listListener = vi.fn()
    const documentListener = vi.fn()
    store.subscribeList(listListener)
    store.subscribeDocument(first.id, documentListener)

    store.update({ ...first, text: 'edited', revision: 1, textRevision: 1, isDirty: false })

    expect(documentListener).toHaveBeenCalledOnce()
    expect(listListener).not.toHaveBeenCalled()
    expect(store.getListSnapshot()).toBe(list)
    expect(store.get(first.id)?.text).toBe('edited')
  })

  it('publishes a new list summary when visible document state changes', () => {
    const store = new DocumentStore()
    const first = makeDocument('first')
    store.replaceAll([first])
    const previousList = store.getListSnapshot()
    const listListener = vi.fn()
    store.subscribeList(listListener)

    store.update({ ...first, isDirty: true })

    expect(listListener).toHaveBeenCalledOnce()
    expect(store.getListSnapshot()).not.toBe(previousList)
    expect(store.getListSnapshot()[0]).toMatchObject({ id: 'first', isDirty: true })
  })

  it('keeps ordered document snapshots for add, replace, and remove transitions', () => {
    const store = new DocumentStore()
    const first = makeDocument('first')
    const second = makeDocument('second')
    const third = makeDocument('third')
    store.replaceAll([first, second])

    store.upsert(third)
    expect(store.getAll().map((document) => document.id)).toEqual(['third', 'first', 'second'])
    store.remove('first')
    expect(store.get('first')).toBeNull()
    expect(store.getAll().map((document) => document.id)).toEqual(['third', 'second'])
    store.replaceAll([second, third])
    expect(store.getAll().map((document) => document.id)).toEqual(['second', 'third'])
  })
})
