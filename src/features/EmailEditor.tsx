import DOMPurify from 'dompurify'
import { Download, ExternalLink, FileText, Paperclip, X, Pencil } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { EmailModel, ViewerDocument } from '../domain/types'
import { isEditableEmailMime } from '../domain/formats/email'
import { createInlineImageUrls, releaseObjectUrls } from '../platform/attachmentResources'

interface Props {
  document: ViewerDocument
  model: EmailModel
  onChange: (model: EmailModel, group?: 'typing' | 'command') => void
  onOpenAttachment: (index: number) => void
  onDownloadAttachment: (index: number) => void
  onAddAttachments: () => void
  onRemoveAttachment: (index: number) => void
  onOpenSource: () => void
}

function addressInput(value: EmailModel['from'], label: string, onChange: (value: EmailModel['from'], group?: 'typing' | 'command') => void) {
  const text = value.map((item) => item.name ? `${item.name} <${item.address}>` : item.address).join(', ')
  return <label className="form-field"><span>{label}</span><input value={text} onChange={(event) => onChange(event.target.value.split(',').map((entry) => {
    const match = entry.trim().match(/^(.*?)\s*<([^>]+)>$/)
    return match ? { name: match[1].trim() || undefined, address: match[2].trim() } : { address: entry.trim() }
  }).filter((entry) => entry.address), 'typing')} /></label>
}

export function EmailEditor({ document, model, onChange, onOpenAttachment, onDownloadAttachment, onAddAttachments, onRemoveAttachment, onOpenSource }: Props) {
  const [bodyFormat, setBodyFormat] = useState<'text' | 'html'>(model.html ? 'html' : 'text')
  const [editing, setEditing] = useState(false)
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({})
  const safeMimeStructure = isEditableEmailMime(document.text)
  const canEdit = safeMimeStructure && document.parseState === 'ready' && document.modelRevision === document.revision
  useEffect(() => {
    const urls = createInlineImageUrls(model.attachments)
    setImageUrls(urls)
    return () => releaseObjectUrls(urls)
  }, [model.attachments])
  const content = model.text || model.html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  const localHtml = (model.html || '').replace(/\bsrc=(['"])cid:([^'"]+)\1/gi, (_match, _quote: string, value: string) => {
    let key = value.trim().replace(/[<>]/g, '')
    try { key = decodeURIComponent(key) } catch { /* Keep the literal Content-ID when it is not percent encoded. */ }
    const url = imageUrls[key.toLowerCase()]
    return url ? `src="${url}"` : 'src=""'
  })
  const safeHtml = DOMPurify.sanitize(localHtml, {
    FORBID_TAGS: ['script', 'style', 'link', 'iframe', 'object', 'embed', 'form', 'input', 'video', 'audio'],
    FORBID_ATTR: ['style', 'srcset', 'background', 'action', 'formaction'],
    ALLOWED_URI_REGEXP: /^(?:blob:|data:image\/(?:png|gif|jpeg|webp);base64,)/i
  })
  const frame = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:"><style>body{font:17px/1.75 system-ui,sans-serif;color:#d4d5d8;margin:16px;overflow-wrap:anywhere}a{color:#a4aaf7}</style></head><body>${safeHtml}</body></html>`
  const sender = model.from[0]
  const details = [
    ['보낸 사람', sender?.name || sender?.address || '—'], ['주소', sender?.address || '—'],
    ['받는 사람', model.to.map((item) => item.address).join(', ') || '—'], ['참조', model.cc.map((item) => item.address).join(', ') || '—'],
    ['날짜', model.date ? new Date(model.date).toLocaleString() : '—'], ['형식', model.html ? 'HTML' : '텍스트'], ['첨부', `${model.attachments.length}개`]
  ]

  return <section className="email-layout">
    <main className="email-main">
      {editing && canEdit ? <div className="email-form">
        <div className="detail-heading"><h2>이메일 편집</h2><button className="icon-button" aria-label="편집 닫기" onClick={() => setEditing(false)}><X size={15} /></button></div>
        <label className="form-field"><span>제목</span><input value={model.subject} onChange={(event) => onChange({ ...model, subject: event.target.value }, 'typing')} /></label>
        {addressInput(model.from, '보낸 사람', (from, group) => onChange({ ...model, from }, group))}
        {addressInput(model.to, '받는 사람', (to, group) => onChange({ ...model, to }, group))}
        {addressInput(model.cc, '참조', (cc, group) => onChange({ ...model, cc }, group))}
        <label className="form-field"><span>날짜</span><input type="datetime-local" value={safeDateInput(model.date)} onChange={(event) => onChange({ ...model, date: event.target.value ? new Date(event.target.value).toISOString() : '' }, 'typing')} /></label>
        <label className="form-field"><span>본문 형식</span><select value={bodyFormat} onChange={(event) => setBodyFormat(event.target.value as 'text' | 'html')}><option value="text">일반 텍스트</option><option value="html">HTML 원문</option></select></label>
        <label className="form-field body-field"><span>{bodyFormat === 'html' ? 'HTML 본문' : '텍스트 본문'}</span><textarea value={bodyFormat === 'html' ? model.html : model.text} onChange={(event) => onChange({ ...model, [bodyFormat]: event.target.value }, 'typing')} rows={15} spellCheck /></label>
        {bodyFormat === 'html' && <div className="email-edit-preview"><span className="small-muted">정제된 미리보기</span><iframe className="email-html-frame" title="정제된 HTML 본문 미리보기" sandbox="" referrerPolicy="no-referrer" srcDoc={frame} /></div>}
        <AttachmentList model={model} editable onAdd={onAddAttachments} onRemove={onRemoveAttachment} onOpen={onOpenAttachment} onDownload={onDownloadAttachment} />
      </div> : <>
        <div className="email-heading"><div className="email-subject-row"><h1>{model.subject || '(제목 없음)'}</h1>{document.isDirty && <span className="modified-pill">수정됨</span>}</div>
          <div className="email-edit-action">{canEdit ? <button className="subtle-button" onClick={() => setEditing(true)}><Pencil size={13} /> 이메일 편집</button> : <><span className="small-muted" title="원본 MIME 파트와 안전한 수정 구간을 연결할 수 없습니다.">이 구조는 원본 탭에서 편집하세요.</span><button className="subtle-button" onClick={onOpenSource}>원본 열기</button></>}</div>
          <div className="email-from-row"><div className="email-avatar">{(sender?.name || sender?.address || '?').slice(0, 1).toUpperCase()}</div><div><strong>{sender?.name || sender?.address || '보낸 사람 없음'}</strong><span>{sender?.address && sender.name ? sender.address : ''}</span></div><time>{model.date ? new Date(model.date).toLocaleString() : ''}</time></div>
          <div className="email-recipient">받는 사람 · {model.to.map((item) => item.address).join(', ') || '알 수 없음'}{model.cc.length ? ` · 참조 ${model.cc.map((item) => item.address).join(', ')}` : ''}</div>
        </div>
        {model.html ? <iframe className="email-html-frame" title="안전하게 정제된 이메일 본문" sandbox="" referrerPolicy="no-referrer" srcDoc={frame} /> : <div className="email-body">{content || '본문이 없습니다.'}</div>}
        <AttachmentList model={model} onOpen={onOpenAttachment} onDownload={onDownloadAttachment} />
      </>}
    </main>
    <aside className="email-details" aria-label="이메일 속성">
      <h2>속성</h2>
      {details.map(([key, value]) => <div className="property-row" key={key}><span>{key}</span><strong title={value}>{value}</strong></div>)}
      {!safeMimeStructure && <div className="inline-warning">기존 MIME 파트를 안전하게 연결할 수 없는 구조입니다. 원본 탭에서만 편집할 수 있고, 보기에서는 원문을 유지합니다.</div>}
      {model.headers.length > 0 && <details className="headers-details"><summary>전체 헤더</summary>{model.headers.map((header, index) => <div className="header-detail" key={`${header.key}-${index}`}><span>{header.key}</span><code>{header.value}</code></div>)}</details>}
    </aside>
  </section>
}

function AttachmentList({ model, onOpen, onDownload, editable = false, onAdd, onRemove }: { model: EmailModel; onOpen: (index: number) => void; onDownload: (index: number) => void; editable?: boolean; onAdd?: () => void; onRemove?: (index: number) => void }) {
  if (!model.attachments.length && !editable) return null
  return <section className="attachments"><div className="attachments-heading"><h2><Paperclip size={14} /> 첨부 파일 <span>{model.attachments.length}</span></h2>{editable && <button className="subtle-button" onClick={onAdd}>+ 첨부 추가</button>}</div>
    {model.attachments.map((attachment, index) => <div className="attachment-row" key={`${attachment.filename}-${index}`}>
      <div className="attachment-icon"><FileText size={16} /></div><div className="attachment-info"><strong>{attachment.filename}</strong><span>{attachment.mimeType} · {formatSize(attachment.content.length)}</span></div>
      {['eml', 'csv', 'md', 'ics', 'vcf'].some((extension) => attachment.filename.toLowerCase().endsWith(`.${extension}`)) && <button className="subtle-button" onClick={() => onOpen(index)} title="작업 공간에서 열기"><ExternalLink size={14} /> 열기</button>}
      <button className="icon-button" onClick={() => onDownload(index)} aria-label={`${attachment.filename} 내려받기`} title="내려받기"><Download size={15} /></button>
      {editable && <button className="icon-button danger-hover" onClick={() => onRemove?.(index)} aria-label={`${attachment.filename} 첨부 제거`} title="첨부 제거"><X size={14} /></button>}
    </div>)}
  </section>
}

function safeDateInput(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 16)
}

function formatSize(size: number): string { return size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB` }
