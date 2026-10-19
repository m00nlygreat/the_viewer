import type { EmailAttachment } from '../domain/types'

export function createInlineImageUrls(attachments: EmailAttachment[]): Record<string, string> {
  const urls: Record<string, string> = {}
  for (const attachment of attachments) {
    if (!attachment.contentId || !attachment.mimeType.toLowerCase().startsWith('image/')) continue
    const key = attachment.contentId.replace(/[<>]/g, '').trim().toLowerCase()
    if (!key || urls[key]) continue
    const blob = new Blob([new Uint8Array(attachment.content)], { type: attachment.mimeType })
    urls[key] = URL.createObjectURL(blob)
  }
  return urls
}

export function releaseObjectUrls(urls: Record<string, string>): void {
  for (const url of Object.values(urls)) URL.revokeObjectURL(url)
}
