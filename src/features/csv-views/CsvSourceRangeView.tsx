import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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

const ESTIMATED_ROW_HEIGHT = 35
const OVERSCAN = 8

export function CsvSourceRangeView({ file, parser, preparedFile }: { file: CsvSourceFile; parser: CsvParserSettings; header?: (string | null)[]; preparedFile?: Promise<CsvPreparedSource> }) {
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
  const [measureRevision, setMeasureRevision] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const measuredHeights = useRef(new Map<string, number>())

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
    setBusy(true); setError(''); setPage(null); setScrollTop(0); measuredHeights.current.clear(); setMeasureRevision(0)
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

  const records = page?.rawRecords ?? []
  const first = page?.firstRecordNo ?? 1
  const offsets: number[] = []
  let totalHeight = 0
  for (const record of records) {
    offsets.push(totalHeight)
    totalHeight += measuredHeights.current.get(`${record.startByte}:${record.recordNo}`) ?? ESTIMATED_ROW_HEIGHT
  }
  let firstVisible = 0
  while (firstVisible < records.length && offsets[firstVisible]! + (measuredHeights.current.get(`${records[firstVisible]!.startByte}:${records[firstVisible]!.recordNo}`) ?? ESTIMATED_ROW_HEIGHT) < scrollTop) firstVisible += 1
  const startRow = Math.max(0, firstVisible - OVERSCAN)
  let endRow = firstVisible
  while (endRow < records.length && offsets[endRow]! < scrollTop + viewportHeight) endRow += 1
  endRow = Math.min(records.length, endRow + OVERSCAN)
  const shownRows = records.slice(startRow, endRow)
  const targetByte = Number(byteInput)
  const canMove = Number.isSafeInteger(targetByte) && targetByte >= 0 && targetByte <= (rangeFile?.size ?? file.size)
  const rangeLabel = useMemo(() => page ? `${formatBytes(page.startByte)}–${formatBytes(page.endByte)} B` : '범위를 읽지 않음', [page])

  useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element) return
    let changed = false
    for (const node of element.querySelectorAll<HTMLElement>('[data-source-line-key]')) {
      const key = node.dataset.sourceLineKey
      if (!key) continue
      const height = node.getBoundingClientRect().height
      if (height > 0 && Math.abs((measuredHeights.current.get(key) ?? 0) - height) > 1) {
        measuredHeights.current.set(key, height)
        changed = true
      }
    }
    if (changed) setMeasureRevision((value) => value + 1)
  }, [endRow, measureRevision, shownRows, startRow])

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
    <div className="csv-source-range-track" aria-label="파일 내 현재 바이트 범위">
      <span>{formatBytes(page?.startByte ?? 0)} B</span><div><i style={{ left: `${((page?.startByte ?? 0) / Math.max(1, rangeFile?.size ?? file.size)) * 100}%`, width: `${Math.max(1, (((page?.endByte ?? 0) - (page?.startByte ?? 0)) / Math.max(1, rangeFile?.size ?? file.size)) * 100)}%` }} /></div><span>{formatBytes(rangeFile?.size ?? file.size)} B</span>
    </div>
    {needsTranscode && !rangeFile && !prepareError && <p className="csv-view-state" role="status">원본 인코딩 {parser.encoding.toUpperCase()}을 OPFS에서 UTF-8 임시 파일로 변환하는 중…</p>}
    {prepareError && <div className="csv-view-error" role="alert"><p>{prepareError}</p><small>원본 다운로드와 보기 설정은 계속 사용할 수 있습니다.</small></div>}
    {busy && rangeFile && <p className="csv-view-state" role="status">바이트 범위와 CSV 레코드 경계를 읽는 중…</p>}
    {error && <div className="csv-view-error" role="alert"><p>{error}</p><small>다른 바이트 위치로 이동하거나 원본 인코딩과 파서 설정을 확인해 다시 시도하세요.</small><div><button className="subtle-button" type="button" onClick={() => setRetry((value) => value + 1)}>다시 시도</button><button className="subtle-button" type="button" disabled={request.offset === 0} onClick={() => { setByteInput('0'); setRequest({ offset: 0, exactBoundary: true, recordOrdinal: 0, serial: request.serial + 1 }) }}>첫 범위로 이동</button></div></div>}
    {!busy && !error && page && <div ref={scrollRef} className="csv-source-range-table" role="region" aria-label="CSV 원문 줄과 바이트 범위" onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
      <div className="csv-source-range-lines">
        {startRow > 0 && <div className="csv-source-range-spacer" aria-hidden="true" style={{ height: offsets[startRow] ?? 0 }} />}
        {shownRows.map((record) => <div className="csv-source-line" data-source-line-key={`${record.startByte}:${record.recordNo}`} key={`${record.startByte}-${record.recordNo}`}>
          <span className="csv-source-line-no">{record.recordNo}</span><pre title={`${formatBytes(record.startByte)}–${formatBytes(record.endByte)} B`}>{record.text || ' '}</pre><span className="csv-source-line-bytes">{formatBytes(record.startByte)}–{formatBytes(record.endByte)} B</span>
        </div>)}
        {endRow < records.length && <div className="csv-source-range-spacer" aria-hidden="true" style={{ height: Math.max(0, totalHeight - (offsets[endRow] ?? totalHeight)) }} />}
        {records.length === 0 && <div className="csv-source-range-empty">이 범위에 완성된 레코드가 없습니다. 다른 바이트 위치로 이동해 보세요.</div>}
      </div>
    </div>}
    <footer className="csv-view-statusbar"><span>{rangeLabel}</span><span>{records.length ? `${first}–${records.at(-1)?.recordNo ?? first}행 확보` : busy ? '범위 읽는 중' : '현재 범위에 행 없음'}</span><span>전체 행 수 미확인 · 파일 {formatBytes(rangeFile?.size ?? file.size)} B</span><span className="csv-view-status-spacer" />{page?.hasMore ? '다음 범위가 있습니다.' : page ? '파일 끝까지 읽었습니다.' : `${parser.encoding.toUpperCase()} · 읽기 전용`}</footer>
  </section>
}

function formatBytes(value: number): string {
  return Math.max(0, Math.floor(value)).toLocaleString()
}
