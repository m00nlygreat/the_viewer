// @vitest-environment jsdom
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { EmailModel, ViewerDocument } from '../src/domain/types'
import { EmailEditor } from '../src/features/EmailEditor'
import { prepareEmailHtml } from '../src/features/emailHtml'

describe('email rendering', () => {
  it('sanitizes the inline HTML body before rendering it', () => {
    const source = 'Content-Type: text/html; charset=UTF-8\r\n\r\n<p>안전한 본문</p><script>alert(1)</script>'
    const model: EmailModel = {
      subject: '본문 테스트', from: [], to: [], cc: [], date: '', text: '',
      html: '<p>안전한 본문</p><script>alert(1)</script><img src="https://tracker.example/pixel" onerror="steal()"><a href="javascript:steal()" onclick="steal()">위험한 링크</a><div style="background:url(https://tracker.example/bg)">본문</div><iframe src="https://tracker.example/frame"></iframe>',
      attachments: [], headers: []
    }
    const document: ViewerDocument = {
      id: 'inline-email-test', name: 'inline.eml', format: 'eml', mimeType: 'message/rfc822', size: source.length,
      savedBytes: new ArrayBuffer(0), sourceText: source, text: source, model, mode: 'view', revision: 0,
      modelRevision: 0, textRevision: 0, parseState: 'ready', diagnostics: [], encoding: 'UTF-8', bom: false,
      savedText: source, isDirty: false, openedAt: 0, lastEditedAt: 0
    }
    const html = renderToStaticMarkup(createElement(EmailEditor, {
      document, model, onOpenAttachment: () => {}, onDownloadAttachment: () => {}
    }))

    expect(html).toContain('안전한 본문')
    expect(html).not.toMatch(/<script|<iframe|onerror=|onclick=|javascript:|tracker\.example|style=/iu)
  })

  it('keeps resolved inline images and removes disallowed external resource URLs', () => {
    const prepared = prepareEmailHtml(
      '<p>본문</p><img src="CID:Photo%40Example.com"><img src="https://tracker.example/pixel"><img src="data:image/svg+xml,<svg>"><img src="data:image/png;base64,AAAA">',
      { 'photo@example.com': 'blob:https://viewer.example/inline-image' }
    )
    const parsed = new DOMParser().parseFromString(prepared, 'text/html')
    const images = parsed.querySelectorAll('img')

    expect(parsed.body.textContent).toContain('본문')
    expect(images[0]?.getAttribute('src')).toBe('blob:https://viewer.example/inline-image')
    expect(images[1]?.hasAttribute('src')).toBe(false)
    expect(images[2]?.hasAttribute('src')).toBe(false)
    expect(images[3]?.getAttribute('src')).toBe('data:image/png;base64,AAAA')
  })

  it('renders attachments inside the email details panel', () => {
    const model: EmailModel = {
      subject: '테스트', from: [], to: [], cc: [], date: '', text: '', html: '<p>본문</p>',
      attachments: [{ filename: 'report.pdf', mimeType: 'application/pdf', content: new Uint8Array([1, 2, 3]) }], headers: []
    }
    const source = [
      'Content-Type: multipart/mixed; boundary="sample"', '', '--sample',
      'Content-Type: text/html; charset=UTF-8', '', '<p>본문</p>', '--sample--', ''
    ].join('\r\n')
    const document: ViewerDocument = {
      id: 'email-test', name: 'test.eml', format: 'eml', mimeType: 'message/rfc822', size: source.length,
      savedBytes: new ArrayBuffer(0), sourceText: source, text: source, model, mode: 'view', revision: 1,
      modelRevision: 1, textRevision: 1, parseState: 'ready', diagnostics: [], encoding: 'UTF-8', bom: false,
      savedText: source, isDirty: false, openedAt: 0, lastEditedAt: 0
    }
    const html = renderToStaticMarkup(createElement(EmailEditor, {
      document, model, onOpenAttachment: () => {}, onDownloadAttachment: () => {}
    }))
    const detailsPanel = html.match(/<aside\b[^>]*>[\s\S]*?<\/aside>/u)?.[0]
    const messageBody = html.match(/<main\b[^>]*>[\s\S]*?<\/main>/u)?.[0]

    expect(detailsPanel).toContain('report.pdf')
    expect(detailsPanel).toContain('첨부 파일')
    expect(detailsPanel).not.toContain('기존 MIME 파트를 안전하게 연결할 수 없는 구조입니다')
    expect(messageBody).not.toContain('report.pdf')
  })
})
