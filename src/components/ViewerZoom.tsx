import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

interface Props { children: ReactNode }

const MIN_ZOOM = 0.5
const MAX_ZOOM = 3

export function ViewerZoom({ children }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const zoomRef = useRef(1)
  const pinchStart = useRef<{ distance: number; zoom: number } | null>(null)
  const [zoom, setZoom] = useState(1)

  useEffect(() => {
    const element = container.current
    if (!element) return

    const applyZoom = (next: number) => {
      const bounded = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next))
      zoomRef.current = bounded
      setZoom(bounded)
    }
    const touchDistance = (touches: TouchList) => {
      const first = touches[0]
      const second = touches[1]
      if (!first || !second) return 0
      return Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY)
    }
    const isInteractive = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest('input, textarea, select, button, a, [contenteditable="true"], .cm-editor, .monaco-editor, .csv-data-grid, .cm-md-table-data-grid, [role="grid"]'))
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey || isInteractive(event.target)) return
      event.preventDefault()
      applyZoom(zoomRef.current * Math.exp(-event.deltaY * 0.002))
    }
    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length < 2 || isInteractive(event.target)) return
      event.preventDefault()
      pinchStart.current = { distance: touchDistance(event.touches), zoom: zoomRef.current }
    }
    const onTouchMove = (event: TouchEvent) => {
      const start = pinchStart.current
      if (event.touches.length < 2 || !start) return
      event.preventDefault()
      const distance = touchDistance(event.touches)
      if (distance > 0 && start.distance > 0) applyZoom(start.zoom * distance / start.distance)
    }
    const onTouchEnd = (event: TouchEvent) => {
      if (event.touches.length < 2) {
        pinchStart.current = null
      } else {
        pinchStart.current = { distance: touchDistance(event.touches), zoom: zoomRef.current }
      }
    }

    element.addEventListener('wheel', onWheel, { passive: false })
    element.addEventListener('touchstart', onTouchStart, { passive: false })
    element.addEventListener('touchmove', onTouchMove, { passive: false })
    element.addEventListener('touchend', onTouchEnd)
    element.addEventListener('touchcancel', onTouchEnd)
    return () => {
      element.removeEventListener('wheel', onWheel)
      element.removeEventListener('touchstart', onTouchStart)
      element.removeEventListener('touchmove', onTouchMove)
      element.removeEventListener('touchend', onTouchEnd)
      element.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [])

  const contentStyle = { zoom } as CSSProperties
  return <div className="viewer-zoom" ref={container}>
    <div className="viewer-zoom-content" style={contentStyle}>{children}</div>
  </div>
}
