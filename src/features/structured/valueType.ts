import type { StructuredScalar } from '../../domain/structured/model'
import { isoDateKind } from '../../domain/structured/output'

export function valueType(node: StructuredScalar): 'text' | 'number' | 'boolean' | 'date' | 'color' | 'null' {
  if (node.dataType === 'number' || node.dataType === 'boolean' || node.dataType === 'null') return node.dataType
  if (node.dataType === 'native-date-time' || isoDateKind(node.raw) || node.displayHint === 'date') return 'date'
  if (node.displayHint === 'color' || /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(node.raw) || /^(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch)\(/i.test(node.raw)) return 'color'
  return 'text'
}
