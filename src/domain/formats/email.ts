import PostalMime from 'postal-mime'
import type { Address, Attachment, Header } from 'postal-mime'
import type { EmailAddress, EmailAttachment, EmailModel } from '../types'

function bytesToArray(bytes: Uint8Array): number[] { return Array.from(bytes) }
function addressList(value: Address | Address[] | undefined): EmailAddress[] {
  const entries = value ? (Array.isArray(value) ? value : [value]) : []
  return entries.flatMap((item) => {
    if ('group' in item) return (item.group ?? []).flatMap((member) => member.address ? [{ name: member.name || undefined, address: member.address }] : [])
    return item.address ? [{ name: item.name || undefined, address: item.address }] : []
  })
}
function attachmentBytes(content: Attachment['content']): Uint8Array {
  if (typeof content === 'string') return new TextEncoder().encode(content)
  return content instanceof Uint8Array ? content : new Uint8Array(content)
}
function safeHeader(value: string): string { return value.replace(/[\r\n\u0000]/g, ' ').trim() }
function utf8Base64(value: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < value.length; offset += 0x8000) binary += String.fromCharCode(...value.subarray(offset, offset + 0x8000))
  return btoa(binary)
}
function base64Text(value: string): string { return utf8Base64(new TextEncoder().encode(value)).replace(/.{1,76}/g, '$&\r\n').trimEnd() }
function encodeHeader(value: string): string {
  const safe = safeHeader(value)
  if (/^[\x00-\x7f]*$/.test(safe)) return safe
  const chunks: string[] = []
  let current = ''
  for (const character of safe) {
    if (utf8Base64(new TextEncoder().encode(current + character)).length > 60 && current) { chunks.push(current); current = '' }
    current += character
  }
  if (current) chunks.push(current)
  return chunks.map((chunk) => `=?UTF-8?B?${utf8Base64(new TextEncoder().encode(chunk))}?=`).join('\r\n ')
}
function serializeAddresses(value: EmailAddress[]): string {
  return value.map((item) => item.name ? `${encodeHeader(item.name)} <${safeHeader(item.address)}>` : safeHeader(item.address)).join(', ')
}

export async function parseEmail(bytes: Uint8Array): Promise<EmailModel> {
  const mail = await new PostalMime().parse(bytes)
  return {
    subject: mail.subject ?? '',
    from: addressList(mail.from), to: addressList(mail.to), cc: addressList(mail.cc),
    date: String(mail.date ?? ''), text: mail.text ?? '', html: typeof mail.html === 'string' ? mail.html : '',
    attachments: mail.attachments.map((attachment): EmailAttachment => ({
      filename: attachment.filename || '첨부 파일', mimeType: attachment.mimeType || 'application/octet-stream',
      content: bytesToArray(attachmentBytes(attachment.content)),
      contentId: attachment.contentId || undefined, disposition: attachment.disposition || undefined
    })),
    headers: mail.headers.map((header: Header) => ({ key: header.key, value: header.value, originalKey: header.originalKey }))
  }
}

export function serializeEmail(model: EmailModel): string {
  const boundary = `viewer-${crypto.randomUUID()}`
  const alternativeBoundary = `viewer-alt-${crypto.randomUUID()}`
  const date = new Date(model.date)
  const generated: Record<string, string> = {
    subject: `Subject: ${encodeHeader(model.subject)}`,
    from: model.from.length ? `From: ${serializeAddresses(model.from)}` : '',
    to: model.to.length ? `To: ${serializeAddresses(model.to)}` : '',
    cc: model.cc.length ? `Cc: ${serializeAddresses(model.cc)}` : '',
    date: model.date && !Number.isNaN(date.getTime()) ? `Date: ${safeHeader(date.toUTCString())}` : '',
    'mime-version': 'MIME-Version: 1.0'
  }
  const hasHtml = Boolean(model.html)
  const hasText = Boolean(model.text)
  let contentType: string
  let body: string
  let transferEncoding = ''
  if (hasHtml && hasText) {
    contentType = `multipart/alternative; boundary="${alternativeBoundary}"`
    body = `--${alternativeBoundary}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64Text(model.text)}\r\n--${alternativeBoundary}\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64Text(model.html)}\r\n--${alternativeBoundary}--\r\n`
  } else {
    contentType = `${hasHtml ? 'text/html' : 'text/plain'}; charset=UTF-8`
    transferEncoding = 'Content-Transfer-Encoding: base64'
    body = `${base64Text(hasHtml ? model.html : model.text)}\r\n`
  }
  if (!model.attachments.length) {
    generated['content-type'] = `Content-Type: ${contentType}`
    if (transferEncoding) generated['content-transfer-encoding'] = transferEncoding
  }
  else {
    generated['content-type'] = `Content-Type: multipart/mixed; boundary="${boundary}"`
    body = `--${boundary}\r\nContent-Type: ${contentType}\r\n${transferEncoding ? `${transferEncoding}\r\n` : ''}\r\n${body}`
  }
  const headers: string[] = []
  const emitted = new Set<string>()
  for (const header of model.headers) {
    const key = header.key.toLowerCase()
    if (Object.hasOwn(generated, key)) {
      if (!emitted.has(key) && generated[key]) headers.push(generated[key]!)
      emitted.add(key)
    } else if (/^[a-z0-9!#$%&'*+.^_`|~-]+$/i.test(header.originalKey ?? header.key)) {
      headers.push(`${header.originalKey ?? header.key}: ${safeHeader(header.value)}`)
    }
  }
  for (const key of ['subject', 'from', 'to', 'cc', 'date', 'mime-version', 'content-type', 'content-transfer-encoding']) {
    if (!emitted.has(key) && generated[key]) headers.push(generated[key]!)
  }
  if (!model.attachments.length) return `${headers.join('\r\n')}\r\n\r\n${body}`
  const parts = [body]
  for (const attachment of model.attachments) {
    const filename = safeHeader(attachment.filename).trim() || 'attachment.bin'
    const quotedFilename = filename.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    const disposition = attachment.disposition === 'inline' ? 'inline' : 'attachment'
    const contentId = attachment.contentId ? `Content-ID: <${safeHeader(attachment.contentId).replace(/[<>]/g, '')}>\r\n` : ''
    const extensionName = /[^\x20-\x7e]/.test(filename) ? `; filename*=UTF-8''${encodeURIComponent(filename).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)}` : ''
    parts.push(`--${boundary}\r\nContent-Type: ${safeHeader(attachment.mimeType) || 'application/octet-stream'}\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: ${disposition}; filename="${quotedFilename}"${extensionName}\r\n${contentId}\r\n${utf8Base64(new Uint8Array(attachment.content)).replace(/.{1,76}/g, '$&\r\n').trimEnd()}\r\n`)
  }
  parts.push(`--${boundary}--\r\n`)
  return `${headers.join('\r\n')}\r\n\r\n${parts.join('')}`
}
