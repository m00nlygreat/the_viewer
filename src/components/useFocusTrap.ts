import { useEffect, useRef } from 'react'

export function useFocusTrap<T extends HTMLElement>(): React.RefObject<T | null> {
  const container = useRef<T>(null)
  useEffect(() => {
    const element = container.current
    if (!element) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (!element.contains(previous)) {
      const initial = element.querySelector<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')
      ;(initial ?? element).focus()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const focusable = Array.from(element.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
        .filter((item) => item.getAttribute('aria-hidden') !== 'true' && item.offsetParent !== null)
      if (!focusable.length) { event.preventDefault(); element.focus(); return }
      const first = focusable[0]!
      const last = focusable[focusable.length - 1]!
      if (event.shiftKey && (document.activeElement === first || !element.contains(document.activeElement))) {
        event.preventDefault(); last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !element.contains(document.activeElement))) {
        event.preventDefault(); first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
      if (previous?.isConnected) previous.focus()
    }
  }, [])
  return container
}
