import { useEffect, useRef, type RefObject } from 'react'

export function useOutsideClick<T extends HTMLElement>(active: boolean, onOutsideClick: () => void): RefObject<T | null> {
  const element = useRef<T | null>(null)
  const callback = useRef(onOutsideClick)
  callback.current = onOutsideClick

  useEffect(() => {
    if (!active) return
    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      const target = event.target
      if (target instanceof Node && element.current && !element.current.contains(target)) callback.current()
    }
    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => document.removeEventListener('pointerdown', handlePointerDown, true)
  }, [active])

  return element
}
