import type { DocumentModel } from './types'
import { isStructuredFormat, type StructuredFormat, type StructuredModel } from './structured/model'
import type { EnvModel } from './env/model'

export type BlockEditorFormat = StructuredFormat | 'env'

export function isBlockEditorFormat(format: string): format is BlockEditorFormat {
  return isStructuredFormat(format) || format === 'env'
}

export function getEditableBlocks(model: DocumentModel): StructuredModel {
  if (model && typeof model === 'object' && 'blocks' in model) return (model as EnvModel).blocks
  return model as StructuredModel
}
