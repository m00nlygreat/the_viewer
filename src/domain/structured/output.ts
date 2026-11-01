import type { StructuredContainer, StructuredFormat, StructuredModel, StructuredNode, StructuredOutput, StructuredScalar } from './model'

export function isoDateKind(value: string): 'offset-date-time' | 'local-date-time' | 'local-date' | 'local-time' | null {
  const match = value.match(/^(?:(\d{4})-(\d{2})-(\d{2}))?(?:[Tt ]?(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?([Zz]|[+-]\d{2}:\d{2})?$/)
  if (!match || (!match[1] && !match[4]) || (match[1] && match[4] && !/[Tt ]/.test(value))) return null
  if (match[1]) {
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3])
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
    const last = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0
    if (month < 1 || month > 12 || day < 1 || day > last) return null
  }
  if (match[4] && (Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6] ?? 0) > 59)) return null
  if (match[7] && match[7].toUpperCase() !== 'Z' && (Number(match[7].slice(1, 3)) > 23 || Number(match[7].slice(4)) > 59)) return null
  if (!match[4] && match[7]) return null
  if (!match[1]) return 'local-time'
  if (!match[4]) return 'local-date'
  return match[7] ? 'offset-date-time' : 'local-date-time'
}

function normalizedNumber(node: StructuredScalar): string | null {
  const raw = node.raw.replaceAll('_', '')
  if (/^[+-]?(?:inf|nan|\.inf|\.nan)$/i.test(raw)) return null
  try {
    if (/^[+-]?0[xob][0-9a-f]+$/i.test(raw)) return (BigInt(raw.replace(/^[+-]/, '')) * (raw.startsWith('-') ? -1n : 1n)).toString()
    if (/^[+-]?\d+$/.test(raw)) {
      const negative = raw.startsWith('-')
      const digits = raw.replace(/^[+-]?0*(?=\d)/, '')
      return `${negative ? '-' : ''}${digits}`
    }
  } catch { return null }
  const clean = raw.replace(/^\+/, '').replace(/^(-?)\./, (_match, sign: string) => `${sign}0.`).replace(/\.(?=[eE]|$)/, '.0').replace(/^(-?)0+(?=\d)/, '$1')
  return /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(clean) ? clean : null
}
function isTomlIntegerInRange(value: string): boolean {
  const negative = value.startsWith('-')
  const digits = negative ? value.slice(1) : value
  const bound = negative ? '9223372036854775808' : '9223372036854775807'
  return digits.length < bound.length || (digits.length === bound.length && digits <= bound)
}
const pathKey = (path: string, key: string) => /^[A-Za-z_$][\w$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`
function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next < 0xdc00 || next > 0xdfff || Number.isNaN(next)) return true
      index++
    } else if (code >= 0xdc00 && code <= 0xdfff) return true
  }
  return false
}
const tomlString = (value: string) => JSON.stringify(value).replace(/\u007f/g, '\\u007F')
const tomlKey = (key: string) => /^[A-Za-z0-9_-]+$/.test(key) ? key : tomlString(key)

export function outputStructured(model: StructuredModel, format: StructuredFormat): StructuredOutput {
  const issues: string[] = []
  const omissions: string[] = []
  const seenIssues = new Set<string>()
  const issue = (message: string) => { if (!seenIssues.has(message)) { issues.push(message); seenIssues.add(message) } }
  if (!model.root) return { preview: '', text: null, issues: ['문서 내용이 없습니다.'], omissions }
  if (model.unsupported) issue(model.unsupported)

  const render = (node: StructuredNode | null, path: string, depth: number): string => {
    if (!node) { issue(`빈 자리 ${path}`); return '비어 있음' }
    if (node.kind === 'scalar') {
      if (node.dataType === 'null') {
        if (format === 'toml') { issue(`없음 불가 ${path}`); return '없음 불가' }
        return 'null'
      }
      if (node.dataType === 'boolean') return node.raw
      if (node.dataType === 'number') {
        if (format === 'yaml' && node.sourceFormat === 'yaml') return node.raw
        const number = normalizedNumber(node)
        if (!number) {
          if (format === 'toml' && node.sourceFormat === 'toml') return node.raw
          if (format === 'toml' && /^[+-]?\.(?:inf|nan)$/i.test(node.raw)) return node.raw.replace('.', '')
          if (format === 'yaml' && /^(?:[+-]?)(?:\.?inf|\.?nan)$/i.test(node.raw)) return node.raw.replace(/^(\+|-)?\.?/, '$1.')
          issue(`표현할 수 없는 숫자 ${path}`); return node.raw
        }
        if (format === 'toml' && /^-?\d+$/.test(number) && !isTomlIntegerInRange(number)) issue(`TOML 정수 범위를 벗어났습니다 ${path}`)
        if (format === 'toml' && /[.e]/i.test(number)) {
          const approximation = Number(number)
          const isZero = /^-?0(?:\.0+)?(?:e[+-]?\d+)?$/i.test(number)
          if (!Number.isFinite(approximation) || (approximation === 0 && !isZero)) issue(`TOML 실수 범위를 벗어났습니다 ${path}`)
        }
        return format === 'toml' && node.sourceFormat === 'toml' ? node.raw : number
      }
      if (format === 'toml') {
        const kind = isoDateKind(node.raw)
        if (node.dataType === 'native-date-time' || (node.dataType === 'string' && kind && node.sourceFormat !== 'toml')) {
          if (kind === 'local-time' && /(?:Z|[+-]\d\d:\d\d)$/i.test(node.raw)) { issue(`시간대가 있는 시간은 TOML에 표현할 수 없습니다 ${path}`); return node.raw }
          return node.raw.replace(/^(\d{4}-\d\d-\d\d[Tt ]|)(\d\d:\d\d)(?=(?:Z|[+-]\d\d:\d\d)?$)/i, '$1$2:00')
        }
        if (hasUnpairedSurrogate(node.raw)) issue(`TOML에 표현할 수 없는 문자가 있습니다 ${path}`)
        return tomlString(node.raw)
      }
      return JSON.stringify(node.raw)
    }
    if (node.kind === 'object') {
      const keys = new Set<string>()
      const rows: string[] = []
      for (const item of node.items) {
        const key = item.key ?? ''
        const childPath = pathKey(path, key)
        if (item.nameMissing) issue(`이름 없음 ${childPath}`)
        if (keys.has(key) && format !== 'json') issue(`같은 이름 ${childPath}`)
        keys.add(key)
        if (format === 'toml' && item.node?.kind === 'scalar' && item.node.dataType === 'null') { if (!omissions.includes(childPath)) omissions.push(childPath); continue }
        if (format === 'toml' && hasUnpairedSurrogate(key)) issue(`TOML에 표현할 수 없는 이름이 있습니다 ${childPath}`)
        const value = render(item.node, childPath, depth + 1)
        if (format === 'toml') rows.push(`${tomlKey(key)} = ${value}`)
        else if (format === 'yaml') rows.push(`${JSON.stringify(key)}: ${value}`)
        else rows.push(`${JSON.stringify(key)}: ${value}`)
      }
      if (!rows.length) return format === 'toml' && depth === 0 ? '' : '{}'
      if (format === 'toml') return depth === 0 ? rows.join('\n') : `{ ${rows.join(', ')} }`
      if (format === 'yaml') return `{ ${rows.join(', ')} }`
      const indent = '  '.repeat(depth)
      return `{\n${rows.map((row) => `${indent}  ${row}`).join(',\n')}\n${indent}}`
    }
    const values = node.items.map((item, index) => render(item.node, `${path}[${index}]`, depth + 1))
    if (!values.length) return '[]'
    if (format !== 'json') return `[${values.join(', ')}]`
    const indent = '  '.repeat(depth)
    return `[\n${values.map((value) => `${indent}  ${value}`).join(',\n')}\n${indent}]`
  }
  if (format === 'toml' && model.root.kind !== 'object') issue('TOML은 최상위 객체가 필요합니다.')
  let preview = render(model.root, '$', 0)
  if (format === 'yaml') {
    const yamlKey = (key: string) => /^[A-Za-z_$][\w$-]*$/.test(key) && !/^(?:true|false|null|yes|no)$/i.test(key) ? key : JSON.stringify(key)
    const block = (node: StructuredNode, path: string, depth: number): string => {
      if (node.kind === 'scalar' || !node.items.length) return `${'  '.repeat(depth)}${render(node, path, depth)}`
      const indent = '  '.repeat(depth)
      return node.items.map((item, index) => {
        const childPath = node.kind === 'array' ? `${path}[${index}]` : pathKey(path, item.key ?? '')
        const prefix = node.kind === 'array' ? '-' : `${yamlKey(item.key ?? '')}:`
        if (item.node && item.node.kind !== 'scalar' && item.node.items.length) return `${indent}${prefix}\n${block(item.node, childPath, depth + 1)}`
        return `${indent}${prefix} ${render(item.node, childPath, depth + 1)}`
      }).join('\n')
    }
    preview = block(model.root, '$', 0)
  } else if (format === 'toml' && model.root.kind === 'object') {
    const sections: string[] = []
    const table = (node: StructuredContainer, path: string[], header?: string) => {
      const lines: string[] = header ? [header] : []
      const later: Array<() => void> = []
      for (const item of node.items) {
        const key = item.key ?? '', child = item.node, childPath = [...path, key]
        if (child?.kind === 'scalar' && child.dataType === 'null') continue
        if (child?.kind === 'object' && child.items.length) later.push(() => table(child, childPath, `[${childPath.map(tomlKey).join('.')}]`))
        else if (child?.kind === 'array' && child.items.length && child.items.every((entry) => entry.node?.kind === 'object')) {
          for (const entry of child.items) later.push(() => table(entry.node as StructuredContainer, childPath, `[[${childPath.map(tomlKey).join('.')}]]`))
        } else lines.push(`${tomlKey(key)} = ${render(child, `$${childPath.map((part) => `.${part}`).join('')}`, path.length + 1)}`)
      }
      if (lines.length) sections.push(lines.join('\n'))
      later.forEach((next) => next())
    }
    table(model.root, [])
    preview = sections.join('\n\n')
  }
  return { preview, text: issues.length ? null : preview, issues, omissions }
}

export function serializeStructured(model: StructuredModel, format: StructuredFormat): string {
  if (model.unsupported) throw new Error(model.unsupported)
  const result = outputStructured(model, format)
  if (!result.text && result.text !== '') throw new Error(result.issues[0] ?? '구조를 출력할 수 없습니다.')
  if (format === 'toml' && result.omissions.length) throw new Error(`TOML에서 없음 값을 저장할 수 없습니다: ${result.omissions.join(', ')}`)
  return result.text
}

export interface Inspection { label: string; path: string }
export function inspectStructured(model: StructuredModel): Inspection[] {
  const result: Inspection[] = []
  const visit = (node: StructuredNode | null, path: string) => {
    if (!node) { result.push({ label: '빈 자리', path }); return }
    if (node.kind === 'scalar') return
    const counts = new Map<string, number>()
    const reported = new Set<string>()
    if (node.kind === 'object') for (const item of node.items) counts.set(item.key ?? '', (counts.get(item.key ?? '') ?? 0) + 1)
    node.items.forEach((item, index) => {
      const child = node.kind === 'array' ? `${path}[${index}]` : pathKey(path, item.key ?? '')
      if (item.nameMissing) result.push({ label: '이름 없음', path: child })
      else if (node.kind === 'object' && (counts.get(item.key ?? '') ?? 0) > 1 && !reported.has(item.key ?? '')) { result.push({ label: '같은 이름', path: child }); reported.add(item.key ?? '') }
      visit(item.node, child)
    })
  }
  visit(model.root, '$')
  if (model.loose.length) result.push({ label: '연결 안 된 블록', path: `${model.loose.length}개` })
  return result
}

export type SchemaFieldIcon = 'object' | 'array' | 'text' | 'number' | 'boolean' | 'date' | 'null'
export interface SchemaDefinition { name: string; count: number; fields: { key: string; optional: boolean; icon?: SchemaFieldIcon }[] }
export function inferSchemas(model: StructuredModel): SchemaDefinition[] {
  const entries: { name: string; keys: string[]; node: StructuredContainer }[] = []
  const visit = (node: StructuredNode | null, name: string) => {
    if (!node || node.kind === 'scalar') return
    if (node.kind === 'object' && node !== model.root && node.items.some((item) => item.key)) entries.push({ name: name || '객체', keys: [...new Set(node.items.map((item) => item.key ?? '').filter(Boolean))], node })
    for (const item of node.items) visit(item.node, node.kind === 'object' ? item.key ?? '' : name)
  }
  visit(model.root, '')
  for (const loose of model.loose) visit(loose.node ?? loose.slot?.node ?? null, loose.slot?.key ?? '')
  const groups: typeof entries[] = []
  for (const entry of entries) {
    const group = groups.find((candidates) => {
      const other = [...candidates].sort((a, b) => b.keys.length - a.keys.length)[0].keys
      const intersection = entry.keys.filter((key) => other.includes(key)).length
      return intersection / new Set([...entry.keys, ...other]).size >= 0.5
    })
    if (group) group.push(entry); else groups.push([entry])
  }
  return groups.map((group) => {
    const representative = [...group].sort((a, b) => b.keys.length - a.keys.length)[0]
    const counts = new Map<string, number>()
    for (const item of group) counts.set(item.name, (counts.get(item.name) ?? 0) + 1)
    const name = [...counts].sort((a, b) => b[1] - a[1])[0][0]
    return { name, count: group.length, fields: representative.node.items.filter((item) => Boolean(item.key)).map((item) => {
      const key = item.key!
      const child = item.node
      let icon: SchemaFieldIcon | undefined
      if (child?.kind === 'object' || child?.kind === 'array') icon = child.kind
      else if (child?.kind === 'scalar') icon = child.dataType === 'native-date-time' || (child.dataType === 'string' && isoDateKind(child.raw)) ? 'date' : child.dataType === 'string' ? 'text' : child.dataType
      return { key, optional: group.some((member) => !member.keys.includes(key)), icon }
    }) }
  })
}

export function uniqueKey(node: StructuredContainer, base = 'key'): string {
  const keys = new Set(node.items.map((item) => item.key))
  if (!keys.has(base)) return base
  let suffix = 2
  while (keys.has(`${base}${suffix}`)) suffix++
  return `${base}${suffix}`
}
