import type { StructuredNode } from '../../domain/structured/model'
import { NodeBlock } from '../structured/Blocks'

export function EnvRootBlock({ root }: { root: StructuredNode | null }) {
  if (!root) return null
  return <NodeBlock node={root} root rootLabel=".env" />
}
