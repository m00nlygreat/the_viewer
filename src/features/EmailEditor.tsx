import { Download, ExternalLink, FileText, Paperclip } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { EmailModel, ViewerDocument } from '../domain/types'
import { getFormat } from '../domain/fileFormats'
import { createInlineImageUrls, releaseObjectUrls } from '../platform/attachmentResources'
import { prepareEmailHtml } from './emailHtml'

interface Props {
  document: ViewerDocument
  model: EmailModel
  onOpenAttachment: (index: number) => void
  onDownloadAttachment: (index: number) => void
}

export function EmailEditor({ document, model, onOpenAttachment, onDownloadAttachment }: Props) {
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({})
  useEffect(() => {
    const urls = createInlineImageUrls(model.attachments)
    setImageUrls(urls)
    return () => releaseObjectUrls(urls)
  }, [model.attachments])

  const content = model.text || model.html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  const safeHtml = useMemo(() => prepareEmailHtml(model.html || '', imageUrls), [imageUrls, model.html])
  const sender = model.from[0]
  const details = [
    ['보낸 사람', sender?.name || sender?.address || '—'], ['주소', sender?.address || '—'],
    ['받는 사람', model.to.map((item) => item.address).join(', ') || '—'], ['참조', model.cc.map((item) => item.address).join(', ') || '—'],
    ['날짜', model.date ? new Date(model.date).toLocaleString() : '—'], ['형식', model.html ? 'HTML' : '텍스트'], ['첨부', `${model.attachments.length}개`]
  ]

  return <section className="email-layout">
    <main className="email-main">
      <div className="email-heading"><div className="email-subject-row"><h1>{model.subject || '(제목 없음)'}</h1>{document.isDirty && <span className="modified-pill">수정됨</span>}</div>
        <div className="email-from-row"><div className="email-avatar">{(sender?.name || sender?.address || '?').slice(0, 1).toUpperCase()}</div><div><strong>{sender?.name || sender?.address || '보낸 사람 없음'}</strong><span>{sender?.address && sender.name ? sender.address : ''}</span></div><time>{model.date ? new Date(model.date).toLocaleString() : ''}</time></div>
        <div className="email-recipient">받는 사람 · {model.to.map((item) => item.address).join(', ') || '알 수 없음'}{model.cc.length ? ` · 참조 ${model.cc.map((item) => item.address).join(', ')}` : ''}</div>
      </div>
      {model.html ? <div className="email-html-content" dangerouslySetInnerHTML={{ __html: safeHtml }} /> : <EmailTextBody content={content || '본문이 없습니다.'} />}
    </main>
    <aside className="email-details" aria-label="이메일 속성">
      <h2>속성</h2>
      {details.map(([key, value]) => <div className="property-row" key={key}><span>{key}</span><strong title={value}>{value}</strong></div>)}
      <AttachmentList model={model} onOpen={onOpenAttachment} onDownload={onDownloadAttachment} />
      {model.headers.length > 0 && <details className="headers-details"><summary>전체 헤더</summary>{model.headers.map((header, index) => <div className="header-detail" key={`${header.key}-${index}`}><span>{header.key}</span><code>{header.value}</code></div>)}</details>}
    </aside>
  </section>
}

function EmailTextBody({ content }: { content: string }) {
  const lines = content.split(/\r\n|\n|\r/u)
  const forwardedIndex = lines.findIndex((line) => /^\s*(?:-{2,}\s*(?:forwarded|original)\s+message\s*-{2,}|begin\s+forwarded\s+message\s*:|forwarded\s+message\s*:|(?:-{2,}\s*)?(?:전달(?:된)?\s*(?:메시지|메일|이메일)|원본\s*(?:메시지|메일|이메일))(?:\s*-{2,})?)\s*$/iu.test(line))

  if (forwardedIndex < 0) return <div className="email-body">{content}</div>

  const introduction = lines.slice(0, forwardedIndex).join('\n').trimEnd()
  const forwarded = lines.slice(forwardedIndex).join('\n')
  return <div className="email-body">
    {introduction && <div>{introduction}</div>}
    <div className="email-forwarded-text">{forwarded}</div>
  </div>
}

function AttachmentList({ model, onOpen, onDownload }: { model: EmailModel; onOpen: (index: number) => void; onDownload: (index: number) => void }) {
  if (!model.attachments.length) return null
  return <section className="attachments"><div className="attachments-heading"><h2><Paperclip size={14} /> 첨부 파일 <span>{model.attachments.length}</span></h2></div>
    {model.attachments.map((attachment, index) => <div className="attachment-row" key={`${attachment.filename}-${index}`}>
      <div className="attachment-icon"><FileText size={16} /></div><div className="attachment-info"><strong>{attachment.filename}</strong><span>{attachment.mimeType} · {formatSize(attachment.content.length)}</span></div>
      {getFormat(attachment.filename, attachment.mimeType) && <button className="subtle-button" onClick={() => onOpen(index)} title="작업 공간에서 열기"><ExternalLink size={14} /> 열기</button>}
      <button className="icon-button" onClick={() => onDownload(index)} aria-label={`${attachment.filename} 내려받기`} title="내려받기"><Download size={15} /></button>
    </div>)}
  </section>
}

function formatSize(size: number): string { return size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB` }
