import { describe, expect, it } from 'vitest'
import { parseCsv } from '../src/domain/formats/csv'
import { applySourceEdit, applyViewCommand, buildExportSnapshot, flushDocument, historyEntry, redoDocument, undoDocument } from '../src/domain/session'
import type { CsvModel, ViewerDocument } from '../src/domain/types'

function makeDocument(overrides: Partial<ViewerDocument> = {}): ViewerDocument {
  const text = 'name,value\nalpha,1'
  const bytes = new TextEncoder().encode(text).buffer
  const model = parseCsv(text, 'UTF-8', false, '\n')
  return {
    id: 'document-1', name: 'sample.csv', format: 'csv', mimeType: 'text/csv', size: bytes.byteLength,
    initialBytes: bytes.slice(0), savedBytes: bytes.slice(0), sourceText: text, text, model, mode: 'view',
    revision: 0, modelRevision: 0, textRevision: 0, parseState: 'ready', diagnostics: [], encoding: 'UTF-8', bom: false,
    savedText: text, isDirty: false, openedAt: 1, lastEditedAt: 1, ...overrides
  }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

describe('document session', () => {
  it('applies source text immediately while keeping the last model and input bytes', () => {
    const document = makeDocument()
    const next = applySourceEdit(document.id, 'name,value\nbeta,2', document)
    expect(next.text).toBe('name,value\nbeta,2')
    expect(next.revision).toBe(1)
    expect(next.textRevision).toBe(1)
    expect(next.parseState).toBe('pending')
    expect(next.model).toBe(document.model)
    expect(next.initialBytes).toEqual(document.initialBytes)
    expect(next.savedBytes).toEqual(document.savedBytes)
  })

  it('serializes a view command against its base revision and updates the shared text', async () => {
    const document = makeDocument()
    const model = document.model as CsvModel
    const next = await applyViewCommand(document.id, document.revision, { ...model, rows: [['beta', '2']] }, document)
    expect(next.text).toBe('name,value\nbeta,2')
    expect(next.revision).toBe(1)
    expect(next.textRevision).toBe(1)
    expect(next.modelRevision).toBe(1)
    expect(next.isDirty).toBe(true)
    await expect(applyViewCommand(document.id, 4, model, document)).rejects.toThrow(/문서가 변경/u)
  })

  it('waits through replacement serializations before flushing a document', async () => {
    const first = deferred()
    const second = deferred()
    let pending: Promise<void> | undefined = first.promise
    const document = makeDocument()
    const flushing = flushDocument(document.id, () => document, () => pending)
    await Promise.resolve()
    pending = second.promise
    first.resolve()
    await Promise.resolve()
    second.resolve()
    await expect(flushing).resolves.toBe(document)
  })

  it('exports saved bytes exactly when unchanged and encodes edited UTF-8 text with its BOM', () => {
    const originalBytes = new Uint8Array([0xff, 0xfe, 0x41, 0x00]).buffer
    const unchanged = makeDocument({ savedBytes: originalBytes, encoding: 'UTF-16LE' })
    expect([...buildExportSnapshot(unchanged.id, unchanged).bytes]).toEqual([255, 254, 65, 0])
    expect(buildExportSnapshot(unchanged.id, unchanged).encoding).toBe('UTF-16LE')

    const edited = applySourceEdit(unchanged.id, '문서', { ...unchanged, savedText: 'old' })
    const snapshot = buildExportSnapshot(edited.id, { ...edited, bom: true })
    expect(snapshot.encoding).toBe('UTF-8')
    expect(snapshot.bytes.slice(0, 3)).toEqual(new Uint8Array([0xef, 0xbb, 0xbf]))
    expect(new TextDecoder().decode(snapshot.bytes.slice(3))).toBe('문서')
  })

  it('undoes and redoes source edits through the document history', () => {
    const original = makeDocument()
    const edited = applySourceEdit(original.id, 'name,value\nbeta,2', original)
    const restored = undoDocument(original.id, edited, historyEntry(original))
    expect(restored.text).toBe(original.text)
    expect(restored.revision).toBe(2)
    expect(restored.parseState).toBe('ready')
    const redone = redoDocument(original.id, restored, historyEntry(edited))
    expect(redone.text).toBe(edited.text)
    expect(redone.revision).toBe(3)
  })
})
