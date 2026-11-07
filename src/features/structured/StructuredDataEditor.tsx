import { useMemo } from 'react'
import type { ViewerDocument } from '../../domain/types'
import type { StructuredFormat, StructuredModel } from '../../domain/structured/model'
import { inspectStructured, outputStructured } from '../../domain/structured/output'
import { structuredBlockPolicy } from '../../domain/block-editor/policy'
import { writeClipboardText } from '../../platform/browserFiles'
import { BlockEditor, type BlockEditorAdapter } from '../block-editor/BlockEditor'
import { StructuredPalette } from './StructuredPalette'
import { LooseProperty, NodeBlock } from './Blocks'
import './structured.css'

export interface StructuredDataEditorProps {
  document: ViewerDocument
  model: StructuredModel
  onChange: (model: StructuredModel, group?: 'typing' | 'command') => void
  outputFormat: StructuredFormat
  onOutputFormat: (format: StructuredFormat) => void
}

export function StructuredDataEditor(props: StructuredDataEditorProps) {
  const adapter = useMemo<BlockEditorAdapter>(() => ({
    policy: structuredBlockPolicy,
    palette: <StructuredPalette />,
    renderRoot: (root) => root ? <div className="sd-root" style={{ left: 48, top: 40 }}><NodeBlock node={root} root /></div> : null,
    renderNode: (node, options) => <NodeBlock node={node} {...options} />,
    renderLoose: (block) => block.node
      ? <NodeBlock node={block.node} looseId={block.id} />
      : block.slot ? <LooseProperty item={block.slot} looseId={block.id} /> : null,
    output: (model) => outputStructured(model, props.outputFormat),
    checks: (model) => inspectStructured(model),
    onCopyOutput: writeClipboardText,
    outputLabel: '출력',
    outputFormats: ['json', 'yaml', 'toml']
  }), [props.outputFormat])
  return <BlockEditor {...props} adapter={adapter} />
}
