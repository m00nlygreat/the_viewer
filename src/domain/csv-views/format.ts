import type { CsvCell, CsvColumnDefinition, CsvColumnDisplay, CsvDisplayOverride, CsvOptionColor } from './model'

export interface CsvFormattedCell {
  text: string
  tone: 'value' | 'unmatched' | 'empty' | 'missing' | 'null-marker' | 'invalid'
  align: 'start' | 'end'
  optionColor: CsvOptionColor | null
  chips: { text: string; color: CsvOptionColor | null; unmatched: boolean }[] | null
}

export function resolveDisplay(column: CsvColumnDefinition, override: CsvDisplayOverride | undefined): CsvColumnDisplay {
  return override?.display ?? column.display
}

export function formatCell(column: CsvColumnDefinition, display: CsvColumnDisplay, cell: CsvCell, stateText: CsvDisplayOverride['stateText']): CsvFormattedCell {
  if (cell.state === 'empty') return state('empty', stateText.empty ?? '빈 값')
  if (cell.state === 'missing') return state('missing', stateText.missing ?? '누락')
  if (cell.state === 'null-marker') return state('null-marker', stateText['null-marker'] ?? `결측 표식: ${cell.raw}`, cell.raw)
  if (cell.state === 'invalid') return { ...state('invalid', cell.raw, cell.raw), text: cell.raw }
  const align = column.type === 'integer' || column.type === 'decimal' ? 'end' : 'start'
  if (column.type === 'integer' || column.type === 'decimal') return { ...state('value', formatNumber(cell.value, column, display)), align }
  if (column.type === 'boolean' && typeof cell.value === 'boolean') {
    const booleanDisplay = display as Extract<CsvColumnDisplay, { as: 'check' | 'text' }>
    return { ...state('value', booleanDisplay.as === 'check' ? (cell.value ? '✓' : '—') : (cell.value ? booleanDisplay.trueLabel : booleanDisplay.falseLabel)), align }
  }
  if (column.type === 'date' && typeof cell.value === 'string') return { ...state('value', formatDate(cell.value, display as Extract<CsvColumnDisplay, { pattern: string }>)), align }
  if (column.type === 'datetime' && typeof cell.value === 'string') return { ...state('value', formatDateTime(cell.raw, cell.value, display as Extract<CsvColumnDisplay, { zone: unknown }>)), align }
  if (column.type === 'select' && typeof cell.value === 'string') return formatSelect(column, [cell.value], display, false)
  if (column.type === 'multiSelect' && Array.isArray(cell.value)) return formatSelect(column, cell.value, display, true)
  return { ...state('value', String(cell.value)), align }
}

function state(tone: CsvFormattedCell['tone'], text: string, optionText?: string): CsvFormattedCell {
  return { text, tone, align: 'start', optionColor: null, chips: optionText === undefined ? null : [{ text: optionText, color: null, unmatched: false }] }
}

function formatNumber(value: string | boolean | string[], column: CsvColumnDefinition, display: CsvColumnDisplay): string {
  if (typeof value !== 'string') return String(value)
  const numberDisplay = display as Extract<CsvColumnDisplay, { grouping: boolean }>
  const negative = value.startsWith('-')
  const unsigned = value.replace(/^-/, '')
  const [whole = '0', rawFraction = ''] = unsigned.split('.')
  const digits = numberDisplay.fractionDigits === 'scale'
    ? (column.type === 'decimal' ? column.parse.scale : 0)
    : numberDisplay.fractionDigits
  const fraction = digits === 0 ? '' : rawFraction.padEnd(digits, '0').slice(0, digits)
  let integerText = whole
  if (numberDisplay.grouping) integerText = whole.replace(/\B(?=(\d{3})+(?!\d))/gu, ',')
  let result = `${integerText}${fraction ? `.${fraction}` : ''}`
  if (numberDisplay.style.kind === 'currency') result = numberDisplay.style.position === 'prefix' ? `${numberDisplay.style.symbol}${result}` : `${result}${numberDisplay.style.symbol}`
  else if (numberDisplay.style.kind === 'percent') result += '%'
  return negative ? (numberDisplay.negative === 'parentheses' ? `(${result})` : `-${result}`) : result
}

function formatDate(isoDate: string, display: Extract<CsvColumnDisplay, { pattern: string }>): string {
  if (display.pattern === 'iso') return isoDate
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(isoDate)
  if (!match) return isoDate
  return display.pattern === 'ko-long' ? `${Number(match[1])}년 ${Number(match[2])}월 ${Number(match[3])}일` : `${Number(match[2])}월 ${Number(match[3])}일`
}

function formatDateTime(raw: string, iso: string, display: Extract<CsvColumnDisplay, { zone: unknown }>): string {
  const zone = display.zone
  if (zone.kind === 'source') return display.seconds ? raw : raw.replace(/(:\d{2})(?:\.\d+)?(?=Z|[+-]\d{2}:\d{2}$)/u, '')
  const timeZone = zone.kind === 'utc' ? 'UTC' : zone.timeZone
  try {
    const parts = new Intl.DateTimeFormat('sv-SE', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
      ...(display.seconds ? { second: '2-digit' as const } : {}), hourCycle: 'h23'
    }).format(new Date(iso))
    return parts.replace(' ', 'T')
  } catch { return iso }
}

function formatSelect(column: CsvColumnDefinition, values: string[], display: CsvColumnDisplay, multiple: boolean): CsvFormattedCell {
  const options = column.type === 'select' || column.type === 'multiSelect' ? column.parse.options : []
  const chips = values.map((value) => {
    const option = options.find((item) => item.id === value)
    return { text: option?.label ?? (option ? value : value), color: option?.color ?? null, unmatched: !option }
  })
  const text = chips.map((chip) => chip.text).join(', ')
  const chipDisplay = display as Extract<CsvColumnDisplay, { as: 'chip' | 'text' }>
  return {
    text,
    tone: chips.some((chip) => chip.unmatched) ? 'unmatched' : 'value',
    align: 'start',
    optionColor: !multiple && chips.length === 1 ? chips[0]!.color : null,
    chips: chipDisplay.as === 'chip' ? chips : null
  }
}
