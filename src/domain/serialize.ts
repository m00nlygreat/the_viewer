import type { CalendarModel, ContactModel, CsvModel, DocumentModel, EmailModel, Format } from './types'

export async function serializeDocument(format: Format, model: DocumentModel): Promise<string> {
  switch (format) {
    case 'csv': return (await import('./formats/csv')).serializeCsv(model as CsvModel)
    case 'md': return (model as { text: string }).text
    case 'eml': return (await import('./formats/email')).serializeEmail(model as EmailModel)
    case 'ics': return (await import('./formats/calendar')).serializeCalendar(model as CalendarModel)
    case 'vcf': return (await import('./vcard')).serializeVCF(model as ContactModel)
  }
}
