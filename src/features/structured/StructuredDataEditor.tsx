import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { ChevronLeft, ChevronRight, Copy } from 'lucide-react'
import type { ViewerDocument } from '../../domain/types'
import { type StructuredFormat, type StructuredModel } from '../../domain/structured/model'
import { applyDrop, findNode, findSlotParent, payloadIds, removeSelection, sourcePayload, type DragSource, type DropTarget, type Payload } from '../../domain/structured/operations'
import { inspectStructured, isoDateKind, outputStructured } from '../../domain/structured/output'
import { BlockContext, type Selection } from './BlockContext'
import { NodeBlock, LooseProperty } from './Blocks'
import { BlockIcon } from './BlockIcon'
import { StructuredPalette } from './StructuredPalette'
import { valueType } from './valueType'
import './structured.css'

interface Props { document: ViewerDocument; model: StructuredModel; onChange: (model: StructuredModel, group?: 'typing' | 'command') => void; outputFormat: StructuredFormat; onOutputFormat: (format: StructuredFormat) => void }
interface View { zoom: number; x: number; y: number }
interface Ghost { x: number; y: number; offsetX: number; offsetY: number; payload: Payload; kind: 'node' | 'slot'; ids: Set<string> }

function ghostLabel(payload: Payload): string {
  if (payload.slot) {
    const child = payload.slot.node
    const summary = !child ? '빈 자리' : child.kind === 'scalar' ? (child.dataType === 'null' ? '없음' : child.raw) : `${child.kind === 'object' ? '{ }' : '[ ]'} ${child.items.length}`
    return `${payload.slot.key ?? '0'} · ${summary}`
  }
  const node = payload.node
  if (node.kind === 'scalar') return node.dataType === 'null' ? '없음' : node.raw
  return `${node.kind === 'object' ? '{ } 객체' : '[ ] 배열'} · ${node.items.length}`
}

function DragGhost({ ghost }: { ghost: Ghost }) {
  const node = ghost.payload.node
  const value = node?.kind === 'scalar' ? node : null
  const type = value ? valueType(value) : null
  return <div className={`sd-ghost ${ghost.kind}${value ? ' scalar' : ''}`} aria-hidden="true" style={{ left: ghost.x - ghost.offsetX, top: ghost.y - ghost.offsetY }}>
    {value && type ? <span className={`sd-value sd-${type}`}>{type === 'color' ? <span className="sd-swatch" style={{ background: value.raw }} /> : <BlockIcon name={type} />}<span>{value.dataType === 'null' ? '없음' : value.raw}</span></span> : ghostLabel(ghost.payload)}
  </div>
}

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

function ResizeHandle({ side, width, onChange }: { side: 'left' | 'right'; width: number; onChange: (width: number) => void }) {
  const initial = side === 'left' ? 220 : 340
  const clamp = (value: number) => Math.min(side === 'left' ? 360 : 560, Math.max(side === 'left' ? 180 : 260, value))
  return <button type="button" className="sd-resizer" aria-label={`${side === 'left' ? '왼쪽' : '오른쪽'} 패널 너비 조절`} title="드래그하거나 ← → 키로 조절 · 더블클릭하면 원래대로" onDoubleClick={() => onChange(initial)} onKeyDown={(event) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); onChange(clamp(width + (event.key === 'ArrowRight' ? 16 : -16) * (side === 'left' ? 1 : -1))) } }} onPointerDown={(event) => {
    event.preventDefault(); const start = event.clientX, startWidth = width, element = event.currentTarget, pointerId = event.pointerId
    element.setPointerCapture(pointerId)
    const move = (next: PointerEvent) => onChange(clamp(startWidth + (next.clientX - start) * (side === 'left' ? 1 : -1)))
    const end = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end); window.removeEventListener('blur', end); if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end); window.addEventListener('blur', end)
  }} />
}

function OutputPanel({ model, format, setFormat, collapsed, onToggle }: { model: StructuredModel; format: StructuredFormat; setFormat: (format: StructuredFormat) => void; collapsed: boolean; onToggle: () => void }) {
  const [notice, setNotice] = useState('')
  const output = useMemo(() => outputStructured(model, format), [model, format])
  const checks = useMemo(() => inspectStructured(model), [model])
  const copyOutput = () => {
    if (output.text === null) { setNotice(output.issues[0] ?? '출력할 수 없습니다.'); return }
    if (!navigator.clipboard?.writeText) { setNotice('클립보드에 복사하지 못했어요'); return }
    void navigator.clipboard.writeText(output.text).then(() => setNotice('출력을 복사했어요'), () => setNotice('클립보드에 복사하지 못했어요'))
  }
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 1800); return () => window.clearTimeout(timer) }, [notice])
  return <>
    <aside className="sd-output" id="sd-output-panel" aria-label="출력" hidden={collapsed}>
      <div className="sd-output-header"><div role="tablist" aria-label="출력 형식" className="sd-tabs">{(['json', 'yaml', 'toml'] as const).map((item) => <button key={item} role="tab" aria-selected={item === format} onClick={() => setFormat(item)}>{item.toUpperCase()}</button>)}</div><button type="button" className="sd-copy-button" aria-label="출력 복사" title="출력 복사" onClick={copyOutput}><Copy size={15} /></button><button type="button" className="sd-panel-toggle" aria-label="소스 보기 패널 접기" title="소스 보기 패널 접기" aria-expanded="true" aria-controls="sd-output-panel" onClick={onToggle}><ChevronRight size={15} aria-hidden="true" /></button></div>
      <div className="sd-output-body" id="sd-output-content">
      <div className="sd-output-code"><pre>{output.preview.split('\n').map((line, index) => <span className={line.includes('비어 있음') || line.includes('없음 불가') ? 'sd-output-error-line' : ''} key={index}>{outputTokens(line)}{'\n'}</span>)}</pre>{output.omissions.length > 0 && <div className="sd-output-note">TOML에는 없음 값을 포함할 수 없어 {output.omissions.join(', ')} 항목을 제외했어요.</div>}{output.issues.filter((issue) => !issue.startsWith('빈 자리')).map((issue) => <div className="sd-output-note" key={issue}>{issue}</div>)}</div>
      <div className="sd-checks"><div className="sd-section-label">점검</div>{checks.length ? checks.map((check, index) => <div className="sd-check" key={`${check.label}-${check.path}-${index}`}><i className={check.label === '연결 안 된 블록' ? 'neutral' : undefined} />{check.label} <span>{check.path}</span></div>) : <div className="sd-check"><i className="neutral" />문제 없음</div>}</div>
      </div>
    </aside>
    {collapsed && <div className="sd-output-fab" role="group" aria-label="출력 작업"><button type="button" className="sd-panel-toggle" aria-label="소스 보기 패널 펼치기" title="소스 보기 패널 펼치기" aria-expanded="false" aria-controls="sd-output-panel" onClick={onToggle}><ChevronLeft size={15} aria-hidden="true" /></button><button type="button" className="sd-copy-button" aria-label="출력 복사" title="출력 복사" onClick={copyOutput}><Copy size={15} /></button></div>}
    {notice && <div className="sd-toast" role="status">{notice}</div>}
  </>
}

export function StructuredDataEditor({ document, model, onChange, outputFormat, onOutputFormat }: Props) {
  const [selected, setSelected] = useState<Selection | null>(null)
  const [editing, setEditing] = useState<Selection | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0 })
  const [leftWidth, setLeftWidth] = useState(220)
  const [rightWidth, setRightWidth] = useState(340)
  const [outputCollapsed, setOutputCollapsed] = useState(true)
  const [ghost, setGhost] = useState<Ghost | null>(null)
  const [paletteDragging, setPaletteDragging] = useState(false)
  const [hover, setHover] = useState<DropTarget | null>(null)
  const [focus, setFocus] = useState<{ id: string; path: string[]; depth: number } | null>(null)
  const viewBeforeFocus = useRef<View | null>(null)
  const canvas = useRef<HTMLElement>(null)
  const world = useRef<HTMLDivElement>(null)
  const live = useRef({ model, onChange, view })
  live.current = { model, onChange, view }
  const cleanup = useRef<(() => void) | null>(null)
  const spaceDown = useRef(false)
  const touches = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ distance: number; worldX: number; worldY: number; zoom: number } | null>(null)
  const readonly = document.parseState !== 'ready' || Boolean(model.unsupported)
  useEffect(() => () => cleanup.current?.(), [])
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.code === 'Space' && (event.type === 'keyup' || !(event.target as HTMLElement).closest('input, textarea, select, [contenteditable]'))) spaceDown.current = event.type === 'keydown' }
    const move = (event: PointerEvent) => {
      if (!touches.current.has(event.pointerId)) return
      touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      const pair = [...touches.current.values()]
      if (pair.length < 2 || !pinch.current || !canvas.current) return
      const rect = canvas.current.getBoundingClientRect(), midX = (pair[0].x + pair[1].x) / 2 - rect.left, midY = (pair[0].y + pair[1].y) / 2 - rect.top
      const distance = Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y)
      const zoom = Math.max(.25, Math.min(3, pinch.current.zoom * distance / pinch.current.distance))
      setView({ zoom, x: midX - pinch.current.worldX * zoom, y: midY - pinch.current.worldY * zoom })
    }
    const end = (event: PointerEvent) => { touches.current.delete(event.pointerId); if (touches.current.size < 2) pinch.current = null }
    const blur = () => { spaceDown.current = false; touches.current.clear(); pinch.current = null; cleanup.current?.(); cleanup.current = null; setGhost(null); setHover(null) }
    window.addEventListener('keydown', key); window.addEventListener('keyup', key); window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end); window.addEventListener('blur', blur)
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('keyup', key); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end); window.removeEventListener('blur', blur) }
  }, [])
  useEffect(() => {
    const element = canvas.current
    const editor = element?.closest('.structured-editor')
    if (!element || !editor) return
    const wheel = (event: WheelEvent) => {
      const target = event.target instanceof Element ? event.target : null
      if (!target || !editor.contains(target)) return
      const zoomGesture = event.ctrlKey || event.metaKey
      const inCanvas = target.closest('.sd-canvas') === element
      if (zoomGesture) {
        event.preventDefault()
        if (!inCanvas || target.closest('input, textarea, select, [contenteditable], .sd-popover, .sd-type-menu, .sd-canvas-bar') || touches.current.size > 1) return
        const bounds = element.getBoundingClientRect()
        const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * bounds.height : event.deltaY
        const boundedDelta = Math.max(-50, Math.min(50, delta))
        zoomAt(live.current.view.zoom * Math.exp(-boundedDelta * .002), event.clientX - bounds.left, event.clientY - bounds.top)
        return
      }
      if (!inCanvas || target.closest('input, textarea, select, [contenteditable], .sd-popover, .sd-type-menu, .sd-canvas-bar')) return
      event.preventDefault()
      setView((current) => ({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }))
    }
    window.document.addEventListener('wheel', wheel, { passive: false, capture: true })
    return () => window.document.removeEventListener('wheel', wheel, true)
  }, [])
  const mutate = (update: (next: StructuredModel) => void, group: 'typing' | 'command' = 'command') => {
    if (readonly) return
    const next = structuredClone(live.current.model); update(next); live.current.model = next; live.current.onChange(next, group)
  }
  const zoomAt = (target: number, cx?: number, cy?: number) => {
    const bounds = canvas.current?.getBoundingClientRect()
    const x = cx ?? (bounds?.width ?? 0) / 2, y = cy ?? (bounds?.height ?? 0) / 2
    setView((current) => { const zoom = Math.max(.25, Math.min(3, target)); return { zoom, x: x - (x - current.x) * zoom / current.zoom, y: y - (y - current.y) * zoom / current.zoom } })
  }
  const targetAt = (x: number, y: number, kind: 'node' | 'slot', ids: Set<string>): DropTarget | null => {
    const element = window.document.elementFromPoint(x, y) as HTMLElement | null
    if (!element || !canvas.current?.contains(element)) return null
    for (let parent: HTMLElement | null = element; parent && parent !== canvas.current; parent = parent.parentElement) {
      if ([parent.dataset.node, parent.dataset.row, parent.dataset.container, parent.dataset.socket].some((id) => id && ids.has(id))) return null
    }
    if (kind === 'node') {
      const socket = element.closest<HTMLElement>('[data-socket]')
      if (socket?.dataset.socket && !ids.has(socket.dataset.socket)) return { type: 'socket', id: socket.dataset.socket }
    }
    const block = element.closest<HTMLElement>('[data-container]')
    if (block?.dataset.container) {
      const id = block.dataset.container
      const node = findNode(live.current.model, id)
      if (!node || node.kind === 'scalar') return null
      const rows = [...block.querySelectorAll<HTMLElement>('[data-parent]')].filter((row) => row.dataset.parent === id)
      let index = node.items.length
      if (block.dataset.collapsed !== 'true') {
        for (const row of rows) { const bounds = row.getBoundingClientRect(); if (y < bounds.top + bounds.height / 2) { index = node.items.findIndex((item) => item.id === row.dataset.row); break } }
      }
      return { type: 'insert', id, index }
    }
    return { type: 'canvas', x: 0, y: 0 }
  }
  const startDrag = (event: ReactPointerEvent<HTMLElement>, source: DragSource, selection: Selection | null) => {
    if ((spaceDown.current || event.button === 1) && canvas.current?.contains(event.currentTarget)) { event.stopPropagation(); pan(event, true); return }
    if (event.button !== 0 || readonly || event.altKey || touches.current.size > 1) return
    event.stopPropagation(); event.preventDefault()
    const element = event.currentTarget, sx = event.clientX, sy = event.clientY
    const payload = sourcePayload(live.current.model, source)
    if (!payload) return
    const hasContainerNode = payload.node?.kind === 'object' || payload.node?.kind === 'array'
    const lifted = source.type !== 'palette' && hasContainerNode ? element.closest<HTMLElement>('.sd-container') ?? element : element
    const bounds = lifted.getBoundingClientRect()
    const originScale = lifted.closest('.sd-world') ? live.current.view.zoom : 1
    const liftedStyleProperties = ['position', 'z-index', 'transform', 'transform-origin', 'filter', 'transition', 'cursor', 'pointer-events', 'will-change']
    const originalLiftStyles = new Map<string, { value: string; priority: string }>(liftedStyleProperties.map((property) => [property, { value: lifted.style.getPropertyValue(property), priority: lifted.style.getPropertyPriority(property) }] as const))
    const ids = payloadIds(payload), kind = payload.slot ? 'slot' : 'node'
    let moved = false, liftedActive = false, last: DropTarget | null = null
    element.setPointerCapture(event.pointerId)
    const clearLifted = () => {
      if (!liftedActive) return
      lifted.classList.remove('sd-lifted')
      originalLiftStyles.forEach(({ value, priority }, property) => {
        if (value) lifted.style.setProperty(property, value, priority)
        else lifted.style.removeProperty(property)
      })
      liftedActive = false
      setPaletteDragging(false)
    }
    const move = (next: PointerEvent) => {
      if (!moved && Math.hypot(next.clientX - sx, next.clientY - sy) < 4) return
      if (!liftedActive) {
        lifted.classList.add('sd-lifted')
        lifted.style.setProperty('position', 'relative')
        lifted.style.setProperty('z-index', '55')
        lifted.style.setProperty('transform-origin', `${(sx - bounds.left) / originScale}px ${(sy - bounds.top) / originScale}px`)
        lifted.style.setProperty('filter', 'drop-shadow(0 10px 14px rgb(0 0 0 / 24%))')
        lifted.style.setProperty('transition', 'transform 70ms cubic-bezier(.2, .8, .2, 1)')
        lifted.style.setProperty('cursor', 'grabbing')
        lifted.style.setProperty('pointer-events', 'none')
        lifted.style.setProperty('will-change', 'transform')
        liftedActive = true
        if (source.type === 'palette') setPaletteDragging(true)
      }
      moved = true
      const scale = lifted.closest('.sd-world') ? live.current.view.zoom : 1
      lifted.style.setProperty('transform', `translate3d(${(next.clientX - sx) / scale}px, ${(next.clientY - sy) / scale}px, 0) rotate(-2deg) scale(1.02)`)
      last = targetAt(next.clientX, next.clientY, kind, ids)
      setHover(last)
    }
    const end = (next: PointerEvent) => {
      cleanup.current?.(); cleanup.current = null; clearLifted(); setGhost(null); setHover(null)
      if (!moved) { if (selection) { setSelected(selection); setEditing(null); element.focus({ preventScroll: true }) }; return }
      if (next.type === 'pointercancel' || !last || !canvas.current) return
      if (last.type === 'canvas') { const box = canvas.current.getBoundingClientRect(), current = live.current.view; last = { type: 'canvas', x: Math.round((next.clientX - (sx - bounds.left) - box.left - current.x) / current.zoom), y: Math.round((next.clientY - (sy - bounds.top) - box.top - current.y) / current.zoom) } }
      const result = applyDrop(live.current.model, source, last)
      if (result) { live.current.onChange(result); if (last.type === 'insert') setCollapsed((old) => { const copy = new Set(old); copy.delete((last as { id: string }).id); return copy }); setSelected(selection) }
    }
    const cancel = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end); clearLifted() }
    cleanup.current?.(); cleanup.current = cancel
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end)
  }
  const startPaletteKey = (event: React.KeyboardEvent<HTMLElement>, payload: Payload) => {
    if (readonly || !canvas.current || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault(); event.stopPropagation()
    const bounds = canvas.current.getBoundingClientRect(), ids = payloadIds(payload), kind = payload.slot ? 'slot' : 'node'
    let x = bounds.left + bounds.width / 2, y = bounds.top + bounds.height / 2
    const update = () => { setGhost({ x, y, offsetX: 0, offsetY: 0, payload, kind, ids }); setHover(targetAt(x, y, kind, ids)) }
    const cancel = () => { window.removeEventListener('keydown', key, true); setGhost(null); setHover(null); cleanup.current = null }
    const key = (next: KeyboardEvent) => {
      if (next.key === 'Escape') { next.preventDefault(); next.stopPropagation(); cancel(); return }
      if (next.key === 'Enter' || next.key === ' ') {
        next.preventDefault(); next.stopPropagation()
        let target = targetAt(x, y, kind, ids)
        if (target?.type === 'canvas') { const current = live.current.view; target = { type: 'canvas', x: Math.round((x - bounds.left - current.x) / current.zoom), y: Math.round((y - bounds.top - current.y) / current.zoom) } }
        if (target) { const result = applyDrop(live.current.model, { type: 'palette', payload }, target); if (result) live.current.onChange(result) }
        cancel(); return
      }
      const step = next.shiftKey ? 40 : 10
      if (next.key === 'ArrowLeft') x = Math.max(bounds.left, x - step)
      else if (next.key === 'ArrowRight') x = Math.min(bounds.right - 1, x + step)
      else if (next.key === 'ArrowUp') y = Math.max(bounds.top, y - step)
      else if (next.key === 'ArrowDown') y = Math.min(bounds.bottom - 1, y + step)
      else return
      next.preventDefault(); next.stopPropagation(); update()
    }
    cleanup.current?.(); cleanup.current = cancel
    window.addEventListener('keydown', key, true); update()
  }
  const pan = (event: ReactPointerEvent<HTMLElement>, force = false) => {
    if (event.button !== 0 && event.button !== 1) return
    if (!force && event.target !== event.currentTarget && event.target !== world.current && event.button !== 1 && !spaceDown.current) return
    event.preventDefault(); const x = event.clientX, y = event.clientY, initial = live.current.view
    let moved = false
    const move = (next: PointerEvent) => { moved ||= Math.hypot(next.clientX - x, next.clientY - y) >= 4; if (moved) setView({ ...initial, x: initial.x + next.clientX - x, y: initial.y + next.clientY - y }) }
    const clear = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end) }
    const end = () => { clear(); cleanup.current = null; if (!moved) { setSelected(null); setEditing(null) } }
    cleanup.current?.(); cleanup.current = clear
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end)
  }
  const fit = () => {
    if (!canvas.current || !world.current) return
    const bounds = canvas.current.getBoundingClientRect()
    const roots = [...world.current.querySelectorAll<HTMLElement>('.sd-root')]
    const minX = Math.min(0, ...roots.map((root) => root.offsetLeft)), minY = Math.min(0, ...roots.map((root) => root.offsetTop))
    const maxX = Math.max(1040, ...roots.map((root) => root.offsetLeft + root.offsetWidth)), maxY = Math.max(860, ...roots.map((root) => root.offsetTop + root.offsetHeight))
    const zoom = Math.max(.25, Math.min(3, (bounds.width - 40) / (maxX - minX), (bounds.height - 40) / (maxY - minY)))
    setView({ zoom, x: (bounds.width - (maxX - minX) * zoom) / 2 - minX * zoom, y: (bounds.height - (maxY - minY) * zoom) / 2 - minY * zoom })
  }
  const toggle = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) => setter((old) => { const next = new Set(old); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const keyDown = (event: React.KeyboardEvent) => {
    const target = event.target as HTMLElement
    if (!target.closest('.sd-canvas') || target.closest('button, a, input, textarea, select, [contenteditable]') || event.nativeEvent.isComposing) return
    if (event.key === 'Escape') { setSelected(null); setEditing(null); return }
    if (!selected || readonly) return
    if (event.key === 'Enter') {
      event.preventDefault()
      if (selected.type !== 'slot' || findSlotParent(model, selected.id)?.kind !== 'array') setEditing(selected)
    }
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); const result = removeSelection(model, selected.type, selected.id); if (result) { onChange(result); setSelected(null) } }
  }
  const focusedNode = focus ? findNode(model, focus.id) : undefined
  useLayoutEffect(() => {
    if (!focus || !focusedNode || !canvas.current || !world.current) return
    const focusedContainer = world.current.querySelector<HTMLElement>('.sd-focused-container')
    if (!focusedContainer) return
    const canvasBounds = canvas.current.getBoundingClientRect()
    const containerBounds = focusedContainer.getBoundingClientRect()
    setView((current) => ({
      ...current,
      x: current.x + canvasBounds.left + canvasBounds.width / 2 - (containerBounds.left + containerBounds.width / 2),
      y: current.y + canvasBounds.top + canvasBounds.height / 2 - (containerBounds.top + containerBounds.height / 2),
    }))
  }, [focus?.id, focusedNode?.id])
  const context = { model, selected, editing, collapsed, expanded, hover, draggingIds: ghost?.ids ?? new Set<string>(), readonly, focusedNodeId: focusedNode && focus ? focus.id : null, startDrag, startPaletteKey, select: setSelected, edit: setEditing, mutate, toggleCollapsed: (id: string) => toggle(setCollapsed, id), toggleExpanded: (id: string) => toggle(setExpanded, id), focusNode: (id: string, path: string[], depth: number) => { if (!focus) viewBeforeFocus.current = live.current.view; setFocus({ id, path, depth }); setSelected(null) } }
  return <BlockContext.Provider value={context}><div className={`structured-editor${paletteDragging ? ' sd-palette-dragging' : ''}`} onKeyDown={keyDown}>
    <div className="sd-layout" style={{ '--sd-left': `${leftWidth}px`, '--sd-right': `${rightWidth}px` } as React.CSSProperties}>
      <StructuredPalette /><ResizeHandle side="left" width={leftWidth} onChange={setLeftWidth} />
      <main className="sd-canvas" ref={canvas} aria-label="작업 캔버스" tabIndex={0} onPointerDownCapture={(event) => {
        if (event.pointerType !== 'touch') return
        touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
        const pair = [...touches.current.values()]
        if (pair.length === 2 && canvas.current) {
          cleanup.current?.(); cleanup.current = null; setGhost(null); setHover(null)
          const rect = canvas.current.getBoundingClientRect(), current = live.current.view, x = (pair[0].x + pair[1].x) / 2 - rect.left, y = (pair[0].y + pair[1].y) / 2 - rect.top
          pinch.current = { distance: Math.max(1, Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y)), worldX: (x - current.x) / current.zoom, worldY: (y - current.y) / current.zoom, zoom: current.zoom }
        }
      }} onPointerDown={(event) => { if (touches.current.size < 2) pan(event) }} style={{ backgroundSize: `${20 * view.zoom}px ${20 * view.zoom}px`, backgroundPosition: `${view.x}px ${view.y}px` }}>
        <div className="sd-world" ref={world} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
          {focusedNode && focus ? <div className="sd-root" style={{ left: 48, top: 40 }}><button type="button" className="sd-focus-back" aria-label="전체 보기로 돌아가기" title="전체 보기로 돌아가기" onClick={() => { setFocus(null); if (viewBeforeFocus.current) { setView(viewBeforeFocus.current); viewBeforeFocus.current = null } }}><ChevronLeft size={15} aria-hidden="true" /><span>전체</span></button><NodeBlock node={focusedNode} depth={focus.depth} path={focus.path} /></div> : <>{model.root && <div className="sd-root" style={{ left: 48, top: 40 }}><NodeBlock node={model.root} root /></div>}{model.loose.map((block) => <div className="sd-root sd-loose" key={block.id} style={{ left: block.x, top: block.y }}>{block.node ? <NodeBlock node={block.node} looseId={block.id} /> : block.slot ? <LooseProperty item={block.slot} looseId={block.id} /> : null}</div>)}</>}
        </div>
        {model.unsupported && <div className="sd-model-note" role="status">{model.unsupported}</div>}
        <div className="sd-canvas-bar"><button aria-label="축소" title="축소" onClick={() => zoomAt(view.zoom / 1.2)}>−</button><button aria-label="100%로 되돌리기" title="100%로 되돌리기" className="sd-percent" onClick={() => setView({ zoom: 1, x: 0, y: 0 })}>{Math.round(view.zoom * 100)}%</button><button aria-label="확대" title="확대" onClick={() => zoomAt(view.zoom * 1.2)}>+</button><button className="sd-fit" aria-label="화면에 맞추기" title="화면에 맞추기" onClick={fit}>화면에 맞추기</button></div>
      </main>
      {!outputCollapsed && <ResizeHandle side="right" width={rightWidth} onChange={setRightWidth} />}<OutputPanel model={model} format={outputFormat} setFormat={onOutputFormat} collapsed={outputCollapsed} onToggle={() => setOutputCollapsed((current) => !current)} />
    </div>
    {ghost && <DragGhost ghost={ghost} />}
  </div></BlockContext.Provider>
}
