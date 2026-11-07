import type { PointerEvent as ReactPointerEvent, ReactNode, RefObject } from 'react'
import { ChevronLeft, Maximize2 } from 'lucide-react'
import type { LooseBlock, StructuredModel, StructuredNode } from '../../domain/structured/model'

export interface CanvasView { zoom: number; x: number; y: number }

export function BlockCanvas({ model, view, canvasRef, worldRef, focus, focusedNode, onBackFromFocus, onPointerDownCapture, onPointerDown, onZoomAt, onResetView, onFit, renderRoot, renderNode, renderLoose }: {
  model: StructuredModel
  view: CanvasView
  canvasRef: RefObject<HTMLElement | null>
  worldRef: RefObject<HTMLDivElement | null>
  focus: { id: string; path: string[]; depth: number } | null
  focusedNode?: StructuredNode
  onBackFromFocus: () => void
  onPointerDownCapture: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
  onZoomAt: (target: number) => void
  onResetView: () => void
  onFit: () => void
  renderRoot: (root: StructuredNode | null) => ReactNode
  renderNode: (node: StructuredNode, options: { depth?: number; path?: string[] }) => ReactNode
  renderLoose: (block: LooseBlock) => ReactNode
}) {
  return <main className="sd-canvas" ref={canvasRef} aria-label="작업 캔버스" tabIndex={0} onPointerDownCapture={onPointerDownCapture} onPointerDown={onPointerDown} style={{ backgroundSize: `${20 * view.zoom}px ${20 * view.zoom}px`, backgroundPosition: `${view.x}px ${view.y}px` }}>
    <div className="sd-world" ref={worldRef} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
      {focusedNode && focus
        ? <div className="sd-root" style={{ left: 48, top: 40 }}><button type="button" className="sd-focus-back" aria-label="전체 보기로 돌아가기" title="전체 보기로 돌아가기" onClick={onBackFromFocus}><ChevronLeft size={15} aria-hidden="true" /><span>전체</span></button>{renderNode(focusedNode, { depth: focus.depth, path: focus.path })}</div>
        : <>{renderRoot(model.root)}{model.loose.map((block) => <div className="sd-root sd-loose" key={block.id} style={{ left: block.x, top: block.y }}>{renderLoose(block)}</div>)}</>}
    </div>
    {model.unsupported && <div className="sd-model-note" role="status">{model.unsupported}</div>}
    <div className="sd-canvas-bar"><button aria-label="축소" title="축소" onClick={() => onZoomAt(view.zoom / 1.2)}>−</button><button aria-label="100%로 되돌리기" title="100%로 되돌리기" className="sd-percent" onClick={onResetView}>{Math.round(view.zoom * 100)}%</button><button aria-label="확대" title="확대" onClick={() => onZoomAt(view.zoom * 1.2)}>+</button><button className="sd-fit" aria-label="화면에 맞추기" title="화면에 맞추기" onClick={onFit}><Maximize2 size={15} aria-hidden="true" /></button></div>
  </main>
}
