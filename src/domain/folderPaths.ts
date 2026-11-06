import type { FolderPath } from './workspace'

export type MarkdownReferenceSyntax = 'markdown' | 'obsidian'
export type ParsedLocalReference =
  | { kind: 'local'; path: FolderPath; query: string; fragment: string }
  | { kind: 'same-document'; fragment: string }
  | { kind: 'external'; href: string }
  | { kind: 'blocked'; reason: string }
  | { kind: 'invalid'; reason: string }

export type ResolvedFolderPath =
  | { kind: 'local'; path: FolderPath; query: string; fragment: string }
  | { kind: 'same-document'; fragment: string }
  | { kind: 'external'; href: string }
  | { kind: 'blocked'; reason: string }
  | { kind: 'invalid'; reason: string }

export function parseLocalReference(raw: string, syntax: MarkdownReferenceSyntax = 'markdown'): ParsedLocalReference {
  const value = raw.trim()
  if (!value) return { kind: 'invalid', reason: '참조 경로가 비어 있습니다.' }
  if (value.startsWith('#')) return { kind: 'same-document', fragment: decodeSuffix(value.slice(1)) }
  if (/^(?:\\\\|\/\/)/u.test(value)) {
    if (value.startsWith('//') && !value.startsWith('///')) return { kind: 'external', href: `https:${value}` }
    return { kind: 'blocked', reason: '네트워크 공유 경로는 폴더에서 열 수 없습니다.' }
  }
  if (/^[a-z][a-z\d+.-]*:/iu.test(value)) {
    const scheme = value.match(/^([a-z][a-z\d+.-]*):/iu)?.[1]?.toLowerCase()
    if (scheme === 'http' || scheme === 'https') return { kind: 'external', href: value }
    return { kind: 'blocked', reason: '이 주소는 폴더 파일로 열 수 없습니다.' }
  }
  if (/^[a-z]:[\\/]/iu.test(value)) return { kind: 'blocked', reason: '드라이브 경로는 폴더에서 열 수 없습니다.' }

  let pathAndSuffix = value
  let fragment = ''
  let query = ''
  const hashAt = pathAndSuffix.indexOf('#')
  if (hashAt >= 0) { fragment = decodeSuffix(pathAndSuffix.slice(hashAt + 1)); pathAndSuffix = pathAndSuffix.slice(0, hashAt) }
  const queryAt = pathAndSuffix.indexOf('?')
  if (queryAt >= 0) { query = decodeSuffix(pathAndSuffix.slice(queryAt + 1)); pathAndSuffix = pathAndSuffix.slice(0, queryAt) }
  if (syntax === 'obsidian' && pathAndSuffix.startsWith('^')) return { kind: 'invalid', reason: '블록 참조에는 파일 경로가 필요합니다.' }

  const segments: string[] = []
  for (const segment of pathAndSuffix.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') { segments.push('..'); continue }
    let decoded: string
    try { decoded = decodeURIComponent(segment) } catch { return { kind: 'invalid', reason: '경로 인코딩이 올바르지 않습니다.' } }
    if (decoded.includes('/') || decoded.includes('\\') || decoded.includes('\0')) return { kind: 'blocked', reason: '경로에 사용할 수 없는 문자가 있습니다.' }
    segments.push(decoded)
  }
  return { kind: 'local', path: segments.join('/'), query, fragment }
}

export function resolveFolderPath(ownerPath: FolderPath, reference: string, syntax: MarkdownReferenceSyntax = 'markdown'): ResolvedFolderPath {
  const parsed = parseLocalReference(reference, syntax)
  if (parsed.kind !== 'local') return parsed
  const rootBased = reference.startsWith('/') && !reference.startsWith('//')
  const obsidianRelative = syntax === 'obsidian' && (/^\.\.?\//u.test(reference))
  const base = rootBased || (syntax === 'obsidian' && !obsidianRelative && !reference.startsWith('/'))
    ? []
    : ownerPath.split('/').slice(0, -1).filter(Boolean)
  for (const segment of parsed.path.split('/')) {
    if (!segment) continue
    if (segment === '..') {
      if (!base.length) return { kind: 'blocked', reason: '폴더 바깥 경로는 열 수 없습니다.' }
      base.pop()
    } else base.push(segment)
  }
  const path = base.join('/')
  if (!path) return { kind: 'invalid', reason: '파일 경로가 비어 있습니다.' }
  return { kind: 'local', path, query: parsed.query, fragment: parsed.fragment }
}

function decodeSuffix(value: string): string {
  try { return decodeURIComponent(value.replace(/\+/gu, '%2B')) } catch { return value }
}
