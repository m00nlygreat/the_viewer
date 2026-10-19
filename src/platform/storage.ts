import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { ThemePreference, ViewerDocument } from '../domain/types'

interface ViewerDatabase extends DBSchema {
  documents: { key: string; value: ViewerDocument; indexes: { 'by-opened': number } }
  settings: { key: string; value: { key: string; value: unknown } }
  shares: { key: string; value: { id: string; files: Array<{ name: string; type: string; bytes: ArrayBuffer }>; createdAt: number } }
}

let database: Promise<IDBPDatabase<ViewerDatabase>> | null = null
function getDatabase(): Promise<IDBPDatabase<ViewerDatabase>> {
  if (!database) database = openDB<ViewerDatabase>(`the-viewer:${__APP_BASE__}`, 1, {
    upgrade(db) {
      const documents = db.createObjectStore('documents', { keyPath: 'id' })
      documents.createIndex('by-opened', 'openedAt')
      db.createObjectStore('settings', { keyPath: 'key' })
      db.createObjectStore('shares', { keyPath: 'id' })
    }
  })
  return database
}

export async function loadDocuments(): Promise<ViewerDocument[]> {
  const db = await getDatabase()
  return (await db.getAll('documents')).sort((a, b) => b.openedAt - a.openedAt)
}
export async function saveDocument(document: ViewerDocument): Promise<void> { await (await getDatabase()).put('documents', document) }
export async function removeDocument(id: string): Promise<void> { await (await getDatabase()).delete('documents', id) }
export async function clearDocuments(): Promise<void> {
  const db = await getDatabase()
  await db.clear('documents')
  await db.clear('shares')
}
export async function clearAllData(): Promise<void> {
  const db = await getDatabase()
  await db.clear('documents')
  await db.clear('settings')
  await db.clear('shares')
}
export async function readSetting<T>(key: string, fallback: T): Promise<T> {
  const record = await (await getDatabase()).get('settings', key)
  return (record?.value as T | undefined) ?? fallback
}
export async function writeSetting<T>(key: string, value: T): Promise<void> {
  await (await getDatabase()).put('settings', { key, value })
}
export async function saveShareTicket(id: string, files: Array<{ name: string; type: string; bytes: ArrayBuffer }>): Promise<void> {
  await (await getDatabase()).put('shares', { id, files, createdAt: Date.now() })
}
export async function takeShareTicket(id: string): Promise<Array<{ name: string; type: string; bytes: ArrayBuffer }> | null> {
  const db = await getDatabase()
  const ticket = await db.get('shares', id)
  if (!ticket || Date.now() - ticket.createdAt > 30 * 60 * 1000) { await db.delete('shares', id); return null }
  await db.delete('shares', id)
  return ticket.files
}
export async function loadTheme(): Promise<ThemePreference> { return readSetting('theme', 'system') }
