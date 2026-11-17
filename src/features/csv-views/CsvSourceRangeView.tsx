import { useEffect, useMemo, useRef, useState } from 'react'
import type { CsvParserSettings } from '../../domain/csv-views/model'
import { CSV_POLICY } from '../../domain/csv-views/policy'
import type { CsvByteRangePage, CsvSourceFile } from '../../platform/csv/sampleFile'
import { readCsvByteRange } from '../../platform/csv/sampleFile'
import type { CsvPreparedSource } from '../../platform/csv/utf8OpfsSource'

interface Request {
  offset: number
  exactBoundary: boolean
  recordOrdinal: number
  serial: number
}

const ROW_HEIGHT = 32
const OVERSCAN = 8

export function CsvSourceRangeView({ file, parser, header = [], preparedFile }: { file: CsvSourceFile; parser: CsvParserSettings; header?: (string | null)[]; preparedFile?: Promise<CsvPreparedSource> }) {
  const needsTranscode = !['utf-8', 'utf8'].includes(parser.encoding.toLowerCase())
  const [rangeFile, setRangeFile] = useState<CsvSourceFile | null>(needsTranscode ? null : file)
  const [prepareError, setPrepareError] = useState('')
  const rangeParser = useMemo<CsvParserSettings>(() => needsTranscode ? { ...parser, encoding: 'utf-8' } : parser, [needsTranscode, parser])
  const [request, setRequest] = useState<Request>({ offset: 0, exactBoundary: true, recordOrdinal: 0, serial: 0 })
  const [byteInput, setByteInput] = useState('0')
  const [page, setPage] = useState<CsvByteRangePage | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(560)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!needsTranscode) { setRangeFile(file); setPrepareError(''); return }
    if (!preparedFile) { setPrepareError('UTF-8 변환 입력을 찾지 못했습니다.'); return }
    let cancelled = false
    setRangeFile(null); setPrepareError('')
    void preparedFile.then((prepared) => { if (!cancelled) setRangeFile(prepared.file) })
      .catch((reason: unknown) => { if (!cancelled) setPrepareError(reason instanceof Error ? reason.message : 'UTF-8 임시 변환을 준비하지 못했습니다.') })
    return () => { cancelled = true }
  }, [file, needsTranscode, preparedFile])

  useEffect(() => {
    if (!rangeFile) { setBusy(needsTranscode && !prepareError); setPage(null); return }
    const abort = new AbortController()
    setBusy(true); setError(''); setPage(null); setScrollTop(0)
    if (scrollRef.current) scrollRef.current.scrollTop = 0
    void readCsvByteRange(rangeFile, rangeParser, {
      offset: request.offset, exactBoundary: request.exactBoundary, recordOrdinal: request.recordOrdinal,
      maxBytes: CSV_POLICY.sourceRangeBytes, maxRecords: CSV_POLICY.sourceRangeMaxRecords, signal: abort.signal
    }).then((result) => { if (!abort.signal.aborted) setPage(result) })
      .catch((reason: unknown) => { if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : '원본 바이트 범위를 읽지 못했습니다.') })
      .finally(() => { if (!abort.signal.aborted) setBusy(false) })
    return () => abort.abort()
  }, [needsTranscode, prepareError, rangeFile, rangeParser, request, retry])

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const updateSize = () => setViewportHeight(element.clientHeight)
    updateSize()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateSize)
    observer?.observe(element)
    return () => observer?.disconnect()
  }, [])

  const rows = page?.rows ?? []
  const width = Math.max(header.length, ...rows.map((row) => row.length), 0)
  const first = page?.firstRecordNo ?? 1
  const startRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const endRow = Math.min(rows.length, startRow + Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN * 2)
  const shownRows = rows.slice(startRow, endRow)
  const showHeader = Boolean(parser.hasHeader && page?.startByte === 0 && header.length)
  const targetByte = Number(byteInput)
  const canMove = Number.isSafeInteger(targetByte) && targetByte >= 0 && targetByte <= (rangeFile?.size ?? file.size)
  const rangeLabel = useMemo(() => page ? `${formatBytes(page.startByte)}–${formatBytes(page.endByte)} B` : '범위를 읽지 않음', [page])

  const moveToByte = () => {
    if (!canMove) return
    setRequest({ offset: targetByte, exactBoundary: false, recordOrdinal: 0, serial: request.serial + 1 })
  }
  const continueReading = () => {
    if (!page?.hasMore) return
    setByteInput(String(page.nextOffset))
    setRequest({ offset: page.nextOffset, exactBoundary: true, recordOrdinal: page.nextRecordOrdinal, serial: request.serial + 1 })
  }

  return <section className="csv-source-range" aria-label="CSV 원본 바이트 범위">
    <div className="csv-source-range-guide" role="note"><strong>읽기 전용 원본</strong><span>{needsTranscode ? '표본을 표시한 뒤 OPFS에서 UTF-8 임시 파일로 변환합니다. 변환 중에는 파일 기반 조회가 준비 상태로 남고, 바이트 위치는 UTF-8 사본 기준입니다.' : '필요한 바이트 범위만 읽습니다. 전체 Monaco 모델과 전체 레코드 수는 만들지 않습니다.'}</span></div>
    <div className="csv-source-range-heading">
      <label>바이트 위치<input aria-label="이동할 바이트 위치" type="number" min={0} max={rangeFile?.size ?? file.size} step={1} value={byteInput} onChange={(event) => setByteInput(event.currentTarget.value)} /></label>
      <button className="subtle-button" type="button" disabled={busy || !canMove} onClick={moveToByte}>위치로 이동</button>
      <button className="secondary-button" type="button" disabled={busy || !page?.hasMore} onClick={continueReading}>이어 읽기</button>
      <span className="csv-source-range-spacer" />
      <span className="csv-source-range-bytes">{rangeLabel} / {formatBytes(rangeFile?.size ?? file.size)} B</span>
    </div>
    {needsTranscode && !rangeFile && !prepareError && <p className="csv-view-state" role="status">원본 인코딩 {parser.encoding.toUpperCase()}을 OPFS에서 UTF-8 임시 파일로 변환하는 중…</p>}
    {prepareError && <div className="csv-view-error" role="alert"><p>{prepareError}</p><small>원본 다운로드와 보기 설정은 계속 사용할 수 있습니다.</small></div>}
    {busy && rangeFile && <p className="csv-view-state" role="status">바이트 범위와 CSV 레코드 경계를 읽는 중…</p>}
    {error && <div className="csv-view-error" role="alert"><p>{error}</p><small>다른 바이트 위치로 이동하거나 원본 인코딩과 파서 설정을 확인해 다시 시도하세요.</small><div><button className="subtle-button" type="button" onClick={() => setRetry((value) => value + 1)}>다시 시도</button><button className="subtle-button" type="button" disabled={request.offset === 0} onClick={() => { setByteInput('0'); setRequest({ offset: 0, exactBoundary: true, recordOrdinal: 0, serial: request.serial + 1 }) }}>첫 범위로 이동</button></div></div>}
    {!busy && !error && page && <div ref={scrollRef} className="csv-source-range-table" role="region" aria-label="CSV 원본 레코드" onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
      <table><thead>{showHeader && <tr><th scope="col">헤더</th>{Array.from({ length: width }, (_, index) => <th scope="col" key={index}>{header[index] ?? `열 ${index + 1}`}</th>)}</tr>}</thead><tbody>
        {startRow > 0 && <tr className="csv-source-range-spacer" aria-hidden="true"><td colSpan={width + 1} style={{ height: startRow * ROW_HEIGHT }} /></tr>}
        {shownRows.map((row, relativeIndex) => {
          const rowIndex = startRow + relativeIndex
          return <tr key={`${page.startByte}-${rowIndex}`}><th scope="row">{first + rowIndex}</th>{Array.from({ length: width }, (_, index) => <td key={index} title={row[index] ?? '누락'}>{row[index] ?? <span className="csv-view-cell missing">누락</span>}</td>)}</tr>
        })}
        {endRow < rows.length && <tr className="csv-source-range-spacer" aria-hidden="true"><td colSpan={width + 1} style={{ height: (rows.length - endRow) * ROW_HEIGHT }} /></tr>}
        {rows.length === 0 && <tr><td colSpan={width + 1}>이 범위에 완성된 레코드가 없습니다. 다른 바이트 위치로 이동해 보세요.</td></tr>}
      </tbody></table>
    </div>}
    <footer className="csv-view-statusbar"><span>{rangeLabel}</span><span>{rows.length ? `${first}–${first + rows.length - 1}행 확보` : busy ? '범위 읽는 중' : '현재 범위에 행 없음'}</span><span>전체 행 수 미확인 · 파일 {formatBytes(rangeFile?.size ?? file.size)} B</span><span className="csv-view-status-spacer" />{page?.hasMore ? '다음 범위가 있습니다.' : page ? '파일 끝까지 읽었습니다.' : `${parser.encoding.toUpperCase()} · 읽기 전용`}</footer>
  </section>
}

function formatBytes(value: number): string {
  return Math.max(0, Math.floor(value)).toLocaleString()
}
