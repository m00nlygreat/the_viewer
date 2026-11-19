import type { DocumentSourceLocation } from './types'

export const MAX_SOURCE_URL_LENGTH = 16_384

export function isSourceUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_SOURCE_URL_LENGTH) return false
  try {
    const protocol = new URL(value).protocol
    return protocol === 'http:' || protocol === 'https:' || protocol === 'file:'
  } catch { return false }
}

export function isDocumentSourceLocation(value: unknown): value is DocumentSourceLocation {
  if (!isRecord(value)) return false
  if (value.kind === 'url') return isSourceUrl(value.url)
  return value.kind === 'local-file' || value.kind === 'shared'
}

export function displaySourceUrl(value: string): string {
  let url: URL
  try { url = new URL(value) } catch { return value }
  if (url.protocol !== 'file:') return value

  let path: string
  try { path = decodeURIComponent(url.pathname) } catch { path = url.pathname }
  path = path.replaceAll('/', '\\')
  if (url.hostname && url.hostname.toLowerCase() !== 'localhost') return `\\\\${url.hostname}${path}`
  if (/^\\[a-z]:\\/iu.test(path)) return path.slice(1)
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
