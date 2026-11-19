import { AsyncDuckDB, ConsoleLogger, DuckDBDataProtocol } from '@duckdb/duckdb-wasm'
import type { CsvColumnDefinition, CsvFileProfile, CsvQueryPage, CsvQueryRequest, CsvSample } from '../../domain/csv-views/model'
import { CsvQueryError } from '../../domain/csv-views/model'
import { parseCell } from '../../domain/csv-views/typing'
import { CSV_POLICY } from '../../domain/csv-views/policy'
import { ensureRuntimeAssetGroup } from '../pwa/runtimeAssets'
import { compileCsvGroupDiscovery, compileCsvQuery } from './sqlCompiler'
import type { CsvSourceFile } from './sampleFile'
import { csvCacheKey, getCsvCacheForSource, putCsvCache } from './opfsCache'
import type { CsvPreparedSource } from './utf8OpfsSource'

export class DuckDbCsvDataSource {
  private readonly fileName = `tv-csv-${crypto.randomUUID()}.csv`
  private file: CsvSourceFile
  private handle: FileSystemFileHandle | null
  private readonly sampleResult: CsvSample
  private profile: CsvFileProfile
  private database: AsyncDuckDB | null = null
  private connection: Awaited<ReturnType<AsyncDuckDB['connect']>> | null = null
  private disposed = false
  private activeQuery: string | null = null
  private generation = 1
  private readonly fileId: string
  private readonly documentId: string
  private readonly sourceRevision: string
  private readonly cacheEnabled: boolean
  private readonly queryFile: Promise<CsvPreparedSource> | null
  private readonly releaseQueryFile: (() => void) | null

  constructor(file: CsvSourceFile, handle: FileSystemFileHandle | null, sample: CsvSample, profile: CsvFileProfile, documentId: string, fileId: string, sourceRevision: string, cacheEnabled: boolean, queryFile: Promise<CsvPreparedSource> | null = null, releaseQueryFile: (() => void) | null = null) {
    this.file = file; this.handle = handle; this.sampleResult = sample; this.profile = profile; this.documentId = documentId; this.fileId = fileId; this.sourceRevision = sourceRevision; this.cacheEnabled = cacheEnabled; this.queryFile = queryFile; this.releaseQueryFile = releaseQueryFile
  }

  async sample(): Promise<CsvSample> { return this.sampleResult }
  async registerSnapshot(): Promise<void> { /* File-backed CSV keeps the Blob registered directly with DuckDB. */ }
  async setSchema(_documentId: string, _schemaRevision: number, columns: CsvColumnDefinition[]): Promise<void> {
    this.profile = { ...this.profile, columns }
  }

  async query(request: CsvQueryRequest, signal: AbortSignal): Promise<CsvQueryPage> {
    if (this.disposed) throw new CsvQueryError('engine-restarted', 'CSV 조회 엔진이 종료되었습니다.')
    if (signal.aborted) throw new CsvQueryError('cancelled', '조회가 취소되었습니다.')
    if (this.activeQuery) throw new CsvQueryError('budget-exceeded', '파일당 한 번에 하나의 조회만 실행할 수 있습니다.')
    this.activeQuery = request.queryId
    try {
      await this.initialize()
      if (signal.aborted) throw new CsvQueryError('cancelled', '조회가 취소되었습니다.')
      this.assertDataset(request.dataset)
      const width = Math.max(this.profile.columns.length, this.sampleResult.header.length, ...this.sampleResult.records.map((row) => row.length), 0)
      const compiled = compileCsvQuery(request, this.profile, this.fileName, width)
      const statement = await this.connection!.prepare(compiled.sql)
      let abortTimer: number | undefined
      const onAbort = () => {
        void this.connection?.cancelSent().catch(() => false)
        abortTimer = window.setTimeout(() => { void this.restartEngine() }, CSV_POLICY.cancelGraceMs)
      }
      signal.addEventListener('abort', onAbort, { once: true })
      try {
        const stream = await statement.send(...compiled.params)
        const rows: CsvQueryPage['rows'] = []
        let bytes = 0
        let hasExtra = false
        for await (const batch of stream) {
          if (signal.aborted) throw new CsvQueryError('cancelled', '조회가 취소되었습니다.')
          const recordNumbers = batch.getChildAt(0)
          for (let index = 0; index < batch.numRows; index += 1) {
            if (rows.length >= Math.min(CSV_POLICY.pageSize, request.limit)) { hasExtra = true; break }
            const recordNo = String(recordNumbers?.get(index) ?? '')
            const cells: CsvQueryPage['rows'][number]['cells'] = {}
            for (let columnIndex = 0; columnIndex < compiled.resultColumns.length; columnIndex += 1) {
              const item = compiled.resultColumns[columnIndex]!
              const rawValue = batch.getChildAt(columnIndex + 1)?.get(index)
              const raw = rawValue === null || rawValue === undefined ? undefined : String(rawValue)
              const column = this.profile.columns.find((candidate) => candidate.id === item.id)
              if (!column) throw new CsvQueryError('invalid-request', `컬럼 설정을 찾을 수 없습니다: ${item.id}`)
              const cell = parseCell(column, raw)
              cells[item.id] = cell
              bytes += new TextEncoder().encode(JSON.stringify(cell)).byteLength
            }
            if (bytes > request.maxResultBytes) throw new CsvQueryError('budget-exceeded', '조회 결과 페이지가 메모리 한도를 넘었습니다. 표시 컬럼을 줄이세요.')
            rows.push({ rowId: `${request.dataset.sourceRevision}:${recordNo}`, recordNo, cells })
          }
          if (hasExtra) break
        }
        const hasMore = hasExtra
        const offset = request.cursor === null ? 0 : Number(request.cursor)
        const nextCursor = hasMore ? String(offset + rows.length) : null
        return { dataset: request.dataset, requestId: request.requestId, queryId: request.queryId, engineGeneration: this.generation, rows, nextCursor, hasMore, total: { status: 'unknown' }, diagnostics: [] }
      } finally {
        signal.removeEventListener('abort', onAbort)
        if (abortTimer !== undefined) window.clearTimeout(abortTimer)
        await statement.close().catch(() => undefined)
      }
    } catch (error) {
      if (signal.aborted) throw new CsvQueryError('cancelled', '조회가 취소되었습니다.')
      if (error instanceof CsvQueryError) throw error
      throw new CsvQueryError('internal', error instanceof Error ? error.message : 'DuckDB CSV 조회에 실패했습니다.')
    } finally { if (this.activeQuery === request.queryId) this.activeQuery = null }
  }

  async discoverGroups(request: { requestId: string; queryId: string; dataset: CsvQueryRequest['dataset']; columnId: string; filter: CsvQueryRequest['filter']; limit: number }, signal: AbortSignal): Promise<{ keys: string[]; complete: boolean }> {
    if (this.disposed) throw new CsvQueryError('engine-restarted', 'CSV 조회 엔진이 종료되었습니다.')
    if (signal.aborted) throw new CsvQueryError('cancelled', '그룹 조회가 취소되었습니다.')
    if (this.activeQuery) throw new CsvQueryError('budget-exceeded', '파일당 한 번에 하나의 조회만 실행할 수 있습니다.')
    this.activeQuery = request.queryId
    try {
      await this.initialize()
      if (signal.aborted) throw new CsvQueryError('cancelled', '그룹 조회가 취소되었습니다.')
      this.assertDataset(request.dataset)
      const width = Math.max(this.profile.columns.length, this.sampleResult.header.length, ...this.sampleResult.records.map((row) => row.length), 0)
      const compiled = compileCsvGroupDiscovery(request, this.profile, this.fileName, width)
      const statement = await this.connection!.prepare(compiled.sql)
      let abortTimer: number | undefined
      const onAbort = () => { void this.connection?.cancelSent().catch(() => false); abortTimer = window.setTimeout(() => { void this.restartEngine() }, CSV_POLICY.cancelGraceMs) }
      signal.addEventListener('abort', onAbort, { once: true })
      try {
        const stream = await statement.send(...compiled.params)
        const keys: string[] = []
        let complete = true
        for await (const batch of stream) {
          if (signal.aborted) throw new CsvQueryError('cancelled', '그룹 조회가 취소되었습니다.')
          for (let index = 0; index < batch.numRows; index += 1) {
            const state = String(batch.getChildAt(0)?.get(index) ?? 'invalid')
            const rawValue = batch.getChildAt(1)?.get(index)
            if (state === 'value') {
              const value = this.profile.columns.find((column) => column.id === request.columnId)?.type === 'boolean' ? String(rawValue).replace(/[A-Z]/gu, (letter) => String.fromCharCode(letter.charCodeAt(0) + 32)) === 'true' : String(rawValue ?? '')
              keys.push(JSON.stringify({ state, value }))
            } else keys.push(JSON.stringify({ state }))
            if (keys.length > request.limit) { complete = false; break }
          }
          if (!complete) break
        }
        return { keys: keys.slice(0, request.limit), complete }
      } finally {
        signal.removeEventListener('abort', onAbort)
        if (abortTimer !== undefined) window.clearTimeout(abortTimer)
        await statement.close().catch(() => undefined)
      }
    } catch (error) {
      if (signal.aborted) throw new CsvQueryError('cancelled', '그룹 조회가 취소되었습니다.')
      if (error instanceof CsvQueryError) throw error
      throw new CsvQueryError('internal', error instanceof Error ? error.message : 'CSV 그룹 조회에 실패했습니다.')
    } finally { if (this.activeQuery === request.queryId) this.activeQuery = null }
  }

  async cancel(queryId: string): Promise<void> {
    if (queryId !== this.activeQuery) return
    await this.connection?.cancelSent().catch(() => false)
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.generation += 1
    await this.connection?.close().catch(() => undefined)
    this.connection = null
    await this.database?.dropFile(this.fileName).catch(() => undefined)
    await this.database?.terminate().catch(() => undefined)
    this.database = null
    this.releaseQueryFile?.()
  }

  private async initialize(): Promise<void> {
    if (this.connection) return
    if (this.queryFile) {
      const prepared = await this.queryFile
      this.file = prepared.file
      this.handle = prepared.handle
    }
    await ensureRuntimeAssetGroup('csvQuery')
    const base = typeof __APP_BASE__ === 'string' ? __APP_BASE__ : '/'
    const workerUrl = new URL(`${base}csv-query/duckdb-browser-mvp.worker.js`, window.location.href)
    const moduleUrl = new URL(`${base}csv-query/duckdb-mvp.wasm`, window.location.href)
    const worker = new Worker(workerUrl, { name: 'duckdb-csv-query' })
    const database = new AsyncDuckDB(new ConsoleLogger(), worker)
    this.database = database
    await database.instantiate(moduleUrl.toString())
    await database.open({ maximumThreads: 1, query: { castBigIntToDouble: false, castDecimalToDouble: false, castTimestampToDate: false }, filesystem: { allowFullHTTPReads: false } })
    const signature = JSON.stringify({ size: this.file.size, lastModified: this.file.lastModified, sourceRevision: this.sourceRevision, parser: this.profile.parser })
    const cacheKey = csvCacheKey({ documentId: this.fileId, fileId: this.fileId, sourceRevision: this.sourceRevision, schemaRevision: this.profile.schemaRevision, condition: { kind: 'raw-source', parser: this.profile.parser }, sort: null, range: null, columnIds: [], engineGeneration: 1 })
    const cached = this.cacheEnabled ? await getCsvCacheForSource(cacheKey, signature).catch(() => null) : null
    if (cached) await database.registerFileHandle(this.fileName, cached, DuckDBDataProtocol.BROWSER_FSACCESS, false)
    else {
      if (this.handle) await database.registerFileHandle(this.fileName, this.handle, DuckDBDataProtocol.BROWSER_FSACCESS, false)
      else await database.registerFileHandle(this.fileName, this.file, DuckDBDataProtocol.BROWSER_FILEREADER, false)
      if (this.cacheEnabled && this.file.size <= CSV_POLICY.opfsCacheBytes) void putCsvCache(cacheKey, this.file, signature).catch(() => undefined)
    }
    this.connection = await database.connect()
  }

  private assertDataset(dataset: CsvQueryRequest['dataset']): void {
    if (dataset.documentId !== this.documentId || dataset.fileId !== this.fileId || dataset.sourceRevision !== this.sourceRevision || dataset.schemaRevision !== this.profile.schemaRevision) throw new CsvQueryError('stale-dataset', 'CSV 원본 또는 컬럼 설정이 바뀌었습니다.')
  }

  private async restartEngine(): Promise<void> {
    if (this.disposed) return
    this.generation += 1
    await this.connection?.close().catch(() => undefined)
    this.connection = null
    await this.database?.terminate().catch(() => undefined)
    this.database = null
  }
}
