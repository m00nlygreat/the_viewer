export const FORMATS = ['eml', 'csv', 'md', 'ics', 'vcf', 'json', 'yaml', 'toml'] as const
export type Format = typeof FORMATS[number]

export const FORMAT_MIME: Record<Format, string> = {
  eml: 'message/rfc822', csv: 'text/csv', md: 'text/markdown', ics: 'text/calendar', vcf: 'text/vcard',
  json: 'application/json', yaml: 'application/yaml', toml: 'application/toml'
}

export const FORMAT_MIME_ALIASES: Record<Format, readonly string[]> = {
  eml: ['message/rfc822'],
  csv: ['text/csv', 'application/csv', 'application/vnd.ms-excel', 'text/x-csv', 'application/x-csv', 'text/comma-separated-values'],
  md: ['text/markdown', 'text/x-markdown'],
  ics: ['text/calendar', 'application/ics', 'application/x-ics', 'text/x-vcalendar'],
  vcf: ['text/vcard', 'text/x-vcard'],
  json: ['application/json', 'text/json'], yaml: ['application/yaml', 'application/x-yaml', 'text/yaml', 'text/x-yaml'], toml: ['application/toml', 'text/toml']
}

export const GENERIC_FILE_MIME_TYPES = ['application/octet-stream', 'application/download', 'application/x-download', 'binary/octet-stream', 'text/plain']

export const FORMAT_LABEL: Record<Format, string> = {
  eml: '이메일', csv: '표', md: '문서', ics: '일정', vcf: '연락처', json: 'JSON', yaml: 'YAML', toml: 'TOML'
}

export const FORMAT_EXTENSIONS: Record<Format, readonly string[]> = {
  eml: ['eml'], csv: ['csv'], md: ['md'], ics: ['ics'], vcf: ['vcf'],
  json: ['json'], yaml: ['yaml', 'yml'], toml: ['toml']
}

export function getFormat(name: string, mimeType = ''): Format | null {
  const mime = mimeType.toLowerCase().split(';')[0].trim()
  const mimeFormat = FORMATS.find((format) => FORMAT_MIME_ALIASES[format].includes(mime))
  if (mimeFormat) return mimeFormat
  const ext = name.toLowerCase().split('.').pop()
  if (ext === 'yml') return 'yaml'
  if (FORMATS.includes(ext as Format)) return ext as Format
  return null
}
