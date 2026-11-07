import type { DocumentModel, DocumentModelByFormat, Format, ViewerDocument } from './types'
import { isStructuredFormat, type StructuredFormat } from './structured/model'
import { hasStructuredModelEnvelope } from './structured/validate'
import { hasDiffModelEnvelope } from './diff/validate'
import { hasEnvModelEnvelope } from './env/validate'

export type StructuredViewerDocument = Extract<ViewerDocument, { format: StructuredFormat }>
export type DocumentModelPair = { [K in Format]: { format: K; document: Extract<ViewerDocument, { format: K }>; model: DocumentModelByFormat[K] } }[Format]

export function isStructuredViewerDocument(document: ViewerDocument): document is StructuredViewerDocument {
  return isStructuredFormat(document.format)
}

export function isDocumentModelForFormat<K extends Format>(format: K, model: DocumentModel): model is DocumentModelByFormat[K] {
  const value = toRecord(model)
  if (!value) return false
  switch (format) {
    case 'csv': return Array.isArray(value.headers) && Array.isArray(value.headerRow) && Array.isArray(value.rows) && Array.isArray(value.errors)
    case 'eml': return typeof value.subject === 'string' && Array.isArray(value.attachments) && Array.isArray(value.headers)
    case 'md': return typeof value.text === 'string'
    case 'ics': return Array.isArray(value.events) && Array.isArray(value.jcal)
    case 'vcf': return Array.isArray(value.cards) && Array.isArray(value.diagnostics)
    case 'json': case 'yaml': case 'toml': return hasStructuredModelEnvelope(value)
    case 'diff': return hasDiffModelEnvelope(value)
    case 'env': return hasEnvModelEnvelope(value)
  }
}

export function matchDocumentModel(document: ViewerDocument, model: DocumentModel): DocumentModelPair {
  switch (document.format) {
    case 'csv': if (isDocumentModelForFormat('csv', model)) return { format: 'csv', document, model }; break
    case 'eml': if (isDocumentModelForFormat('eml', model)) return { format: 'eml', document, model }; break
    case 'md': if (isDocumentModelForFormat('md', model)) return { format: 'md', document, model }; break
    case 'ics': if (isDocumentModelForFormat('ics', model)) return { format: 'ics', document, model }; break
    case 'vcf': if (isDocumentModelForFormat('vcf', model)) return { format: 'vcf', document, model }; break
    case 'json': if (isDocumentModelForFormat('json', model)) return { format: 'json', document, model }; break
    case 'yaml': if (isDocumentModelForFormat('yaml', model)) return { format: 'yaml', document, model }; break
    case 'toml': if (isDocumentModelForFormat('toml', model)) return { format: 'toml', document, model }; break
    case 'diff': if (isDocumentModelForFormat('diff', model)) return { format: 'diff', document, model }; break
    case 'env': if (isDocumentModelForFormat('env', model)) return { format: 'env', document, model }; break
  }
  throw new Error(isStructuredFormat(document.format) ? '구조 데이터 모델이 올바르지 않습니다.' : '보기 편집 모델과 문서 형식이 일치하지 않습니다.')
}

export function replaceDocumentModel<K extends Format>(
  document: Extract<ViewerDocument, { format: K }>,
  model: DocumentModelByFormat[K]
): Extract<ViewerDocument, { format: K }> {
  return { ...document, model }
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
}
