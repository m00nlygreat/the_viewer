import { useEffect, useRef, useState, type MutableRefObject, type PointerEvent as ReactPointerEvent } from 'react'
import type { CanvasView } from './BlockCanvas'

interface PinchAnchor { distance: number; worldX: number; worldY: number; zoom: number }

export function useCanvasViewport({ cleanup, onPinchStart, onWindowBlur, onPanClick }: {
  cleanup: MutableRefObject<(() => void) | null>
  onPinchStart?: () => void
  onWindowBlur?: () => void
  onPanClick?: () => void
}) {
  const [view, setView] = useState<CanvasView>({ zoom: 1, x: 0, y: 0 })
  const canvas = useRef<HTMLElement | null>(null)
  const world = useRef<HTMLDivElement | null>(null)
  const touches = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<PinchAnchor | null>(null)
  const spaceDown = useRef(false)
  const viewRef = useRef(view)
  viewRef.current = view
  const callbacks = useRef({ onPinchStart, onWindowBlur, onPanClick })
  callbacks.current = { onPinchStart, onWindowBlur, onPanClick }

  const zoomAt = (target: number, cx?: number, cy?: number) => {
    const bounds = canvas.current?.getBoundingClientRect()
    const x = cx ?? (bounds?.width ?? 0) / 2, y = cy ?? (bounds?.height ?? 0) / 2
    setView((current) => { const zoom = Math.max(.25, Math.min(3, target)); return { zoom, x: x - (x - current.x) * zoom / current.zoom, y: y - (y - current.y) * zoom / current.zoom } })
  }

  const pan = (event: ReactPointerEvent<HTMLElement>, force = false) => {
    if (event.button !== 0 && event.button !== 1) return
    if (!force && event.target !== event.currentTarget && event.target !== world.current && event.button !== 1 && !spaceDown.current) return
    event.preventDefault()
    const x = event.clientX, y = event.clientY, initial = viewRef.current
    let moved = false, frame = 0, latest: PointerEvent | null = null
    const applyPan = (next: PointerEvent) => setView({ ...initial, x: initial.x + next.clientX - x, y: initial.y + next.clientY - y })
    const move = (next: PointerEvent) => {
      moved ||= Math.hypot(next.clientX - x, next.clientY - y) >= 4
      if (!moved) return
      latest = next
      if (!frame) frame = window.requestAnimationFrame(() => { frame = 0; if (latest) applyPan(latest) })
    }
    const clear = () => { if (frame) window.cancelAnimationFrame(frame); frame = 0; latest = null; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end) }
    const end = (next: PointerEvent) => { if (next.type !== 'pointercancel' && moved) applyPan(next); clear(); cleanup.current = null; if (!moved) callbacks.current.onPanClick?.() }
    cleanup.current?.(); cleanup.current = clear
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end)
  }

  const onPointerDownCapture = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType !== 'touch') return
    touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const pair = [...touches.current.values()]
    if (pair.length === 2 && canvas.current) {
      cleanup.current?.(); cleanup.current = null
      callbacks.current.onPinchStart?.()
      const rect = canvas.current.getBoundingClientRect(), current = viewRef.current
      const x = (pair[0]!.x + pair[1]!.x) / 2 - rect.left, y = (pair[0]!.y + pair[1]!.y) / 2 - rect.top
      pinch.current = { distance: Math.max(1, Math.hypot(pair[0]!.x - pair[1]!.x, pair[0]!.y - pair[1]!.y)), worldX: (x - current.x) / current.zoom, worldY: (y - current.y) / current.zoom, zoom: current.zoom }
    }
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => { if (touches.current.size < 2) pan(event) }

  const fit = () => {
    if (!canvas.current || !world.current) return
    const bounds = canvas.current.getBoundingClientRect()
    const roots = [...world.current.querySelectorAll<HTMLElement>('.sd-root')]
    const minX = Math.min(0, ...roots.map((root) => root.offsetLeft)), minY = Math.min(0, ...roots.map((root) => root.offsetTop))
    const maxX = Math.max(1040, ...roots.map((root) => root.offsetLeft + root.offsetWidth)), maxY = Math.max(860, ...roots.map((root) => root.offsetTop + root.offsetHeight))
    const zoom = Math.max(.25, Math.min(3, (bounds.width - 40) / (maxX - minX), (bounds.height - 40) / (maxY - minY)))
    setView({ zoom, x: (bounds.width - (maxX - minX) * zoom) / 2 - minX * zoom, y: (bounds.height - (maxY - minY) * zoom) / 2 - minY * zoom })
  }

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const target = event.target as Element | null
      if (event.code === 'Space' && (event.type === 'keyup' || !target?.closest('input, textarea, select, [contenteditable]'))) spaceDown.current = event.type === 'keydown'
    }
    const move = (event: PointerEvent) => {
      if (!touches.current.has(event.pointerId)) return
      touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      const pair = [...touches.current.values()]
      if (pair.length < 2 || !pinch.current || !canvas.current) return
      const rect = canvas.current.getBoundingClientRect(), midX = (pair[0]!.x + pair[1]!.x) / 2 - rect.left, midY = (pair[0]!.y + pair[1]!.y) / 2 - rect.top
      const distance = Math.hypot(pair[0]!.x - pair[1]!.x, pair[0]!.y - pair[1]!.y)
      const zoom = Math.max(.25, Math.min(3, pinch.current.zoom * distance / pinch.current.distance))
      setView({ zoom, x: midX - pinch.current.worldX * zoom, y: midY - pinch.current.worldY * zoom })
    }
    const end = (event: PointerEvent) => { touches.current.delete(event.pointerId); if (touches.current.size < 2) pinch.current = null }
    const blur = () => {
      spaceDown.current = false; touches.current.clear(); pinch.current = null
      cleanup.current?.(); cleanup.current = null
      callbacks.current.onWindowBlur?.()
    }
    const wheel = (event: WheelEvent) => {
      const target = event.target instanceof Element ? event.target : null
      const editor = canvas.current?.closest('.structured-editor')
      if (!target || !editor?.contains(target)) return
      const zoomGesture = event.ctrlKey || event.metaKey
      const inCanvas = target.closest('.sd-canvas') === canvas.current
      if (zoomGesture) {
        event.preventDefault()
        if (!inCanvas || target.closest('input, textarea, select, [contenteditable], .sd-popover, .sd-type-menu, .sd-canvas-bar') || touches.current.size > 1) return
        const bounds = canvas.current!.getBoundingClientRect()
        const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * bounds.height : event.deltaY
        zoomAt(viewRef.current.zoom * Math.exp(-Math.max(-50, Math.min(50, delta)) * .002), event.clientX - bounds.left, event.clientY - bounds.top)
        return
      }
      if (!inCanvas || target.closest('input, textarea, select, [contenteditable], .sd-popover, .sd-type-menu, .sd-canvas-bar')) return
      event.preventDefault()
      setView((current) => ({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }))
    }
    window.addEventListener('keydown', key); window.addEventListener('keyup', key)
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end); window.addEventListener('blur', blur)
    window.document.addEventListener('wheel', wheel, { passive: false, capture: true })
    return () => {
      window.removeEventListener('keydown', key); window.removeEventListener('keyup', key)
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end); window.removeEventListener('blur', blur)
      window.document.removeEventListener('wheel', wheel, true)
    }
  }, [cleanup])

  return { view, setView, canvas, world, touches, spaceDown, zoomAt, pan, fit, onPointerDownCapture, onPointerDown }
}
