import { CSV_POLICY } from './policy'
import type {
  CsvCell, CsvColumnBase, CsvColumnDefinition, CsvColumnSample, CsvColumnType, CsvDateFormat,
  CsvDecimalParse, CsvInvalidCode
} from './model'

const EMPTY: CsvCell = { state: 'empty' }
const MISSING: CsvCell = { state: 'missing' }
const ASCII_TRIM = /^[ \t]+|[ \t]+$/g

export function createDefaultColumn(type: CsvColumnType, base: CsvColumnBase, sample: CsvColumnSample | null): CsvColumnDefinition {
  const normalizedBase = { ...base, nullMarkers: [...base.nullMarkers], allowSurroundingSpace: base.allowSurroundingSpace }
  switch (type) {
    case 'text': return { ...normalizedBase, type, parse: {}, display: { as: 'plain' } }
    case 'integer': return { ...normalizedBase, type, parse: { allowPlusSign: false, thousandsSeparator: null, allowFullWidthDigits: false, allowExponent: false }, display: defaultNumberDisplay(0) }
    case 'decimal': return { ...normalizedBase, type, parse: { precision: CSV_POLICY.maxDigits, scale: inferScale(sample), decimalSeparator: '.', thousandsSeparator: null, currencySymbols: [], percentInput: 'reject', allowBareFraction: false, allowExponent: false }, display: defaultNumberDisplay('scale') }
    case 'boolean': return { ...normalizedBase, type, parse: { trueValues: ['true'], falseValues: ['false'], ignoreCase: 'ascii' }, display: { as: 'check', trueLabel: '참', falseLabel: '거짓' } }
    case 'date': return { ...normalizedBase, type, parse: { formats: ['YYYY-MM-DD'] }, display: { pattern: 'iso' } }
    case 'datetime': return { ...normalizedBase, type, parse: { offset: { kind: 'require' }, allowTwelveHour: false, allowDateOnly: false }, display: { zone: { kind: 'source' }, seconds: true } }
    case 'select': return { ...normalizedBase, type, parse: { options: [], matching: 'exact', closed: false }, display: { as: 'chip' } }
    case 'multiSelect': throw new Error('다중 선택 타입은 구분자를 지정한 뒤 설정해야 합니다.')
  }
}

export function parseCell(column: CsvColumnDefinition, raw: string | undefined): CsvCell {
  if (raw === undefined) return MISSING
  if (raw === '') return EMPTY
  if (column.nullMarkers.includes(raw)) return { state: 'null-marker', raw }
  let value = raw
  if (column.type !== 'text') {
    if (column.allowSurroundingSpace) value = value.replace(ASCII_TRIM, '')
    else if (value !== value.replace(ASCII_TRIM, '')) return invalid(raw, 'whitespace')
    if (value === '') return invalid(raw, 'syntax')
  }
  const parsed = parseTypedValue(column, value)
  return parsed.ok ? { state: 'value', raw, value: parsed.value } : invalid(raw, parsed.code)
}

export function parseConstant(column: CsvColumnDefinition, value: string): CsvCell {
  return parseCell(column, value)
}

function parseTypedValue(column: CsvColumnDefinition, raw: string): { ok: true; value: string | boolean | string[] } | { ok: false; code: CsvInvalidCode } {
  switch (column.type) {
    case 'text': return { ok: true, value: raw }
    case 'integer': {
      let input = column.parse.allowFullWidthDigits ? fullWidthToAscii(raw) : raw
      const sign = column.parse.allowPlusSign ? '[+-]?' : '-?'
      const exponent = column.parse.allowExponent ? '(?:[eE][+-]?\\d+)?' : ''
      const separator = column.parse.thousandsSeparator
      if (separator && input.includes(separator)) {
        const grouped = validateIntegerGroups(input, separator, column.parse.allowPlusSign)
        if (!grouped.ok) return grouped
        input = grouped.value
      }
      if (!new RegExp(`^${sign}\\d+${exponent}$`, 'u').test(input)) return { ok: false, code: 'syntax' }
      const expanded = expandExponent(input)
      if (!expanded) return { ok: false, code: 'syntax' }
      if (expanded.includes('.')) return { ok: false, code: 'syntax' }
      const digits = expanded.replace(/^[+-]/u, '').replace(/^0+/u, '') || '0'
      if (digits.length > CSV_POLICY.maxDigits) return { ok: false, code: 'range' }
      const negative = expanded.startsWith('-') && digits !== '0'
      return { ok: true, value: `${negative ? '-' : ''}${digits}` }
    }
    case 'decimal': return parseDecimal(column.parse, raw)
    case 'boolean': {
      const key = column.parse.ignoreCase === 'ascii' ? asciiLower(raw) : raw
      const trueMatch = column.parse.trueValues.some((candidate) => (column.parse.ignoreCase === 'ascii' ? asciiLower(candidate) : candidate) === key)
      const falseMatch = column.parse.falseValues.some((candidate) => (column.parse.ignoreCase === 'ascii' ? asciiLower(candidate) : candidate) === key)
      if (trueMatch === falseMatch) return { ok: false, code: 'syntax' }
      return { ok: true, value: trueMatch }
    }
    case 'date': {
      const date = parseDate(raw, column.parse.formats)
      return date ? { ok: true, value: date } : { ok: false, code: 'date' }
    }
    case 'datetime': return parseDateTime(column.parse, raw)
    case 'select': return parseSelect(column.parse, raw)
    case 'multiSelect': {
      if (!column.parse.separator) return { ok: false, code: 'syntax' }
      const parts = raw.split(column.parse.separator)
      if (parts.some((part) => part === '')) return { ok: false, code: 'empty-item' }
      const mapped: string[] = []
      for (const part of parts) {
        const item = parseSelect(column.parse, part)
        if (!item.ok) return item
        const key = String(item.value)
        if (column.parse.duplicates === 'keep' || !mapped.includes(key)) mapped.push(key)
      }
      return { ok: true, value: mapped }
    }
  }
}

function defaultNumberDisplay(fractionDigits: 'scale' | number) {
  return { grouping: true, fractionDigits, style: { kind: 'plain' as const }, negative: 'minus' as const }
}

function inferScale(sample: CsvColumnSample | null): number {
  if (!sample) return 0
  let scale = 0
  for (const raw of sample.raws) {
    if (raw === undefined || raw === '') continue
    const match = /^-?\d+\.(\d+)$/u.exec(raw)
    if (match) scale = Math.max(scale, match[1]!.length)
  }
  return scale
}

function parseDecimal(rule: CsvDecimalParse, raw: string): { ok: true; value: string } | { ok: false; code: CsvInvalidCode } {
  let input = raw
  let percent = false
  if (input.endsWith('%')) {
    if (rule.percentInput === 'reject' || input.indexOf('%') !== input.length - 1) return { ok: false, code: 'syntax' }
    percent = true
    input = input.slice(0, -1)
  }
  if (rule.currencySymbols.length) {
    const matches = rule.currencySymbols.filter((symbol) => input.startsWith(symbol) || input.endsWith(symbol))
    if (matches.length > 1) return { ok: false, code: 'syntax' }
    if (matches.length === 1) {
      const symbol = matches[0]!
      if (input.startsWith(symbol)) input = input.slice(symbol.length)
      else input = input.slice(0, -symbol.length)
    }
  }
  if (rule.thousandsSeparator && input.includes(rule.thousandsSeparator)) {
    if (rule.thousandsSeparator === rule.decimalSeparator) return { ok: false, code: 'thousands' }
    const grouped = validateDecimalGroups(input, rule.decimalSeparator, rule.thousandsSeparator)
    if (!grouped.ok) return grouped
    input = grouped.value
  }
  if (rule.decimalSeparator !== '.') {
    if (input.includes('.')) return { ok: false, code: 'syntax' }
    input = input.replace(rule.decimalSeparator, '.')
  }
  const exponentPart = rule.allowExponent ? '(?:[eE][+-]?\\d+)?' : ''
  const integer = rule.allowBareFraction ? '(?:\\d+)?' : '\\d+'
  const fraction = rule.allowBareFraction ? '(?:\\.\\d*)?' : '(?:\\.\\d+)?'
  if (!new RegExp(`^-?${integer}${fraction}${exponentPart}$`, 'u').test(input) || !/\d/u.test(input)) return { ok: false, code: 'syntax' }
  let expanded = expandExponent(input)
  if (!expanded) return { ok: false, code: 'syntax' }
  if (percent && rule.percentInput === 'divide-by-100') expanded = divideDecimalBy100(expanded)
  const negative = expanded.startsWith('-')
  const unsigned = expanded.replace(/^[+-]/u, '')
  const [integerPart = '', fractionPart = ''] = unsigned.split('.')
  const normalizedInteger = integerPart.replace(/^0+/u, '') || '0'
  const normalizedFraction = fractionPart.replace(/0+$/u, '')
  const scale = normalizedFraction.length
  const precision = (normalizedInteger === '0' ? 1 : normalizedInteger.length) + scale
  if (precision > rule.precision) return { ok: false, code: 'range' }
  if (scale > rule.scale) return { ok: false, code: 'scale' }
  const isZero = normalizedInteger === '0' && !normalizedFraction
  return { ok: true, value: `${negative && !isZero ? '-' : ''}${normalizedInteger}${normalizedFraction ? `.${normalizedFraction}` : ''}` }
}

function validateIntegerGroups(input: string, separator: string, allowPlus: boolean): { ok: true; value: string } | { ok: false; code: CsvInvalidCode } {
  const sign = input[0] === '-' || (allowPlus && input[0] === '+') ? input[0]! : ''
  const body = sign ? input.slice(1) : input
  const parts = body.split(separator)
  if (!/^\d{1,3}$/u.test(parts[0] ?? '') || parts.slice(1).some((part) => !/^\d{3}$/u.test(part))) return { ok: false, code: 'thousands' }
  return { ok: true, value: sign + parts.join('') }
}

function validateDecimalGroups(input: string, decimal: string, thousands: string): { ok: true; value: string } | { ok: false; code: CsvInvalidCode } {
  if (input.includes(thousands) && input.includes(decimal) && input.indexOf(thousands) > input.lastIndexOf(decimal)) return { ok: false, code: 'thousands' }
  const [integer = '', fraction, ...extra] = input.split(decimal)
  if (extra.length) return { ok: false, code: 'syntax' }
  const sign = integer[0] === '-' || integer[0] === '+' ? integer[0]! : ''
  const body = sign ? integer.slice(1) : integer
  const parts = body.split(thousands)
  if (!/^\d{1,3}$/u.test(parts[0] ?? '') || parts.slice(1).some((part) => !/^\d{3}$/u.test(part))) return { ok: false, code: 'thousands' }
  return { ok: true, value: sign + parts.join('') + (fraction === undefined ? '' : `${decimal}${fraction}`) }
}

function parseDate(raw: string, formats: CsvDateFormat[]): string | null {
  for (const format of formats) {
    const parts = dateParts(raw, format)
    if (!parts) continue
    const { year, month, day } = parts
    if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) continue
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }
  return null
}

function dateParts(raw: string, format: CsvDateFormat): { year: number; month: number; day: number } | null {
  const patterns: Record<CsvDateFormat, RegExp> = {
    'YYYY-MM-DD': /^(\d{4})-(\d{2})-(\d{2})$/u, 'YYYY/MM/DD': /^(\d{4})\/(\d{2})\/(\d{2})$/u,
    'YYYY.MM.DD': /^(\d{4})\.(\d{2})\.(\d{2})$/u, YYYYMMDD: /^(\d{4})(\d{2})(\d{2})$/u,
    'DD/MM/YYYY': /^(\d{2})\/(\d{2})\/(\d{4})$/u, 'MM/DD/YYYY': /^(\d{2})\/(\d{2})\/(\d{4})$/u,
    'DD.MM.YYYY': /^(\d{2})\.(\d{2})\.(\d{4})$/u
  }
  const match = patterns[format].exec(raw)
  if (!match) return null
  if (format.startsWith('DD/')) return { day: Number(match[1]), month: Number(match[2]), year: Number(match[3]) }
  if (format.startsWith('MM/')) return { month: Number(match[1]), day: Number(match[2]), year: Number(match[3]) }
  if (format.startsWith('DD.')) return { day: Number(match[1]), month: Number(match[2]), year: Number(match[3]) }
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
}

function parseDateTime(rule: Extract<CsvColumnDefinition, { type: 'datetime' }>['parse'], raw: string): { ok: true; value: string } | { ok: false; code: CsvInvalidCode } {
  let input = raw
  if (rule.allowTwelveHour) {
    const twelveHour = /^(\d{4}-\d{2}-\d{2})[T ](0?[1-9]|1[0-2]):(\d{2})(?::(\d{2})(\.\d{1,6})?)?[ \t]+(AM|PM)(Z|[+-]\d{2}:\d{2})?$/iu.exec(raw)
    if (twelveHour) {
      let hour = Number(twelveHour[2]) % 12
      if (twelveHour[6]!.toUpperCase() === 'PM') hour += 12
      input = `${twelveHour[1]}T${String(hour).padStart(2, '0')}:${twelveHour[3]}${twelveHour[4] ? `:${twelveHour[4]}${twelveHour[5] ?? ''}` : ''}${twelveHour[7] ?? ''}`
    }
  }
  const pattern = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?(Z|[+-]\d{2}:\d{2})?)?$/u
  const match = pattern.exec(input)
  if (!match) return { ok: false, code: 'date' }
  const date = parseDate(match[1]!, ['YYYY-MM-DD'])
  if (!date) return { ok: false, code: 'date' }
  const hasTime = match[2] !== undefined
  let suffix = match[6] ?? ''
  if (!hasTime) {
    if (!rule.allowDateOnly) return { ok: false, code: 'date' }
    if (rule.offset.kind !== 'assume') return { ok: false, code: 'offset-required' }
    match[2] = '00'; match[3] = '00'; match[4] = '00'; match[5] = ''; suffix = ''
  }
  const hour = Number(match[2]), minute = Number(match[3]), second = Number(match[4] ?? '0')
  const millisecond = Number((match[5] ?? '').padEnd(3, '0').slice(0, 3))
  if (hour > 23 || minute > 59 || second > 59) return { ok: false, code: 'date' }
  const local = { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)), day: Number(date.slice(8, 10)), hour, minute, second, millisecond }
  if (suffix) {
    const offset = parseOffset(suffix)
    if (offset === null) return { ok: false, code: 'date' }
    return { ok: true, value: isoWithOffset(local, offset) }
  }
  if (rule.offset.kind !== 'assume') return { ok: false, code: 'offset-required' }
  const matches = instantsForLocalTime(local, rule.offset.timeZone)
  if (matches.length === 0) return { ok: false, code: 'dst-gap' }
  if (matches.length > 1) return { ok: false, code: 'dst-overlap' }
  return { ok: true, value: new Date(matches[0]!).toISOString() }
}

function instantsForLocalTime(local: { year: number; month: number; day: number; hour: number; minute: number; second: number; millisecond: number }, timeZone: string): number[] {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    const nominal = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second, local.millisecond)
    const offsets = new Set<number>()
    for (const delta of [-36, -24, -12, 0, 12, 24, 36]) {
      const sample = new Date(nominal + delta * 3_600_000)
      const parts = formatter.formatToParts(sample)
      const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]))
      const represented = Date.UTC(Number(fields.year), Number(fields.month) - 1, Number(fields.day), Number(fields.hour), Number(fields.minute), Number(fields.second))
      offsets.add(represented - Math.floor(sample.getTime() / 1000) * 1000)
    }
    const matches: number[] = []
    for (const offset of offsets) {
      const candidate = nominal - offset
      const parts = formatter.formatToParts(new Date(candidate))
      const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]))
      if (Number(fields.year) === local.year && Number(fields.month) === local.month && Number(fields.day) === local.day && Number(fields.hour) === local.hour && Number(fields.minute) === local.minute && Number(fields.second) === local.second) matches.push(candidate)
    }
    return [...new Set(matches)].sort((a, b) => a - b)
  } catch { return [] }
}

function parseOffset(value: string): number | null {
  if (value === 'Z') return 0
  const match = /^([+-])(\d{2}):(\d{2})$/u.exec(value)
  if (!match) return null
  const hour = Number(match[2]), minute = Number(match[3])
  if (hour > 14 || minute > 59 || (hour === 14 && minute !== 0)) return null
  return (match[1] === '-' ? -1 : 1) * (hour * 60 + minute) * 60_000
}

function isoWithOffset(local: { year: number; month: number; day: number; hour: number; minute: number; second: number; millisecond: number }, offset: number): string {
  const instant = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second, local.millisecond) - offset
  return new Date(instant).toISOString()
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}
function asciiLower(value: string): string { return value.replace(/[A-Z]/gu, (character) => String.fromCharCode(character.charCodeAt(0) + 32)) }
function fullWidthToAscii(value: string): string { return value.replace(/[０-９]/gu, (character) => String.fromCharCode(character.charCodeAt(0) - 0xfee0)) }
function invalid(raw: string, code: CsvInvalidCode): CsvCell { return { state: 'invalid', raw, code } }

function parseSelect(rule: Extract<CsvColumnDefinition, { type: 'select' }>['parse'], raw: string): { ok: true; value: string } | { ok: false; code: CsvInvalidCode } {
  const key = optionKey(raw, rule.matching)
  const option = rule.options.find((item) => optionKey(item.raw, rule.matching) === key)
  if (option) return { ok: true, value: option.id }
  return rule.closed ? { ok: false, code: 'closed-option' } : { ok: true, value: raw }
}

function optionKey(value: string, matching: 'exact' | 'ascii-case-trim'): string {
  return matching === 'exact' ? value : asciiLower(value.replace(/^[ \t]+|[ \t]+$/gu, ''))
}

function expandExponent(value: string): string | null {
  if (!/[eE]/u.test(value)) return value
  const match = /^([+-]?)(\d*)(?:\.(\d*))?[eE]([+-]?\d+)$/u.exec(value)
  if (!match) return null
  const sign = match[1] ?? '', integer = match[2] ?? '', fraction = match[3] ?? '', exponent = Number(match[4])
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > CSV_POLICY.maxDigits * 2) return null
  const digits = integer + fraction
  const point = integer.length + exponent
  if (point <= 0) return `${sign}0.${'0'.repeat(-point)}${digits}`
  if (point >= digits.length) return `${sign}${digits}${'0'.repeat(point - digits.length)}`
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`
}

function divideDecimalBy100(value: string): string {
  const negative = value.startsWith('-')
  const unsigned = value.replace(/^[+-]/u, '')
  const [whole = '', fraction = ''] = unsigned.split('.')
  const digits = whole + fraction
  const point = whole.length - 2
  const shifted = point <= 0 ? `0.${'0'.repeat(-point)}${digits}` : point >= digits.length ? `${digits}${'0'.repeat(point - digits.length)}` : `${digits.slice(0, point)}.${digits.slice(point)}`
  const [integerPart = '', decimalPart = ''] = shifted.split('.')
  const normalized = `${integerPart.replace(/^0+/u, '') || '0'}${decimalPart ? `.${decimalPart}` : ''}`
  return `${negative ? '-' : ''}${normalized}`
}
