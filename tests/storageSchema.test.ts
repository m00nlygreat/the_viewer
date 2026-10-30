import { describe, expect, it } from 'vitest'
import type { EmailModel, ViewerDocument } from '../src/domain/types'
import { normalizeStoredDocument, serializeStoredDocument } from '../src/platform/storage'

const document: ViewerDocument = {
  id: 'doc-1', name: 'note.md', format: 'md', mimeType: 'text/markdown', size: 4,
  initialBytes: new ArrayBuffer(4), savedBytes: new ArrayBuffer(4), sourceText: 'note', text: 'note',
  model: { text: 'note' }, mode: 'view', revision: 0, modelRevision: 0, textRevision: 0,
  parseState: 'ready', diagnostics: [], encoding: 'UTF-8', bom: false, savedText: 'note', isDirty: false,
  openedAt: 1, lastEditedAt: 1
}

describe('document storage schema', () => {
  it('stores typed documents with an explicit schema version', () => {
    const stored = serializeStoredDocument(document)
    expect(stored).toMatchObject({ schemaVersion: 3, format: 'md', model: { text: 'note' } })
    expect(normalizeStoredDocument(stored)).toEqual(document)
  })

  it('continues to read legacy inline records and removes deprecated fields', () => {
    const legacy = { ...document, sourceBytes: new ArrayBuffer(4) }
    expect(normalizeStoredDocument(legacy)).toEqual(document)
  })

  it('normalizes legacy email attachment arrays into compact byte arrays', () => {
    const email = {
      ...document,
      id: 'email-1', name: 'mail.eml', format: 'eml' as const,
      model: {
        subject: '', from: [], to: [], cc: [], date: '', text: '', html: '', headers: [],
        attachments: [{ filename: 'data.bin', mimeType: 'application/octet-stream', content: [0, 127, 255] }]
      }
    }

    const restored = normalizeStoredDocument({ ...email, schemaVersion: 2 })
    expect(restored.model).toMatchObject({ attachments: [{ filename: 'data.bin' }] })
    if (restored.format !== 'eml') throw new Error('이메일 문서가 아닙니다.')
    expect((restored.model as EmailModel).attachments[0]?.content).toEqual(new Uint8Array([0, 127, 255]))

    const saved = serializeStoredDocument({ ...email, model: { ...email.model, attachments: [{ ...email.model.attachments[0]!, content: new Uint8Array([0, 127, 255]) }] } })
    expect(saved.schemaVersion).toBe(3)
    expect(normalizeStoredDocument(saved)).toEqual({ ...email, model: { ...email.model, attachments: [{ ...email.model.attachments[0]!, content: new Uint8Array([0, 127, 255]) }] } })
  })

  it('rejects an unknown persisted schema version', () => {
    expect(() => normalizeStoredDocument({ ...document, schemaVersion: 99 })).toThrow('지원하지 않는 문서 저장 버전')
  })
})
