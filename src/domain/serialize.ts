import type { ViewerDocument } from './types'

export async function serializeDocument(document: ViewerDocument): Promise<string> {
  switch (document.format) {
    case 'csv': return (await import('./formats/csv')).serializeCsv(document.model)
    case 'md': return document.model.text
    case 'eml': {
      const email = await import('./formats/email')
      return email.serializeEmailPreserving(document.model, document.text)
    }
    case 'ics': return (await import('./formats/calendar')).serializeCalendar(document.model)
    case 'vcf': return (await import('./vcard')).serializeVCF(document.model)
    case 'json': case 'yaml': case 'toml': return (await import('./structured/output')).serializeStructured(document.model, document.format)
    case 'diff': return document.text
    case 'env': {
      const { outputEnv } = await import('./env/output')
      const output = outputEnv(document.model, document.text)
      if (output.text === null) throw new Error(output.issues[0] ?? 'ENV 초안을 출력할 수 없습니다.')
      return output.text
    }
  }
}
