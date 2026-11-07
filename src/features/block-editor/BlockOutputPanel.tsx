import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Copy } from 'lucide-react'
import type { StructuredFormat, StructuredModel } from '../../domain/structured/model'
import { isoDateKind } from '../../domain/structured/output'
import type { BlockEditorCheck, BlockEditorOutput } from './BlockEditor'

const MAX_HIGHLIGHTED_OUTPUT_LENGTH = 16 * 1024

function outputTokens(line: string) {
  const tokens = line.split(/("(?:\\.|[^"\\])*"|\b\d{4}-\d\d-\d\d(?:[Tt ]\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)?)?|\b\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)?|\b(?:true|false|null)\b|-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|비어 있음|없음 불가)/g)
  return tokens.map((part, index) => {
    let className = ''
    if (part === '비어 있음' || part === '없음 불가') className = 'sd-code-error'
    else if (part.startsWith('"')) {
      if (/^\s*[:=]/.test(tokens[index + 1] ?? '')) className = 'sd-code-key'
      else {
        try { className = isoDateKind(JSON.parse(part) as string) ? 'sd-code-date' : 'sd-code-string' }
        catch { className = 'sd-code-string' }
      }
    } else if (part === 'null') className = 'sd-code-null'
    else if (/^(true|false)$/.test(part)) className = 'sd-code-bool'
    else if (isoDateKind(part)) className = 'sd-code-date'
    else if (/^-?\d/.test(part)) className = 'sd-code-number'
    return <span className={className} key={index}>{part}</span>
  })
}

function useNotice() {
  const [notice, setNotice] = useState('')
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 1800); return () => window.clearTimeout(timer) }, [notice])
  return { notice, setNotice }
}

async function copyOutputText(text: string, onCopy: (text: string) => Promise<void>, setNotice: (notice: string) => void) {
  try {
    await onCopy(text)
    setNotice('출력을 복사했어요')
  } catch {
    setNotice('클립보드에 복사하지 못했어요')
  }
}

export function CollapsedOutputControls({ model, getOutput, onExpand, onCopyOutput }: {
  model: StructuredModel
  getOutput: (model: StructuredModel) => BlockEditorOutput
  onExpand: () => void
  onCopyOutput: (text: string) => Promise<void>
}) {
  const { notice, setNotice } = useNotice()
  const copyOutput = () => {
    const output = getOutput(model)
    if (output.text === null) { setNotice(output.issues[0] ?? '출력할 수 없습니다.'); return }
    void copyOutputText(output.text, onCopyOutput, setNotice)
  }
  return <>
    <div className="sd-output-fab" role="group" aria-label="출력 작업"><button type="button" className="sd-panel-toggle" aria-label="소스 보기 패널 펼치기" title="소스 보기 패널 펼치기" aria-expanded="false" onClick={onExpand}><ChevronLeft size={15} aria-hidden="true" /></button><button type="button" className="sd-copy-button" aria-label="출력 복사" title="출력 복사" onClick={copyOutput}><Copy size={15} /></button></div>
    {notice && <div className="sd-toast" role="status">{notice}</div>}
  </>
}

export function BlockOutputPanel({ model, format, options, setFormat, getOutput, getChecks, outputLabel, onCollapse, onCopyOutput }: {
  model: StructuredModel
  format: StructuredFormat
  options: readonly StructuredFormat[]
  setFormat?: (format: StructuredFormat) => void
  getOutput: (model: StructuredModel) => BlockEditorOutput
  getChecks: (model: StructuredModel) => BlockEditorCheck[]
  outputLabel: string
  onCollapse: () => void
  onCopyOutput: (text: string) => Promise<void>
}) {
  const { notice, setNotice } = useNotice()
  const output = useMemo(() => getOutput(model), [getOutput, model])
  const checks = useMemo(() => getChecks(model), [getChecks, model])
  const highlightOutput = output.preview.length <= MAX_HIGHLIGHTED_OUTPUT_LENGTH
  const copyOutput = () => {
    if (output.text === null) { setNotice(output.issues[0] ?? '출력할 수 없습니다.'); return }
    void copyOutputText(output.text, onCopyOutput, setNotice)
  }
  return <>
    <aside className="sd-output" id="sd-output-panel" aria-label="출력">
      <div className="sd-output-header">{options.length ? <div role="tablist" aria-label="출력 형식" className="sd-tabs">{options.map((item) => <button key={item} role="tab" aria-selected={item === format} onClick={() => setFormat?.(item)}>{item.toUpperCase()}</button>)}</div> : <strong className="sd-output-label">{outputLabel}</strong>}<button type="button" className="sd-copy-button" aria-label="출력 복사" title="출력 복사" onClick={copyOutput}><Copy size={15} /></button><button type="button" className="sd-panel-toggle" aria-label="소스 보기 패널 접기" title="소스 보기 패널 접기" aria-expanded="true" aria-controls="sd-output-panel" onClick={onCollapse}><ChevronRight size={15} aria-hidden="true" /></button></div>
      <div className="sd-output-body" id="sd-output-content">
        <div className="sd-output-code"><pre>{highlightOutput && options.length ? output.preview.split('\n').map((line, index) => <span className={line.includes('비어 있음') || line.includes('없음 불가') ? 'sd-output-error-line' : ''} key={index}>{outputTokens(line)}{'\n'}</span>) : output.preview}</pre>{output.omissions.length > 0 && <div className="sd-output-note">출력에서 제외된 항목: {output.omissions.join(', ')}</div>}{output.issues.filter((issue) => !issue.startsWith('빈 자리')).map((issue) => <div className="sd-output-note" key={issue}>{issue}</div>)}</div>
        <div className="sd-checks"><div className="sd-section-label">점검</div>{checks.length ? checks.map((check, index) => <div className="sd-check" key={`${check.label}-${check.path}-${index}`}><i className={check.label === '연결 안 된 블록' ? 'neutral' : undefined} />{check.label} <span>{check.path}</span></div>) : <div className="sd-check"><i className="neutral" />문제 없음</div>}</div>
      </div>
    </aside>
    {notice && <div className="sd-toast" role="status">{notice}</div>}
  </>
}
