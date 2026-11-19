import { CSV_POLICY } from './policy'
import type {
  CsvColumnDefinition, CsvDisplayOverride, CsvFileProfile, CsvFilter, CsvLayout,
  CsvValidationIssue, CsvValidationResult, CsvViewBackup, CsvViewBundle, CsvViewDefinition
} from './model'
import { isRecord } from './model'
import { allowedOperators } from './query'
import { parseConstant } from './typing'

type Check<T> = { value: T | null; issues: CsvValidationIssue[]; filledDefaults: { path: string }[] }

export function validateColumnDefinition(input: unknown): CsvValidationResult<CsvColumnDefinition> {
  const checked = checkColumn(input, '')
  return result(checked)
}

export function validateViewDefinition(input: unknown, columns: readonly CsvColumnDefinition[]): CsvValidationResult<CsvViewDefinition> {
  const checked = checkView(input, new Map(columns.map((column) => [column.id, column])), '')
  return result(checked)
}

export function validateViewBundle(input: unknown): CsvValidationResult<CsvViewBundle> {
  const issues: CsvValidationIssue[] = []
  const filledDefaults: { path: string }[] = []
  if (!fitsImportLimit(input)) return { ok: false, issues: [{ path: '', code: 'limit', detail: '가져오기 파일은 5 MiB 이하여야 합니다.' }] }
  if (!isRecord(input)) return fail('', 'type')
  if (input.kind !== 'csv-view-bundle') return fail('/kind', 'type')
  if (input.schemaVersion !== 1) return fail('/schemaVersion', 'unknown-version')
  const source = input.source
  if (!isRecord(source) || typeof source.fileName !== 'string' || !Array.isArray(source.headers) || !source.headers.every((value) => value === null || typeof value === 'string') || !isNat(source.columnCount)) issues.push(issue('/source', 'type'))
  if (!isRecord(input.profile)) issues.push(issue('/profile', 'type'))
  const profileCheck = checkProfile(input.profile, '/profile', false)
  issues.push(...profileCheck.issues); filledDefaults.push(...profileCheck.filledDefaults)
  if (!Array.isArray(input.views)) issues.push(issue('/views', 'type'))
  const profile = profileCheck.value as Omit<CsvFileProfile, 'viewOrder'> | null
  const columns = profile?.columns ?? []
  const views: CsvViewDefinition[] = []
  const viewIds = new Set<string>()
  if (Array.isArray(input.views)) {
    if (input.views.length > CSV_POLICY.maxViewsPerFile) return fail('/views', 'limit', '파일당 뷰는 100개까지 저장할 수 있습니다.')
    for (let index = 0; index < input.views.length; index += 1) {
      const checked = checkView(input.views[index], new Map(columns.map((column) => [column.id, column])), `/views/${index}`)
      issues.push(...checked.issues); filledDefaults.push(...checked.filledDefaults)
      if (checked.value) {
        if (viewIds.has(checked.value.id)) issues.push(issue(`/views/${index}/id`, 'duplicate-id'))
        viewIds.add(checked.value.id); views.push(checked.value)
      }
    }
  }
  if (!Array.isArray(input.viewOrder) || !input.viewOrder.every((id) => typeof id === 'string')) issues.push(issue('/viewOrder', 'type'))
  else {
    const order = input.viewOrder as string[]
    if (new Set(order).size !== order.length) issues.push(issue('/viewOrder', 'duplicate-id'))
    if (order.length !== viewIds.size || order.some((id) => !viewIds.has(id)) || [...viewIds].some((id) => !order.includes(id))) issues.push(issue('/viewOrder', 'unknown-column', 'viewOrder와 views의 ID 집합이 다릅니다.'))
  }
  if (!isIsoDateTime(input.exportedAt)) issues.push(issue('/exportedAt', 'type'))
  if (typeof input.appVersion !== 'string') issues.push(issue('/appVersion', 'type'))
  if (isRecord(source) && isNat(source.columnCount) && Array.isArray(source.headers) && source.headers.length !== source.columnCount) issues.push(issue('/source/headers', 'type', '헤더 수가 columnCount와 다릅니다.'))
  if (profile && isRecord(source) && isNat(source.columnCount) && profile.columns.length !== source.columnCount) issues.push(issue('/profile/columns', 'type', '프로필 컬럼 수가 원본 컬럼 수와 다릅니다.'))
  if (issues.length || !profile || !isRecord(source) || !Array.isArray(input.views) || !Array.isArray(input.viewOrder) || !isIsoDateTime(input.exportedAt) || typeof input.appVersion !== 'string') return { ok: false, issues }
  const value: CsvViewBundle = {
    kind: 'csv-view-bundle', schemaVersion: 1, exportedAt: input.exportedAt, appVersion: input.appVersion,
    source: source as CsvViewBundle['source'], profile, viewOrder: input.viewOrder as string[], views
  }
  return { ok: true, value, filledDefaults }
}

export function validateBackup(input: unknown): CsvValidationResult<CsvViewBackup> {
  if (!fitsImportLimit(input)) return fail('', 'limit', '가져오기 파일은 5 MiB 이하여야 합니다.')
  if (!isRecord(input)) return fail('', 'type')
  if (input.kind !== 'csv-view-backup') return fail('/kind', 'type')
  if (input.schemaVersion !== 1) return fail('/schemaVersion', 'unknown-version')
  if (!Array.isArray(input.profiles)) return fail('/profiles', 'type')
  const issues: CsvValidationIssue[] = []
  const filledDefaults: { path: string }[] = []
  const profiles: CsvViewBackup['profiles'] = []
  for (let index = 0; index < input.profiles.length; index += 1) {
    const raw = input.profiles[index]
    if (!isRecord(raw)) { issues.push(issue(`/profiles/${index}`, 'type')); continue }
    const bundle = { ...raw, kind: 'csv-view-bundle', schemaVersion: 1, exportedAt: input.exportedAt, appVersion: input.appVersion }
    const checked = validateViewBundle(bundle)
    if (!checked.ok) issues.push(...checked.issues.map((item) => ({ ...item, path: `/profiles/${index}${item.path}` })))
    else {
      filledDefaults.push(...checked.filledDefaults.map((item) => ({ path: `/profiles/${index}${item.path}` })))
      const { kind: _kind, schemaVersion: _version, exportedAt: _date, appVersion: _app, ...profile } = checked.value
      profiles.push(profile)
    }
  }
  if (!isIsoDateTime(input.exportedAt)) issues.push(issue('/exportedAt', 'type'))
  if (typeof input.appVersion !== 'string') issues.push(issue('/appVersion', 'type'))
  if (issues.length) return { ok: false, issues }
  return { ok: true, value: { kind: 'csv-view-backup', schemaVersion: 1, exportedAt: input.exportedAt as string, appVersion: input.appVersion as string, profiles }, filledDefaults }
}

export function validateProfile(input: unknown): CsvValidationResult<CsvFileProfile> {
  return result(checkProfile(input, '', true))
}

export function isValidFilterForColumns(filter: CsvFilter | null, columns: readonly CsvColumnDefinition[]): boolean {
  const checked = checkFilter(filter, new Map(columns.map((column) => [column.id, column])), '', { conditions: 0 }, 0)
  return checked.issues.length === 0
}

export function findAffectedViews(profile: CsvFileProfile, views: CsvViewDefinition[], draft: CsvColumnDefinition): { viewId: string; reasons: CsvValidationIssue['code'][] }[] {
  const columns = profile.columns.map((column) => column.id === draft.id ? draft : column)
  const affected: { viewId: string; reasons: CsvValidationIssue['code'][] }[] = []
  for (const view of views) {
    const checked = checkView(view, new Map(columns.map((column) => [column.id, column])), '')
    if (checked.issues.length) affected.push({ viewId: view.id, reasons: [...new Set(checked.issues.map((item) => item.code))] })
  }
  return affected
}

function checkProfile(input: unknown, path: string, includeOrder: true): Check<CsvFileProfile>
function checkProfile(input: unknown, path: string, includeOrder: false): Check<Omit<CsvFileProfile, 'viewOrder'>>
function checkProfile(input: unknown, path: string, includeOrder: boolean): Check<CsvFileProfile | Omit<CsvFileProfile, 'viewOrder'>> {
  const issues: CsvValidationIssue[] = [], filledDefaults: { path: string }[] = []
  if (!isRecord(input)) return { value: null, issues: [issue(path, 'type')], filledDefaults }
  if (input.schemaVersion !== 1) issues.push(issue(`${path}/schemaVersion`, 'unknown-version'))
  if (typeof input.fileId !== 'string' || !input.fileId) issues.push(issue(`${path}/fileId`, 'required'))
  if (!isRecord(input.parser)) issues.push(issue(`${path}/parser`, 'required'))
  const parser = checkParser(input.parser, `${path}/parser`); issues.push(...parser.issues)
  if (!Array.isArray(input.columns)) issues.push(issue(`${path}/columns`, 'required'))
  const columns: CsvColumnDefinition[] = []
  const ids = new Set<string>(), positions = new Set<number>()
  if (Array.isArray(input.columns)) {
    if (input.columns.length > 100_000) return { value: null, issues: [...issues, issue(`${path}/columns`, 'limit')], filledDefaults }
    for (let index = 0; index < input.columns.length; index += 1) {
      const checked = checkColumn(input.columns[index], `${path}/columns/${index}`)
      issues.push(...checked.issues); filledDefaults.push(...checked.filledDefaults)
      if (checked.value) {
        if (ids.has(checked.value.id)) issues.push(issue(`${path}/columns/${index}/id`, 'duplicate-id'))
        if (positions.has(checked.value.sourceIndex)) issues.push(issue(`${path}/columns/${index}/sourceIndex`, 'duplicate-id'))
        ids.add(checked.value.id); positions.add(checked.value.sourceIndex); columns.push(checked.value)
      }
    }
    columns.sort((a, b) => a.sourceIndex - b.sourceIndex)
    if (columns.some((column, index) => column.sourceIndex !== index)) issues.push(issue(`${path}/columns`, 'type', 'sourceIndex는 0부터 연속된 위치여야 합니다.'))
  }
  if (!isPositiveInt(input.schemaRevision)) issues.push(issue(`${path}/schemaRevision`, 'required'))
  if (!isPositiveInt(input.profileRevision)) issues.push(issue(`${path}/profileRevision`, 'required'))
  if (!isIsoDateTime(input.updatedAt)) issues.push(issue(`${path}/updatedAt`, 'required'))
  let viewOrder: string[] = []
  if (includeOrder) {
    if (!Array.isArray(input.viewOrder) || !input.viewOrder.every((id) => typeof id === 'string')) issues.push(issue(`${path}/viewOrder`, 'required'))
    else { viewOrder = [...input.viewOrder] as string[]; if (new Set(viewOrder).size !== viewOrder.length) issues.push(issue(`${path}/viewOrder`, 'duplicate-id')) }
  }
  if (issues.length || !parser.value || !Array.isArray(input.columns)) return { value: null, issues, filledDefaults }
  const common = {
    schemaVersion: 1 as const, fileId: input.fileId as string, parser: parser.value, columns,
    schemaRevision: input.schemaRevision as number, profileRevision: input.profileRevision as number, updatedAt: input.updatedAt as string
  }
  return { value: includeOrder ? { ...common, viewOrder } : common, issues, filledDefaults }
}

function checkParser(input: unknown, path: string): Check<CsvFileProfile['parser']> {
  const issues: CsvValidationIssue[] = []
  if (!isRecord(input)) return { value: null, issues: [issue(path, 'required')], filledDefaults: [] }
  const valid = typeof input.encoding === 'string' && input.encoding.length > 0 && input.encoding.length <= 64 &&
    ['auto', 'present', 'absent'].includes(String(input.bom)) && typeof input.hasHeader === 'boolean' && typeof input.delimiter === 'string' && input.delimiter.length === 1 &&
    (input.quote === null || input.quote === '"' || input.quote === "'") && ['double-quote', 'backslash'].includes(String(input.escape)) && ['auto', 'lf', 'crlf', 'cr'].includes(String(input.newline))
  if (!valid) issues.push(issue(path, 'type'))
  return { value: valid ? input as unknown as CsvFileProfile['parser'] : null, issues, filledDefaults: [] }
}

function checkColumn(input: unknown, path: string): Check<CsvColumnDefinition> {
  const issues: CsvValidationIssue[] = [], filledDefaults: { path: string }[] = []
  if (!isRecord(input)) return { value: null, issues: [issue(path, 'type')], filledDefaults }
  const { id, sourceIndex, sourceHeader, label, typeSource, type } = input
  if (typeof id !== 'string' || !id || id.length > 128) issues.push(issue(`${path}/id`, 'required'))
  if (!isNat(sourceIndex)) issues.push(issue(`${path}/sourceIndex`, 'required'))
  if (!(sourceHeader === null || typeof sourceHeader === 'string') || (typeof sourceHeader === 'string' && sourceHeader.length > 4096)) issues.push(issue(`${path}/sourceHeader`, 'type'))
  if (typeof label !== 'string' || label.length > 256) issues.push(issue(`${path}/label`, 'required'))
  if (typeSource !== 'inferred' && typeSource !== 'user') issues.push(issue(`${path}/typeSource`, 'required'))
  if (!['text', 'integer', 'decimal', 'boolean', 'date', 'datetime', 'select', 'multiSelect'].includes(String(type))) issues.push(issue(`${path}/type`, 'type'))
  if (!Array.isArray(input.nullMarkers) || !input.nullMarkers.every((item) => typeof item === 'string') || new Set(input.nullMarkers).size !== input.nullMarkers.length || input.nullMarkers.includes('')) issues.push(issue(`${path}/nullMarkers`, 'type'))
  if (typeof input.allowSurroundingSpace !== 'boolean') issues.push(issue(`${path}/allowSurroundingSpace`, 'required'))
  if (issues.length || typeof type !== 'string') return { value: null, issues, filledDefaults }
  const base = {
    id: id as string, sourceIndex: sourceIndex as number, sourceHeader: sourceHeader as string | null, label: label as string,
    typeSource: typeSource as 'inferred' | 'user', nullMarkers: input.nullMarkers as string[], allowSurroundingSpace: input.allowSurroundingSpace as boolean
  }
  const parseInput = isRecord(input.parse) ? { ...input.parse } : null
  if (!parseInput) issues.push(issue(`${path}/parse`, 'required'))
  const displayInput = isRecord(input.display) ? { ...input.display } : null
  if (!displayInput) issues.push(issue(`${path}/display`, 'required'))
  const parse = parseInput ? { ...parseInput } : {}
  const fill = (key: string, value: unknown) => { if (!(key in parse)) { parse[key] = value; filledDefaults.push({ path: `${path}/parse/${key}` }) } }
  if (parseInput) {
    switch (type) {
      case 'text': break
      case 'integer': fill('allowPlusSign', false); fill('thousandsSeparator', null); fill('allowFullWidthDigits', false); fill('allowExponent', false); break
      case 'decimal': fill('precision', CSV_POLICY.maxDigits); fill('scale', 0); fill('decimalSeparator', '.'); fill('thousandsSeparator', null); fill('currencySymbols', []); fill('percentInput', 'reject'); fill('allowBareFraction', false); fill('allowExponent', false); break
      case 'boolean': fill('trueValues', ['true']); fill('falseValues', ['false']); fill('ignoreCase', 'ascii'); break
      case 'date': fill('formats', ['YYYY-MM-DD']); break
      case 'datetime': fill('offset', { kind: 'require' }); fill('allowTwelveHour', false); fill('allowDateOnly', false); break
      case 'select': fill('options', []); fill('matching', 'exact'); fill('closed', false); break
      case 'multiSelect': fill('options', []); fill('matching', 'exact'); fill('closed', false); fill('duplicates', 'keep'); break
    }
  }
  const normalizedDisplay = displayInput ?? defaultDisplay(type)
  if (!displayInput) filledDefaults.push({ path: `${path}/display` })
  const validParse = validateParse(type, parse, `${path}/parse`, issues)
  const validDisplay = validateDisplay(type, normalizedDisplay, `${path}/display`, issues)
  if (!validParse || !validDisplay || issues.length) return { value: null, issues, filledDefaults }
  return { value: { ...base, type, parse: validParse, display: validDisplay } as CsvColumnDefinition, issues, filledDefaults }
}

function defaultDisplay(type: string): Record<string, unknown> {
  if (type === 'text') return { as: 'plain' }
  if (type === 'integer' || type === 'decimal') return { grouping: true, fractionDigits: type === 'integer' ? 0 : 'scale', style: { kind: 'plain' }, negative: 'minus' }
  if (type === 'boolean') return { as: 'check', trueLabel: '참', falseLabel: '거짓' }
  if (type === 'date') return { pattern: 'iso' }
  if (type === 'datetime') return { zone: { kind: 'source' }, seconds: true }
  return { as: 'chip' }
}

function validateParse(type: string, parse: Record<string, unknown>, path: string, issues: CsvValidationIssue[]): unknown | null {
  const booleanFields: Record<string, string[]> = {
    integer: ['allowPlusSign', 'allowFullWidthDigits', 'allowExponent'], decimal: ['allowBareFraction', 'allowExponent'], boolean: [], datetime: ['allowTwelveHour', 'allowDateOnly'], select: ['closed'], multiSelect: ['closed']
  }
  for (const field of booleanFields[type] ?? []) if (typeof parse[field] !== 'boolean') issues.push(issue(`${path}/${field}`, 'required'))
  if (type === 'text') { if (Object.keys(parse).length) issues.push(issue(path, 'type')); return Object.keys(parse).length ? null : {} }
  if (type === 'integer') {
    if (!isSeparatorOrNull(parse.thousandsSeparator)) issues.push(issue(`${path}/thousandsSeparator`, 'type'))
    return hasIssuesAt(issues, path) ? null : { allowPlusSign: parse.allowPlusSign, thousandsSeparator: parse.thousandsSeparator, allowFullWidthDigits: parse.allowFullWidthDigits, allowExponent: parse.allowExponent }
  }
  if (type === 'decimal') {
    if (!isNat(parse.precision) || Number(parse.precision) < 1 || Number(parse.precision) > CSV_POLICY.maxDigits) issues.push(issue(`${path}/precision`, 'limit'))
    if (!isNat(parse.scale) || Number(parse.scale) > Number(parse.precision)) issues.push(issue(`${path}/scale`, 'limit'))
    if (parse.decimalSeparator !== '.' && parse.decimalSeparator !== ',') issues.push(issue(`${path}/decimalSeparator`, 'type'))
    if (!isSeparatorOrNull(parse.thousandsSeparator) || parse.thousandsSeparator === parse.decimalSeparator) issues.push(issue(`${path}/thousandsSeparator`, 'type'))
    if (!Array.isArray(parse.currencySymbols) || !parse.currencySymbols.every((value) => typeof value === 'string' && value.length > 0) || new Set(parse.currencySymbols).size !== parse.currencySymbols.length) issues.push(issue(`${path}/currencySymbols`, 'type'))
    if (!['reject', 'strip-sign', 'divide-by-100'].includes(String(parse.percentInput))) issues.push(issue(`${path}/percentInput`, 'type'))
    return hasIssuesAt(issues, path) ? null : parse
  }
  if (type === 'boolean') {
    if (!stringArray(parse.trueValues) || !stringArray(parse.falseValues) || !parse.trueValues.length || !parse.falseValues.length || intersects(parse.trueValues, parse.falseValues)) issues.push(issue(path, 'option-conflict'))
    if (parse.ignoreCase !== 'none' && parse.ignoreCase !== 'ascii') issues.push(issue(`${path}/ignoreCase`, 'type'))
    return hasIssuesAt(issues, path) ? null : parse
  }
  if (type === 'date') {
    const formats = ['YYYY-MM-DD', 'YYYY/MM/DD', 'YYYY.MM.DD', 'YYYYMMDD', 'DD/MM/YYYY', 'MM/DD/YYYY', 'DD.MM.YYYY']
    if (!Array.isArray(parse.formats) || !parse.formats.length || !parse.formats.every((format) => formats.includes(String(format)))) issues.push(issue(`${path}/formats`, 'type'))
    if (Array.isArray(parse.formats) && parse.formats.includes('DD/MM/YYYY') && parse.formats.includes('MM/DD/YYYY')) issues.push(issue(`${path}/formats`, 'option-conflict'))
    return hasIssuesAt(issues, path) ? null : parse
  }
  if (type === 'datetime') {
    if (!isRecord(parse.offset) || (parse.offset.kind !== 'require' && (parse.offset.kind !== 'assume' || typeof parse.offset.timeZone !== 'string' || !validTimeZone(parse.offset.timeZone)))) issues.push(issue(`${path}/offset`, 'type'))
    if (parse.allowDateOnly && (!isRecord(parse.offset) || parse.offset.kind !== 'assume')) issues.push(issue(`${path}/allowDateOnly`, 'option-conflict'))
    return hasIssuesAt(issues, path) ? null : parse
  }
  if (type === 'select' || type === 'multiSelect') {
    const options = parse.options
    if (!Array.isArray(options)) issues.push(issue(`${path}/options`, 'type'))
    const optionIds = new Set<string>(), raws = new Set<string>()
    if (Array.isArray(options)) for (let index = 0; index < options.length; index += 1) {
      const option = options[index]
      if (!isRecord(option) || typeof option.id !== 'string' || !option.id || typeof option.raw !== 'string' || typeof option.label !== 'string' || !isColor(option.color)) { issues.push(issue(`${path}/options/${index}`, 'type')); continue }
      if (optionIds.has(option.id) || raws.has(option.raw)) issues.push(issue(`${path}/options/${index}`, 'option-conflict'))
      optionIds.add(option.id); raws.add(option.raw)
    }
    if (parse.matching !== 'exact' && parse.matching !== 'ascii-case-trim') issues.push(issue(`${path}/matching`, 'type'))
    if (type === 'multiSelect' && (typeof parse.separator !== 'string' || !parse.separator)) issues.push(issue(`${path}/separator`, 'required'))
    if (type === 'multiSelect' && parse.duplicates !== 'keep' && parse.duplicates !== 'collapse') issues.push(issue(`${path}/duplicates`, 'type'))
    return hasIssuesAt(issues, path) ? null : parse
  }
  issues.push(issue(path, 'type'))
  return null
}

function validateDisplay(type: string, display: Record<string, unknown>, path: string, issues: CsvValidationIssue[]): unknown | null {
  const allowed = (values: string[], field = 'as') => { if (!values.includes(String(display[field]))) issues.push(issue(`${path}/${field}`, 'type')) }
  if (type === 'text') allowed(['plain', 'link', 'image'])
  else if (type === 'integer' || type === 'decimal') {
    if (typeof display.grouping !== 'boolean') issues.push(issue(`${path}/grouping`, 'required'))
    if (!(display.fractionDigits === 'scale' || (isNat(display.fractionDigits) && Number(display.fractionDigits) <= CSV_POLICY.maxDigits))) issues.push(issue(`${path}/fractionDigits`, 'type'))
    if (!isRecord(display.style) || !['plain', 'currency', 'percent'].includes(String(display.style.kind))) issues.push(issue(`${path}/style`, 'type'))
    else if (display.style.kind === 'currency' && (typeof display.style.symbol !== 'string' || !['prefix', 'suffix'].includes(String(display.style.position)))) issues.push(issue(`${path}/style`, 'type'))
    if (display.negative !== 'minus' && display.negative !== 'parentheses') issues.push(issue(`${path}/negative`, 'type'))
  } else if (type === 'boolean') {
    allowed(['check', 'text']); if (typeof display.trueLabel !== 'string' || typeof display.falseLabel !== 'string') issues.push(issue(path, 'required'))
  } else if (type === 'date') allowed(['iso', 'ko-long', 'ko-short'], 'pattern')
  else if (type === 'datetime') {
    if (!isRecord(display.zone) || !['source', 'utc', 'fixed'].includes(String(display.zone.kind))) issues.push(issue(`${path}/zone`, 'type'))
    else if (display.zone.kind === 'fixed' && (typeof display.zone.timeZone !== 'string' || !validTimeZone(display.zone.timeZone))) issues.push(issue(`${path}/zone/timeZone`, 'type'))
    if (typeof display.seconds !== 'boolean') issues.push(issue(`${path}/seconds`, 'required'))
  } else allowed(['chip', 'text'])
  return hasIssuesAt(issues, path) ? null : display
}

function checkView(input: unknown, columns: ReadonlyMap<string, CsvColumnDefinition>, path: string): Check<CsvViewDefinition> {
  const issues: CsvValidationIssue[] = [], filledDefaults: { path: string }[] = []
  if (!isRecord(input)) return { value: null, issues: [issue(path, 'type')], filledDefaults }
  if (typeof input.id !== 'string' || !input.id || input.id.length > 128) issues.push(issue(`${path}/id`, 'required'))
  if (typeof input.name !== 'string' || input.name.trim().length === 0 || input.name.length > 128) issues.push(issue(`${path}/name`, 'required'))
  if (!isIsoDateTime(input.updatedAt)) issues.push(issue(`${path}/updatedAt`, 'required'))
  if (!Array.isArray(input.columnIds) || !input.columnIds.every((id) => typeof id === 'string')) issues.push(issue(`${path}/columnIds`, 'type'))
  else if (new Set(input.columnIds).size !== input.columnIds.length) issues.push(issue(`${path}/columnIds`, 'duplicate-id'))
  if (!Array.isArray(input.sort)) issues.push(issue(`${path}/sort`, 'type'))
  const layout = checkLayout(input.layout, columns, `${path}/layout`, issues)
  const columnIds = Array.isArray(input.columnIds) && input.columnIds.every((id) => typeof id === 'string') ? input.columnIds as string[] : []
  for (let index = 0; index < columnIds.length; index += 1) if (!columns.has(columnIds[index]!)) issues.push(issue(`${path}/columnIds/${index}`, 'unknown-column'))
  const sort: CsvViewDefinition['sort'] = []
  if (Array.isArray(input.sort)) for (let index = 0; index < input.sort.length; index += 1) {
    const item = input.sort[index]
    if (!isRecord(item) || typeof item.columnId !== 'string' || !columns.has(item.columnId) || (item.direction !== 'asc' && item.direction !== 'desc')) { issues.push(issue(`${path}/sort/${index}`, 'type')); continue }
    if (columns.get(item.columnId)!.type === 'multiSelect') issues.push(issue(`${path}/sort/${index}`, 'sort-not-allowed'))
    sort.push({ columnId: item.columnId, direction: item.direction })
  }
  if (layout?.kind === 'list' && layout.groupColumnId && columns.get(layout.groupColumnId)?.type === 'multiSelect') issues.push(issue(`${path}/layout/groupColumnId`, 'sort-not-allowed'))
  if (input.filter !== null && input.filter !== undefined) {
    const filter = checkFilter(input.filter, columns, `${path}/filter`, { conditions: 0 }, 0)
    issues.push(...filter.issues)
  }
  const displayOverrides: Record<string, CsvDisplayOverride> = {}
  if (!isRecord(input.displayOverrides)) issues.push(issue(`${path}/displayOverrides`, 'type'))
  else for (const [columnId, rawOverride] of Object.entries(input.displayOverrides)) {
    const column = columns.get(columnId)
    if (!column) { issues.push(issue(`${path}/displayOverrides/${escapePointer(columnId)}`, 'unknown-column')); continue }
    if (!isRecord(rawOverride)) { issues.push(issue(`${path}/displayOverrides/${escapePointer(columnId)}`, 'type')); continue }
    const override: Record<string, unknown> = { ...rawOverride }
    if (!('label' in override)) { override.label = null; filledDefaults.push({ path: `${path}/displayOverrides/${escapePointer(columnId)}/label` }) }
    if (!('display' in override)) { override.display = null; filledDefaults.push({ path: `${path}/displayOverrides/${escapePointer(columnId)}/display` }) }
    if (!('stateText' in override)) { override.stateText = {}; filledDefaults.push({ path: `${path}/displayOverrides/${escapePointer(columnId)}/stateText` }) }
    const value = checkOverride(column, override, `${path}/displayOverrides/${escapePointer(columnId)}`, issues)
    if (value) displayOverrides[columnId] = value
  }
  if (layout?.kind === 'gallery' && layout.coverColumnId) {
    const cover = columns.get(layout.coverColumnId)
    const display = cover?.type === 'text' ? displayOverrides[layout.coverColumnId]?.display ?? cover.display : null
    if (cover && (cover.type !== 'text' || !display || !('as' in display) || display.as !== 'image')) issues.push(issue(`${path}/layout/coverColumnId`, 'layout-column-type'))
  }
  if (!layout || issues.length || typeof input.id !== 'string' || typeof input.name !== 'string' || !isIsoDateTime(input.updatedAt) || !Array.isArray(input.columnIds) || !Array.isArray(input.sort)) return { value: null, issues, filledDefaults }
  return { value: { id: input.id, name: input.name, layout, columnIds, filter: (input.filter ?? null) as CsvViewDefinition['filter'], sort, displayOverrides, updatedAt: input.updatedAt }, issues, filledDefaults }
}

function checkLayout(input: unknown, columns: ReadonlyMap<string, CsvColumnDefinition>, path: string, issues: CsvValidationIssue[]): CsvLayout | null {
  if (!isRecord(input) || typeof input.kind !== 'string') { issues.push(issue(path, 'type')); return null }
  const reference = (id: unknown, location: string, allowedTypes?: string[]) => {
    if (typeof id !== 'string' || !columns.has(id)) { issues.push(issue(location, 'unknown-column')); return }
    if (allowedTypes && !allowedTypes.includes(columns.get(id)!.type)) issues.push(issue(location, 'layout-column-type'))
  }
  const optionalReference = (id: unknown, location: string, allowedTypes?: string[]) => {
    if (id === undefined || id === null) return null
    reference(id, location, allowedTypes)
    return typeof id === 'string' ? id : null
  }
  const columnList = (ids: unknown, location: string, allowedTypes?: string[]): string[] => {
    if (ids === undefined) return []
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) { issues.push(issue(location, 'type')); return [] }
    if (new Set(ids).size !== ids.length) issues.push(issue(location, 'duplicate-id'))
    ids.forEach((id, index) => reference(id, `${location}/${index}`, allowedTypes))
    return ids as string[]
  }
  switch (input.kind) {
    case 'grid': return { kind: 'grid' }
    case 'list':
      reference(input.titleColumnId, `${path}/titleColumnId`)
      for (const key of ['subtitleColumnId', 'trailingColumnId', 'colorColumnId', 'groupColumnId']) if (!(input[key] === null || typeof input[key] === 'string')) issues.push(issue(`${path}/${key}`, 'type'))
      if (input.subtitleColumnId) reference(input.subtitleColumnId, `${path}/subtitleColumnId`)
      if (input.trailingColumnId) reference(input.trailingColumnId, `${path}/trailingColumnId`)
      if (input.colorColumnId) reference(input.colorColumnId, `${path}/colorColumnId`, ['select', 'boolean'])
      if (input.groupColumnId) reference(input.groupColumnId, `${path}/groupColumnId`)
      return { kind: 'list', titleColumnId: input.titleColumnId as string, subtitleColumnId: input.subtitleColumnId as string | null, trailingColumnId: input.trailingColumnId as string | null, colorColumnId: input.colorColumnId as string | null, groupColumnId: input.groupColumnId as string | null, badgeColumnIds: columnList(input.badgeColumnIds, `${path}/badgeColumnIds`, ['select', 'boolean']) }
    case 'gallery':
      reference(input.titleColumnId, `${path}/titleColumnId`)
      if (!(input.coverColumnId === null || typeof input.coverColumnId === 'string')) issues.push(issue(`${path}/coverColumnId`, 'type'))
      if (input.coverColumnId) {
        reference(input.coverColumnId, `${path}/coverColumnId`)
        const cover = columns.get(input.coverColumnId as string)
        if (cover && cover.type !== 'text') issues.push(issue(`${path}/coverColumnId`, 'layout-column-type'))
      }
      return { kind: 'gallery', titleColumnId: input.titleColumnId as string, coverColumnId: input.coverColumnId as string | null, subtitleColumnId: optionalReference(input.subtitleColumnId, `${path}/subtitleColumnId`), badgeColumnIds: columnList(input.badgeColumnIds, `${path}/badgeColumnIds`, ['select', 'boolean']), footerColumnIds: columnList(input.footerColumnIds, `${path}/footerColumnIds`) }
    case 'kanban':
      reference(input.groupColumnId, `${path}/groupColumnId`, ['select', 'boolean'])
      if (!Array.isArray(input.hiddenGroupKeys) || !input.hiddenGroupKeys.every((key) => typeof key === 'string')) issues.push(issue(`${path}/hiddenGroupKeys`, 'type'))
      return { kind: 'kanban', groupColumnId: input.groupColumnId as string, hiddenGroupKeys: Array.isArray(input.hiddenGroupKeys) ? input.hiddenGroupKeys as string[] : [], titleColumnId: optionalReference(input.titleColumnId, `${path}/titleColumnId`), subtitleColumnId: optionalReference(input.subtitleColumnId, `${path}/subtitleColumnId`), trailingColumnId: optionalReference(input.trailingColumnId, `${path}/trailingColumnId`), footerColumnIds: columnList(input.footerColumnIds, `${path}/footerColumnIds`) }
    case 'calendar':
      reference(input.dateColumnId, `${path}/dateColumnId`, ['date', 'datetime'])
      return { kind: 'calendar', dateColumnId: input.dateColumnId as string, titleColumnId: optionalReference(input.titleColumnId, `${path}/titleColumnId`), subtitleColumnId: optionalReference(input.subtitleColumnId, `${path}/subtitleColumnId`), colorColumnId: optionalReference(input.colorColumnId, `${path}/colorColumnId`, ['select', 'boolean']) }
    default: issues.push(issue(`${path}/kind`, 'type')); return null
  }
}

function checkFilter(input: unknown, columns: ReadonlyMap<string, CsvColumnDefinition>, path: string, budget: { conditions: number }, depth: number): Check<CsvFilter> {
  const issues: CsvValidationIssue[] = []
  if (depth > CSV_POLICY.maxFilterDepth) return { value: null, issues: [issue(path, 'limit')], filledDefaults: [] }
  if (!isRecord(input) || typeof input.op !== 'string') return { value: null, issues: [issue(path, 'type')], filledDefaults: [] }
  if (input.op === 'and' || input.op === 'or') {
    if (!Array.isArray(input.children)) return { value: null, issues: [issue(`${path}/children`, 'type')], filledDefaults: [] }
    budget.conditions += input.children.length
    if (budget.conditions > CSV_POLICY.maxFilterConditions) return { value: null, issues: [issue(`${path}/children`, 'limit')], filledDefaults: [] }
    const children: CsvFilter[] = []
    input.children.forEach((child, index) => { const checked = checkFilter(child, columns, `${path}/children/${index}`, budget, depth + 1); issues.push(...checked.issues); if (checked.value) children.push(checked.value) })
    return { value: issues.length ? null : { op: input.op, children }, issues, filledDefaults: [] }
  }
  if (input.op === 'not') {
    const child = checkFilter(input.child, columns, `${path}/child`, budget, depth + 1)
    return { value: child.value && !child.issues.length ? { op: 'not', child: child.value } : null, issues: child.issues, filledDefaults: [] }
  }
  budget.conditions += 1
  if (budget.conditions > CSV_POLICY.maxFilterConditions) return { value: null, issues: [issue(path, 'limit')], filledDefaults: [] }
  if (typeof input.columnId !== 'string' || !columns.has(input.columnId)) return { value: null, issues: [issue(`${path}/columnId`, 'unknown-column')], filledDefaults: [] }
  const column = columns.get(input.columnId)!
  if (!allowedOperators(column.type).includes(input.op)) return { value: null, issues: [issue(`${path}/op`, 'operator-not-allowed')], filledDefaults: [] }
  if (input.op === 'is' || input.op === 'isNot') {
    if (!['value', 'empty', 'missing', 'null-marker', 'invalid'].includes(String(input.state))) return { value: null, issues: [issue(`${path}/state`, 'type')], filledDefaults: [] }
    return { value: { op: input.op, columnId: input.columnId, state: input.state } as CsvFilter, issues, filledDefaults: [] }
  }
  if (input.op === 'in' || input.op === 'notIn' || input.op === 'hasAny' || input.op === 'hasAll') {
    if (!Array.isArray(input.optionIds) || !input.optionIds.every((id) => typeof id === 'string')) return { value: null, issues: [issue(`${path}/optionIds`, 'type')], filledDefaults: [] }
    const ids = input.optionIds as string[]
    const options = column.type === 'select' || column.type === 'multiSelect' ? column.parse.options : []
    if (ids.some((id) => !options.some((option) => option.id === id))) issues.push(issue(`${path}/optionIds`, 'constant-invalid'))
    return { value: issues.length ? null : { op: input.op, columnId: input.columnId, optionIds: ids } as CsvFilter, issues, filledDefaults: [] }
  }
  if (typeof input.value !== 'string') return { value: null, issues: [issue(`${path}/value`, 'required')], filledDefaults: [] }
  if (input.op === 'contains' || input.op === 'startsWith') {
    if (input.ignoreCase !== 'none' && input.ignoreCase !== 'ascii') issues.push(issue(`${path}/ignoreCase`, 'type'))
  }
  if (['eq', 'neq', 'lt', 'lte', 'gt', 'gte'].includes(input.op)) {
    if (parseConstant(column, input.value).state !== 'value') issues.push(issue(`${path}/value`, 'constant-invalid'))
  }
  return { value: issues.length ? null : { op: input.op, columnId: input.columnId, value: input.value, ...(input.op === 'contains' || input.op === 'startsWith' ? { ignoreCase: input.ignoreCase } : {}) } as CsvFilter, issues, filledDefaults: [] }
}

function checkOverride(column: CsvColumnDefinition, input: Record<string, unknown>, path: string, issues: CsvValidationIssue[]): CsvDisplayOverride | null {
  if (!(input.label === null || (typeof input.label === 'string' && input.label.length <= 256))) issues.push(issue(`${path}/label`, 'type'))
  if (!(input.display === null || isRecord(input.display))) issues.push(issue(`${path}/display`, 'type'))
  if (input.display && isRecord(input.display)) {
    const copy: CsvValidationIssue[] = []
    if (!validateDisplay(column.type, input.display, `${path}/display`, copy)) issues.push(...copy)
  }
  if (!isRecord(input.stateText) || Object.entries(input.stateText).some(([key, value]) => !['empty', 'missing', 'null-marker'].includes(key) || typeof value !== 'string' || value.length > 256)) issues.push(issue(`${path}/stateText`, 'type'))
  if (hasIssuesAt(issues, path)) return null
  return { label: input.label as string | null, display: input.display as CsvDisplayOverride['display'], stateText: input.stateText as CsvDisplayOverride['stateText'] }
}

function result<T>(check: Check<T>): CsvValidationResult<T> { return check.value && check.issues.length === 0 ? { ok: true, value: check.value, filledDefaults: check.filledDefaults } : { ok: false, issues: check.issues } }
function fail(path: string, code: CsvValidationIssue['code'], detail: string | null = null): CsvValidationResult<never> { return { ok: false, issues: [issue(path, code, detail)] } }
function issue(path: string, code: CsvValidationIssue['code'], detail: string | null = null): CsvValidationIssue { return { path, code, detail } }
function isNat(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 }
function isPositiveInt(value: unknown): value is number { return isNat(value) && value > 0 }
function isIsoDateTime(value: unknown): value is string { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value) && Number.isFinite(Date.parse(value)) }
function validTimeZone(value: string): boolean { try { new Intl.DateTimeFormat('en-US', { timeZone: value }); return true } catch { return false } }
function stringArray(value: unknown): value is string[] { return Array.isArray(value) && value.every((item) => typeof item === 'string') && new Set(value).size === value.length }
function intersects(a: readonly string[], b: readonly string[]): boolean { return a.some((item) => b.includes(item)) }
function isSeparatorOrNull(value: unknown): boolean { return value === null || value === ',' || value === '.' || value === ' ' || value === "'" }
function isColor(value: unknown): boolean { return ['gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'].includes(String(value)) }
function hasIssuesAt(issues: CsvValidationIssue[], path: string): boolean { return issues.some((item) => item.path === path || item.path.startsWith(`${path}/`)) }
function escapePointer(value: string): string { return value.replace(/~/gu, '~0').replace(/\//gu, '~1') }
function fitsImportLimit(value: unknown): boolean { try { return new TextEncoder().encode(JSON.stringify(value)).byteLength <= CSV_POLICY.maxImportBytes } catch { return false } }
