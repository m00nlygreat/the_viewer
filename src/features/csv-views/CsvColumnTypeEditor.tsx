import { useMemo, useState } from 'react'
import { createDefaultColumn } from '../../domain/csv-views/typing'
import { findAffectedViews } from '../../domain/csv-views/validate'
import { previewColumn, recommendColumns } from '../../domain/csv-views/inference'
import { formatCell } from '../../domain/csv-views/format'
import { filterColumns } from '../../domain/csv-views/query'
import { CSV_POLICY } from '../../domain/csv-views/policy'
import type { CsvColumnDefinition, CsvColumnType, CsvDateFormat, CsvFileProfile, CsvMultiSelectParse, CsvNumberDisplay, CsvSample, CsvSaveResult, CsvSelectOption, CsvSelectParse, CsvThousandsSeparator, CsvViewDefinition } from '../../domain/csv-views/model'

const optionColors = ['gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'] as const
const dateFormats: CsvDateFormat[] = ['YYYY-MM-DD', 'YYYY/MM/DD', 'YYYY.MM.DD', 'YYYYMMDD', 'DD/MM/YYYY', 'MM/DD/YYYY', 'DD.MM.YYYY']
const typeLabels: Record<CsvColumnType, string> = { text: '텍스트', integer: '정수', decimal: '소수', boolean: '참/거짓', date: '날짜', datetime: '날짜·시간', select: '단일 선택', multiSelect: '다중 선택' }
const typeMarks: Record<CsvColumnType, string> = { text: 'T', integer: '#', decimal: '1.2', boolean: '✓', date: '◷', datetime: '◷', select: '▾', multiSelect: '≡' }
const thousandsOptions: { value: CsvThousandsSeparator | null; label: string }[] = [
  { value: null, label: '없음' }, { value: ',', label: '쉼표' }, { value: '.', label: '마침표' }, { value: ' ', label: '공백' }, { value: "'", label: '작은따옴표' }
]

export interface CsvColumnTypeEditorProps {
  column: CsvColumnDefinition
  profile: CsvFileProfile
  views: CsvViewDefinition[]
  sample: CsvSample | null
  onApply(draft: CsvColumnDefinition): Promise<CsvSaveResult>
  onCancel(): void
}

export function CsvColumnTypeEditor({ column, profile, views, sample, onApply, onCancel }: CsvColumnTypeEditorProps) {
  const [activeColumnId, setActiveColumnId] = useState(column.id)
  const [draft, setDraft] = useState<CsvColumnDefinition>(column)
  const [separator, setSeparator] = useState(';')
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState('')
  const activeColumn = profile.columns.find((item) => item.id === activeColumnId) ?? column
  const types: CsvColumnType[] = ['text', 'integer', 'decimal', 'boolean', 'date', 'datetime', 'select', 'multiSelect']
  const raws = sample?.records.map((record) => record[activeColumn.sourceIndex]) ?? []
  const columnSample = sample ? { sourceIndex: activeColumn.sourceIndex, raws } : null
  const preview = useMemo(() => sample ? previewColumn(sample, draft) : null, [draft, sample])
  const affected = useMemo(() => findAffectedViews(profile, views, draft), [draft, profile, views])
  const recommendation = useMemo(() => sample ? recommendColumns(sample, profile.columns).find((item) => item.sourceIndex === activeColumn.sourceIndex)?.selected.type ?? null : null, [activeColumn.sourceIndex, profile.columns, sample])
  const referencingViews = useMemo(() => views.filter((view) => viewReferencesColumn(view, activeColumn.id)), [activeColumn.id, views])
  const numericDisplay = draft.display as CsvNumberDisplay
  const updateSelectParse = (patch: Partial<CsvSelectParse>) => setDraft((current) => {
    if (current.type === 'select') return { ...current, parse: { ...current.parse, ...patch } }
    if (current.type === 'multiSelect') return { ...current, parse: { ...current.parse, ...patch } }
    return current
  })
  const updateMultiSelectParse = (patch: Partial<CsvMultiSelectParse>) => setDraft((current) => current.type === 'multiSelect' ? { ...current, parse: { ...current.parse, ...patch } } : current)
  const updateNumericDisplay = (patch: Partial<CsvNumberDisplay>) => setDraft((current) => current.type === 'integer' || current.type === 'decimal' ? { ...current, display: { ...current.display, ...patch } } : current)
  const updateCurrencyStyle = (patch: Partial<Extract<CsvNumberDisplay['style'], { kind: 'currency' }>>) => setDraft((current) => {
    if ((current.type === 'integer' || current.type === 'decimal') && current.display.style.kind === 'currency') {
      return { ...current, display: { ...current.display, style: { ...current.display.style, ...patch } } }
    }
    return current
  })
  const chooseType = (next: CsvColumnType) => {
    try {
      const base = { id: activeColumn.id, sourceIndex: activeColumn.sourceIndex, sourceHeader: activeColumn.sourceHeader, label: activeColumn.label, typeSource: 'user' as const, nullMarkers: [...activeColumn.nullMarkers], allowSurroundingSpace: activeColumn.allowSurroundingSpace }
      let result: CsvColumnDefinition
      if (next === 'multiSelect') {
        const single = createDefaultColumn('select', base, columnSample)
        if (single.type !== 'select') throw new Error('선택지 기본 설정을 만들지 못했습니다.')
        result = { ...single, type: 'multiSelect', parse: { ...single.parse, separator, duplicates: 'keep' } }
      } else result = createDefaultColumn(next, base, columnSample)
      if (result.type === 'select' && sample) result.parse.options = sampleOptions(sample, activeColumn.sourceIndex)
      setDraft(result); setFailure('')
    } catch (error) { setFailure(error instanceof Error ? error.message : '타입 설정을 만들지 못했습니다.') }
  }
  const apply = async () => {
    setSaving(true); setFailure('')
    try {
      const result = await onApply({ ...draft, typeSource: 'user' } as CsvColumnDefinition)
      if (!result.ok) setFailure(result.reason === 'invalid' ? result.issues.map((issue) => issue.detail ?? issue.code).join(', ') : result.reason === 'storage' ? result.error.message : '다른 탭에서 설정이 변경되었습니다.')
      else onCancel()
    } catch (error) { setFailure(error instanceof Error ? error.message : '컬럼 설정을 저장하지 못했습니다.') }
    finally { setSaving(false) }
  }
  const selectColumn = (next: CsvColumnDefinition) => {
    if (next.id === activeColumn.id) return
    if (JSON.stringify(draft) !== JSON.stringify(activeColumn) && !window.confirm('현재 컬럼의 변경을 버리고 다른 컬럼을 편집할까요?')) return
    setActiveColumnId(next.id); setDraft(next); setSeparator(next.type === 'multiSelect' ? next.parse.separator : ';'); setFailure('')
  }
  const matchedCount = preview?.counts.value ?? 0
  const sampleCount = sample?.records.length ?? 0
  const affectedIds = new Set(affected.map((item) => item.viewId))
  const previewStatus = (state: string) => ({ value: '해석', empty: '빈 값', missing: '누락', 'null-marker': '결측 표식', invalid: '해석 실패' })[state] ?? state
  const draftChanged = JSON.stringify(draft) !== JSON.stringify(activeColumn)

  return <div className="csv-view-editor-overlay"><section className="csv-view-editor csv-column-type-editor" role="dialog" aria-modal="true" aria-labelledby="csv-column-type-title">
    <header><div><h2 id="csv-column-type-title">컬럼 타입</h2><p>파일 공통 설정 · 모든 뷰에 적용</p></div><button type="button" className="icon-button" aria-label="타입 편집 닫기" onClick={onCancel}>×</button></header>
    <div className="csv-column-type-body">
      <aside className="csv-type-columns" aria-label="CSV 컬럼 목록">{profile.columns.map((item) => {
        const selected = item.id === activeColumn.id
        const currentType = selected ? draft.type : item.type
        return <button type="button" key={item.id} className={`csv-type-column${selected ? ' active' : ''}`} aria-current={selected ? 'true' : undefined} onClick={() => selectColumn(item)}><span className="csv-column-type-mark">{typeMarks[currentType]}</span><span className="csv-type-column-copy"><strong>{item.label}</strong><small>{typeLabels[currentType]}</small></span><span className={`csv-type-source${item.typeSource === 'user' ? ' user' : ''}`}>{item.typeSource === 'user' ? '지정' : '추천'}</span></button>
      })}</aside>
      <div className="csv-column-type-main">
      <div className="csv-type-column-heading"><strong>{activeColumn.label}</strong><small>원래 위치 {activeColumn.sourceIndex} · 헤더 {activeColumn.sourceHeader === null ? '(없음)' : `“${activeColumn.sourceHeader}”`}</small></div>
      <div className="csv-type-segment" role="group" aria-label="컬럼 타입">{types.map((item) => <button type="button" key={item} className={draft.type === item ? 'active' : ''} aria-pressed={draft.type === item} onClick={() => chooseType(item)}><span className="csv-column-type-mark">{typeMarks[item]}</span>{typeLabels[item]}{recommendation === item && activeColumn.typeSource === 'inferred' && <small>추천</small>}</button>)}</div>
      <div className="csv-type-evidence"><span>표본 <b>{sampleCount}</b>행 중 <b>{matchedCount}</b>개 일치 <i aria-hidden="true"><i style={{ width: sampleCount ? `${matchedCount / sampleCount * 100}%` : '0%' }} /></i></span><span>파일 끝 {sample?.reachedEof ? '확인' : <strong className="csv-type-unreached">미도달</strong>}</span><small>처음 {CSV_POLICY.sampleRecords}개 레코드 · 최대 {CSV_POLICY.sampleBytes / (1024 * 1024)} MiB 표본. 전체 검증 아님</small></div>
      {preview?.leadingZeroLoss ? <div className="csv-type-note" role="status">앞자리 0 손실이 예상되는 표본 행 {preview.leadingZeroLoss}개가 있습니다.</div> : null}
      <div className="csv-type-section-title">입력 규칙</div>
      <div className="csv-type-rules">
      {draft.type === 'text' && <p className="csv-type-rule-note">원문 그대로 보존합니다. 앞뒤 공백과 대소문자를 바꾸지 않습니다.</p>}
      {draft.type === 'integer' && <p className="csv-type-rule-note">정수 범위를 벗어나거나 지정한 입력 규칙에 맞지 않는 값은 해석 실패로 표시합니다.</p>}
      {(draft.type === 'decimal' || draft.type === 'date' || draft.type === 'datetime' || draft.type === 'boolean') && <p className="csv-type-rule-note">지정한 형식에 맞지 않는 값은 변환하지 않고 해석 실패로 표시합니다.</p>}
      {draft.type === 'integer' && <>
        <label className="csv-view-check-row"><input type="checkbox" checked={draft.parse.allowPlusSign} onChange={(event) => setDraft({ ...draft, parse: { ...draft.parse, allowPlusSign: event.currentTarget.checked } })} />+ 부호 허용</label>
        <label>천 단위 구분자<ThousandsSelect value={draft.parse.thousandsSeparator} onChange={(value) => setDraft({ ...draft, parse: { ...draft.parse, thousandsSeparator: value } })} /></label>
        <label className="csv-view-check-row"><input type="checkbox" checked={draft.parse.allowFullWidthDigits} onChange={(event) => setDraft({ ...draft, parse: { ...draft.parse, allowFullWidthDigits: event.currentTarget.checked } })} />전각 숫자 허용</label>
        <label className="csv-view-check-row"><input type="checkbox" checked={draft.parse.allowExponent} onChange={(event) => setDraft({ ...draft, parse: { ...draft.parse, allowExponent: event.currentTarget.checked } })} />지수 표기 허용</label>
      </>}
      {draft.type === 'decimal' && <>
        <label>정밀도<input type="number" min={1} max={38} value={draft.parse.precision} onChange={(event) => setDraft({ ...draft, parse: { ...draft.parse, precision: Math.max(1, Math.min(38, Number(event.currentTarget.value))) } })} /></label>
        <label>소수 자릿수<input type="number" min={0} max={38} value={draft.parse.scale} onChange={(event) => setDraft({ ...draft, parse: { ...draft.parse, scale: Math.max(0, Math.min(draft.parse.precision, Number(event.currentTarget.value))) } })} /></label>
        <label>소수점<select value={draft.parse.decimalSeparator} onChange={(event) => setDraft({ ...draft, parse: { ...draft.parse, decimalSeparator: event.currentTarget.value as '.' | ',' } })}><option value=".">마침표</option><option value=",">쉼표</option></select></label>
        <label>천 단위 구분자<ThousandsSelect value={draft.parse.thousandsSeparator} onChange={(value) => setDraft({ ...draft, parse: { ...draft.parse, thousandsSeparator: value } })} /></label>
        <label>통화 기호<input value={draft.parse.currencySymbols.join('|')} onChange={(event) => setDraft({ ...draft, parse: { ...draft.parse, currencySymbols: splitList(event.currentTarget.value, '|') } })} placeholder="$|₩|€" /></label>
        <label>퍼센트 입력<select value={draft.parse.percentInput} onChange={(event) => setDraft({ ...draft, parse: { ...draft.parse, percentInput: event.currentTarget.value as typeof draft.parse.percentInput } })}><option value="reject">거부</option><option value="strip-sign">기호만 제거</option><option value="divide-by-100">100으로 나누기</option></select></label>
        <label className="csv-view-check-row"><input type="checkbox" checked={draft.parse.allowBareFraction} onChange={(event) => setDraft({ ...draft, parse: { ...draft.parse, allowBareFraction: event.currentTarget.checked } })} />.5 / 5. 허용</label>
        <label className="csv-view-check-row"><input type="checkbox" checked={draft.parse.allowExponent} onChange={(event) => setDraft({ ...draft, parse: { ...draft.parse, allowExponent: event.currentTarget.checked } })} />지수 표기 허용</label>
      </>}
      {draft.type === 'boolean' && <>
        <label>참으로 해석<input value={draft.parse.trueValues.join('|')} onChange={(event) => setDraft({ ...draft, parse: { ...draft.parse, trueValues: splitList(event.currentTarget.value, '|') } })} /></label>
        <label>거짓으로 해석<input value={draft.parse.falseValues.join('|')} onChange={(event) => setDraft({ ...draft, parse: { ...draft.parse, falseValues: splitList(event.currentTarget.value, '|') } })} /></label>
        <label>대소문자<select value={draft.parse.ignoreCase} onChange={(event) => setDraft({ ...draft, parse: { ...draft.parse, ignoreCase: event.currentTarget.value as 'none' | 'ascii' } })}><option value="ascii">ASCII 무시</option><option value="none">구분</option></select></label>
      </>}
      {draft.type === 'date' && <fieldset className="csv-view-column-options"><legend>날짜 입력 형식</legend>{dateFormats.map((format) => <label className="csv-view-check-row" key={format}><input type="checkbox" checked={draft.parse.formats.includes(format)} onChange={(event) => setDraft({ ...draft, parse: { formats: event.currentTarget.checked ? [...draft.parse.formats, format] : draft.parse.formats.filter((item) => item !== format) } })} />{format}</label>)}</fieldset>}
      {draft.type === 'datetime' && <>
        <label>시간대 규칙<select value={draft.parse.offset.kind} onChange={(event) => setDraft({ ...draft, parse: { ...draft.parse, offset: event.currentTarget.value === 'require' ? { kind: 'require' } : { kind: 'assume', timeZone: 'UTC' } } })}><option value="require">입력 오프셋 필요</option><option value="assume">시간대 지정</option></select></label>
        {draft.parse.offset.kind === 'assume' && <label>시간대<input value={draft.parse.offset.timeZone} onChange={(event) => setDraft({ ...draft, parse: { ...draft.parse, offset: { kind: 'assume', timeZone: event.currentTarget.value } } })} placeholder="Asia/Seoul" /></label>}
        <label className="csv-view-check-row"><input type="checkbox" checked={draft.parse.allowTwelveHour} onChange={(event) => setDraft({ ...draft, parse: { ...draft.parse, allowTwelveHour: event.currentTarget.checked } })} />12시간제 허용</label>
        <label className="csv-view-check-row"><input type="checkbox" checked={draft.parse.allowDateOnly} onChange={(event) => setDraft({ ...draft, parse: { ...draft.parse, allowDateOnly: event.currentTarget.checked } })} />날짜만 입력된 값 허용</label>
      </>}
      {(draft.type === 'select' || draft.type === 'multiSelect') && <>
        {draft.type === 'multiSelect' && <label>목록 구분자<input value={draft.parse.separator} onChange={(event) => { const value = event.currentTarget.value; setSeparator(value); setDraft((current) => current.type === 'multiSelect' ? { ...current, parse: { ...current.parse, separator: value, options: current.parse.options.length ? current.parse.options : sampleOptions(sample, activeColumn.sourceIndex, value) } } : current) }} /></label>}
        <label>선택지 연결<select value={draft.parse.matching} onChange={(event) => updateSelectParse({ matching: event.currentTarget.value as 'exact' | 'ascii-case-trim' })}><option value="exact">정확히 일치</option><option value="ascii-case-trim">ASCII 대소문자·공백 무시</option></select></label>
        <label className="csv-view-check-row"><input type="checkbox" checked={draft.parse.closed} onChange={(event) => updateSelectParse({ closed: event.currentTarget.checked })} />등록하지 않은 값을 실패로 처리</label>
        <label>선택지 목록<input value={draft.parse.options.map((option) => `${option.raw}|${option.label}`).join('\n')} onChange={(event) => updateSelectParse({ options: parseOptions(event.currentTarget.value, draft.parse.options) })} placeholder={'todo|할 일\nin_progress|진행 중'} /></label>
        <small>한 줄에 원문|표시명. 선택지 ID와 색은 순서대로 유지합니다.</small>
        {draft.type === 'multiSelect' && <label>중복 항목<select value={draft.parse.duplicates} onChange={(event) => updateMultiSelectParse({ duplicates: event.currentTarget.value as 'keep' | 'collapse' })}><option value="keep">유지</option><option value="collapse">하나로 합치기</option></select></label>}
      </>}
      <fieldset className="csv-view-column-options"><legend>표시 형식</legend>
        {draft.type === 'text' && <label>텍스트 표시<select value={draft.display.as} onChange={(event) => setDraft({ ...draft, display: { as: event.currentTarget.value as 'plain' | 'link' | 'image' } })}><option value="plain">일반 텍스트</option><option value="link">링크</option><option value="image">이미지</option></select></label>}
        {(draft.type === 'integer' || draft.type === 'decimal') && <>
          <label className="csv-view-check-row"><input type="checkbox" checked={numericDisplay.grouping} onChange={(event) => updateNumericDisplay({ grouping: event.currentTarget.checked })} />천 단위 구분 표시</label>
          <label>소수 표시<select value={numericDisplay.fractionDigits === 'scale' ? 'scale' : String(numericDisplay.fractionDigits)} onChange={(event) => updateNumericDisplay({ fractionDigits: event.currentTarget.value === 'scale' ? 'scale' : Math.max(0, Math.min(38, Number(event.currentTarget.value))) })}><option value="scale">저장된 소수 자릿수</option>{Array.from({ length: 9 }, (_, index) => <option value={index} key={index}>{index}자리</option>)}</select></label>
          <label>숫자 형식<select value={numericDisplay.style.kind} onChange={(event) => updateNumericDisplay({ style: event.currentTarget.value === 'currency' ? { kind: 'currency', symbol: '$', position: 'prefix' } : { kind: event.currentTarget.value as 'plain' | 'percent' } })}><option value="plain">숫자</option><option value="currency">통화</option><option value="percent">퍼센트 표시</option></select></label>
          {numericDisplay.style.kind === 'currency' && <>
            <label>통화 기호<input value={numericDisplay.style.symbol} onChange={(event) => updateCurrencyStyle({ symbol: event.currentTarget.value })} /></label>
            <label>기호 위치<select value={numericDisplay.style.position} onChange={(event) => updateCurrencyStyle({ position: event.currentTarget.value as 'prefix' | 'suffix' })}><option value="prefix">앞</option><option value="suffix">뒤</option></select></label>
          </>}
          <label>음수 표시<select value={numericDisplay.negative} onChange={(event) => updateNumericDisplay({ negative: event.currentTarget.value as 'minus' | 'parentheses' })}><option value="minus">마이너스 기호</option><option value="parentheses">괄호</option></select></label>
        </>}
        {draft.type === 'boolean' && <><label>참/거짓 표시<select value={draft.display.as} onChange={(event) => setDraft({ ...draft, display: { ...draft.display, as: event.currentTarget.value as 'check' | 'text' } })}><option value="check">기호</option><option value="text">텍스트</option></select></label><label>참 표시<input value={draft.display.trueLabel} onChange={(event) => setDraft({ ...draft, display: { ...draft.display, trueLabel: event.currentTarget.value } })} /></label><label>거짓 표시<input value={draft.display.falseLabel} onChange={(event) => setDraft({ ...draft, display: { ...draft.display, falseLabel: event.currentTarget.value } })} /></label></>}
        {draft.type === 'date' && <label>날짜 표시<select value={draft.display.pattern} onChange={(event) => setDraft({ ...draft, display: { pattern: event.currentTarget.value as 'iso' | 'ko-long' | 'ko-short' } })}><option value="iso">YYYY-MM-DD</option><option value="ko-long">한국어 긴 형식</option><option value="ko-short">한국어 짧은 형식</option></select></label>}
        {draft.type === 'datetime' && <><label>시간대 표시<select value={draft.display.zone.kind} onChange={(event) => setDraft({ ...draft, display: { ...draft.display, zone: event.currentTarget.value === 'fixed' ? { kind: 'fixed', timeZone: 'Asia/Seoul' } : { kind: event.currentTarget.value as 'source' | 'utc' } } })}><option value="source">원문 시간대</option><option value="utc">UTC</option><option value="fixed">지정 시간대</option></select></label>{draft.display.zone.kind === 'fixed' && <label>표시 시간대<input value={draft.display.zone.timeZone} onChange={(event) => setDraft({ ...draft, display: { ...draft.display, zone: { kind: 'fixed', timeZone: event.currentTarget.value } } })} /></label>}<label className="csv-view-check-row"><input type="checkbox" checked={draft.display.seconds} onChange={(event) => setDraft({ ...draft, display: { ...draft.display, seconds: event.currentTarget.checked } })} />초 표시</label></>}
        {(draft.type === 'select' || draft.type === 'multiSelect') && <label>선택지 표시<select value={draft.display.as} onChange={(event) => setDraft({ ...draft, display: { as: event.currentTarget.value as 'chip' | 'text' } })}><option value="chip">칩</option><option value="text">텍스트</option></select></label>}
      </fieldset>
      <label className="csv-view-check-row"><input type="checkbox" checked={draft.allowSurroundingSpace} onChange={(event) => setDraft({ ...draft, allowSurroundingSpace: event.currentTarget.checked })} />앞뒤 ASCII 공백 허용</label>
      <label>결측 표식<input value={draft.nullMarkers.join(', ')} onChange={(event) => setDraft({ ...draft, nullMarkers: event.currentTarget.value ? event.currentTarget.value.split(',').map((value) => value.trim()).filter(Boolean) : [] })} placeholder="예: N/A, NULL" /></label>
      </div>
      <div className="csv-type-section-title">원문 → 해석값 미리보기</div>
      {preview ? <div className="csv-type-preview-scroll"><table className="csv-type-preview-table"><thead><tr><th>원문</th><th>해석값</th><th>상태</th></tr></thead><tbody>{preview.rows.slice(0, 12).map((row) => {
        const formatted = formatCell(draft, draft.display, row.cell, {})
        return <tr key={row.recordNo}><td><code>{row.raw === undefined ? '누락' : row.raw === '' ? '""' : row.raw}</code></td><td className={formatted.tone}>{formatted.text}</td><td className={formatted.tone}>{previewStatus(row.cell.state)}{row.cell.state === 'invalid' ? ` · ${row.cell.code}` : ''}</td></tr>
      })}{preview.rows.length === 0 && <tr><td colSpan={3} className="csv-type-preview-empty">표본 예시 없음</td></tr>}</tbody></table></div> : null}
      {!preview && <div className="csv-type-preview-unavailable">표본 미리보기를 사용할 수 없습니다.</div>}
      {draftChanged && referencingViews.length > 0 && <div className="csv-view-conflict"><strong>적용하면 영향을 받는 보기 {referencingViews.length}개</strong>{referencingViews.map((view) => <span key={view.id}>· {view.name}{affectedIds.has(view.id) ? ' — 저장 후 검증 필요' : ''}</span>)}<span>CSV 원문과 수정 상태는 바뀌지 않습니다.</span></div>}
      {failure && <p className="csv-view-error" role="alert">{failure}</p>}
    </div>
    </div>
    <footer><span className="csv-type-editor-note">표본 밖 예외는 타입을 바꾸지 않고 <strong>해석 실패</strong>로 표시합니다.</span><button type="button" className="secondary-button" onClick={onCancel}>취소</button><button type="button" className="primary-button" onClick={() => { void apply() }} disabled={saving || (draft.type === 'multiSelect' && !draft.parse.separator)}>{saving ? '저장 중…' : '적용'}</button></footer>
  </section></div>
}

function viewReferencesColumn(view: CsvViewDefinition, columnId: string): boolean {
  if (view.columnIds.includes(columnId) || view.sort.some((item) => item.columnId === columnId) || filterColumns(view.filter).includes(columnId) || Object.hasOwn(view.displayOverrides, columnId)) return true
  const layout = view.layout
  if (layout.kind === 'list') return [layout.titleColumnId, layout.subtitleColumnId, layout.trailingColumnId, layout.colorColumnId, layout.groupColumnId].includes(columnId)
  if (layout.kind === 'gallery') return layout.titleColumnId === columnId || layout.coverColumnId === columnId
  if (layout.kind === 'kanban') return layout.groupColumnId === columnId
  if (layout.kind === 'calendar') return layout.dateColumnId === columnId
  return false
}

function ThousandsSelect({ value, onChange }: { value: CsvThousandsSeparator | null; onChange(value: CsvThousandsSeparator | null): void }) {
  return <select value={value ?? ''} onChange={(event) => onChange((event.currentTarget.value || null) as CsvThousandsSeparator | null)}>{thousandsOptions.map((item) => <option value={item.value ?? ''} key={item.label}>{item.label}</option>)}</select>
}
function splitList(value: string, separator: string): string[] { return value.split(separator).filter((item) => item !== '') }
function sampleOptions(sample: CsvSample | null, sourceIndex: number, separator?: string): CsvSelectOption[] {
  if (!sample) return []
  const values = [...new Set(sample.records.flatMap((record) => {
    const raw = record[sourceIndex]
    if (raw === undefined || raw === '') return []
    return separator ? raw.split(separator).filter(Boolean) : [raw]
  }))].slice(0, CSV_POLICY.maxSelectOptionCandidates)
  return values.map((raw, index) => ({ id: `csv-option-${sourceIndex + 1}-${index + 1}`, raw, label: raw, color: optionColors[index % optionColors.length]! }))
}
function parseOptions(value: string, existing: CsvSelectOption[]): CsvSelectOption[] {
  const parsed = value.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).slice(0, 100).map((line) => {
    const [raw = '', ...labelParts] = line.split('|')
    return { raw, label: labelParts.join('|') || raw }
  }).filter((option) => option.raw.length > 0)
  const matched = parsed.map((item) => existing.find((option) => option.raw === item.raw) ?? null)
  const used = new Set(matched.flatMap((option) => option ? [option.id] : []))
  return parsed.map((item, index) => {
    const old = matched[index] ?? (existing[index] && !used.has(existing[index]!.id) ? existing[index] : undefined)
    if (old) used.add(old.id)
    return { id: old?.id ?? crypto.randomUUID(), raw: item.raw, label: item.label, color: old?.color ?? optionColors[index % optionColors.length]! }
  })
}
