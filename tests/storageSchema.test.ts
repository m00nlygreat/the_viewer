import { describe, expect, it } from 'vitest'
import type { EmailModel, ViewerDocument } from '../src/domain/types'
import { parseCalendar } from '../src/domain/formats/calendar'
import { parseVCF } from '../src/domain/vcard'
import { normalizeStoredDocument, serializeStoredDocument } from '../src/platform/storage'
import { parseEnv } from '../src/domain/env/parse'
import { parseDiff } from '../src/domain/diff/parse'

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

    const bufferModel = { ...email.model, attachments: [{ filename: 'data.bin', mimeType: 'application/octet-stream', content: new Uint8Array([4, 5]).buffer }] }
    const restoredBuffer = normalizeStoredDocument({ ...email, model: bufferModel })
    if (restoredBuffer.format !== 'eml') throw new Error('이메일 문서가 아닙니다.')
    expect(restoredBuffer.model.attachments[0]?.content).toEqual(new Uint8Array([4, 5]))
  })

  it('rejects an unknown persisted schema version', () => {
    expect(() => normalizeStoredDocument({ ...document, schemaVersion: 99 })).toThrow('지원하지 않는 문서 저장 버전')
  })

  it('rejects a persisted model that does not match its file format', () => {
    expect(() => normalizeStoredDocument({ ...document, format: 'csv', model: { text: 'not CSV' } })).toThrow('저장된 CSV 모델이 올바르지 않습니다.')
  })

  it('rejects malformed nested rows, calendar events, contact properties, and email headers', () => {
    const csv = { headers: ['name'], headerRow: ['name'], rows: [['valid', 3]], hasHeader: true, delimiter: ',', newline: '\n', bom: false, encoding: 'UTF-8', errors: [] }
    expect(() => normalizeStoredDocument({ ...document, format: 'csv', model: csv })).toThrow('저장된 CSV 모델이 올바르지 않습니다.')

    const calendar = { events: [{ uid: 'event-1', summary: '회의', location: '', description: '', start: '', end: '', allDay: 'no' }], jcal: [], diagnostics: [] }
    expect(() => normalizeStoredDocument({ ...document, format: 'ics', model: calendar })).toThrow('저장된 일정 모델이 올바르지 않습니다.')

    const contacts = { cards: [{ recordId: 'card-1', uid: 'card-1', version: '4.0', properties: [{ name: 'FN', params: '', value: 'Ada' }], fullName: 'Ada', givenName: 'Ada', familyName: '', organization: '', title: '', phones: [], emails: [], urls: [], notes: '' }], diagnostics: [] }
    expect(() => normalizeStoredDocument({ ...document, format: 'vcf', model: contacts })).toThrow('저장된 연락처 모델이 올바르지 않습니다.')

    const email = { subject: '', from: [], to: [], cc: [], date: '', text: '', html: '', attachments: [], headers: [{ key: 'Subject', value: 7 }] }
    expect(() => normalizeStoredDocument({ ...document, format: 'eml', model: email })).toThrow('저장된 이메일 모델이 올바르지 않습니다.')
  })

  it('accepts parsed calendar and contact models with their nested source data', () => {
    const calendar = parseCalendar(['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:event-1', 'SUMMARY:회의', 'DTSTART:20261107T090000Z', 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n'))
    expect(normalizeStoredDocument({ ...document, format: 'ics', model: calendar }).model).toEqual(calendar)

    const contacts = parseVCF(['BEGIN:VCARD', 'VERSION:4.0', 'UID:contact-1', 'FN:Ada Lovelace', 'TEL;TYPE=work:123', 'END:VCARD', ''].join('\r\n'))
    expect(normalizeStoredDocument({ ...document, format: 'vcf', model: contacts }).model).toEqual(contacts)
  })

  it('stores and restores DIFF and ENV models without changing their source maps', () => {
    const cases = [
      { id: 'diff-1', name: 'change.patch', format: 'diff' as const, mimeType: 'text/x-diff', text: '--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old\n+new\n', model: parseDiff('--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old\n+new\n') },
      { id: 'env-1', name: '.env.production', format: 'env' as const, mimeType: 'text/plain', text: '# keep\r\nA="one"\r\n', model: parseEnv('# keep\r\nA="one"\r\n') }
    ]
    for (const item of cases) {
      const bytes = new TextEncoder().encode(item.text).buffer
      const source: ViewerDocument = {
        ...document, id: item.id, name: item.name, format: item.format, mimeType: item.mimeType, size: bytes.byteLength,
        initialBytes: bytes.slice(0), savedBytes: bytes.slice(0), sourceText: item.text, text: item.text, savedText: item.text,
        model: item.model
      } as ViewerDocument
      const stored = serializeStoredDocument(source)
      expect(normalizeStoredDocument(stored)).toEqual(source)
    }
  })

  it('rejects corrupt DIFF and ENV source ranges', () => {
    const diffText = '--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old\n+new\n'
    const diff = parseDiff(diffText)
    const invalidDiff = structuredClone(diff)
    invalidDiff.segments[0]!.to = diffText.length + 1
    expect(() => normalizeStoredDocument({ ...document, format: 'diff', model: invalidDiff })).toThrow('저장된 diff 모델이 올바르지 않습니다.')

    const envText = 'A=value\n'
    const env = parseEnv(envText)
    const invalidEnv = structuredClone(env)
    const assignment = invalidEnv.syntax?.records.find((record) => record.type === 'assignment')
    if (!assignment || assignment.type !== 'assignment') throw new Error('ENV assignment expected')
    assignment.valueRange.to = envText.length + 1
    expect(() => normalizeStoredDocument({ ...document, format: 'env', model: invalidEnv })).toThrow('저장된 ENV 모델이 올바르지 않습니다.')
  })

  it('preserves valid folder ownership and removes malformed folder paths without discarding the document', () => {
    const owned = normalizeStoredDocument({ ...document, folderRef: { folderId: 'folder-1', path: 'notes/a.md' } })
    expect(owned.folderRef).toEqual({ folderId: 'folder-1', path: 'notes/a.md' })
    expect(normalizeStoredDocument({ ...document, folderRef: { folderId: 'folder-1', path: '../outside.md' } })).toMatchObject({ id: 'doc-1', text: 'note', folderRef: undefined })
  })
})
