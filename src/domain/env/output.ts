import type { StructuredModel } from '../structured/model'
import type { EnvModel } from './model'
import { compileEnv, inspectEnv } from './sourcePatch'

export interface EnvOutput { preview: string; text: string | null; issues: string[]; omissions: string[] }

export function outputEnv(model: EnvModel, source: string): EnvOutput {
  const inspection = inspectEnv(model)
  const compiled = compileEnv(model, model.blocks as StructuredModel, source)
  const issues = [...inspection.issues, ...inspection.duplicates.map((key) => `중복된 변수 이름: ${key}`), ...inspection.loose.map((item) => `연결 안 된 블록은 출력에서 제외됩니다: ${item}`)]
  if (compiled.kind === 'draft') return { preview: compiled.preview, text: null, issues: [...new Set([...issues, ...compiled.issues])], omissions: inspection.loose }
  return { preview: compiled.text, text: compiled.text, issues, omissions: inspection.loose }
}
