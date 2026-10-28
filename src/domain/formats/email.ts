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

interface RawHeaderField { name: string; originalName: string; value: string; start: number; end: number; lineEnd: number }
interface RawMessage { headerBlock: string; body: string; separator: string; lineBreak: string; fields: RawHeaderField[] }

function rawMessage(source: string): RawMessage | null {
  const separatorMatch = /\r\n\r\n|\n\n|\r\r/.exec(source)
  if (!separatorMatch || separatorMatch.index === undefined) return null
  const headerBlock = source.slice(0, separatorMatch.index)
  const separator = separatorMatch[0]
  const lineBreak = /\r\n|\n|\r/.exec(separator)?.[0] ?? '\r\n'
  const lines: Array<{ text: string; start: number; end: number; lineEnd: number }> = []
  for (let start = 0; start < headerBlock.length;) {
    let end = start
    while (end < headerBlock.length && headerBlock[end] !== '\r' && headerBlock[end] !== '\n') end += 1
    let lineEnd = end
    if (headerBlock.slice(end, end + 2) === '\r\n') lineEnd += 2
    else if (end < headerBlock.length) lineEnd += 1
    lines.push({ text: headerBlock.slice(start, end), start, end, lineEnd })
    start = lineEnd
  }
  const fields: RawHeaderField[] = []
  for (const line of lines) {
    if (/^[ \t]/.test(line.text) && fields.length) {
      const previous = fields[fields.length - 1]!
      previous.value += ` ${line.text.trim()}`
      previous.end = line.end
      previous.lineEnd = line.lineEnd
      continue
    }
    const match = line.text.match(/^([^:\r\n]+):[ \t]*(.*)$/)
    if (match) fields.push({ name: match[1]!.trim().toLowerCase(), originalName: match[1]!.trim(), value: match[2]!, start: line.start, end: line.end, lineEnd: line.lineEnd })
  }
  return { headerBlock, body: source.slice(separatorMatch.index + separator.length), separator, lineBreak, fields }
}

function rewriteHeaderBlock(headerBlock: string, lineBreak: string, changes: Map<string, string | null>): string {
  const message = rawMessage(`${headerBlock}${lineBreak}${lineBreak}`)
  if (!message) return headerBlock
  const edits: Array<{ start: number; end: number; replacement: string }> = []
  const additions: Array<{ name: string; value: string }> = []
  for (const [rawName, value] of changes) {
    const name = rawName.toLowerCase()
    const fields = message.fields.filter((field) => field.name === name)
    if (!fields.length) {
      if (value !== null) additions.push({ name: rawName, value })
      continue
    }
    fields.forEach((field, index) => {
      const replacement = value === null || index > 0 ? '' : `${field.originalName}: ${value}`
      edits.push({ start: field.start, end: value === null || index > 0 ? field.lineEnd : field.end, replacement })
    })
  }
  let result = headerBlock
  for (const edit of edits.sort((a, b) => b.start - a.start)) result = `${result.slice(0, edit.start)}${edit.replacement}${result.slice(edit.end)}`
  for (const addition of additions) result += `${result ? lineBreak : ''}${addition.name}: ${addition.value}`
  return result
}

function headerRaw(headerBlock: string, name: string): string | undefined {
  const message = rawMessage(`${headerBlock}\r\n\r\n`)
  const field = message?.fields.find((item) => item.name === name.toLowerCase())
  return field ? headerBlock.slice(field.start, field.end) : undefined
}

function headerValue(headerBlock: string, name: string): string | undefined {
  return rawMessage(`${headerBlock}\r\n\r\n`)?.fields.find((item) => item.name === name.toLowerCase())?.value
}

function contentType(source: string): string {
  return rawMessage(source)?.fields.find((field) => field.name === 'content-type')?.value.trim() ?? 'text/plain'
}

function generatedMultipart(source: string): boolean {
  const type = contentType(source)
  const boundary = type.match(/^multipart\/mixed\s*;[^\r\n]*\bboundary\s*=\s*"?(viewer-[a-z0-9-]+)"?/i)?.[1]
  if (!boundary) return false
  return new RegExp(`--${boundary}\\r?\\nContent-Type:\\s*text\\/(?:plain|html)\\b`, 'i').test(source)
}

export function isEditableEmailMime(source: string): boolean {
  if (generatedMultipart(source)) return true
  const message = rawMessage(source)
  if (!message) return false
  const types = message.fields.filter((field) => field.name === 'content-type')
  const transfers = message.fields.filter((field) => field.name === 'content-transfer-encoding')
  const managed = ['subject', 'from', 'to', 'cc', 'date']
  if (managed.some((name) => message.fields.filter((field) => field.name === name).length > 1) || types.length > 1 || transfers.length > 1) return false
  const type = types[0]?.value.trim() ?? 'text/plain'
  const transfer = transfers[0]?.value.trim().toLowerCase() ?? ''
  return /^text\/(?:plain|html)\b/i.test(type) && ['','7bit','8bit','binary','base64'].includes(transfer)
}

export async function serializeEmailPreserving(model: EmailModel, source: string): Promise<string> {
  if (generatedMultipart(source)) return serializeEmail(model)
  const message = rawMessage(source)
  if (!message || !isEditableEmailMime(source)) throw new Error('이메일 구조를 안전하게 연결할 수 없습니다. 원본 탭에서 수정하세요.')
  const original = await parseEmail(new TextEncoder().encode(source))
  const sourceType = contentType(source)
  const sourceIsHtml = /^text\/html\b/i.test(sourceType)
  const htmlChanged = model.html !== original.html
  const textChanged = model.text !== original.text
  const bodyChanged = htmlChanged || textChanged
  const outputIsHtml = htmlChanged ? true : textChanged ? false : sourceIsHtml
  const bodyText = outputIsHtml ? model.html : model.text
  const changes = new Map<string, string | null>()
  if (model.subject !== original.subject) changes.set('Subject', encodeHeader(model.subject))
  if (JSON.stringify(model.from) !== JSON.stringify(original.from)) changes.set('From', model.from.length ? serializeAddresses(model.from) : '')
  if (JSON.stringify(model.to) !== JSON.stringify(original.to)) changes.set('To', model.to.length ? serializeAddresses(model.to) : '')
  if (JSON.stringify(model.cc) !== JSON.stringify(original.cc)) changes.set('Cc', model.cc.length ? serializeAddresses(model.cc) : '')
  if (model.date !== original.date) {
    const date = new Date(model.date)
    changes.set('Date', model.date && !Number.isNaN(date.getTime()) ? safeHeader(date.toUTCString()) : '')
  }
  if (outputIsHtml !== sourceIsHtml) changes.set('Content-Type', `${outputIsHtml ? 'text/html' : 'text/plain'}; charset=UTF-8`)
  const originalTransfer = headerValue(message.headerBlock, 'content-transfer-encoding')?.trim().toLowerCase() ?? ''
  const encodedBody = bodyChanged ? base64TextWithNewline(bodyText, message.lineBreak) : message.body
  if (bodyChanged && originalTransfer !== 'base64') changes.set('Content-Transfer-Encoding', 'base64')
  let headerBlock = rewriteHeaderBlock(message.headerBlock, message.lineBreak, changes)

  if (!model.attachments.length) return `${headerBlock}${message.separator}${encodedBody}`

  const boundary = `viewer-${crypto.randomUUID()}`
  const bodyHeaderBlock = headerBlock
  const contentHeaderRaw = headerRaw(bodyHeaderBlock, 'content-type') ?? `Content-Type: ${outputIsHtml ? 'text/html' : 'text/plain'}; charset=UTF-8`
  const transferHeaderRaw = headerRaw(bodyHeaderBlock, 'content-transfer-encoding')
  const innerHeaders = [contentHeaderRaw, transferHeaderRaw].filter((value): value is string => Boolean(value)).join(message.lineBreak)
  const outerChanges = new Map<string, string | null>([['Content-Type', `multipart/mixed; boundary="${boundary}"`], ['Content-Transfer-Encoding', null]])
  if (!headerValue(bodyHeaderBlock, 'mime-version')) outerChanges.set('MIME-Version', '1.0')
  headerBlock = rewriteHeaderBlock(bodyHeaderBlock, message.lineBreak, outerChanges)
  const parts = [`--${boundary}${message.lineBreak}${innerHeaders}${message.lineBreak}${message.lineBreak}${encodedBody}${encodedBody.endsWith(message.lineBreak) ? '' : message.lineBreak}`]
  for (const attachment of model.attachments) parts.push(serializeAttachmentPart(attachment, boundary, message.lineBreak))
  parts.push(`--${boundary}--${message.lineBreak}`)
  return `${headerBlock}${message.separator}${parts.join('')}`
}

function base64TextWithNewline(value: string, lineBreak: string): string {
  const encoded = utf8Base64(new TextEncoder().encode(value))
  return encoded.match(/.{1,76}/g)?.join(lineBreak) ?? ''
}

function serializeAttachmentPart(attachment: EmailAttachment, boundary: string, lineBreak: string): string {
  const filename = safeHeader(attachment.filename).trim() || 'attachment.bin'
  const quotedFilename = filename.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const disposition = attachment.disposition === 'inline' ? 'inline' : 'attachment'
  const contentId = attachment.contentId ? `Content-ID: <${safeHeader(attachment.contentId).replace(/[<>]/g, '')}>${lineBreak}` : ''
  const extensionName = /[^\x20-\x7e]/.test(filename) ? `; filename*=UTF-8''${encodeURIComponent(filename).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)}` : ''
  const base64 = utf8Base64(new Uint8Array(attachment.content)).match(/.{1,76}/g)?.join(lineBreak) ?? ''
  return `--${boundary}${lineBreak}Content-Type: ${safeHeader(attachment.mimeType) || 'application/octet-stream'}${lineBreak}Content-Transfer-Encoding: base64${lineBreak}Content-Disposition: ${disposition}; filename="${quotedFilename}"${extensionName}${lineBreak}${contentId}${lineBreak}${base64}${lineBreak}`
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
