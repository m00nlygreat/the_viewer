import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MutableRefObject, type PointerEvent as ReactPointerEvent } from 'react'
import type { StructuredModel } from '../../domain/structured/model'
import { findNode, findSlotParent, payloadIds, sourcePayload, type DragSource, type DropTarget, type Payload } from '../../domain/structured/operations'
import { applyBlockDrop, removeBlockSelection } from '../../domain/block-editor/commands'
import type { BlockEditorPolicy } from '../../domain/block-editor/policy'
import type { Selection } from './BlockContext'
import type { useCanvasViewport } from './useCanvasViewport'

export interface BlockGhost { x: number; y: number; offsetX: number; offsetY: number; payload: Payload; kind: 'node' | 'slot'; ids: Set<string> }
const EMPTY_DRAGGING_IDS = new Set<string>()

interface DraftState<T extends object = object> { base: T; copy?: T; parent?: DraftState; parentKey?: PropertyKey; proxy?: T }

function createCopyOnWriteDraft<T extends object>(base: T): { draft: T; finish: () => T } {
  const states = new WeakMap<object, DraftState>()
  const copyState = (state: DraftState): object => {
    if (state.copy) return state.copy
    state.copy = (Array.isArray(state.base) ? state.base.slice() : { ...state.base }) as object
    states.set(state.copy, state)
    if (state.parent && state.parentKey !== undefined) Reflect.set(copyState(state.parent), state.parentKey, state.copy)
    return state.copy
  }
  const stateFor = (value: object, parent?: DraftState, parentKey?: PropertyKey): DraftState => {
    const existing = states.get(value)
    if (existing) return existing
    const state: DraftState = { base: value, parent, parentKey }
    const unwrap = (candidate: unknown) => candidate && typeof candidate === 'object' ? states.get(candidate)?.copy ?? states.get(candidate)?.base ?? candidate : candidate
    const proxy = new Proxy(value, {
      get(_target, key, receiver) {
        const source = state.copy ?? state.base
        const child = Reflect.get(source, key, receiver)
        return child !== null && typeof child === 'object' ? stateFor(child, state, key).proxy : child
      },
      set(_target, key, nextValue) {
        const source = state.copy ?? state.base
        const next = unwrap(nextValue)
        if (Object.is(Reflect.get(source, key), next)) return true
        return Reflect.set(copyState(state), key, next)
      },
      deleteProperty(_target, key) {
        const source = state.copy ?? state.base
        if (!Reflect.has(source, key)) return true
        return Reflect.deleteProperty(copyState(state), key)
      },
      has(_target, key) { return Reflect.has(state.copy ?? state.base, key) },
      ownKeys() { return Reflect.ownKeys(state.copy ?? state.base) },
      getOwnPropertyDescriptor(_target, key) { return Reflect.getOwnPropertyDescriptor(state.copy ?? state.base, key) }
    }) as T
    state.proxy = proxy
    states.set(value, state)
    states.set(proxy, state)
    return state
  }
  const root = stateFor(base)
  return { draft: root.proxy as T, finish: () => root.copy ? root.copy as T : base }
}

type Viewport = ReturnType<typeof useCanvasViewport>

export function useBlockEditor({ model, onChange, readonly, policy, stringValuesOnly, cleanup, viewport }: {
  model: StructuredModel
  onChange: (model: StructuredModel, group?: 'typing' | 'command') => void
  readonly: boolean
  policy: BlockEditorPolicy
  stringValuesOnly?: boolean
  cleanup: MutableRefObject<(() => void) | null>
  viewport: Viewport
}) {
  const { canvas: canvasRef, world: worldRef, setView: setCanvasView, view: canvasView } = viewport
  const [selected, setSelected] = useState<Selection | null>(null)
  const [editing, setEditing] = useState<Selection | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [ghost, setGhost] = useState<BlockGhost | null>(null)
  const [paletteDragging, setPaletteDragging] = useState(false)
  const [hover, setHover] = useState<DropTarget | null>(null)
  const [focus, setFocus] = useState<{ id: string; path: string[]; depth: number } | null>(null)
  const viewBeforeFocus = useRef<Viewport['view'] | null>(null)
  const live = useRef({ model, onChange, view: viewport.view })
  live.current = { model, onChange, view: viewport.view }

  const mutate = (update: (next: StructuredModel) => void, group: 'typing' | 'command' = 'command') => {
    if (readonly) return
    const draft = createCopyOnWriteDraft(live.current.model)
    update(draft.draft)
    const next = draft.finish()
    if (next !== live.current.model) { live.current.model = next; live.current.onChange(next, group) }
  }

  const targetAt = (x: number, y: number, kind: 'node' | 'slot', ids: Set<string>): DropTarget | null => {
    const element = window.document.elementFromPoint(x, y) as HTMLElement | null
    if (!element || !viewport.canvas.current?.contains(element)) return null
    for (let parent: HTMLElement | null = element; parent && parent !== viewport.canvas.current; parent = parent.parentElement) {
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
        for (const row of rows) { const bounds = row.getBoundingClientRect(); if (y < bounds.top + bounds.height / 2) { const rowIndex = Number(row.dataset.index); if (Number.isInteger(rowIndex) && rowIndex >= 0) index = rowIndex; break } }
      }
      return { type: 'insert', id, index }
    }
    return { type: 'canvas', x: 0, y: 0 }
  }

  const startDrag = (event: ReactPointerEvent<HTMLElement>, source: DragSource, selection: Selection | null) => {
    if ((viewport.spaceDown.current || event.button === 1) && viewport.canvas.current?.contains(event.currentTarget)) { event.stopPropagation(); viewport.pan(event, true); return }
    if (event.button !== 0 || readonly || event.altKey || viewport.touches.current.size > 1) return
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
    const updateDragPosition = (next: PointerEvent) => {
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
    let frame = 0, latest: PointerEvent | null = null
    const move = (next: PointerEvent) => {
      if (!moved && Math.hypot(next.clientX - sx, next.clientY - sy) < 4) return
      moved = true; latest = next
      if (!frame) frame = window.requestAnimationFrame(() => { frame = 0; if (latest) updateDragPosition(latest) })
    }
    const end = (next: PointerEvent) => {
      if (frame) { window.cancelAnimationFrame(frame); frame = 0 }
      if (next.type !== 'pointercancel' && moved) updateDragPosition(next)
      cleanup.current?.(); cleanup.current = null; clearLifted(); setGhost(null); setHover(null)
      if (!moved) { if (selection) { setSelected(selection); setEditing(null); element.focus({ preventScroll: true }) }; return }
      if (next.type === 'pointercancel' || !last || !viewport.canvas.current) return
      if (last.type === 'canvas') { const box = viewport.canvas.current.getBoundingClientRect(), current = live.current.view; last = { type: 'canvas', x: Math.round((next.clientX - (sx - bounds.left) - box.left - current.x) / current.zoom), y: Math.round((next.clientY - (sy - bounds.top) - box.top - current.y) / current.zoom) } }
      const result = applyBlockDrop(live.current.model, source, last, policy)
      if (result) { live.current.onChange(result); if (last.type === 'insert') setCollapsed((old) => { const copy = new Set(old); copy.delete((last as { id: string }).id); return copy }); setSelected(selection) }
    }
    const cancel = () => { if (frame) window.cancelAnimationFrame(frame); frame = 0; latest = null; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end); clearLifted() }
    cleanup.current?.(); cleanup.current = cancel
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end)
  }

  const startPaletteKey = (event: ReactKeyboardEvent<HTMLElement>, payload: Payload) => {
    if (readonly || !viewport.canvas.current || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault(); event.stopPropagation()
    const bounds = viewport.canvas.current.getBoundingClientRect(), ids = payloadIds(payload), kind = payload.slot ? 'slot' : 'node'
    let x = bounds.left + bounds.width / 2, y = bounds.top + bounds.height / 2
    const update = () => { setGhost({ x, y, offsetX: 0, offsetY: 0, payload, kind, ids }); setHover(targetAt(x, y, kind, ids)) }
    const cancel = () => { window.removeEventListener('keydown', key, true); setGhost(null); setHover(null); cleanup.current = null }
    const key = (next: KeyboardEvent) => {
      if (next.key === 'Escape') { next.preventDefault(); next.stopPropagation(); cancel(); return }
      if (next.key === 'Enter' || next.key === ' ') {
        next.preventDefault(); next.stopPropagation()
        let target = targetAt(x, y, kind, ids)
        if (target?.type === 'canvas') { const current = live.current.view; target = { type: 'canvas', x: Math.round((x - bounds.left - current.x) / current.zoom), y: Math.round((y - bounds.top - current.y) / current.zoom) } }
        if (target) { const result = applyBlockDrop(live.current.model, { type: 'palette', payload }, target, policy); if (result) live.current.onChange(result) }
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

  const keyDown = (event: ReactKeyboardEvent) => {
    const target = event.target as HTMLElement
    if (!target.closest('.sd-canvas') || target.closest('button, a, input, textarea, select, [contenteditable]') || event.nativeEvent.isComposing) return
    if (event.key === 'Escape') { setSelected(null); setEditing(null); return }
    if (!selected || readonly) return
    if (event.key === 'Enter') {
      event.preventDefault()
      if (selected.type !== 'slot' || findSlotParent(model, selected.id)?.kind !== 'array') setEditing(selected)
    }
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); const result = removeBlockSelection(model, selected, policy); if (result) { onChange(result); setSelected(null) } }
  }

  const focusedNode = focus ? findNode(model, focus.id) : undefined
  useLayoutEffect(() => {
    if (!focus || !focusedNode || !canvasRef.current || !worldRef.current) return
    const focusedContainer = worldRef.current.querySelector<HTMLElement>('.sd-focused-container')
    if (!focusedContainer) return
    const canvasBounds = canvasRef.current.getBoundingClientRect(), containerBounds = focusedContainer.getBoundingClientRect()
    setCanvasView((current) => ({
      ...current,
      x: current.x + canvasBounds.left + canvasBounds.width / 2 - (containerBounds.left + containerBounds.width / 2),
      y: current.y + canvasBounds.top + canvasBounds.height / 2 - (containerBounds.top + containerBounds.height / 2)
    }))
  }, [canvasRef, focus, focusedNode, setCanvasView, worldRef])

  const actions = useRef({ startDrag, startPaletteKey, mutate })
  actions.current = { startDrag, startPaletteKey, mutate }
  const context = useMemo(() => ({
    model, selected, editing, collapsed, expanded, hover, draggingIds: ghost?.ids ?? EMPTY_DRAGGING_IDS, readonly, stringValuesOnly,
    focusedNodeId: focusedNode && focus ? focus.id : null,
    startDrag: (...args: Parameters<typeof startDrag>) => actions.current.startDrag(...args),
    startPaletteKey: (...args: Parameters<typeof startPaletteKey>) => actions.current.startPaletteKey(...args),
    select: setSelected,
    edit: setEditing,
    mutate: (...args: Parameters<typeof mutate>) => actions.current.mutate(...args),
    toggleCollapsed: (id: string) => setCollapsed((old) => { const next = new Set(old); if (next.has(id)) next.delete(id); else next.add(id); return next }),
    toggleExpanded: (id: string) => setExpanded((old) => { const next = new Set(old); if (next.has(id)) next.delete(id); else next.add(id); return next }),
    focusNode: (id: string, path: string[], depth: number) => { if (!focus) viewBeforeFocus.current = canvasView; setFocus({ id, path, depth }); setSelected(null) }
  }), [canvasView, collapsed, editing, expanded, focus, focusedNode, ghost?.ids, hover, model, readonly, selected, stringValuesOnly])

  const backFromFocus = () => { setFocus(null); if (viewBeforeFocus.current) { viewport.setView(viewBeforeFocus.current); viewBeforeFocus.current = null } }
  const clearSelection = () => { setSelected(null); setEditing(null) }
  const cancelTransient = () => { setGhost(null); setHover(null) }
  return { context, keyDown, ghost, paletteDragging, focus, focusedNode, backFromFocus, clearSelection, cancelTransient }
}
