import { formatCell, resolveDisplay } from '../../domain/csv-views/format'
import type { CsvCell, CsvColumnDefinition, CsvDisplayOverride } from '../../domain/csv-views/model'

export function CsvCellDisplay({ column, override, cell, compact = false }: { column: CsvColumnDefinition | undefined; override?: CsvDisplayOverride; cell: CsvCell | undefined; compact?: boolean }) {
  if (!cell) return <span className="st-missing">누락</span>
  const stateText = override?.stateText ?? {}
  if (cell.state === 'empty') return <span className="st-empty">{stateText.empty ?? '빈 값'}</span>
  if (cell.state === 'missing') return <span className="st-missing">{stateText.missing ?? '누락'}</span>
  if (cell.state === 'null-marker') return <span className="st-null" title="결측 표식">{stateText['null-marker'] ?? cell.raw}</span>
  if (cell.state === 'invalid') return <span className="st-invalid" title={invalidHint(cell.code, cell.raw)}>{cell.raw}</span>
  if (!column) return <span>{String(cell.value)}</span>

  const display = resolveDisplay(column, override)
  const formatted = formatCell(column, display, cell, stateText)
  if (column.type === 'boolean' && 'as' in display && display.as === 'check' && typeof cell.value === 'boolean') {
    return <span className={`bool${cell.value ? ' on' : ''}`} aria-label={cell.value ? '참' : '거짓'}><span className="box">{cell.value && <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>}</span></span>
  }
  if (formatted.chips) return <span className="csv-cell-chips">{formatted.chips.map((chip, index) => column.type === 'select'
    ? <span key={`${chip.text}-${index}`} className={`sel${chip.unmatched ? ' unreg' : ''}`} data-color={chip.color ?? 'gray'} title={chip.unmatched ? '선택지 밖 값 (원문 레이블로 표시)' : undefined}>{chip.text}</span>
    : <span key={`${chip.text}-${index}`} className="tag">{chip.text}</span>)}</span>
  const numeric = formatted.align === 'end'
  const date = column.type === 'date' || column.type === 'datetime'
  const mono = numeric || date || compact && (column.type === 'integer' || column.type === 'decimal')
  return <span className={`${numeric ? 'td-num' : ''}${mono ? ' mono' : ''}${date ? ' csv-cell-date' : ''}`.trim()}>{formatted.text}</span>
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
