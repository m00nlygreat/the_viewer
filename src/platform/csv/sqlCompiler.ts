import type { CsvColumnDefinition, CsvFileProfile, CsvFilter, CsvQueryRequest } from '../../domain/csv-views/model'
import { parseConstant } from '../../domain/csv-views/typing'
import { decodeGroupKey } from '../../domain/csv-views/query'

export interface CompiledCsvQuery { sql: string; params: unknown[]; resultColumns: { id: string; sourceIndex: number }[] }

/** Builds a parameterized query. File names never become SQL identifiers. */
export function compileCsvQuery(request: CsvQueryRequest, profile: CsvFileProfile, internalFileName: string, width: number): CompiledCsvQuery {
  const columns = new Map(profile.columns.map((column) => [column.id, column]))
  const params: unknown[] = []
  const aliases = Array.from({ length: width }, (_, index) => `c${index}`)
  const columnsStruct = aliases.map((alias) => `${sqlString(alias)}: 'VARCHAR'`).join(', ')
  const csvOptions = [
    `header = false`,
    `skip = ${profile.parser.hasHeader ? 1 : 0}`,
    `auto_detect = false`,
    `columns = {${columnsStruct}}`,
    `delim = ${sqlString(profile.parser.delimiter)}`,
    `quote = ${profile.parser.quote === null ? "''" : sqlString(profile.parser.quote)}`,
    `escape = ${sqlString(profile.parser.escape === 'double-quote' ? profile.parser.quote ?? '"' : '\\')}`,
    `force_not_null = [${aliases.map(sqlString).join(', ')}]`,
    `null_padding = true`
  ].join(', ')
  const table = `read_csv(${sqlString(internalFileName)}, ${csvOptions})`
  const requested = [...new Set(request.columnIds)].flatMap((id) => { const column = columns.get(id); return column ? [{ id, sourceIndex: column.sourceIndex }] : [] })
  if (requested.length !== new Set(request.columnIds).size) throw new Error('조회 요청에 알 수 없는 컬럼이 있습니다.')
  const where: string[] = []
  if (request.filter) where.push(compileFilter(request.filter, columns, params))
  if (request.scope.kind === 'group') {
    const column = requireColumn(columns, request.scope.columnId)
    const group = decodeGroupKey(request.scope.key)
    if (!group) throw new Error('그룹 범위 키가 올바르지 않습니다.')
    if (group.state !== 'value') { where.push(`${stateExpression(column)} = ?`); params.push(group.state) }
    else {
      where.push(`(${stateExpression(column)} = 'value' AND ${valueExpression(column)} = ${typedParameter(column)})`)
      params.push(group.value === true ? true : group.value === false ? false : String(group.value))
    }
  } else if (request.scope.kind === 'calendar') {
    const column = requireColumn(columns, request.scope.columnId)
    where.push(`${valueExpression(column)} >= ? AND ${valueExpression(column)} < ?`); params.push(request.scope.start, request.scope.end)
  }
  const selected = requested.map((item) => `"c${item.sourceIndex}"`).join(', ')
  const sort = request.sort.map((item) => {
    const column = requireColumn(columns, item.columnId)
    const state = stateExpression(column)
    return `CASE WHEN ${state} = 'value' THEN 0 WHEN ${state} = 'empty' THEN 1 WHEN ${state} = 'missing' THEN 2 WHEN ${state} = 'null-marker' THEN 3 ELSE 4 END ASC, ${valueExpression(column)} ${item.direction.toUpperCase()}`
  })
  const orderBy = request.sort.length ? `ORDER BY ${[...sort, '"__record_no" ASC'].join(', ')}` : ''
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const offset = request.cursor === null ? 0 : Number(request.cursor)
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('조회 cursor가 올바르지 않습니다.')
  const sql = `WITH raw_rows AS (SELECT row_number() OVER () AS "__record_no", * FROM ${table}) SELECT "__record_no"${selected ? `, ${selected}` : ''} FROM raw_rows ${whereSql} ${orderBy} LIMIT ? OFFSET ?`
  params.push(Math.min(200, request.limit) + 1, offset)
  return { sql, params, resultColumns: requested }
}

export function compileCsvGroupDiscovery(request: { dataset: CsvQueryRequest['dataset']; filter: CsvQueryRequest['filter']; columnId: string; limit: number }, profile: CsvFileProfile, internalFileName: string, width: number): CompiledCsvQuery {
  const columns = new Map(profile.columns.map((column) => [column.id, column]))
  const column = requireColumn(columns, request.columnId)
  const aliases = Array.from({ length: width }, (_, index) => `c${index}`)
  const columnsStruct = aliases.map((alias) => `${sqlString(alias)}: 'VARCHAR'`).join(', ')
  const csvOptions = [
    'header = false', `skip = ${profile.parser.hasHeader ? 1 : 0}`, 'auto_detect = false', `columns = {${columnsStruct}}`,
    `delim = ${sqlString(profile.parser.delimiter)}`, `quote = ${profile.parser.quote === null ? "''" : sqlString(profile.parser.quote)}`,
    `escape = ${sqlString(profile.parser.escape === 'double-quote' ? profile.parser.quote ?? '"' : '\\')}`,
    `force_not_null = [${aliases.map(sqlString).join(', ')}]`, 'null_padding = true'
  ].join(', ')
  const params: unknown[] = []
  const where = request.filter ? `WHERE ${compileFilter(request.filter, columns, params)}` : ''
  const state = stateExpression(column)
  const value = valueExpression(column)
  params.push(Math.min(101, Math.max(1, request.limit + 1)))
  const sql = `SELECT DISTINCT ${state} AS "__state", CAST(${value} AS VARCHAR) AS "__value" FROM read_csv(${sqlString(internalFileName)}, ${csvOptions}) ${where} ORDER BY "__state", "__value" LIMIT ?`
  return { sql, params, resultColumns: [{ id: column.id, sourceIndex: column.sourceIndex }] }
}

function compileFilter(filter: CsvFilter, columns: ReadonlyMap<string, CsvColumnDefinition>, params: unknown[]): string {
  if (filter.op === 'and' || filter.op === 'or') return `(${filter.children.map((child) => compileFilter(child, columns, params)).join(` ${filter.op.toUpperCase()} `) || (filter.op === 'and' ? 'TRUE' : 'FALSE')})`
  if (filter.op === 'not') return `(NOT ${compileFilter(filter.child, columns, params)})`
  if (!('columnId' in filter)) throw new Error('필터 조건이 올바르지 않습니다.')
  const column = requireColumn(columns, filter.columnId)
  const raw = rawExpression(column)
  const state = stateExpression(column)
  if (filter.op === 'is' || filter.op === 'isNot') {
    const condition = stateCondition(column, filter.state)
    return filter.op === 'is' ? condition : `(NOT ${condition})`
  }
  if (filter.op === 'contains' || filter.op === 'startsWith') {
    if (column.type !== 'text') throw new Error('텍스트 검색은 텍스트 컬럼에서만 사용할 수 있습니다.')
    const expression = filter.ignoreCase === 'ascii' ? `translate(${raw}, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')` : raw
    const value = filter.ignoreCase === 'ascii' ? asciiLower(filter.value) : filter.value
    params.push(filter.op === 'contains' ? value : value)
    return `(${state} = 'value' AND ${filter.op === 'contains' ? `contains(${expression}, ?)` : `starts_with(${expression}, ?)`})`
  }
  if ((filter.op === 'in' || filter.op === 'notIn') && 'optionIds' in filter) {
    if (column.type !== 'select') throw new Error('선택형 비교는 단일 선택 컬럼에서만 사용할 수 있습니다.')
    const options = filter.optionIds.flatMap((id) => { const option = column.parse.options.find((item) => item.id === id); return option ? [option] : [] })
    if (options.length !== filter.optionIds.length) throw new Error('저장된 선택지 ID를 찾을 수 없습니다.')
    if (!options.length) return filter.op === 'in' ? 'FALSE' : 'TRUE'
    params.push(...options.map((option) => option.raw))
    const condition = `${state} = 'value' AND ${raw} IN (${options.map(() => '?').join(', ')})`
    if (filter.op === 'in') return `(${condition})`
    params.push(...options.map((option) => option.raw))
    return `(${state} = 'value' AND NOT (${raw} IN (${options.map(() => '?').join(', ')})))`
  }
  if ((filter.op === 'hasAny' || filter.op === 'hasAll') && 'optionIds' in filter) {
    if (column.type !== 'multiSelect') throw new Error('다중 선택 비교는 다중 선택 컬럼에서만 사용할 수 있습니다.')
    const options = filter.optionIds.flatMap((id) => { const option = column.parse.options.find((item) => item.id === id); return option ? [option.raw] : [] })
    if (options.length !== filter.optionIds.length) throw new Error('저장된 선택지 ID를 찾을 수 없습니다.')
    if (!options.length) return filter.op === 'hasAll' ? 'TRUE' : 'FALSE'
    const array = `string_to_array(${raw}, ${sqlString(column.parse.separator)})`
    return filter.op === 'hasAny'
      ? `(${state} = 'value' AND list_has_any(${array}, [${options.map((value) => { params.push(value); return '?' }).join(', ')}]))`
      : `(${state} = 'value' AND list_has_all(${array}, [${options.map((value) => { params.push(value); return '?' }).join(', ')}]))`
  }
  if (!('value' in filter)) throw new Error('필터 상수가 없습니다.')
  const constant = parseConstant(column, filter.value)
  if (constant.state !== 'value') throw new Error('필터 값이 컬럼 타입 규칙에 맞지 않습니다.')
  const cast = column.type === 'integer' || column.type === 'decimal' ? 'CAST(? AS DECIMAL(38, 18))' : column.type === 'date' ? 'CAST(? AS DATE)' : column.type === 'datetime' ? 'CAST(? AS TIMESTAMPTZ)' : '?'
  params.push(typeof constant.value === 'boolean' ? constant.value : Array.isArray(constant.value) ? constant.value.join(',') : constant.value)
  const operator = ({ eq: '=', neq: '<>', lt: '<', lte: '<=', gt: '>', gte: '>=' } as const)[filter.op]
  return `(${state} = 'value' AND ${valueExpression(column)} ${operator} ${cast})`
}

function stateExpression(column: CsvColumnDefinition): string {
  const raw = rawExpression(column)
  const empty = `${raw} = ''`
  const markers = column.nullMarkers.length ? `${raw} IN (${column.nullMarkers.map(sqlString).join(', ')})` : 'FALSE'
  return `CASE WHEN ${raw} IS NULL THEN 'missing' WHEN ${empty} THEN 'empty' WHEN ${markers} THEN 'null-marker' WHEN ${valueExpression(column)} IS NOT NULL THEN 'value' ELSE 'invalid' END`
}
function stateCondition(column: CsvColumnDefinition, state: string): string {
  if (state === 'value') return `(${stateExpression(column)} = 'value')`
  if (state === 'empty') return `(${rawExpression(column)} = '')`
  if (state === 'missing') return `(${rawExpression(column)} IS NULL)`
  if (state === 'null-marker') return column.nullMarkers.length ? `(${rawExpression(column)} IN (${column.nullMarkers.map(sqlString).join(', ')}))` : 'FALSE'
  return `(${rawExpression(column)} IS NOT NULL AND ${rawExpression(column)} <> '' AND ${stateExpression(column)} = 'invalid')`
}
function valueExpression(column: CsvColumnDefinition): string {
  const raw = rawExpression(column)
  switch (column.type) {
    case 'text': return raw
    case 'integer': return `CASE WHEN regexp_full_match(${integerNormalized(column)}, '${column.parse.allowPlusSign ? '[+\\-]?' : '-?'}[0-9]+') THEN TRY_CAST(${integerNormalized(column)} AS DECIMAL(38, 0)) END`
    case 'decimal': return `CASE WHEN regexp_full_match(${decimalNormalized(column)}, '${column.parse.decimalSeparator === '.' ? '-?[0-9]+(\\.[0-9]+)?' : '-?[0-9]+(,[0-9]+)?'}') THEN TRY_CAST(replace(${decimalNormalized(column)}, ${sqlString(column.parse.decimalSeparator)}, '.') AS DECIMAL(38, ${column.parse.scale})) END`
    case 'boolean': {
      const norm = column.parse.ignoreCase === 'ascii' ? `translate(${raw}, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')` : raw
      const pairs = [...column.parse.trueValues.map((value) => [value, 'TRUE'] as const), ...column.parse.falseValues.map((value) => [value, 'FALSE'] as const)]
      return `CASE ${pairs.map(([value, result]) => `WHEN ${norm} = ${sqlString(column.parse.ignoreCase === 'ascii' ? asciiLower(value) : value)} THEN ${result}`).join(' ')} END`
    }
    case 'date': return column.parse.formats.some((format) => format === 'YYYY-MM-DD') ? `TRY_CAST(${raw} AS DATE)` : `TRY_CAST(strptime(${raw}, ${sqlString(dateStrptime(column.parse.formats[0] ?? 'YYYY-MM-DD'))}) AS DATE)`
    case 'datetime': return `TRY_CAST(${raw} AS TIMESTAMPTZ)`
    case 'select': {
      const pairs = column.parse.options.map((option) => `WHEN ${raw} = ${sqlString(option.raw)} THEN ${sqlString(option.id)}`).join(' ')
      return `CASE ${pairs} ${column.parse.closed ? '' : `ELSE ${raw}`} END`
    }
    case 'multiSelect': return `CASE WHEN list_contains(string_to_array(${raw}, ${sqlString(column.parse.separator)}), '') THEN NULL ELSE string_to_array(${raw}, ${sqlString(column.parse.separator)}) END`
  }
}
function typedParameter(column: CsvColumnDefinition): string {
  if (column.type === 'integer') return 'CAST(? AS DECIMAL(38, 0))'
  if (column.type === 'decimal') return `CAST(? AS DECIMAL(38, ${column.parse.scale}))`
  if (column.type === 'date') return 'CAST(? AS DATE)'
  if (column.type === 'datetime') return 'CAST(? AS TIMESTAMPTZ)'
  if (column.type === 'boolean') return 'CAST(? AS BOOLEAN)'
  return '?'
}
function integerNormalized(column: Extract<CsvColumnDefinition, { type: 'integer' }>): string {
  let expression = rawExpression(column)
  if (column.parse.thousandsSeparator) expression = `replace(${expression}, ${sqlString(column.parse.thousandsSeparator)}, '')`
  if (column.parse.allowPlusSign) expression = `regexp_replace(${expression}, '^\\+', '')`
  if (column.parse.allowFullWidthDigits) expression = `translate(${expression}, '０１２３４５６７８９', '0123456789')`
  return expression
}
function decimalNormalized(column: Extract<CsvColumnDefinition, { type: 'decimal' }>): string {
  let expression = rawExpression(column)
  if (column.parse.thousandsSeparator) expression = `replace(${expression}, ${sqlString(column.parse.thousandsSeparator)}, '')`
  for (const symbol of column.parse.currencySymbols) expression = `replace(${expression}, ${sqlString(symbol)}, '')`
  if (column.parse.allowBareFraction) expression = `regexp_replace(${expression}, '^(-?)\\.', '\\10.')`
  return expression
}
function rawExpression(column: CsvColumnDefinition): string { return `"c${column.sourceIndex}"` }
function requireColumn(columns: ReadonlyMap<string, CsvColumnDefinition>, id: string): CsvColumnDefinition { const column = columns.get(id); if (!column) throw new Error(`알 수 없는 컬럼입니다: ${id}`); return column }
function sqlString(value: string): string { return `'${value.replaceAll("'", "''")}'` }
function asciiLower(value: string): string { return value.replace(/[A-Z]/gu, (char) => String.fromCharCode(char.charCodeAt(0) + 32)) }
function dateStrptime(value: string): string { return value.replace('YYYY', '%Y').replace('MM', '%m').replace('DD', '%d') }
