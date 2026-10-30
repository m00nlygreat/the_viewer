import { describe, expect, it } from 'vitest'
import { DocumentController } from '../src/domain/documentController'
import { buildExportSnapshot } from '../src/domain/session'
import { parseCsv } from '../src/domain/formats/csv'
import type { ViewerDocument } from '../src/domain/types'

function makeDocument(): ViewerDocument {
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

  it('prepares a view command without exposing revision construction to the caller', async () => {
    const controller = new DocumentController()
    const document = makeDocument()
    const model = parseCsv('name,value\nbeta,2', 'UTF-8', false, '\n')
    const command = controller.prepareViewCommand(document, document.revision, model, 'command', 42)!

    expect(command.optimisticDocument.revision).toBe(1)
    expect(command.optimisticDocument.lastEditedAt).toBe(42)
    expect(command.optimisticDocument.isDirty).toBe(true)
    await expect(command.serializedDocument).resolves.toMatchObject({ text: 'name,value\nbeta,2', revision: 1 })
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
})
