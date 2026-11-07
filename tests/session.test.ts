import { describe, expect, it } from 'vitest'
import { parseCsv } from '../src/domain/formats/csv'
import { applySourceEdit, applyViewCommand, buildExportSnapshot, canPersistRecovery, documentIsDirty, flushDocument, historyEntry, makeDocumentFromBytes, redoDocument, undoDocument } from '../src/domain/session'
import { matchDocumentModel } from '../src/domain/documentModel'
import type { CsvModel, ViewerDocument } from '../src/domain/types'
import { parseEnv } from '../src/domain/env/parse'
import { scalar, slot } from '../src/domain/structured/model'

function makeDocument(overrides: Partial<ViewerDocument> = {}): ViewerDocument {
  const text = 'name,value\nalpha,1'
  const bytes = new TextEncoder().encode(text).buffer
  const model = parseCsv(text, 'UTF-8', false, '\n')
  return {
    id: 'document-1', name: 'sample.csv', format: 'csv', mimeType: 'text/csv', size: bytes.byteLength,
    initialBytes: bytes.slice(0), savedBytes: bytes.slice(0), sourceText: text, text, model, mode: 'view',
    revision: 0, modelRevision: 0, textRevision: 0, parseState: 'ready', diagnostics: [], encoding: 'UTF-8', bom: false,
    savedText: text, isDirty: false, openedAt: 1, lastEditedAt: 1, ...overrides
  } as ViewerDocument
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

describe('document session', () => {
  it('keeps the dirty state of a lazy document summary without comparing empty payload placeholders', () => {
    const summary = makeDocument({ text: '', savedText: '', savedBytes: new ArrayBuffer(0), isDirty: true, payloadLoaded: false })
    expect(documentIsDirty(summary)).toBe(true)
    expect(documentIsDirty({ ...summary, isDirty: false })).toBe(false)
  })

  it('shares the immutable original and saved byte baseline without retaining another copy', async () => {
    const input = new TextEncoder().encode('name,value\nalpha,1')
    const document = await makeDocumentFromBytes('sample.csv', 'text/csv', input)
    expect(document.initialBytes).toBe(document.savedBytes)
    expect(document.initialBytes).not.toBe(input.buffer)
    expect(new Uint8Array(document.initialBytes!)).toEqual(input)
  })

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
    const next = await applyViewCommand(document.id, document.revision, matchDocumentModel(document, { ...model, rows: [['beta', '2']] }))
    expect(next.text).toBe('name,value\nbeta,2')
    expect(next.revision).toBe(1)
    expect(next.textRevision).toBe(1)
    expect(next.modelRevision).toBe(1)
    expect(next.isDirty).toBe(true)
    await expect(applyViewCommand(document.id, 4, matchDocumentModel(document, model))).rejects.toThrow(/문서가 변경/u)
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
    const unchanged = makeDocument({ savedBytes: originalBytes, encoding: 'UTF-16LE', bom: true })
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

  it('recomputes dirty state after exporting, undoing, and redoing', () => {
    const original = makeDocument()
    const edited = applySourceEdit(original.id, 'name,value\nbeta,2', original)
    const savedSnapshot = buildExportSnapshot(edited.id, edited)
    const saved = {
      ...edited,
      savedText: savedSnapshot.text,
      savedBytes: savedSnapshot.bytes.slice().buffer as ArrayBuffer,
      isDirty: false
    }

    const undone = undoDocument(saved.id, saved, historyEntry(original))
    expect(undone.text).toBe(original.text)
    expect(undone.isDirty).toBe(true)
    expect(buildExportSnapshot(undone.id, undone).text).toBe(original.text)
    expect(new TextDecoder().decode(buildExportSnapshot(undone.id, undone).bytes)).toBe(original.text)

    const redone = redoDocument(saved.id, undone, historyEntry(saved))
    expect(redone.text).toBe(savedSnapshot.text)
    expect(redone.isDirty).toBe(false)
    expect(buildExportSnapshot(redone.id, redone).bytes).toEqual(savedSnapshot.bytes)
  })

  it('restores the BOM metadata with the matching history entry', () => {
    const original = makeDocument()
    const edited = { ...original, bom: true, isDirty: true }
    const undone = undoDocument(original.id, edited, historyEntry(original))
    expect(undone.bom).toBe(false)
    expect(undone.isDirty).toBe(false)
  })

  it('shares Markdown view and source text through undo, redo, and immediate export', () => {
    const text = '\uFEFF---\r\ntitle: Note\r\n---\r\n\r\n# 제목\r\n\r\n- [ ] 작업\r\n'
    const bytes = new TextEncoder().encode(text).buffer
    const document = makeDocument({
      id: 'markdown-document', name: 'notes.md', format: 'md', mimeType: 'text/markdown',
      size: bytes.byteLength, initialBytes: bytes.slice(0), savedBytes: bytes.slice(0),
      sourceText: text, text, model: { text }, bom: true, savedText: text
    })
    const editedText = text.replace('작업', '완료')
    const viewed = applySourceEdit(document.id, editedText, document)
    expect(viewed.text).toBe(editedText)
    expect(viewed.textRevision).toBe(viewed.revision)
    expect(buildExportSnapshot(viewed.id, viewed).text).toBe(editedText)

    const undone = undoDocument(document.id, viewed, historyEntry(document))
    expect(undone.text).toBe(text)
    const redone = redoDocument(document.id, undone, historyEntry(viewed))
    expect(redone.text).toBe(editedText)
    expect(buildExportSnapshot(redone.id, redone).bytes.slice(0, 3)).toEqual(new Uint8Array([0xef, 0xbb, 0xbf]))
  })

  it('keeps ENV drafts recoverable, blocks view export, and resolves them through shared undo history', async () => {
    const text = 'A=one\n'
    const bytes = new TextEncoder().encode(text).buffer
    const envDocument = makeDocument({
      id: 'env-session', name: 'app.env', format: 'env', mimeType: 'text/plain', size: bytes.byteLength,
      initialBytes: bytes.slice(0), savedBytes: bytes.slice(0), sourceText: text, text, model: parseEnv(text), savedText: text
    }) as Extract<ViewerDocument, { format: 'env' }>
    const initialModel = envDocument.model
    const draftModel = structuredClone(initialModel)
    if (draftModel.blocks.root?.kind !== 'object') throw new Error('ENV root expected')
    draftModel.blocks.root.items.push(slot('NEW', null))

    const draft = await applyViewCommand(envDocument.id, 0, matchDocumentModel(envDocument, draftModel))
    expect(draft.structuredDraft).toBe(true)
    expect(draft.text).toBe(text)
    expect(draft.textRevision).toBe(0)
    expect(draft.revision).toBe(1)
    expect(documentIsDirty(draft)).toBe(true)
    expect(() => buildExportSnapshot(draft.id, draft)).toThrow(/빈 자리/u)
    await expect(flushDocument(draft.id, () => draft)).rejects.toThrow(/빈 자리/u)

    const undone = undoDocument(draft.id, draft, historyEntry(envDocument))
    expect(undone.text).toBe(text)
    expect(undone.structuredDraft).not.toBe(true)
    const redone = redoDocument(draft.id, undone, historyEntry(draft))
    expect(redone.structuredDraft).toBe(true)
    expect(canPersistRecovery(redone)).toBe(true)

    if (redone.format !== 'env') throw new Error('ENV document expected')
    const resolvedModel = structuredClone(redone.model)
    const resolvedRoot = resolvedModel.blocks.root
    if (resolvedRoot?.kind !== 'object') throw new Error('ENV root expected')
    const added = resolvedRoot.items.at(-1)!
    added.node = scalar('string', 'two')
    const resolved = await applyViewCommand(redone.id, redone.revision, matchDocumentModel(redone, resolvedModel))
    expect(resolved.structuredDraft).toBe(false)
    expect(resolved.text).toBe('A=one\nNEW=two\n')
    expect(resolved.textRevision).toBe(resolved.revision)
  })
})
