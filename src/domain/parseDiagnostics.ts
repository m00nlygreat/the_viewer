import type { DocumentModel, Format } from './types'

export function hasFatalDiagnostics(format: Format, model: DocumentModel, messages: readonly string[]): boolean {
  if (!messages.length) return false
  if (format === 'eml') return true
  if (format === 'ics') return (model as { jcal: unknown[] }).jcal.length === 0
  if (format === 'vcf') return (model as { cards: unknown[] }).cards.length === 0
  if (format === 'csv') return (model as { errors: string[] }).errors.some((message) => /MissingQuotes|InvalidQuotes/i.test(message))
  return false
}
