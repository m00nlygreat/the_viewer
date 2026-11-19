import { useState } from 'react'
import { formatCell, resolveDisplay } from '../../domain/csv-views/format'
import { isSupportedInlineImageDataUrl, safeHttpUrl, safeHttpsImageUrl } from '../../domain/csv-views/cellDisplay'
import type { CsvCell, CsvColumnDefinition, CsvDisplayOverride } from '../../domain/csv-views/model'

export function CsvCellDisplay({ column, override, cell, compact = false }: { column: CsvColumnDefinition | undefined; override?: CsvDisplayOverride; cell: CsvCell | undefined; compact?: boolean }) {
  if (!cell) return <span className="st-missing csv-cell-value">누락</span>
  const stateText = override?.stateText ?? {}
  if (cell.state === 'empty') return <span className="st-empty csv-cell-value" title={stateText.empty ?? '빈 값'}>{stateText.empty ?? '빈 값'}</span>
  if (cell.state === 'missing') return <span className="st-missing csv-cell-value" title={stateText.missing ?? '누락'}>{stateText.missing ?? '누락'}</span>
  if (cell.state === 'null-marker') return <span className="st-null csv-cell-value" title={cell.raw}>{stateText['null-marker'] ?? cell.raw}</span>
  if (cell.state === 'invalid') return <span className="st-invalid csv-cell-value" title={`${invalidHint(cell.code, cell.raw)}\n${cell.raw}`}>{cell.raw}</span>
  if (!column) return <span className="csv-cell-value" title={cell.raw}>{String(cell.value)}</span>

  const display = resolveDisplay(column, override)
  const displayAs = 'as' in display ? display.as : undefined
  const formatted = formatCell(column, display, cell, stateText)
  if (column.type === 'text' && displayAs === 'link' && typeof cell.value === 'string') {
    const href = safeHttpUrl(cell.value)
    if (href) return <a className="csv-cell-value csv-cell-link" href={href} target="_blank" rel="noopener noreferrer" title={cell.raw}>{cell.value}</a>
  }
  if (column.type === 'text' && displayAs === 'image' && typeof cell.value === 'string') {
    if (isSupportedInlineImageDataUrl(cell.value)) return <CsvImageCell source={cell.value} inline title={cell.raw} />
    const httpsSource = safeHttpsImageUrl(cell.value)
    if (httpsSource) return <CsvImageCell source={httpsSource} title={cell.raw} />
  }
  if (column.type === 'boolean' && 'as' in display && display.as === 'check' && typeof cell.value === 'boolean') {
    return <span className={`bool${cell.value ? ' on' : ''}`} aria-label={cell.value ? '참' : '거짓'} title={cell.raw}><span className="box">{cell.value && <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>}</span></span>
  }
  if (formatted.chips) return <span className="csv-cell-chips" title={cell.raw}>{formatted.chips.map((chip, index) => column.type === 'select'
    ? <span key={`${chip.text}-${index}`} className={`sel${chip.unmatched ? ' unreg' : ''}`} data-color={chip.color ?? 'gray'} title={chip.unmatched ? '선택지 밖 값 (원문 레이블로 표시)' : undefined}><span className="csv-cell-chip-label">{chip.text}</span></span>
    : <span key={`${chip.text}-${index}`} className="tag"><span className="csv-cell-chip-label">{chip.text}</span></span>)}</span>
  const numeric = formatted.align === 'end'
  const date = column.type === 'date' || column.type === 'datetime'
  const mono = numeric || date || compact && (column.type === 'integer' || column.type === 'decimal')
  const identifier = isLongUnbrokenIdentifier(formatted.text)
  return <span className={`csv-cell-value${numeric ? ' td-num' : ''}${mono ? ' mono' : ''}${date ? ' csv-cell-date' : ''}${identifier ? ' csv-cell-identifier' : ''}`.trim()} title={cell.raw}>{formatted.text}</span>
}

function CsvImageCell({ source, inline = false, title }: { source: string; inline?: boolean; title: string }) {
  const [requested, setRequested] = useState(inline)
  const [failed, setFailed] = useState(false)
  return <span className="csv-cell-image" title={title}>
    {requested && !failed
      ? <img src={source} alt="CSV 이미지" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      : failed
        ? <span className="csv-cell-image-error" role="alert"><span className="csv-cell-image-address">{source}</span><button type="button" className="subtle-button" onClick={() => { setFailed(false); setRequested(true) }}>다시 시도</button></span>
        : <button type="button" className="csv-cell-image-load" onClick={() => setRequested(true)}>이미지 불러오기</button>}
  </span>
}

function isLongUnbrokenIdentifier(value: string): boolean {
  return value.length >= 18 && /[A-Za-z]/u.test(value) && !/\s/u.test(value)
}

function invalidHint(code: string | undefined, raw: string): string {
  const detail = code === 'thousands' ? '천 단위 구분 위치가 올바르지 않음'
    : code === 'date' && /^\d{4}-\d{2}-\d{2}$/u.test(raw) ? '존재하지 않는 날짜 또는 날짜 형식 오류'
      : code === 'date' ? '날짜 형식이 올바르지 않음'
        : code === 'whitespace' ? '앞뒤 공백이 허용되지 않음'
          : code === 'range' ? '지원 범위를 벗어남'
            : code === 'scale' ? '소수 자릿수가 설정 범위를 넘음'
              : code === 'empty-item' ? '선택 항목이 비어 있음'
                : '값 형식이 올바르지 않음'
  return `해석 실패: ${detail}`
}
