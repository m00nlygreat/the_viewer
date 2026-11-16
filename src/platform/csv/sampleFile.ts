import Papa from 'papaparse'
import { CSV_POLICY } from '../../domain/csv-views/policy'
import type { CsvFileIdentity, CsvParserSettings, CsvSample } from '../../domain/csv-views/model'
import { readIdentity } from './fileIdentity'

export interface CsvSourceFile extends Blob { name: string; lastModified: number; type: string }

/** Reads only the bounded prefix required for column setup; the source Blob stays external. */
export async function readCsvSample(file: CsvSourceFile, settings?: Partial<CsvParserSettings>, signal?: AbortSignal): Promise<{ sample: CsvSample; parser: CsvParserSettings }> {
  if (signal?.aborted) throw abortError()
  const parser: CsvParserSettings = {
    encoding: settings?.encoding ?? 'utf-8', bom: settings?.bom ?? 'auto', hasHeader: settings?.hasHeader ?? true,
    delimiter: settings?.delimiter ?? ',', quote: settings?.quote ?? '"', escape: settings?.escape ?? 'double-quote', newline: settings?.newline ?? 'auto'
  }
  const records: string[][] = []
  let bytesRead = 0
  let stoppedBy: CsvSample['stoppedBy'] = 'eof'
  let detectedDelimiter = parser.delimiter
  const maxRecords = CSV_POLICY.sampleRecords + (parser.hasHeader ? 1 : 0)
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: Error) => { if (settled) return; settled = true; signal?.removeEventListener('abort', onAbort); error ? reject(error) : resolve() }
    const onAbort = () => { stoppedBy = 'records'; finish(abortError()) }
    signal?.addEventListener('abort', onAbort, { once: true })
    Papa.parse<string[]>(file as File, {
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
