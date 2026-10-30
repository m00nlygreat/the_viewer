import type { Root } from 'react-dom/client'

export function unmountWidgetRoot(root: Root): void {
  queueMicrotask(() => root.unmount())
}
