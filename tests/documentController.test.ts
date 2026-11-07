import { describe, expect, it } from 'vitest'
import { DocumentController } from '../src/domain/documentController'
import { buildExportSnapshot, historyEntry } from '../src/domain/session'
import { parseCsv } from '../src/domain/formats/csv'
import { parseEnv } from '../src/domain/env/parse'
import { parseStructured } from '../src/domain/structured/parse'
import type { EmailModel, ViewerDocument } from '../src/domain/types'
import { matchDocumentModel, type DocumentModelPair } from '../src/domain/documentModel'

type InvalidCsvModelPair = Extract<DocumentModelPair, { format: 'csv' }> & { model: ReturnType<typeof parseStructured> }
type AssertNever<T extends never> = T
export type MismatchedCsvModelRejectedAtCompileTime = AssertNever<Extract<DocumentModelPair, InvalidCsvModelPair>>

function makeDocument(): Extract<ViewerDocument, { format: 'csv' }> {
  const text = 'name,value\nalpha,1'
  const bytes = new TextEncoder().encode(text).buffer
  return {
    id: 'document-controller', name: 'sample.csv', format: 'csv', mimeType: 'text/csv', size: bytes.byteLength,
    initialBytes: bytes.slice(0), savedBytes: bytes.slice(0), sourceText: text, text,
    model: parseCsv(text, 'UTF-8', false, '\n'), mode: 'view', revision: 0, modelRevision: 0, textRevision: 0,
    parseState: 'ready', diagnostics: [], encoding: 'UTF-8', bom: false, savedText: text, isDirty: false,
    openedAt: 1, lastEditedAt: 1
  }
}

describe('document controller', () => {
  it('restores source edits through undo and redo against the saved baseline', () => {
    const controller = new DocumentController()
    const original = makeDocument()
    const edited = controller.applySourceText(original, 'name,value\nbeta,2')

    const undone = controller.restoreHistory(edited, 'undo')!
    expect(undone.text).toBe(original.text)
    expect(undone.isDirty).toBe(false)

    const redone = controller.restoreHistory(undone, 'redo')!
    expect(redone.text).toBe('name,value\nbeta,2')
    expect(redone.isDirty).toBe(true)
  })

  it('coalesces rapid typing for one document without merging other documents', () => {
    const controller = new DocumentController()
    const first = makeDocument()
    const second = { ...makeDocument(), id: 'another-document' }
    const firstEdit = controller.applySourceText(first, 'one', 'typing')
    const nextFirstEdit = controller.applySourceText(firstEdit, 'two', 'typing')
    const secondEdit = controller.applySourceText(second, 'other', 'typing')

    expect(controller.restoreHistory(nextFirstEdit)?.text).toBe(first.text)
    expect(controller.restoreHistory(secondEdit)?.text).toBe(second.text)
  })

  it('keeps an explicit continuous edit as one undo unit and starts a new unit after it ends', () => {
    const controller = new DocumentController()
    const original = makeDocument()
    controller.beginContinuousGroup(original.id)
    const firstEdit = controller.applySourceText(original, 'first', 'typing')
    const secondEdit = controller.applySourceText(firstEdit, 'second', 'typing')
    controller.endContinuousGroup(original.id)
    const thirdEdit = controller.applySourceText(secondEdit, 'third', 'typing')

    const undoneThird = controller.restoreHistory(thirdEdit, 'undo')!
    expect(undoneThird.text).toBe('second')
    expect(controller.restoreHistory(undoneThird, 'undo')?.text).toBe(original.text)
  })

  it('trims the oldest document history when the shared byte budget is exceeded', () => {
    const first = makeDocument()
    const second = { ...makeDocument(), id: 'another-document' }
    const entryBytes = historyEntry(first).estimatedBytes
    const controller = new DocumentController(80, entryBytes * 4, entryBytes + 1)
    const firstEdit = controller.applySourceText(first, 'first edit')
    const secondEdit = controller.applySourceText(second, 'second edit')

    expect(controller.restoreHistory(firstEdit)).toBeNull()
    expect(controller.restoreHistory(secondEdit)?.text).toBe(second.text)
  })

  it('estimates large CSV cell arrays and email attachment buffers in history snapshots', () => {
    const base = makeDocument()
    const csvModel = {
      ...base.model,
      rows: Array.from({ length: 2_000 }, () => Array.from({ length: 8 }, () => 'x'.repeat(128)))
    }
    const csvDocument: ViewerDocument = { ...base, model: csvModel }
    expect(historyEntry(csvDocument).estimatedBytes).toBeGreaterThan(4_000_000)

    const emailModel: EmailModel = {
      subject: '', from: [], to: [], cc: [], date: '', text: '', html: '', headers: [],
      attachments: [{ filename: 'large.bin', mimeType: 'application/octet-stream', content: new Uint8Array(2 * 1024 * 1024) }]
    }
    const emailDocument: ViewerDocument = { ...base, format: 'eml', model: emailModel }
    expect(historyEntry(emailDocument).estimatedBytes).toBeGreaterThan(2 * 1024 * 1024)
  })

  it('includes empty structured draft slots in the undo history estimate', () => {
    const base = makeDocument()
    const draft: Extract<ViewerDocument, { format: 'json' }> = {
      ...base, name: 'draft.json', format: 'json', mimeType: 'application/json', structuredDraft: true,
      model: {
        root: { id: 'root', kind: 'object', items: Array.from({ length: 10_000 }, (_, index) => ({ id: `slot-${index}`, key: `field-${index}`, node: null })) },
        loose: []
      }
    }

    expect(historyEntry(draft).estimatedBytes).toBeGreaterThan(400_000)
  })

  it('prepares a view command without exposing revision construction to the caller', async () => {
    const controller = new DocumentController()
    const document = makeDocument()
    const model = parseCsv('name,value\nbeta,2', 'UTF-8', false, '\n')
    const command = controller.prepareViewCommand({ format: 'csv', document, model }, document.revision, 'command', 42)!

    expect(command.optimisticDocument.revision).toBe(1)
    expect(command.optimisticDocument.lastEditedAt).toBe(42)
    expect(command.optimisticDocument.isDirty).toBe(true)
    await expect(command.serializedDocument).resolves.toMatchObject({ text: 'name,value\nbeta,2', revision: 1 })
  })

  it('uses the shared optimistic history and source compiler for ENV commands', async () => {
    const controller = new DocumentController()
    const text = '# keep\r\nA=one\r\n'
    const bytes = new TextEncoder().encode(text).buffer
    const original = {
      ...makeDocument(), id: 'env-controller', name: 'app.env', format: 'env' as const, mimeType: 'text/plain',
      size: bytes.byteLength, initialBytes: bytes.slice(0), savedBytes: bytes.slice(0), sourceText: text, text,
      savedText: text, model: parseEnv(text)
    }
    const nextModel = structuredClone(original.model)
    if (nextModel.blocks.root?.kind !== 'object' || nextModel.blocks.root.items[0]?.node?.kind !== 'scalar') throw new Error('ENV assignment expected')
    nextModel.blocks.root.items[0].node.raw = 'two'
    const command = controller.prepareViewCommand({ format: 'env', document: original, model: nextModel }, original.revision, 'command', 42)!

    expect(command.optimisticDocument).toMatchObject({ revision: 1, modelRevision: 1, structuredDraft: true, lastEditedAt: 42 })
    const applied = await command.serializedDocument
    expect(applied.text).toBe('# keep\r\nA=two\r\n')
    expect(applied.textRevision).toBe(1)
    expect(applied.structuredDraft).toBe(false)
    const undone = controller.restoreHistory(applied, 'undo')!
    expect(undone.text).toBe(text)
    const redone = controller.restoreHistory(undone, 'redo')!
    expect(redone.text).toBe('# keep\r\nA=two\r\n')
  })

  it('rejects a model with the wrong format before recording undo history', () => {
    const csv = makeDocument()
    const structuredModel = parseStructured('{}', 'json')
    const structured: Extract<ViewerDocument, { format: 'json' }> = {
      ...csv, name: 'sample.json', format: 'json', mimeType: 'application/json', text: '{}', sourceText: '{}', savedText: '{}',
      model: structuredModel
    }
    expect(() => matchDocumentModel(structured, csv.model)).toThrow('구조 데이터 모델이 올바르지 않습니다.')
    expect(() => matchDocumentModel(csv, structuredModel)).toThrow('보기 편집 모델과 문서 형식이 일치하지 않습니다.')
  })

  it('restores a serialized view command through undo and redo', async () => {
    const controller = new DocumentController()
    const original = makeDocument()
    const nextModel = parseCsv('name,value\nbeta,2', 'UTF-8', false, '\n')
    const command = controller.prepareViewCommand({ format: 'csv', document: original, model: nextModel }, original.revision, 'command', 42)!
    const applied = await command.serializedDocument
    if (applied.format !== 'csv') throw new Error('view command changed the document format')

    const undone = controller.restoreHistory(applied, 'undo')!
    if (undone.format !== 'csv') throw new Error('undo changed the document format')
    expect(undone.text).toBe(original.text)
    expect(undone.model.rows).toEqual(original.model.rows)

    const redone = controller.restoreHistory(undone, 'redo')!
    if (redone.format !== 'csv') throw new Error('redo changed the document format')
    expect(redone.text).toBe('name,value\nbeta,2')
    expect(redone.model.rows).toEqual(nextModel.rows)
  })

  it('records a successful export as the baseline even if a newer edit exists', () => {
    const controller = new DocumentController()
    const original = makeDocument()
    const edited = controller.applySourceText(original, 'name,value\nbeta,2')
    const snapshot = buildExportSnapshot(edited.id, edited)
    const newerEdit = controller.applySourceText(edited, 'name,value\ngamma,3')

    const saved = controller.markSaved(newerEdit, snapshot)
    expect(saved.savedText).toBe('name,value\nbeta,2')
    expect(saved.isDirty).toBe(true)
  })

  it('compares each undo state with the saved baseline after a save between edits', () => {
    const controller = new DocumentController()
    const original = makeDocument()
    const firstEdit = controller.applySourceText(original, 'name,value\nbeta,2', 'command')
    const savedSnapshot = buildExportSnapshot(firstEdit.id, firstEdit)
    const secondEdit = controller.applySourceText(firstEdit, 'name,value\ngamma,3', 'command')
    const saved = controller.markSaved(secondEdit, savedSnapshot)

    const undoneSecondEdit = controller.restoreHistory(saved, 'undo')!
    expect(undoneSecondEdit.text).toBe(firstEdit.text)
    expect(undoneSecondEdit.isDirty).toBe(false)
    const undoneFirstEdit = controller.restoreHistory(undoneSecondEdit, 'undo')!
    expect(undoneFirstEdit.text).toBe(original.text)
    expect(undoneFirstEdit.isDirty).toBe(true)
  })
})
