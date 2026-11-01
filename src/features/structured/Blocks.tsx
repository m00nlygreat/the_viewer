import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { findNode, findSlot, type DragSource } from '../../domain/structured/operations'
import { slot, type StructuredContainer, type StructuredNode, type StructuredScalar, type StructuredSlot } from '../../domain/structured/model'
import { isoDateKind, uniqueKey } from '../../domain/structured/output'
import { useBlocks, type Selection } from './BlockContext'
import { BlockIcon } from './BlockIcon'
import { valueType } from './valueType'
import { DatePopover } from './DatePopover'
import { ColorPopover } from './ColorPopover'

function InlineInput({ value, label, valid, onCommit, onCancel }: { value: string; label: string; valid?: (value: string) => boolean; onCommit: (value: string, refocus: boolean) => void; onCancel: (refocus: boolean) => void }) {
  const [draft, setDraft] = useState(value)
  const [error, setError] = useState(false)
  const [multiline, setMultiline] = useState(value.includes('\n'))
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement>(null)
  const focused = useRef(false)
  const switching = useRef(false)
  const finalized = useRef(false)
  const nextCaret = useRef<number | null>(null)
  useEffect(() => {
    const input = ref.current
    if (!input) return
    input.focus()
    if (!focused.current) input.select()
    else input.setSelectionRange(nextCaret.current ?? input.value.length, nextCaret.current ?? input.value.length)
    focused.current = true
    switching.current = false
    nextCaret.current = null
  }, [multiline])
  const commit = (blur = false) => {
    if (switching.current || finalized.current) return
    if (valid && !valid(draft)) { if (blur) { finalized.current = true; onCancel(false) } else setError(true); return }
    finalized.current = true
    onCommit(draft, !blur)
  }
  const inputProps = { 'aria-label': label, value: draft, onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { setDraft(event.target.value); setError(false) }, onBlur: () => commit(true), onKeyDown: (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    event.stopPropagation()
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Enter' && event.shiftKey && !multiline && !valid) {
      event.preventDefault()
      const start = event.currentTarget.selectionStart ?? draft.length, end = event.currentTarget.selectionEnd ?? start
      switching.current = true
      nextCaret.current = start + 1
      setDraft(`${draft.slice(0, start)}\n${draft.slice(end)}`)
      setMultiline(true)
      return
    }
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); commit() }
    if (event.key === 'Escape') { event.preventDefault(); finalized.current = true; onCancel(true) }
  } }
  return <span className={`sd-inline${error ? ' error' : ''}`} onPointerDown={(event) => event.stopPropagation()}>{multiline ? <textarea {...inputProps} ref={ref as React.RefObject<HTMLTextAreaElement>} rows={Math.min(6, Math.max(2, draft.split('\n').length))} /> : <input {...inputProps} ref={ref as React.RefObject<HTMLInputElement>} />}{error && <small>숫자가 아니에요</small>}</span>
}

function displayText(raw: string): string {
  if (!raw) return '빈 텍스트'
  return raw.replace(/^\s+|\s+$/g, (spaces) => spaces.replace(/ /g, '·').replace(/\n/g, '↵')).replace(/\n/g, '↵')
}
function dateDescription(value: string): string {
  const kind = isoDateKind(value)
  if (kind === 'local-date') return '날짜만'
  if (kind === 'local-time') return '시간만'
  const match = value.match(/^(\d{4})-(\d\d)-(\d\d)[Tt ](\d\d):(\d\d)(?::\d\d(?:\.\d+)?)?(Z|[+-]\d\d:\d\d)?$/i)
  if (!match) return value
  const date = new Date(0); date.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  const weekday = ['일', '월', '화', '수', '목', '금', '토'][date.getUTCDay()]
  const hour = Number(match[4]), period = hour < 12 ? '오전' : '오후'
  const zone = match[6] ? match[6].toUpperCase() === 'Z' ? ' · UTC' : ` · UTC${match[6][0]}${Number(match[6].slice(1, 3))}${match[6].slice(4) === '00' ? '' : `:${match[6].slice(4)}`}` : ''
  return `${Number(match[2])}월 ${Number(match[3])}일 (${weekday}) ${period} ${hour % 12 || 12}:${match[5]}${zone}`
}
function containerPreview(node: StructuredContainer): string {
  if (node.kind === 'object') return `${node.items.slice(0, 4).map((item) => item.key).join(', ')}${node.items.length > 4 ? '…' : ''}`
  if (node.items.length && node.items.every((item) => item.node?.kind === 'object')) {
    const first = node.items[0].node as StructuredContainer
    return `모두 객체 · ${first.items.slice(0, 4).map((item) => item.key).join(', ')}${first.items.length > 4 ? '…' : ''}`
  }
  return `${node.items.slice(0, 4).map((item) => { const child = item.node; return !child ? '빈 자리' : child.kind === 'scalar' ? child.raw : child.kind === 'object' ? '객체' : '배열' }).join(', ')}${node.items.length > 4 ? '…' : ''}`
}

function ValueChip({ node, source = { type: 'node', id: node.id } }: { node: StructuredScalar; source?: DragSource }) {
  const context = useBlocks()
  const [popover, setPopover] = useState<'date' | 'color' | 'type' | null>(null)
  const [showShortColor, setShowShortColor] = useState(false)
  const popRef = useRef<HTMLSpanElement>(null)
  const type = showShortColor ? 'color' : valueType(node)
  const editing = context.editing?.type === 'node' && context.editing.id === node.id
  const selected = context.selected?.id === node.id
  const expanded = context.expanded.has(node.id)
  const select: Selection = { type: 'node', id: node.id }
  useLayoutEffect(() => {
    if (!popover || !popRef.current) return
    const popup = popRef.current.querySelector<HTMLElement>('.sd-popover, .sd-type-menu')
    const viewport = popRef.current.closest<HTMLElement>('.sd-canvas')
    if (!popup || !viewport) return
    const bounds = viewport.getBoundingClientRect()
    let rect = popup.getBoundingClientRect()
    const scale = rect.width / popup.offsetWidth || 1
    popup.style.maxWidth = `${Math.max(80, (bounds.width - 16) / scale)}px`
    popup.style.maxHeight = `${Math.max(80, (bounds.height - 16) / scale)}px`
    popup.style.overflow = 'auto'
    rect = popup.getBoundingClientRect()
    const dx = rect.right > bounds.right - 8 ? bounds.right - 8 - rect.right : rect.left < bounds.left + 8 ? bounds.left + 8 - rect.left : 0
    const dy = rect.bottom > bounds.bottom - 8 ? bounds.bottom - 8 - rect.bottom : rect.top < bounds.top + 8 ? bounds.top + 8 - rect.top : 0
    popup.style.transform = `translate(${dx / scale}px, ${dy / scale}px)`
  }, [popover])
  useEffect(() => {
    if (!popover) return
    const close = (event: PointerEvent) => { if (!popRef.current?.contains(event.target as Node)) setPopover(null) }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [popover])
  useEffect(() => {
    if (popover !== 'date' && popover !== 'color') return
    window.dispatchEvent(new Event('structured:group-start'))
    return () => { window.dispatchEvent(new Event('structured:group-end')) }
  }, [popover])
  const begin = () => {
    if (context.readonly) return
    context.select(select)
    if (type === 'boolean') context.mutate((model) => { const value = findNode(model, node.id); if (value?.kind === 'scalar') value.raw = value.raw === 'true' ? 'false' : 'true' })
    else if (type === 'date' || type === 'color') setPopover(type)
    else if (type !== 'null') context.edit(select)
  }
  useEffect(() => {
    if (!editing || (type !== 'date' && type !== 'color' && type !== 'boolean' && type !== 'null')) return
    context.edit(null)
    if (type === 'date' || type === 'color') setPopover(type)
    else if (type === 'boolean') context.mutate((model) => { const value = findNode(model, node.id); if (value?.kind === 'scalar') value.raw = value.raw === 'true' ? 'false' : 'true' })
  }, [context, editing, node.id, type])
  const update = (raw: string, group: 'typing' | 'command' = 'command') => {
    if (raw === node.raw) return
    context.mutate((model) => {
      const value = findNode(model, node.id)
      if (value?.kind !== 'scalar') return
      value.raw = raw
      if (value.dataType === 'native-date-time') value.dateKind = isoDateKind(raw) ?? value.dateKind
    }, group)
  }
  const closePopover = () => { setPopover(null); requestAnimationFrame(() => popRef.current?.querySelector<HTMLElement>('.sd-value')?.focus({ preventScroll: true })) }
  const closeEditor = (refocus: boolean) => { context.edit(null); if (refocus) requestAnimationFrame(() => popRef.current?.querySelector<HTMLElement>('.sd-value')?.focus({ preventScroll: true })) }
  const long = node.dataType === 'string' && (node.raw.length > 80 || node.raw.includes('\n'))
  const number = type === 'number' ? Number(node.raw.replaceAll('_', '')) : NaN
  const unsafe = type === 'number' && /^-?\d+$/.test(node.raw) && !Number.isSafeInteger(number)
  const isLink = /^https?:\/\//i.test(node.raw) && node.dataType === 'string'
  const nonIso = node.dataType === 'string' && node.raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  const dateCandidate = nonIso ? `${nonIso[3]}-${nonIso[1].padStart(2, '0')}-${nonIso[2].padStart(2, '0')}` : ''
  const rgb = node.raw.match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i)
  const rgbHex = rgb && rgb.slice(1).every((part) => Number(part) <= 255) ? `#${rgb.slice(1).map((part) => Number(part).toString(16).padStart(2, '0')).join('').toUpperCase()}` : ''
  return <span className="sd-value-wrap" ref={popRef}>
    <span className={`sd-value sd-${type}${long ? ' long' : ''}${selected ? ' selected' : ''}${expanded ? ' expanded' : ''}${context.draggingIds.has(node.id) ? ' dragging' : ''}`} data-node={node.id} tabIndex={0} role="button" aria-label={`${type} ${node.dataType === 'null' ? '없음' : node.raw || '빈 텍스트'}`} onFocus={(event) => { if (event.target === event.currentTarget) context.select(select) }} onPointerDown={(event) => context.startDrag(event, source, select)} onDoubleClick={(event) => { event.stopPropagation(); begin() }} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); if (!context.readonly) { context.select(select); setPopover('type') } }} onKeyDown={(event) => { if (event.shiftKey && event.key === 'F10') { event.preventDefault(); setPopover('type') } }}>
      {type === 'color' ? <span className="sd-swatch" style={{ background: /^#[\da-f]{8}$/i.test(node.raw) ? `linear-gradient(${node.raw}, ${node.raw}), repeating-conic-gradient(#d4d4d4 0% 25%, #fff 0% 50%) 0 0 / 6px 6px` : node.raw }} /> : <BlockIcon name={isLink ? 'link' : type} />}
      {editing && type !== 'date' && type !== 'color' ? <InlineInput value={node.raw} label="값" valid={type === 'number' ? (value) => /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(value) : undefined} onCommit={(value, refocus) => { if (value !== node.raw) update(value); closeEditor(refocus) }} onCancel={closeEditor} /> : <span className="sd-value-text">{type === 'null' ? '없음' : expanded ? node.raw : displayText(node.raw)}</span>}
    </span>
    {long && <button type="button" className="sd-value-extra" onPointerDown={(event) => event.stopPropagation()} onClick={() => context.toggleExpanded(node.id)}>{expanded ? '접기' : `${node.raw.length}자 · 펼치기`}</button>}
    {unsafe && <span className="sd-value-warning">정확히 저장할 수 없는 크기 · 텍스트로 바꿀까요?</span>}
    {unsafe && <button type="button" className="sd-suggestion" onPointerDown={(event) => event.stopPropagation()} onClick={() => context.mutate((model) => { const value = findNode(model, node.id); if (value?.kind === 'scalar') { value.dataType = 'string'; value.sourceFormat = undefined } })}>텍스트로 바꾸기</button>}
    {type === 'number' && Number.isFinite(number) && Math.abs(number) >= 1000000 && <span className="sd-value-extra">{/^-?\d+$/.test(node.raw) ? BigInt(node.raw).toLocaleString('ko-KR') : number.toLocaleString('ko-KR')}{Math.abs(number) >= 100000000 ? ` · 약 ${(number / 100000000).toFixed(1)}억` : ''}</span>}
    {type === 'date' && <span className="sd-value-extra">{dateDescription(node.raw)}</span>}
    {type === 'text' && node.raw.includes('\n') && <span className="sd-value-extra">{node.raw.split('\n').length}줄</span>}
    {type === 'text' && /^\d{4}-\d\d-\d\d$/.test(node.raw) && !isoDateKind(node.raw) && <span className="sd-value-extra">날짜처럼 보이지만 없는 날짜라 텍스트</span>}
    {type === 'color' && /^#[\da-f]{8}$/i.test(node.raw) && <span className="sd-value-extra">투명도 {Math.round(parseInt(node.raw.slice(7, 9), 16) / 255 * 100)}%</span>}
    {nonIso && isoDateKind(dateCandidate) && <button type="button" className="sd-suggestion" onPointerDown={(event) => event.stopPropagation()} onClick={() => update(dateCandidate)}>날짜 {dateCandidate}로 바꾸기</button>}
    {rgbHex && <button type="button" className="sd-suggestion" onPointerDown={(event) => event.stopPropagation()} onClick={() => update(rgbHex)}>{rgbHex}로 바꾸기</button>}
    {!showShortColor && /^#[0-9a-f]{3}$/i.test(node.raw) && <button type="button" className="sd-suggestion" onPointerDown={(event) => event.stopPropagation()} onClick={() => setShowShortColor(true)}>색으로 보기</button>}
    {isLink && <a className="sd-link" href={node.raw} target="_blank" rel="noopener noreferrer" aria-label="링크 새 탭에서 열기" onPointerDown={(event) => event.stopPropagation()}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M7 17 17 7M9 7h8v8" /></svg></a>}
    {popover === 'date' && <DatePopover value={node.raw} onChange={(value) => update(value, 'typing')} onClose={closePopover} />}
    {popover === 'color' && <ColorPopover value={node.raw} model={context.model} onChange={(value) => update(value, 'typing')} onClose={closePopover} />}
    {popover === 'type' && <div className="sd-type-menu" onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); closePopover() } }}>{(['string', 'number', 'boolean', 'null'] as const).map((dataType) => {
      const current = node.dataType === dataType
      const allowed = current || (dataType === 'string' && node.dataType === 'number') || dataType === 'null'
      const icon = dataType === 'string' ? 'text' : dataType
      const label = dataType === 'string' ? (current ? '텍스트' : '텍스트로') : dataType === 'number' ? (current ? '숫자' : '숫자로') : dataType === 'boolean' ? '불리언' : '없음으로 비우기'
      const detail = current ? '지금' : !allowed ? '바꿀 수 없음' : dataType === 'string' ? JSON.stringify(node.raw) : ''
      return <button type="button" className={current ? 'current' : undefined} key={dataType} disabled={!allowed} onClick={() => { if (!current) context.mutate((model) => { const value = findNode(model, node.id); if (value?.kind === 'scalar') { value.dataType = dataType; if (dataType === 'null') value.raw = ''; value.sourceFormat = undefined } }); setPopover(null) }}><BlockIcon name={icon} /><span>{label}</span><small>{detail}</small></button>
    })}</div>}
  </span>
}

function PropertyRow({ item, index, parent, depth, looseId, path = ['$'] }: { item: StructuredSlot; index: number; parent?: StructuredContainer; depth: number; looseId?: string; path?: string[] }) {
  const context = useBlocks()
  const rowRef = useRef<HTMLDivElement>(null)
  const editing = context.editing?.type === 'slot' && context.editing.id === item.id
  const key = parent?.kind === 'array' ? String(index) : item.key ?? ''
  const selected = context.selected?.id === item.id
  const duplicate = parent?.kind === 'object' && parent.items.filter((other) => other.key === item.key).length > 1
  const source: DragSource = looseId ? { type: 'loose', id: looseId } : { type: 'slot', id: item.id }
  const closeEditor = (refocus: boolean) => { context.edit(null); if (refocus) requestAnimationFrame(() => rowRef.current?.focus({ preventScroll: true })) }
  return <div ref={rowRef} className={`sd-row depth-${Math.min(depth, 3)}${selected ? ' selected' : ''}${item.node && item.node.kind !== 'scalar' ? ' container-row' : ''}${context.draggingIds.has(item.id) ? ' dragging' : ''}`} data-row={item.id} data-parent={parent?.id} tabIndex={0} onFocus={(event) => { if (event.target === event.currentTarget) context.select({ type: 'slot', id: item.id }) }} onPointerDown={(event) => context.startDrag(event, source, { type: 'slot', id: item.id })}>
    {context.hover?.type === 'insert' && context.hover.id === parent?.id && context.hover.index === index && <span className="sd-insertion" />}
    <span className={`sd-key${item.nameMissing || duplicate ? ' error' : ''}${item.nameMissing ? ' name-missing' : ''}`} title={key} onDoubleClick={(event) => { event.stopPropagation(); if (parent?.kind !== 'array' && !context.readonly) context.edit({ type: 'slot', id: item.id }) }}>
      {editing ? <InlineInput value={key} label="이름" onCommit={(value, refocus) => { if (value !== key || item.nameMissing) context.mutate((model) => { const target = findSlot(model, item.id); if (target) { target.key = value; target.nameMissing = false } }); closeEditor(refocus) }} onCancel={closeEditor} /> : item.nameMissing ? '이름 없음' : key.replace(/ /g, '·')}
    </span>
    {!item.node ? <span className={`sd-socket${context.hover?.type === 'socket' && context.hover.id === item.id ? ' hover' : ''}`} data-socket={item.id} /> : <NodeBlock node={item.node} depth={depth + 1} path={[...path, key]} />}
    {duplicate && <span className="sd-value-warning">{parent?.items.filter((other) => other.key === item.key).at(-1)?.id === item.id ? '내보내면 이 값이 남아요' : `같은 이름 ${parent?.items.filter((other) => other.key === item.key).length}개`}</span>}
  </div>
}

export function NodeBlock({ node, depth = 1, root = false, looseId, path = ['$'] }: { node: StructuredNode; depth?: number; root?: boolean; looseId?: string; path?: string[] }) {
  const context = useBlocks()
  if (node.kind === 'scalar') return <ValueChip node={node} source={looseId ? { type: 'loose', id: looseId } : { type: 'node', id: node.id }} />
  const collapsed = !root && context.collapsed.has(node.id)
  const selection: Selection = { type: 'node', id: node.id }
  const source: DragSource = looseId ? { type: 'loose', id: looseId } : { type: 'node', id: node.id }
  const manyArray = node.kind === 'array' && node.items.length > 100
  const longArray = manyArray && !context.expanded.has(node.id)
  const visible = longArray ? [...node.items.slice(0, 3), ...node.items.slice(-1)] : node.items
  const block = <div className={`sd-container depth-${Math.min(depth, 3)}${context.selected?.id === node.id ? ' selected' : ''}${context.draggingIds.has(node.id) ? ' dragging' : ''}`} data-container={node.id} data-collapsed={collapsed}>
    <div className="sd-container-head" data-node={node.id} tabIndex={root ? undefined : 0} onFocus={(event) => { if (!root && event.target === event.currentTarget) context.select(selection) }} onPointerDown={(event) => { if (!root) context.startDrag(event, source, selection); else event.stopPropagation() }}>
      {!root && <button type="button" className="sd-fold" aria-label={collapsed ? '펼치기' : '접기'} aria-expanded={!collapsed} onPointerDown={(event) => event.stopPropagation()} onClick={() => context.toggleCollapsed(node.id)}><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: collapsed ? undefined : 'rotate(90deg)' }}><path d="m9 6 6 6-6 6" /></svg></button>}
      <BlockIcon name={node.kind} size={depth === 1 ? 16 : depth === 2 ? 14 : 13} />{root && <strong>최상위</strong>}
      {collapsed && <span className="sd-collapse-preview">{containerPreview(node)}</span>}
      <span className="sd-count">{node.items.length}</span>
      {depth > 3 && <button type="button" className="sd-focus-node" onPointerDown={(event) => event.stopPropagation()} onClick={() => context.focusNode(node.id, path, depth)}>이 그릇만 보기</button>}
    </div>
    {!collapsed && <div className="sd-items">{visible.map((item, visibleIndex) => {
      const index = longArray && visibleIndex === 3 ? node.items.length - 1 : visibleIndex
      return <div className="sd-row-holder" key={item.id}>{manyArray && visibleIndex === 3 && <button type="button" className="sd-more" onClick={() => context.toggleExpanded(node.id)}>3 – {node.items.length - 2} · {node.items.length - 4}개 {longArray ? '더 보기' : '접기'}</button>}<PropertyRow item={item} index={index} parent={node} depth={depth} path={path} /></div>
    })}
    {context.hover?.type === 'insert' && context.hover.id === node.id && context.hover.index === node.items.length && <span className="sd-insertion sd-insertion-end" />}
    <button type="button" className="sd-add" aria-label={node.kind === 'object' ? '프로퍼티 추가' : '배열 항목 추가'} onPointerDown={(event) => event.stopPropagation()} onClick={() => context.mutate((model) => { const parent = findNode(model, node.id); if (parent && parent.kind !== 'scalar') parent.items.push(slot(parent.kind === 'object' ? uniqueKey(parent) : null, null)) })}>+ 자리</button></div>}
  </div>
  if (depth <= 3) return block
  return <div className="sd-deep"><div className="sd-breadcrumb">{path.map((part, index) => <span key={`${part}-${index}`}>{index > 0 && <i>›</i>}{part}</span>)}<small>깊이 {depth}</small></div><div className="sd-deep-body"><div className="sd-deep-guides" aria-hidden="true"><span /><span /><span /></div>{block}</div></div>
}
export function LooseProperty({ item, looseId }: { item: StructuredSlot; looseId: string }) { return <PropertyRow item={item} index={0} depth={1} looseId={looseId} /> }
