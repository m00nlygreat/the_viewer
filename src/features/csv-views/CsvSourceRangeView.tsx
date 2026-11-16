import { useEffect, useState } from 'react'
import type { CsvParserSettings } from '../../domain/csv-views/model'
import type { CsvSourceFile } from '../../platform/csv/sampleFile'
import { readCsvRecordPage } from '../../platform/csv/sampleFile'

export function CsvSourceRangeView({ file, parser }: { file: CsvSourceFile; parser: CsvParserSettings }) {
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<string[][]>([])
  const [hasMore, setHasMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const abort = new AbortController()
    setBusy(true); setError('')
    void readCsvRecordPage(file, parser, page * 200, 200, abort.signal).then((result) => {
      setRows(result.rows); setHasMore(result.hasMore)
    }).catch((reason: unknown) => { if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : '원본 범위를 읽지 못했습니다.') })
      .finally(() => { if (!abort.signal.aborted) setBusy(false) })
    return () => abort.abort()
  }, [file, page, parser])
  const width = Math.max(0, ...rows.map((row) => row.length))
  return <section className="csv-source-range" aria-label="CSV 원본 범위">
    <div className="csv-source-range-heading"><strong>원본 · 레코드 {page * 200 + 1}–{page * 200 + rows.length}{hasMore ? '+' : ''}</strong><span>필요한 범위만 읽습니다.</span><div className="toolbar-spacer" /><button className="subtle-button" disabled={page === 0 || busy} onClick={() => setPage((value) => Math.max(0, value - 1))}>이전</button><button className="subtle-button" disabled={!hasMore || busy} onClick={() => setPage((value) => value + 1)}>다음</button></div>
    {busy && <p role="status">원본 범위를 읽는 중…</p>}
    {error && <p className="csv-view-error" role="alert">{error}<button className="subtle-button" onClick={() => setPage((value) => value)}>다시 시도</button></p>}
    {!busy && !error && <div className="csv-source-range-table"><table><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}><th scope="row">{page * 200 + rowIndex + 1}</th>{Array.from({ length: width }, (_, index) => <td key={index}>{row[index] ?? <span className="csv-view-cell missing">누락</span>}</td>)}</tr>)}</tbody></table></div>}
  </section>
}
