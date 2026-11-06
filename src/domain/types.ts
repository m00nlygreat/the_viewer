import type { Format } from './fileFormats'
import type { StructuredModel } from './structured/model'
import type { FolderDocumentRef } from './workspace'
export { FORMATS, FORMAT_MIME, FORMAT_MIME_ALIASES, GENERIC_FILE_MIME_TYPES, FORMAT_LABEL, getFormat } from './fileFormats'
export type { Format } from './fileFormats'
export type EditorMode = 'view' | 'source'
export type ThemePreference = 'system' | 'light' | 'dark'

export interface ParseDiagnostic {
  severity: 'error' | 'warning' | 'info'
  message: string
  from?: number
  to?: number
  line?: number
  column?: number
}

export interface CsvModel {
  headers: string[]
  headerRow: string[]
  rows: string[][]
  hasHeader: boolean
  delimiter: string
  newline: '\n' | '\r\n'
  bom: boolean
  encoding: string
  errors: string[]
}

export interface EmailAddress { name?: string; address: string }
export interface EmailAttachment {
  filename: string
  mimeType: string
  content: Uint8Array
  contentId?: string
  disposition?: string
}
export interface EmailModel {
  subject: string
  from: EmailAddress[]
  to: EmailAddress[]
  cc: EmailAddress[]
  date: string
  text: string
  html: string
  attachments: EmailAttachment[]
  headers: Array<{ key: string; value: string; originalKey?: string }>
}

export interface CalendarEvent {
  uid: string
  summary: string
  location: string
  description: string
  start: string
  end: string
  allDay: boolean
  timezone?: string
  recurrence?: string
  originalStart?: string
  originalEnd?: string
  originalAllDay?: boolean
  originalRecurrence?: string
  originalTimezone?: string
  componentIndex?: number
}
export interface CalendarModel { events: CalendarEvent[]; jcal: unknown[]; diagnostics: string[] }

export interface VCardProperty { name: string; params: string; value: string; raw: string; group?: string }
export interface ContactCard {
  recordId: string
  uid: string
  version: '3.0' | '4.0' | '2.1' | 'unknown'
  properties: VCardProperty[]
  fullName: string
  givenName: string
  familyName: string
  organization: string
  title: string
  phones: Array<{ value: string; label: string }>
  emails: Array<{ value: string; label: string }>
  urls: string[]
  notes: string
}
export interface ContactModel { cards: ContactCard[]; diagnostics: string[] }

export interface DocumentModelByFormat {
  csv: CsvModel
  eml: EmailModel
  md: { text: string }
  ics: CalendarModel
  vcf: ContactModel
  json: StructuredModel
  yaml: StructuredModel
  toml: StructuredModel
}
export type DocumentModel = DocumentModelByFormat[Format]

export interface ViewerDocument {
  id: string
  name: string
  format: Format
  /** The viewer's raw-text or unsupported-file path, instead of a supported document format. */
  contentKind?: 'plain-text' | 'unsupported'
  mimeType: string
  size: number
  /** Bytes as first opened. Older recovered sessions may not have this value. */
  initialBytes?: ArrayBuffer
  /** Deprecated alias accepted only while migrating pre-session records. */
  sourceBytes?: ArrayBuffer
  /** Exact byte baseline of the last successful save/export. */
  savedBytes: ArrayBuffer
  sourceText: string
  text: string
  model: DocumentModel
  mode: EditorMode
  revision: number
  modelRevision: number
  textRevision: number
  parseState: 'pending' | 'ready' | 'error'
  diagnostics: ParseDiagnostic[]
  encoding: string
  bom: boolean
  savedText: string
  isDirty: boolean
  /** The block graph is a recoverable draft that cannot yet be written to source. */
  structuredDraft?: boolean
  sourceError?: string
  openedAt: number
  lastEditedAt: number
  parentId?: string
  /** Membership in the currently selected folder, independent of email attachment ownership. */
  folderRef?: FolderDocumentRef
  /** Handle for writing back to the selected, dropped, or OS-launched local file. */
  sourceFileHandle?: FileSystemFileHandle
  /** The extension can read file:// bytes but cannot provide a writable file handle. */
  fileSource?: 'file-url'
  relayTicketId?: string
  shareTicketId?: string
  shareFileIndex?: number
}

type PersistedDocumentFor<K extends Format> = Omit<ViewerDocument, 'format' | 'model'> & {
  schemaVersion: 3
  format: K
  model: DocumentModelByFormat[K]
}
export type PersistedViewerDocument = { [K in Format]: PersistedDocumentFor<K> }[Format]
