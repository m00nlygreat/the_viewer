import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { EmailModel, ViewerDocument } from '../src/domain/types'
import { createEmailPreviewDocument } from '../src/features/emailPreviewDocument'

vi.mock('dompurify', () => ({ default: { sanitize: (html: string) => html } }))

import { EmailEditor } from '../src/features/EmailEditor'

describe('email rendering', () => {
  it('gives sanitized HTML a high-contrast light reading surface', () => {
    const body = '<p>본문</p>'
    const frame = createEmailPreviewDocument(body)

    expect(frame).toContain('color-scheme:light;background:#fff')
    expect(frame).toContain('color:#202124;background:#fff')
    expect(frame).toContain("default-src 'none'")
    expect(frame).toContain(body)
  })

  it('renders attachments inside the email details panel', () => {
    const model: EmailModel = {
      subject: '테스트', from: [], to: [], cc: [], date: '', text: '', html: '<p>본문</p>',
      attachments: [{ filename: 'report.pdf', mimeType: 'application/pdf', content: [1, 2, 3] }], headers: []
    }
    const source = 'Content-Type: text/html; charset=UTF-8\r\n\r\n<p>본문</p>'
    const document: ViewerDocument = {
      id: 'email-test', name: 'test.eml', format: 'eml', mimeType: 'message/rfc822', size: source.length,
      savedBytes: new ArrayBuffer(0), sourceText: source, text: source, model, mode: 'view', revision: 1,
      modelRevision: 1, textRevision: 1, parseState: 'ready', diagnostics: [], encoding: 'UTF-8', bom: false,
      savedText: source, isDirty: false, openedAt: 0, lastEditedAt: 0
    }
    const html = renderToStaticMarkup(createElement(EmailEditor, {
      document, model, onChange: () => {}, onOpenAttachment: () => {}, onDownloadAttachment: () => {},
      onAddAttachments: () => {}, onRemoveAttachment: () => {}, onOpenSource: () => {}
    }))
    const detailsPanel = html.match(/<aside\b[^>]*>[\s\S]*?<\/aside>/u)?.[0]
    const messageBody = html.match(/<main\b[^>]*>[\s\S]*?<\/main>/u)?.[0]

    expect(detailsPanel).toContain('report.pdf')
    expect(detailsPanel).toContain('첨부 파일')
    expect(messageBody).not.toContain('report.pdf')
  })
})
