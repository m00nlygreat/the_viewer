import type { ReactNode } from 'react'

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

export function BlockEditorLayout({ palette, canvas, output, collapsedOutput, leftWidth, rightWidth, outputCollapsed, onLeftWidthChange, onRightWidthChange }: {
  palette: ReactNode
  canvas: ReactNode
  output: ReactNode
  collapsedOutput: ReactNode
  leftWidth: number
  rightWidth: number
  outputCollapsed: boolean
  onLeftWidthChange: (width: number) => void
  onRightWidthChange: (width: number) => void
}) {
  return <div className="sd-layout" style={{ '--sd-left': `${leftWidth}px`, '--sd-right': `${rightWidth}px` } as React.CSSProperties}>
    {palette}<ResizeHandle side="left" width={leftWidth} onChange={onLeftWidthChange} />
    {canvas}
    {!outputCollapsed && <ResizeHandle side="right" width={rightWidth} onChange={onRightWidthChange} />}
    {outputCollapsed ? collapsedOutput : output}
  </div>
}
