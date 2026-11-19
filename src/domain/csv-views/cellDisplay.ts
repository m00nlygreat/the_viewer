export function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value)
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname || url.username || url.password) return null
    return url.href
  } catch { return null }
}

export function safeHttpsImageUrl(value: string): string | null {
  const safeUrl = safeHttpUrl(value)
  return safeUrl?.startsWith('https://') ? safeUrl : null
}

export function isSupportedInlineImageDataUrl(value: string): boolean {
  if (!value.startsWith('data:')) return false
  const comma = value.indexOf(',')
  if (comma < 0 || comma === value.length - 1) return false
  const metadata = value.slice(0, comma)
  return /^data:image\/(?:png|jpeg|gif|webp)(?:;[^;,]+)*$/iu.test(metadata)
}
