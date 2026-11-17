import Papa from 'papaparse'
import { CSV_POLICY } from '../../domain/csv-views/policy'
import type { CsvFileIdentity, CsvParserSettings, CsvSample } from '../../domain/csv-views/model'
import { readIdentity } from './fileIdentity'

export interface CsvSourceFile extends Blob { name: string; lastModified: number; type: string }
export interface CsvByteRangePage {
  rows: string[][]
  firstRecordNo: number | null
  startByte: number
  endByte: number
  nextOffset: number
  nextRecordOrdinal: number
  hasMore: boolean
}

export async function readCsvByteRange(file: CsvSourceFile, settings: CsvParserSettings, options: {
  offset: number; exactBoundary?: boolean; recordOrdinal?: number; maxBytes?: number; maxRecords?: number; signal?: AbortSignal
}): Promise<CsvByteRangePage> {
  const { offset, signal } = options
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('바이트 위치가 올바르지 않습니다.')
  if (!['utf-8', 'utf8'].includes(settings.encoding.toLowerCase())) throw new Error('원본 범위 조회에는 UTF-8로 변환된 입력이 필요합니다.')
  const maxBytes = options.maxBytes ?? CSV_POLICY.sampleFirstChunkBytes
  const maxRecords = options.maxRecords ?? CSV_POLICY.pageSize
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || !Number.isSafeInteger(maxRecords) || maxRecords <= 0) throw new Error('원본 범위 크기가 올바르지 않습니다.')

  const target = Math.min(offset, file.size)
  let position = options.exactBoundary ? target : 0
  let recordOrdinal = options.exactBoundary ? options.recordOrdinal ?? 0 : 0
  let recordStart = position
  let startByte = options.exactBoundary || target === 0 ? position : -1
  let rangeEnd = position
  let aligned = options.exactBoundary === true || target === 0
  let collecting = aligned
  let inQuotes = false
  let atFieldStart = true
  let escapeNext = false
  let pendingQuote = false
  let pendingCr = false
  let finished = false
  let firstRecordNo: number | null = null
  const recordBufferBytes = 64 * 1024
  let recordChunks: Uint8Array[] = []
  let recordBuffer = new Uint8Array(recordBufferBytes)
  let recordBufferLength = 0
  let recordByteLength = 0
  const rows: string[][] = []
  const decoder = new TextDecoder(settings.encoding, { fatal: true, ignoreBOM: true })
  const quoteByte = settings.quote === null ? null : asciiByte(settings.quote, '인용 부호')
  const delimiterByte = asciiByte(settings.delimiter, '구분자')
  const escapeByte = settings.escape === 'backslash' ? 0x5c : quoteByte
  const prefix = new Uint8Array(await file.slice(0, 3).arrayBuffer())
  const hasUtf8Bom = settings.bom !== 'absent' && prefix[0] === 0xef && prefix[1] === 0xbb && prefix[2] === 0xbf
  const append = (byte: number) => {
    if (!collecting) return
    if (recordByteLength >= CSV_POLICY.sampleBytes) throw new Error('원본 레코드가 8 MiB 제한을 넘었습니다. 더 작은 범위나 다른 입력을 사용해 주세요.')
    if (recordBufferLength === recordBuffer.length) { recordChunks.push(recordBuffer); recordBuffer = new Uint8Array(recordBufferBytes); recordBufferLength = 0 }
    recordBuffer[recordBufferLength++] = byte
    recordByteLength += 1
  }
  const finishRecord = (boundary: number) => {
    if (collecting) {
      const bytes = new Uint8Array(recordByteLength)
      let byteOffset = 0
      for (const chunk of recordChunks) { bytes.set(chunk, byteOffset); byteOffset += chunk.length }
      bytes.set(recordBuffer.subarray(0, recordBufferLength), byteOffset)
      let text = decoder.decode(bytes)
      if (recordOrdinal === 0 && settings.bom !== 'absent' && text.startsWith('\uFEFF')) text = text.slice(1)
      const parsed = Papa.parse<string[]>(text, {
        delimiter: settings.delimiter, quoteChar: settings.quote ?? undefined,
        escapeChar: settings.escape === 'backslash' ? '\\' : settings.quote ?? undefined,
        dynamicTyping: false, skipEmptyLines: false
      })
      if (parsed.errors.length) throw new Error(parsed.errors[0]?.message ?? 'CSV 원본 레코드를 해석하지 못했습니다.')
      if (!(settings.hasHeader && recordOrdinal === 0)) {
        firstRecordNo ??= settings.hasHeader ? recordOrdinal : recordOrdinal + 1
        rows.push((parsed.data[0] ?? []).map((value) => String(value ?? '')))
      }
    }
    recordOrdinal += 1
    recordChunks = []; recordBufferLength = 0; recordByteLength = 0
    inQuotes = false; atFieldStart = true; escapeNext = false; pendingQuote = false
    recordStart = boundary
    if (!aligned) {
      if (boundary >= target) { aligned = true; collecting = true; startByte = boundary; rangeEnd = boundary }
    } else {
      collecting = true
      rangeEnd = boundary
      if (rows.length >= maxRecords || boundary - startByte >= maxBytes) finished = true
    }
  }
  const consume = (bytes: Uint8Array, baseOffset: number) => {
    for (let index = 0; index < bytes.length && !finished; index += 1) {
      const byte = bytes[index]!
      const absolute = baseOffset + index
      if (hasUtf8Bom && absolute < 3) { append(byte); continue }
      if (pendingCr) {
        pendingCr = false
        if (byte === 0x0a) { finishRecord(absolute + 1); continue }
        finishRecord(absolute)
        if (finished) break
      }
      if (pendingQuote) {
        if (byte === quoteByte) { append(byte); pendingQuote = false; atFieldStart = false; continue }
        pendingQuote = false; inQuotes = false; atFieldStart = false
      }
      if (escapeNext) { append(byte); escapeNext = false; continue }
      if (inQuotes) {
        if (settings.escape === 'backslash' && byte === escapeByte) { append(byte); escapeNext = true; continue }
        if (byte === quoteByte) { append(byte); pendingQuote = settings.escape === 'double-quote'; if (!pendingQuote) inQuotes = false; continue }
        append(byte); continue
      }
      if (byte === 0x0d) { pendingCr = true; continue }
      if (byte === 0x0a) { finishRecord(absolute + 1); continue }
      if (byte === quoteByte && atFieldStart) { append(byte); inQuotes = true; atFieldStart = false; continue }
      append(byte)
      atFieldStart = byte === delimiterByte
    }
  }

  while (position < file.size && !finished) {
    if (signal?.aborted) throw abortError()
    const end = Math.min(file.size, position + CSV_POLICY.sampleFirstChunkBytes)
    const chunk = new Uint8Array(await file.slice(position, end).arrayBuffer())
    consume(chunk, position)
    position = end
    if (position < file.size && !finished) await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
  }
  if (signal?.aborted) throw abortError()
  if (!finished) {
    if (pendingCr) { pendingCr = false; finishRecord(file.size) }
    else if (recordByteLength > 0 || inQuotes || pendingQuote || recordStart < file.size) finishRecord(file.size)
    rangeEnd = file.size
  }
  if (startByte < 0) startByte = rangeEnd
  return { rows, firstRecordNo, startByte, endByte: rangeEnd, nextOffset: rangeEnd, nextRecordOrdinal: recordOrdinal, hasMore: rangeEnd < file.size }
}

/** Reads only the bounded prefix required for column setup; the source Blob stays external. */
export async function readCsvSample(file: CsvSourceFile, settings?: Partial<CsvParserSettings>, signal?: AbortSignal): Promise<{ sample: CsvSample; parser: CsvParserSettings }> {
  if (signal?.aborted) throw abortError()
  const parser: CsvParserSettings = {
    encoding: settings?.encoding ?? 'utf-8', bom: settings?.bom ?? 'auto', hasHeader: settings?.hasHeader ?? true,
    delimiter: settings?.delimiter ?? ',', quote: settings?.quote ?? '"', escape: settings?.escape ?? 'double-quote', newline: settings?.newline ?? 'auto'
  }
  let sampleFile: File = file as File
  let prefixTruncated = false
  if (!['utf-8', 'utf8'].includes(parser.encoding.toLowerCase())) {
    const length = Math.min(file.size, CSV_POLICY.sampleBytes)
    const bytes = new Uint8Array(await file.slice(0, length).arrayBuffer())
    if (signal?.aborted) throw abortError()
    let decoded: string
    try { decoded = new TextDecoder(parser.encoding, { fatal: true, ignoreBOM: parser.bom === 'absent' }).decode(bytes, { stream: length < file.size }) }
    catch { throw new Error(`CSV 인코딩 “${parser.encoding}”을 표본에서 해석하지 못했습니다.`) }
    prefixTruncated = length < file.size
    if (prefixTruncated) decoded = decoded.slice(0, lastCompleteRecordBoundary(decoded, parser))
    if (!decoded && file.size > 0) throw new Error('첫 CSV 레코드가 표본 읽기 한도보다 커서 부분 표본을 만들지 못했습니다.')
    sampleFile = new File([decoded], file.name, { type: file.type || 'text/csv' })
  }
  const records: string[][] = []
  let bytesRead = 0
  let stoppedBy: CsvSample['stoppedBy'] = prefixTruncated ? 'bytes' : 'eof'
  let detectedDelimiter = parser.delimiter
  const maxRecords = CSV_POLICY.sampleRecords + (parser.hasHeader ? 1 : 0)
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: Error) => { if (settled) return; settled = true; signal?.removeEventListener('abort', onAbort); error ? reject(error) : resolve() }
    const onAbort = () => { stoppedBy = 'records'; finish(abortError()) }
    signal?.addEventListener('abort', onAbort, { once: true })
    Papa.parse<string[]>(sampleFile, {
      worker: true, header: false, dynamicTyping: false, skipEmptyLines: false, chunkSize: CSV_POLICY.sampleFirstChunkBytes,
      ...(settings?.delimiter ? { delimiter: settings.delimiter } : {}), quoteChar: parser.quote ?? undefined,
      escapeChar: parser.escape === 'backslash' ? '\\' : parser.quote ?? undefined,
      step(result, stream) {
        if (signal?.aborted) { stream.abort(); finish(abortError()); return }
        detectedDelimiter = result.meta.delimiter || detectedDelimiter
        const row = result.data.map((value) => String(value ?? ''))
        const rowBytes = row.reduce((sum, value) => sum + new TextEncoder().encode(value).byteLength, 0)
        if (records.length && bytesRead + rowBytes > CSV_POLICY.sampleBytes) { stoppedBy = 'bytes'; stream.abort(); finish(); return }
        records.push(row); bytesRead += rowBytes
        if (records.length >= maxRecords) { stoppedBy = 'records'; stream.abort(); finish() }
      },
      complete() { finish() },
      error(error) { finish(new Error(error.message || 'CSV 표본을 읽지 못했습니다.')) }
    })
  })
  if (signal?.aborted) throw abortError()
  parser.delimiter = detectedDelimiter.length === 1 ? detectedDelimiter : parser.delimiter
  const header = parser.hasHeader ? (records.shift() ?? []).map((value) => value === '' ? null : value) : Array.from({ length: Math.max(0, ...records.map((row) => row.length)) }, () => null)
  const sample: CsvSample = { header, records, firstRecordNo: 1, reachedEof: stoppedBy === 'eof', bytesRead, stoppedBy }
  return { sample, parser }
}

function lastCompleteRecordBoundary(text: string, parser: CsvParserSettings): number {
  let inQuotes = false
  let atFieldStart = true
  let lastBoundary = 0
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!
    if (inQuotes) {
      if (parser.escape === 'backslash' && character === '\\') { index += 1; continue }
      if (character === parser.quote) {
        if (parser.escape === 'double-quote' && text[index + 1] === parser.quote) { index += 1; continue }
        inQuotes = false
      }
      continue
    }
    if (parser.quote !== null && character === parser.quote && atFieldStart) { inQuotes = true; atFieldStart = false; continue }
    if (character === parser.delimiter) { atFieldStart = true; continue }
    if (character === '\r' || character === '\n') {
      if (character === '\r' && text[index + 1] === '\n') index += 1
      lastBoundary = index + 1
      atFieldStart = true
      continue
    }
    atFieldStart = false
  }
  return lastBoundary
}

export async function identifyCsvFile(file: CsvSourceFile, header: (string | null)[], folder: CsvFileIdentity['folder']): Promise<CsvFileIdentity> {
  const stableHeader = header.some((cell) => cell !== null) ? JSON.stringify(header) : null
  return readIdentity(file, stableHeader, folder)
}

export async function readCsvRecordPage(file: CsvSourceFile, settings: CsvParserSettings, offset: number, limit = 200, signal?: AbortSignal): Promise<{ rows: string[][]; hasMore: boolean }> {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('원본 위치가 올바르지 않습니다.')
  const rows: string[][] = []
  let recordNo = 0
  let hasMore = false
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: Error) => { if (settled) return; settled = true; signal?.removeEventListener('abort', onAbort); error ? reject(error) : resolve() }
    const onAbort = () => finish(abortError())
    signal?.addEventListener('abort', onAbort, { once: true })
    Papa.parse<string[]>(file as File, {
      worker: true, header: false, dynamicTyping: false, skipEmptyLines: false, chunkSize: CSV_POLICY.sampleFirstChunkBytes,
      delimiter: settings.delimiter, quoteChar: settings.quote ?? undefined,
      escapeChar: settings.escape === 'backslash' ? '\\' : settings.quote ?? undefined,
      step(result, stream) {
        if (signal?.aborted) { stream.abort(); finish(abortError()); return }
        const row = result.data.map((value) => String(value ?? ''))
        if (settings.hasHeader && recordNo === 0) { recordNo += 1; return }
        const logicalIndex = recordNo - (settings.hasHeader ? 1 : 0)
        recordNo += 1
        if (logicalIndex < offset) return
        if (rows.length >= limit) { hasMore = true; stream.abort(); finish(); return }
        rows.push(row)
      },
      complete() { finish() },
      error(error) { finish(new Error(error.message || 'CSV 원본 행을 읽지 못했습니다.')) }
    })
  })
  if (signal?.aborted) throw abortError()
  return { rows, hasMore }
}

function abortError(): DOMException { return new DOMException('CSV 표본 읽기가 취소되었습니다.', 'AbortError') }
function asciiByte(value: string, label: string): number {
  const bytes = new TextEncoder().encode(value)
  if (bytes.length !== 1) throw new Error(`${label}는 ASCII 한 글자여야 합니다.`)
  return bytes[0]!
}
