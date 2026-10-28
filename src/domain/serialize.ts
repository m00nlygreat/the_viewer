import type { CalendarModel, ContactModel, CsvModel, DocumentModel, EmailModel, Format } from './types'

export async function serializeDocument(format: Format, model: DocumentModel, sourceText?: string): Promise<string> {
  switch (format) {
    case 'csv': return (await import('./formats/csv')).serializeCsv(model as CsvModel)
    case 'md': return (model as { text: string }).text
    case 'eml': {
      const email = await import('./formats/email')
      return sourceText === undefined ? email.serializeEmail(model as EmailModel) : email.serializeEmailPreserving(model as EmailModel, sourceText)
    }
    case 'ics': return (await import('./formats/calendar')).serializeCalendar(model as CalendarModel)
    case 'vcf': return (await import('./vcard')).serializeVCF(model as ContactModel)
  }
}
