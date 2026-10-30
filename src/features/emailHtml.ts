import DOMPurify from 'dompurify'

export function resolveInlineImageContentIds(html: string, imageUrls: Readonly<Record<string, string>>): string {
  return html.replace(/\bsrc=(['"])cid:([^'"]+)\1/giu, (_match, _quote: string, value: string) => {
    let key = value.trim().replace(/[<>]/g, '')
    try { key = decodeURIComponent(key) } catch { /* Keep the literal Content-ID when it is not percent encoded. */ }
    const url = imageUrls[key.toLowerCase()]
    return url ? `src="${url}"` : 'src=""'
  })
}

export function sanitizeEmailHtml(html: string): string {
  const sanitized = DOMPurify.sanitize(html, {
    FORBID_TAGS: ['script', 'style', 'link', 'iframe', 'object', 'embed', 'form', 'input', 'video', 'audio'],
    FORBID_ATTR: ['style', 'srcset', 'background', 'action', 'formaction'],
    ALLOWED_URI_REGEXP: /^(?:blob:|data:image\/(?:png|gif|jpeg|webp);base64,)/i
  })

  // DOMPurify deliberately treats some image data URLs as safe by default. Apply the email viewer's
  // narrower raster-only policy after sanitization so SVG data URLs cannot become active content.
  const parsed = new DOMParser().parseFromString(sanitized, 'text/html')
  for (const image of parsed.querySelectorAll('img[src]')) {
    const source = image.getAttribute('src')?.trim() ?? ''
    if (!/^blob:[^\s]+$/iu.test(source) && !/^data:image\/(?:png|gif|jpeg|webp);base64,[a-z0-9+/]+={0,2}$/iu.test(source)) {
      image.removeAttribute('src')
    }
  }
  return parsed.body.innerHTML
}

export function prepareEmailHtml(html: string, imageUrls: Readonly<Record<string, string>>): string {
  return sanitizeEmailHtml(resolveInlineImageContentIds(html, imageUrls))
}
