import type { Format } from '../platform/fileTypes'
export { FORMATS, FORMAT_MIME, FORMAT_MIME_ALIASES, GENERIC_FILE_MIME_TYPES, FORMAT_LABEL, getFormat } from '../platform/fileTypes'
export type { Format } from '../platform/fileTypes'
export type EditorMode = 'view' | 'edit' | 'source'
export type ThemePreference = 'system' | 'light' | 'dark'

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
  content: number[]
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

export type DocumentModel = CsvModel | EmailModel | CalendarModel | ContactModel | { text: string }

export interface ViewerDocument {
  id: string
  name: string
  format: Format
  mimeType: string
  size: number
  sourceBytes: ArrayBuffer
  sourceText: string
  text: string
  model: DocumentModel
  mode: EditorMode
  revision: number
  savedText: string
  isDirty: boolean
  sourceError?: string
  openedAt: number
  lastEditedAt: number
  parentId?: string
  relayTicketId?: string
}
