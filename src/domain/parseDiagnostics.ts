import type { CalendarModel, ContactModel, CsvModel, DocumentModel, Format } from './types'
import { hasEnvModelEnvelope } from './env/validate'

export function hasFatalDiagnostics(format: Format, model: DocumentModel, messages: readonly string[]): boolean {
  if (!messages.length) return false
  if (format === 'json' || format === 'yaml' || format === 'toml') return true
  if (format === 'eml') return true
  if (format === 'ics') return isCalendarModel(model) && model.jcal.length === 0
  if (format === 'vcf') return isContactModel(model) && model.cards.length === 0
  if (format === 'csv') return isCsvModel(model) && model.errors.some((message) => /MissingQuotes|InvalidQuotes/i.test(message))
  if (format === 'env') return isEnvModel(model) && model.syntax === null
  return false
}

function isEnvModel(model: DocumentModel) { return hasEnvModelEnvelope(model) }

function isCalendarModel(model: DocumentModel): model is CalendarModel {
  return typeof model === 'object' && model !== null && 'jcal' in model && Array.isArray(model.jcal)
}

function isContactModel(model: DocumentModel): model is ContactModel {
  return typeof model === 'object' && model !== null && 'cards' in model && Array.isArray(model.cards)
}

function isCsvModel(model: DocumentModel): model is CsvModel {
  return typeof model === 'object' && model !== null && 'errors' in model && Array.isArray(model.errors) && model.errors.every((message) => typeof message === 'string')
}
