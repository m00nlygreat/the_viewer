import { useMemo, useState, type PointerEvent } from 'react'
import type { StructuredModel, StructuredNode } from '../../domain/structured/model'

interface Color { h: number; s: number; v: number; a: number }
function fromHex(value: string): Color {
  const short = value.match(/^#([0-9a-f]{3})$/i)
  const expanded = short ? `#${[...short[1]].map((digit) => digit + digit).join('')}` : value
  let hex = expanded.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i)
  if (!hex && typeof document !== 'undefined') {
    const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d')
    if (ctx) {
      canvas.width = 1; canvas.height = 1; ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1)
      const pixels = ctx.getImageData(0, 0, 1, 1).data
      const encoded = [...pixels].map((part) => part.toString(16).padStart(2, '0')).join('')
      hex = `#${encoded}`.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i)
    }
  }
  const digits = hex?.[1] ?? '000000'
  const r = parseInt(digits.slice(0, 2), 16) / 255, g = parseInt(digits.slice(2, 4), 16) / 255, b = parseInt(digits.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min
  let h = 0
  if (delta) h = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4
  return { h: (h * 60 + 360) % 360, s: max ? delta / max : 0, v: max, a: hex?.[2] ? parseInt(hex[2], 16) / 255 : 1 }
}
function toHex({ h, s, v, a }: Color): string {
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c
  const rgb = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return `#${rgb.map((value) => Math.round((value + m) * 255).toString(16).padStart(2, '0')).join('')}${a < 0.999 ? Math.round(a * 255).toString(16).padStart(2, '0') : ''}`.toUpperCase()
}
function colors(model: StructuredModel): string[] {
  const found = new Set<string>()
  const visit = (node: StructuredNode | null | undefined) => {
    if (!node) return
    if (node.kind === 'scalar') { if (node.dataType === 'string' && (/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(node.raw) || /^(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch)\(/i.test(node.raw))) found.add(node.raw); return }
    node.items.forEach((item) => visit(item.node))
  }
  visit(model.root); model.loose.forEach((item) => visit(item.node ?? item.slot?.node))
  return [...found]
}
export function ColorPopover({ value, model, onChange, onClose }: { value: string; model: StructuredModel; onChange: (value: string) => void; onClose: () => void }) {
  const [color, setColor] = useState(() => fromHex(value))
  const [input, setInput] = useState(value)
  const swatches = useMemo(() => colors(model), [model])
  const validColor = (text: string) => typeof CSS !== 'undefined' && CSS.supports('color', text)
  const apply = (next: Color) => { setColor(next); const result = toHex(next); setInput(result); onChange(result) }
  const pointer = (event: PointerEvent<HTMLDivElement>, axis: 'sv' | 'h' | 'a') => {
    event.stopPropagation(); event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId)
    const element = event.currentTarget
    const move = (x: number, y: number) => {
      const rect = element.getBoundingClientRect(), cx = Math.max(0, Math.min(1, (x - rect.left) / rect.width)), cy = Math.max(0, Math.min(1, (y - rect.top) / rect.height))
      apply(axis === 'sv' ? { ...color, s: cx, v: 1 - cy } : axis === 'h' ? { ...color, h: cx * 359.99 } : { ...color, a: cx })
    }
    move(event.clientX, event.clientY)
    const onMove = (next: globalThis.PointerEvent) => move(next.clientX, next.clientY)
    const end = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end) }
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end)
  }
  return <div className="sd-popover sd-color-popover" onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.stopPropagation(); onClose() } }}>
    <div className="sd-sv" style={{ backgroundColor: `hsl(${color.h} 100% 50%)` }} onPointerDown={(event) => pointer(event, 'sv')}><i style={{ left: `${color.s * 100}%`, top: `${(1 - color.v) * 100}%` }} /></div>
    <div className="sd-hue" onPointerDown={(event) => pointer(event, 'h')}><i style={{ left: `${color.h / 360 * 100}%` }} /></div>
    <div className="sd-alpha" onPointerDown={(event) => pointer(event, 'a')}><span style={{ background: `linear-gradient(90deg, transparent, ${toHex({ ...color, a: 1 })})` }} /><i style={{ left: `${color.a * 100}%` }} /></div>
    <div className="sd-color-inputs"><input aria-label="색 값" value={input} aria-invalid={!validColor(input)} onChange={(event) => { const next = event.target.value; setInput(next); if (validColor(next)) { setColor(fromHex(next)); onChange(next) } }} /><label><input aria-label="투명도" type="number" min="0" max="100" value={Math.round(color.a * 100)} onChange={(event) => apply({ ...color, a: Math.min(100, Math.max(0, Number(event.target.value))) / 100 })} />%</label></div>
    <small>이 문서의 색</small><div className="sd-color-swatches">{swatches.map((colorValue) => <button key={colorValue} type="button" title={colorValue} aria-label={colorValue} style={{ background: colorValue }} onClick={() => { setColor(fromHex(colorValue)); setInput(colorValue); onChange(colorValue) }} />)}</div>
  </div>
}
