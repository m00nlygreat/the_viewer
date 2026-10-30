import { createRoot, type Root } from 'react-dom/client'
import type { ReactNode } from 'react'

const roots = new WeakMap<HTMLElement, Root>()

export function renderWidgetRoot(element: HTMLElement, content: ReactNode): void {
  let root = roots.get(element)
  if (!root) {
    root = createRoot(element)
    roots.set(element, root)
  }
  root.render(content)
}

export function unmountWidgetRoot(element: HTMLElement): void {
  const root = roots.get(element)
  if (!root) return
  roots.delete(element)
  queueMicrotask(() => root.unmount())
}
