import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { ViewerDocument } from '../../domain/types'
import type { LooseBlock, StructuredFormat, StructuredModel, StructuredNode } from '../../domain/structured/model'
import type { BlockEditorPolicy } from '../../domain/block-editor/policy'
import { BlockContext } from './BlockContext'
import { BlockOutputPanel, CollapsedOutputControls } from './BlockOutputPanel'
import { BlockEditorLayout } from './BlockEditorLayout'
import { BlockCanvas } from './BlockCanvas'
import { useCanvasViewport } from './useCanvasViewport'
import { useBlockEditor, type BlockGhost } from './useBlockEditor'
import { BlockIcon } from '../structured/BlockIcon'
import { valueType } from '../structured/valueType'
import './block-editor.css'

export interface BlockEditorOutput { preview: string; text: string | null; issues: string[]; omissions: string[] }
export interface BlockEditorCheck { label: string; path?: string }
export interface BlockNodeRenderOptions { depth?: number; root?: boolean; rootLabel?: string; looseId?: string; path?: string[] }
export interface BlockEditorAdapter {
  policy: BlockEditorPolicy
  palette: ReactNode
  renderRoot: (root: StructuredNode | null) => ReactNode
  renderNode: (node: StructuredNode, options: BlockNodeRenderOptions) => ReactNode
  renderLoose: (block: LooseBlock) => ReactNode
  output: (model: StructuredModel) => BlockEditorOutput
  checks: (model: StructuredModel) => BlockEditorCheck[]
  onCopyOutput: (text: string) => Promise<void>
  outputLabel: string
  outputFormats?: readonly StructuredFormat[]
  stringValuesOnly?: boolean
}

export interface BlockEditorProps {
  document: ViewerDocument
  model: StructuredModel
  onChange: (model: StructuredModel, group?: 'typing' | 'command') => void
  outputFormat?: StructuredFormat
  onOutputFormat?: (format: StructuredFormat) => void
  adapter: BlockEditorAdapter
  readonly?: boolean
}

interface Props extends BlockEditorProps { outputFormat?: StructuredFormat }

function ghostLabel(payload: BlockGhost['payload']): string {
  if (payload.slot) {
    const child = payload.slot.node
    const summary = !child ? '빈 자리' : child.kind === 'scalar' ? (child.dataType === 'null' ? '없음' : child.raw) : `${child.kind === 'object' ? '{ }' : '[ ]'} ${child.items.length}`
    return `${payload.slot.key ?? '0'} · ${summary}`
  }
  const node = payload.node
  if (node.kind === 'scalar') return node.dataType === 'null' ? '없음' : node.raw
  return `${node.kind === 'object' ? '{ } 객체' : '[ ] 배열'} · ${node.items.length}`
}

function DragGhost({ ghost, stringValuesOnly }: { ghost: BlockGhost; stringValuesOnly: boolean }) {
  const node = ghost.payload.node
  const value = node?.kind === 'scalar' ? node : null
  const type = value ? stringValuesOnly ? 'text' : valueType(value) : null
  return <div className={`sd-ghost ${ghost.kind}${value ? ' scalar' : ''}`} aria-hidden="true" style={{ left: ghost.x - ghost.offsetX, top: ghost.y - ghost.offsetY }}>
    {value && type ? <span className={`sd-value sd-${type}`}>{type === 'color' ? <span className="sd-swatch" style={{ background: value.raw }} /> : <BlockIcon name={type} />}<span>{value.dataType === 'null' ? '없음' : value.raw}</span></span> : ghostLabel(ghost.payload)}
  </div>
}

export function BlockEditor({ document, model, onChange, outputFormat = 'json', onOutputFormat, adapter, readonly: readonlyOverride }: Props) {
  const [leftWidth, setLeftWidth] = useState(220)
  const [rightWidth, setRightWidth] = useState(340)
  const [outputCollapsed, setOutputCollapsed] = useState(true)
  const cleanup = useRef<(() => void) | null>(null)
  const viewportCallbacks = useRef({ clearSelection: () => {}, cancelTransient: () => {} })
  const viewport = useCanvasViewport({
    cleanup,
    onPinchStart: () => viewportCallbacks.current.cancelTransient(),
    onWindowBlur: () => viewportCallbacks.current.cancelTransient(),
    onPanClick: () => viewportCallbacks.current.clearSelection()
  })
  const readonly = readonlyOverride ?? (document.parseState !== 'ready' || Boolean(model.unsupported))
  const editor = useBlockEditor({ model, onChange, readonly, policy: adapter.policy, stringValuesOnly: adapter.stringValuesOnly, cleanup, viewport })
  viewportCallbacks.current = { clearSelection: editor.clearSelection, cancelTransient: editor.cancelTransient }
  useEffect(() => () => cleanup.current?.(), [])

  const canvasContent = <BlockCanvas model={model} view={viewport.view} canvasRef={viewport.canvas} worldRef={viewport.world} focus={editor.focus} focusedNode={editor.focusedNode}
    onBackFromFocus={editor.backFromFocus} onPointerDownCapture={viewport.onPointerDownCapture} onPointerDown={viewport.onPointerDown} onZoomAt={viewport.zoomAt}
    onResetView={() => viewport.setView({ zoom: 1, x: 0, y: 0 })} onFit={viewport.fit} renderRoot={adapter.renderRoot} renderNode={adapter.renderNode} renderLoose={adapter.renderLoose} />
  const collapsedOutput = <CollapsedOutputControls model={model} getOutput={adapter.output} onExpand={() => setOutputCollapsed(false)} onCopyOutput={adapter.onCopyOutput} />
  const outputPanel = <BlockOutputPanel model={model} format={outputFormat} options={adapter.outputFormats ?? []} setFormat={onOutputFormat} getOutput={adapter.output} getChecks={adapter.checks} outputLabel={adapter.outputLabel} onCollapse={() => setOutputCollapsed(true)} onCopyOutput={adapter.onCopyOutput} />

  return <BlockContext.Provider value={editor.context}><div className={`structured-editor${editor.paletteDragging ? ' sd-palette-dragging' : ''}`} onKeyDown={editor.keyDown}>
    <BlockEditorLayout palette={adapter.palette} canvas={canvasContent} output={outputPanel} collapsedOutput={collapsedOutput} leftWidth={leftWidth} rightWidth={rightWidth} outputCollapsed={outputCollapsed} onLeftWidthChange={setLeftWidth} onRightWidthChange={setRightWidth} />
    {editor.ghost && <DragGhost ghost={editor.ghost} stringValuesOnly={Boolean(adapter.stringValuesOnly)} />}
  </div></BlockContext.Provider>
}
