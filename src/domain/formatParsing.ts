import { getFormat, type Format } from './types'
import type { DocumentModel, EmailModel } from './types'
export { hasFatalDiagnostics } from './parseDiagnostics'

export interface ParsedFile { format: Format; model: DocumentModel; text: string; diagnostics: string[]; encoding: string }

export function decodeBytes(bytes: Uint8Array): { text: string; encoding: string; bom: boolean } {
  let encoding = 'UTF-8'
  let offset = 0
  let bom = false
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) { offset = 3; bom = true }
  else if (bytes[0] === 0xff && bytes[1] === 0xfe) { encoding = 'UTF-16LE'; offset = 2; bom = true }
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) { encoding = 'UTF-16BE'; offset = 2; bom = true }
  const payload = bytes.subarray(offset)
  if (bom) return { text: new TextDecoder(encoding).decode(payload), encoding, bom }
  try { return { text: new TextDecoder('UTF-8', { fatal: true }).decode(payload), encoding: 'UTF-8', bom: false } }
  catch { /* Try a common Korean legacy encoding before using replacement characters. */ }
  try { return { text: new TextDecoder('euc-kr', { fatal: false }).decode(bytes), encoding: 'EUC-KR', bom: false } }
  catch { return { text: new TextDecoder().decode(bytes), encoding: 'UTF-8', bom: false } }
}

function normalizeNewline(text: string): '\n' | '\r\n' { return text.includes('\r\n') ? '\r\n' : '\n' }

export async function parseFileContent(name: string, mimeType: string, bytes: Uint8Array, explicitFormat?: Format, options?: { csvHasHeader?: boolean }): Promise<ParsedFile> {
  const format = explicitFormat ?? getFormat(name, mimeType)
  if (!format) throw new Error('지원하지 않는 파일입니다. .eml, .csv, .md, .ics, .vcf 파일을 선택하세요.')
  if (format === 'eml') {
    const [{ parseEmail }, decoded] = await Promise.all([
      import('./formats/email'),
      Promise.resolve(decodeBytes(bytes))
    ])
    try {
      return { format, model: await parseEmail(bytes), text: decoded.text, encoding: decoded.encoding, diagnostics: [] }
    } catch (error) {
      const model: EmailModel = { subject: '', from: [], to: [], cc: [], date: '', text: '', html: '', attachments: [], headers: [] }
      return { format, model, text: decoded.text, encoding: decoded.encoding, diagnostics: [`이메일 MIME을 해석하지 못했습니다: ${error instanceof Error ? error.message : '잘못된 구조'}`] }
    }
  }
  const decoded = decodeBytes(bytes)
  const text = decoded.text
  if (format === 'csv') {
    const { parseCsv } = await import('./formats/csv')
    const model = parseCsv(text, decoded.encoding, decoded.bom, normalizeNewline(text), options?.csvHasHeader)
    return { format, model, text, encoding: decoded.encoding, diagnostics: model.errors }
  }
  if (format === 'md') return { format, model: { text }, text, encoding: decoded.encoding, diagnostics: [] }
  if (format === 'ics') {
    const { parseCalendar } = await import('./formats/calendar')
    const model = parseCalendar(text)
    return { format, model, text, encoding: decoded.encoding, diagnostics: model.diagnostics }
  }
  const { parseVCF } = await import('./vcard')
  const model = parseVCF(text)
  return { format, model, text, encoding: decoded.encoding, diagnostics: model.diagnostics }
}
