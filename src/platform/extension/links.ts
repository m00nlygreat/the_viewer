import { getFormat, FORMAT_MIME, GENERIC_FILE_MIME_TYPES } from '../fileTypes'
import type { Format, PickedFile } from '../fileTypes'
import { isLocalFileAccessAllowed } from './autoOpen'
import { assertInputFileSize, maxInputFileBytes } from '../../domain/inputPolicy'

export async function readRemoteLinkTicket(id: string): Promise<string | null> {
  const result = await chrome.storage.local.get(`link:${id}`)
  const ticket = result[`link:${id}`] as { url?: string; createdAt?: number } | undefined
  if (!ticket?.url || !ticket.createdAt || Date.now() - ticket.createdAt > 30 * 60 * 1000) return null
  return ticket.url
}

export async function deleteRemoteLinkTicket(id: string): Promise<void> { await chrome.storage.local.remove(`link:${id}`) }

export async function fetchAutoOpenedFile(source: string): Promise<PickedFile> {
  const url = new URL(source)
  if (url.protocol !== 'file:') return fetchRemoteLinkFile(source, { requestPermission: false })
  const format = getFormat(url.pathname)
  if (!format) throw new Error('지원 형식(.eml, .csv, .md, .ics, .vcf)이 아닙니다.')
  if (!await isLocalFileAccessAllowed()) throw new Error('Chrome 확장 세부정보에서 “파일 URL에 대한 액세스 허용”을 켜세요.')
  const response = await fetch(url.href)
  if (!response.ok) throw new Error('로컬 파일을 읽지 못했습니다. 파일 위치와 접근 권한을 확인하세요.')
  return { name: decodeUrlName(url), type: FORMAT_MIME[format], bytes: await readFileBytes(response) }
}

export async function fetchRemoteLinkFile(source: string, options: { requestPermission?: boolean } = {}): Promise<PickedFile> {
  const url = new URL(source)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('HTTP 또는 HTTPS 링크만 열 수 있습니다.')
  const originPattern = `${url.origin}/*`
  const hasPermission = await chrome.permissions.contains({ origins: [originPattern] })
  const allowed = hasPermission || (options.requestPermission !== false && await chrome.permissions.request({ origins: [originPattern] }))
  if (!allowed) throw new Error('사이트 권한을 허용하지 않았습니다. 링크 파일을 내려받아 직접 열 수 있습니다.')
  const response = await fetch(url.href, { credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' })
  if (!response.ok) throw new Error(`파일 요청 실패 (${response.status})`)
  const responseName = responseFilename(response.headers.get('content-disposition')) || decodeUrlName(url)
  const mimeType = response.headers.get('content-type') ?? ''
  const mime = mimeType.toLowerCase().split(';')[0].trim()
  const mimeFormat = getFormat('', mime)
  const nameFormat = getFormat(responseName) ?? getFormat(decodeUrlName(url))
  const genericMime = !mime || GENERIC_FILE_MIME_TYPES.includes(mime)
  const format = mimeFormat ?? (genericMime ? nameFormat : null)
  if (!format) throw new Error('지원 형식(.eml, .csv, .md, .ics, .vcf)이 아닙니다.')
  const name = ensureFormatExtension(responseName, format)
  return { name, type: mimeType || FORMAT_MIME[format as Format], bytes: await readFileBytes(response) }
}

async function readFileBytes(response: Response): Promise<Uint8Array> {
  const maximum = maxInputFileBytes(navigator.userAgent)
  const length = Number(response.headers.get('content-length') ?? 0)
  if (length > maximum) assertInputFileSize('다운로드', length, navigator.userAgent)
  const reader = response.body?.getReader()
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    assertInputFileSize('다운로드', bytes.byteLength, navigator.userAgent)
    return bytes
  }
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maximum) {
        await reader.cancel()
        assertInputFileSize('다운로드', total, navigator.userAgent)
      }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return bytes
}

function decodeUrlName(url: URL): string {
  const name = url.pathname.split('/').filter(Boolean).pop() || 'download'
  try { return decodeURIComponent(name) } catch { return name }
}

function responseFilename(disposition: string | null): string | null {
  if (!disposition) return null
  const extended = disposition.match(/(?:^|;)\s*filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1]?.trim().replace(/^"|"$/g, '')
  if (extended) {
    try { return safeFilename(decodeURIComponent(extended)) } catch { return safeFilename(extended) }
  }
  const ordinary = disposition.match(/(?:^|;)\s*filename\s*=\s*(?:"([^"]*)"|([^;]*))/i)
  const name = ordinary?.[1] ?? ordinary?.[2]?.trim()
  return name ? safeFilename(name) : null
}

function safeFilename(name: string): string {
  return name.split(/[\\/]/).pop()?.replace(/[\u0000-\u001f\u007f]/g, '').trim() || 'download'
}

function ensureFormatExtension(name: string, format: Format): string {
  const safeName = safeFilename(name)
  if (safeName.toLowerCase().endsWith(`.${format}`)) return safeName
  const dot = safeName.lastIndexOf('.')
  const base = (dot > 0 ? safeName.slice(0, dot) : safeName).replace(/^\.+/, '') || 'download'
  return `${base}.${format}`
}
