import type { ContactCard, ContactModel, VCardProperty } from './types'

const splitOutsideQuotes = (value: string, separator: string): string[] => {
  const parts: string[] = []
  let current = ''
  let quoted = false
  let escaped = false
  for (const char of value) {
    if (escaped) { current += char; escaped = false; continue }
    if (char === '\\') { current += char; escaped = true; continue }
    if (char === '"') quoted = !quoted
    if (char === separator && !quoted) { parts.push(current); current = ''; continue }
    current += char
  }
  parts.push(current)
  return parts
}

export function unfoldVCard(source: string): string[] {
  const lines = source.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/)
  const unfolded: string[] = []
  for (const line of lines) {
    if (/^[ \t]/.test(line) && unfolded.length) unfolded[unfolded.length - 1] += line.slice(1)
    else if (line) unfolded.push(line)
  }
  return unfolded
}

function parseProperty(line: string): VCardProperty | null {
  const boundary = splitOutsideQuotes(line, ':')
  if (boundary.length < 2) return null
  const left = boundary.shift()!
  const value = boundary.join(':')
  const bits = splitOutsideQuotes(left, ';')
  const rawName = bits.shift() ?? ''
  const nameBits = rawName.split('.')
  const name = nameBits.pop()!.toUpperCase()
  return { name, group: nameBits.join('.') || undefined, params: bits.join(';'), value, raw: line }
}

function unescapeText(value: string): string {
  return value.replace(/\\([nN,;\\])/g, (_, char: string) => char.toLowerCase() === 'n' ? '\n' : char)
}

function paramLabel(params: string): string {
  const type = params.match(/(?:^|;)TYPE=("[^"]+"|[^;]+)/i)?.[1]?.replaceAll('"', '')
  return type?.split(',')[0] ?? '기타'
}

function cardFrom(properties: VCardProperty[], index: number): ContactCard {
  const first = (name: string) => properties.find((property) => property.name === name)?.value ?? ''
  const all = (name: string) => properties.filter((property) => property.name === name)
  const structuredName = first('N').split(';').map(unescapeText)
  const fullName = unescapeText(first('FN')) || [structuredName[1], structuredName[0]].filter(Boolean).join(' ')
  const versionText = first('VERSION')
  const version: ContactCard['version'] = versionText === '3.0' || versionText === '4.0' || versionText === '2.1' ? versionText : 'unknown'
  return {
    uid: first('UID') || `contact-${index}`,
    version,
    properties,
    fullName,
    familyName: structuredName[0] ?? '',
    givenName: structuredName[1] ?? '',
    organization: unescapeText(first('ORG').split(';')[0] ?? ''),
    title: unescapeText(first('TITLE')),
    phones: all('TEL').map((property) => ({ value: unescapeText(property.value.replace(/^tel:/i, '')), label: paramLabel(property.params) })),
    emails: all('EMAIL').map((property) => ({ value: unescapeText(property.value.replace(/^mailto:/i, '')), label: paramLabel(property.params) })),
    urls: all('URL').map((property) => unescapeText(property.value)),
    notes: unescapeText(first('NOTE'))
  }
}

export function parseVCF(source: string): ContactModel {
  const lines = unfoldVCard(source)
  const cards: ContactCard[] = []
  const diagnostics: string[] = []
  let current: VCardProperty[] | null = null
  for (const line of lines) {
    if (/^BEGIN:VCARD$/i.test(line)) { if (current) diagnostics.push('중첩된 BEGIN:VCARD가 있어 이전 연락처를 복구했습니다.'); current = []; continue }
    if (/^END:VCARD$/i.test(line)) {
      if (current) cards.push(cardFrom(current, cards.length + 1))
      current = null
      continue
    }
    if (current) {
      const property = parseProperty(line)
      if (property) current.push(property)
      else diagnostics.push('해석할 수 없는 vCard 속성을 원문에서 보존하지 못했습니다.')
    }
  }
  if (current?.length) { cards.push(cardFrom(current, cards.length + 1)); diagnostics.push('닫히지 않은 연락처를 파일 끝에서 복구했습니다.') }
  if (!cards.length) diagnostics.push('VCARD 레코드를 찾지 못했습니다.')
  return { cards, diagnostics }
}

function escapeText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;')
}

function foldLine(line: string): string {
  const chunks: string[] = []
  let current = ''
  let size = 0
  for (const char of line) {
    const bytes = new TextEncoder().encode(char).length
    if (size + bytes > 75) { chunks.push(current); current = ' '; size = 1 }
    current += char
    size += bytes
  }
  chunks.push(current)
  return chunks.join('\r\n')
}

function upsert(properties: VCardProperty[], name: string, value: string, params = ''): VCardProperty[] {
  const index = properties.findIndex((property) => property.name === name)
  if (!value) return properties.filter((property) => property.name !== name)
  const property = { name, params, value, raw: `${name}${params ? `;${params}` : ''}:${value}` }
  if (index < 0) return [...properties, property]
  return properties.map((entry, current) => current === index ? property : entry)
}

export function updateContact(model: ContactModel, uid: string, update: Partial<Pick<ContactCard, 'fullName' | 'givenName' | 'familyName' | 'organization' | 'title' | 'notes'>>): ContactModel {
  return {
    ...model,
    cards: model.cards.map((card) => {
      if (card.uid !== uid) return card
      let properties = [...card.properties]
      if (update.fullName !== undefined) properties = upsert(properties, 'FN', escapeText(update.fullName))
      if (update.givenName !== undefined || update.familyName !== undefined) {
        const family = escapeText(update.familyName ?? card.familyName)
        const given = escapeText(update.givenName ?? card.givenName)
        properties = upsert(properties, 'N', `${family};${given};;;`)
      }
      if (update.organization !== undefined) properties = upsert(properties, 'ORG', escapeText(update.organization))
      if (update.title !== undefined) properties = upsert(properties, 'TITLE', escapeText(update.title))
      if (update.notes !== undefined) properties = upsert(properties, 'NOTE', escapeText(update.notes))
      return cardFrom(properties, 0)
    })
  }
}

export function setContactItems(model: ContactModel, uid: string, field: 'phones' | 'emails', items: Array<{ value: string; label: string }>): ContactModel {
  const propertyName = field === 'phones' ? 'TEL' : 'EMAIL'
  return {
    ...model,
    cards: model.cards.map((card) => {
      if (card.uid !== uid) return card
      const previous = card.properties.filter((property) => property.name === propertyName)
      let cursor = 0
      const properties = card.properties.flatMap((property) => {
        if (property.name !== propertyName) return [property]
        const item = items[cursor]
        const old = previous[cursor]
        cursor += 1
        if (!item?.value.trim()) return []
        const label = item.label.replace(/[^a-zA-Z0-9,-]/g, '') || paramLabel(old?.params ?? '')
        const value = escapeText(item.value.trim())
        const params = label === '기타' ? old?.params ?? '' : `TYPE=${label}`
        return [{ name: propertyName, params, value, raw: `${propertyName}${params ? `;${params}` : ''}:${value}` }]
      })
      const existingCount = previous.length
      const extras = items.slice(existingCount).filter((item) => item.value.trim()).map((item) => {
        const label = item.label.replace(/[^a-zA-Z0-9,-]/g, '') || 'OTHER'
        const value = escapeText(item.value.trim())
        return { name: propertyName, params: `TYPE=${label}`, value, raw: `${propertyName};TYPE=${label}:${value}` }
      })
      return cardFrom([...properties, ...extras], 0)
    })
  }
}

export function addContact(model: ContactModel): ContactModel {
  const version = model.cards[0]?.version === '3.0' ? '3.0' : '4.0'
  const uid = `urn:uuid:${crypto.randomUUID()}`
  const properties = [
    { name: 'VERSION', params: '', value: version, raw: `VERSION:${version}` },
    { name: 'FN', params: '', value: '', raw: 'FN:' },
    { name: 'N', params: '', value: ';;;;', raw: 'N:;;;;' },
    { name: 'UID', params: '', value: uid, raw: `UID:${uid}` }
  ]
  return { ...model, cards: [...model.cards, cardFrom(properties, model.cards.length + 1)] }
}

export function removeContact(model: ContactModel, uid: string): ContactModel {
  return { ...model, cards: model.cards.filter((card) => card.uid !== uid) }
}

export function serializeVCF(model: ContactModel): string {
  return model.cards.map((card) => `BEGIN:VCARD\r\n${card.properties.map((property) => foldLine(property.raw)).join('\r\n')}\r\nEND:VCARD`).join('\r\n') + '\r\n'
}
