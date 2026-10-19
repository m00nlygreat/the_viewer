import { getFormat, FORMAT_MIME } from '../../domain/types'
import type { Format } from '../../domain/types'
import type { PickedFile } from '../FilePicker'

export async function readRemoteLinkTicket(id: string): Promise<string | null> {
  const result = await chrome.storage.local.get(`link:${id}`)
  const ticket = result[`link:${id}`] as { url?: string; createdAt?: number } | undefined
  if (!ticket?.url || !ticket.createdAt || Date.now() - ticket.createdAt > 30 * 60 * 1000) return null
  return ticket.url
}

export async function deleteRemoteLinkTicket(id: string): Promise<void> { await chrome.storage.local.remove(`link:${id}`) }

export async function fetchRemoteLinkFile(source: string): Promise<PickedFile> {
  const url = new URL(source)
  if (url.protocol !== 'https:') throw new Error('HTTPS 링크만 열 수 있습니다.')
  const originPattern = `${url.origin}/*`
  const allowed = await chrome.permissions.request({ origins: [originPattern] })
  if (!allowed) throw new Error('사이트 권한을 허용하지 않았습니다. 링크 파일을 내려받아 직접 열 수 있습니다.')
  const response = await fetch(url.href, { credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' })
  if (!response.ok) throw new Error(`파일 요청 실패 (${response.status})`)
  const maximum = /Mobi|Android/i.test(navigator.userAgent) ? 20 * 1024 * 1024 : 50 * 1024 * 1024
  const length = Number(response.headers.get('content-length') ?? 0)
  if (length > maximum) throw new Error('파일 크기가 기기별 제한을 초과합니다.')
  const name = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || 'download')
  const mimeType = response.headers.get('content-type') ?? ''
  const format = getFormat(name, mimeType)
  if (!format) throw new Error('지원 형식(.eml, .csv, .md, .ics, .vcf)이 아닙니다.')
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > maximum) throw new Error('파일 크기가 기기별 제한을 초과합니다.')
  return { name, type: mimeType || FORMAT_MIME[format as Format], bytes }
}
