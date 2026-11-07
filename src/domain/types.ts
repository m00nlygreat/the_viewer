import type { Format } from './fileFormats'
import type { StructuredModel } from './structured/model'
import type { DiffModel } from './diff/model'
import type { EnvModel } from './env/model'
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
  diff: DiffModel
  env: EnvModel
}
export type DocumentModel = DocumentModelByFormat[Format]

interface ViewerDocumentFields {
  id: string
  name: string
  /** The viewer's raw-text or unsupported-file path, instead of a supported document format. */
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

type SupportedViewerDocument = { [K in Format]: ViewerDocumentFields & {
  format: K
  model: DocumentModelByFormat[K]
  contentKind?: never
} }[Format]

type PlainTextViewerDocument = ViewerDocumentFields & {
  format: 'md'
  contentKind: 'plain-text'
  model: { text: string }
}

type UnsupportedViewerDocument = ViewerDocumentFields & {
  format: 'md'
  contentKind: 'unsupported'
  model: { text: string }
}

export type ViewerDocument = (SupportedViewerDocument | PlainTextViewerDocument | UnsupportedViewerDocument) & {
  /** False while a document list entry has not loaded its recoverable payload. */
  payloadLoaded?: boolean
}

type PersistedDocumentFor<K extends Format> = ViewerDocumentFields & {
  schemaVersion: 3
  format: K
  model: DocumentModelByFormat[K]
  contentKind?: never
}
type PersistedSpecialDocument = ViewerDocumentFields & {
  schemaVersion: 3
  format: 'md'
  contentKind: 'plain-text' | 'unsupported'
  model: { text: string }
}
export type PersistedViewerDocument = { [K in Format]: PersistedDocumentFor<K> }[Format] | PersistedSpecialDocument

type PersistedPayloadKey = 'model' | 'text' | 'sourceText' | 'savedText' | 'savedBytes' | 'initialBytes'
type PersistedSummaryFor<K extends Format> = Omit<PersistedDocumentFor<K>, PersistedPayloadKey> & { payloadRef: true }
type PersistedSpecialSummary = Omit<PersistedSpecialDocument, PersistedPayloadKey> & { payloadRef: true }
export type PersistedViewerDocumentSummary = { [K in Format]: PersistedSummaryFor<K> }[Format] | PersistedSpecialSummary

type PersistedEmailAttachment = Omit<EmailAttachment, 'content'>
type PersistedEmailModel = Omit<EmailModel, 'attachments'> & { attachments: PersistedEmailAttachment[] }
type PersistedDocumentModelByFormat = { [K in Format]: K extends 'eml' ? PersistedEmailModel : DocumentModelByFormat[K] }

export type PersistedViewerDocumentPayload = { [K in Format]: {
  id: string
  format: K
  model: PersistedDocumentModelByFormat[K]
  text: string
  sourceText: string
  savedText: string
} }[Format]

export interface PersistedViewerDocumentBlobs {
  id: string
  savedBytes: ArrayBuffer
  initialBytes?: ArrayBuffer
  emailAttachmentContents?: ArrayBuffer[]
}
