import { useCallback, useMemo } from 'react'
import type { EnvModel } from '../../domain/env/model'
import { outputEnv } from '../../domain/env/output'
import { inspectEnv } from '../../domain/env/sourcePatch'
import { withEnvBlocks } from '../../domain/env/model'
import type { ViewerDocument } from '../../domain/types'
import type { StructuredModel } from '../../domain/structured/model'
import { BlockEditor, type BlockEditorAdapter, type BlockEditorCheck } from '../block-editor/BlockEditor'
import { envPolicy } from './envPolicy'
import { writeClipboardText } from '../../platform/browserFiles'
import { EnvPalette } from './EnvPalette'
import { EnvRootBlock } from './EnvRootBlock'
import { LooseProperty, NodeBlock } from '../structured/Blocks'

type EnvDocument = Extract<ViewerDocument, { format: 'env' }>

export function EnvEditor({ document, model, onChange }: { document: EnvDocument; model: EnvModel; onChange: (model: EnvModel, group?: 'typing' | 'command') => void }) {
  const output = useCallback((blocks: StructuredModel) => outputEnv(withEnvBlocks(model, blocks), document.text), [document.text, model])
  const checks = useCallback((blocks: StructuredModel): BlockEditorCheck[] => {
    const result = inspectEnv(withEnvBlocks(model, blocks))
    return [
      ...result.issues.map((issue) => ({ label: '확인', path: issue })),
      ...result.duplicates.map((key) => ({ label: '중복 키', path: key })),
      ...result.loose.map((item) => ({ label: '연결 안 된 블록', path: item }))
    ]
  }, [model])
  const adapter = useMemo<BlockEditorAdapter>(() => ({
    policy: envPolicy,
    palette: <EnvPalette />,
    renderRoot: (root) => root ? <div className="sd-root" style={{ left: 48, top: 40 }}><EnvRootBlock root={root} /></div> : null,
    renderNode: (node, options) => <NodeBlock node={node} {...options} />,
    renderLoose: (block) => block.node
      ? <NodeBlock node={block.node} looseId={block.id} />
      : block.slot ? <LooseProperty item={block.slot} looseId={block.id} /> : null,
    output, checks, onCopyOutput: writeClipboardText, outputLabel: 'ENV', outputFormats: [], stringValuesOnly: true
  }), [checks, output])
  const readonly = document.parseState !== 'ready' || document.modelRevision !== document.revision || model.syntax === null
  return <BlockEditor document={document} model={model.blocks} onChange={(blocks, group) => onChange(withEnvBlocks(model, blocks), group)} adapter={adapter} readonly={readonly} />
}
