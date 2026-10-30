import { openDB, type DBSchema, type IDBPDatabase, type IDBPObjectStore } from 'idb'
import { PROTOCOL_VERSION, WORKSPACE_SNAPSHOT_LIMIT, type RelayKind } from '../relay/protocol'

const DATABASE_NAME = 'the-viewer-extension-relay'
const MAX_RELAY_STORAGE_BYTES = 300 * 1024 * 1024
const TICKET_LIFETIME_MS = 10 * 60 * 1000
const TOTAL_BYTES_KEY = 'totalBytes'

export interface RelayTicket {
  id: string
  version: number
  kind: RelayKind
  tabId: number
  createdAt: number
  expiresAt: number
  name: string
  mimeType: string
  byteLength: number
  bytes: ArrayBuffer
}

export interface CompletedRelayTicket {
  id: string
  kind: RelayKind
  tabId: number
  name: string
  expiresAt: number
}

interface RelayDatabase extends DBSchema {
  tickets: { key: string; value: RelayTicket; indexes: { 'by-created': number; 'by-expires': number } }
  completed: { key: string; value: CompletedRelayTicket; indexes: { 'by-expires': number } }
  meta: { key: string; value: number }
}

type WritableTickets<Stores extends ('tickets' | 'meta' | 'completed')[]> = IDBPObjectStore<RelayDatabase, Stores, 'tickets', 'readwrite'>

let database: Promise<IDBPDatabase<RelayDatabase>> | null = null
let createQueue: Promise<void> = Promise.resolve()

function getDatabase(): Promise<IDBPDatabase<RelayDatabase>> {
  if (!database) database = openDB<RelayDatabase>(DATABASE_NAME, 2, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('tickets')) {
        const tickets = db.createObjectStore('tickets', { keyPath: 'id' })
        tickets.createIndex('by-created', 'createdAt')
        tickets.createIndex('by-expires', 'expiresAt')
      }
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta')
      if (!db.objectStoreNames.contains('completed')) {
        const completed = db.createObjectStore('completed', { keyPath: 'id' })
        completed.createIndex('by-expires', 'expiresAt')
      }
    }
  })
  return database
}

export class RelayStoreError extends Error {
  constructor(readonly code: 'INVALID_TICKET' | 'EXPIRED' | 'ACCESS_DENIED' | 'SIZE_LIMIT', message: string) {
    super(message)
    this.name = 'RelayStoreError'
  }
}

export async function createTicket(input: {
  id?: string
  kind: RelayKind
  tabId: number
  name: string
  mimeType: string
  bytes: Uint8Array | ArrayBuffer
}): Promise<RelayTicket> {
  const task = createQueue.then(() => createTicketNow(input))
  createQueue = task.then(() => undefined, () => undefined)
  return task
}

async function createTicketNow(input: {
  id?: string
  kind: RelayKind
  tabId: number
  name: string
  mimeType: string
  bytes: Uint8Array | ArrayBuffer
}): Promise<RelayTicket> {
  const source = input.bytes instanceof Uint8Array ? input.bytes : new Uint8Array(input.bytes)
  if (source.byteLength > WORKSPACE_SNAPSHOT_LIMIT || source.byteLength > MAX_RELAY_STORAGE_BYTES) {
    throw new RelayStoreError('SIZE_LIMIT', '전달 데이터가 임시 저장 용량 제한을 초과했습니다.')
  }
  const now = Date.now()
  const id = input.id ?? crypto.randomUUID()
  const bytes = source.slice().buffer as ArrayBuffer
  const ticket: RelayTicket = {
    id, version: PROTOCOL_VERSION, kind: input.kind, tabId: input.tabId,
    createdAt: now, expiresAt: now + TICKET_LIFETIME_MS,
    name: input.name.slice(0, 255), mimeType: input.mimeType.slice(0, 128), byteLength: bytes.byteLength, bytes
  }
  const db = await getDatabase()
  const tx = db.transaction(['tickets', 'meta'], 'readwrite')
  const tickets = tx.objectStore('tickets')
  const meta = tx.objectStore('meta')
  let total = await meta.get(TOTAL_BYTES_KEY)
  if (typeof total !== 'number') total = await calculateStoredBytes(tickets)

  let expiryCursor = await tickets.index('by-expires').openCursor(IDBKeyRange.upperBound(now))
  while (expiryCursor) {
    total -= expiryCursor.value.byteLength
    await expiryCursor.delete()
    expiryCursor = await expiryCursor.continue()
  }

  if (total + ticket.byteLength > MAX_RELAY_STORAGE_BYTES) {
    let oldestCursor = await tickets.index('by-created').openCursor()
    while (oldestCursor && total + ticket.byteLength > MAX_RELAY_STORAGE_BYTES) {
      total -= oldestCursor.value.byteLength
      await oldestCursor.delete()
      oldestCursor = await oldestCursor.continue()
    }
  }
  if (total + ticket.byteLength > MAX_RELAY_STORAGE_BYTES) {
    tx.abort()
    await tx.done.catch(() => undefined)
    throw new RelayStoreError('SIZE_LIMIT', '전달 임시 저장 공간이 가득 찼습니다. 오래된 작업을 정리한 뒤 다시 시도하세요.')
  }
  await tickets.add(ticket)
  await meta.put(total + ticket.byteLength, TOTAL_BYTES_KEY)
  await tx.done
  return ticket
}

async function calculateStoredBytes<Stores extends ('tickets' | 'meta' | 'completed')[]>(store: WritableTickets<Stores>): Promise<number> {
  let total = 0
  let cursor = await store.openCursor()
  while (cursor) {
    total += cursor.value.byteLength
    cursor = await cursor.continue()
  }
  return total
}

export async function readTicket(id: string, expectedTabId?: number): Promise<RelayTicket> {
  const db = await getDatabase()
  const ticket = await db.get('tickets', id)
  if (!ticket) throw new RelayStoreError('INVALID_TICKET', '전달 티켓을 찾을 수 없습니다.')
  if (ticket.expiresAt <= Date.now()) {
    await deleteTicket(id, ticket.byteLength)
    throw new RelayStoreError('EXPIRED', '전달 티켓의 유효 시간이 지났습니다.')
  }
  if (expectedTabId !== undefined && ticket.tabId !== expectedTabId) {
    throw new RelayStoreError('ACCESS_DENIED', '전달 티켓이 현재 탭에 속하지 않습니다.')
  }
  return ticket
}

export async function readCompletedTicket(id: string): Promise<CompletedRelayTicket | null> {
  const db = await getDatabase()
  const completed = await db.get('completed', id)
  if (!completed) return null
  if (completed.expiresAt <= Date.now()) {
    await db.delete('completed', id)
    return null
  }
  return completed
}

export async function commitTicket(id: string): Promise<CompletedRelayTicket> {
  const db = await getDatabase()
  const tx = db.transaction(['tickets', 'meta', 'completed'], 'readwrite')
  const completedStore = tx.objectStore('completed')
  const previous = await completedStore.get(id)
  if (previous && previous.expiresAt > Date.now()) {
    await tx.done
    return previous
  }

  const tickets = tx.objectStore('tickets')
  const ticket = await tickets.get(id)
  if (!ticket) {
    await tx.done
    throw new RelayStoreError('INVALID_TICKET', '전달 티켓을 찾을 수 없습니다.')
  }
  await tickets.delete(id)
  const meta = tx.objectStore('meta')
  const total = await meta.get(TOTAL_BYTES_KEY)
  if (typeof total === 'number') await meta.put(Math.max(0, total - ticket.byteLength), TOTAL_BYTES_KEY)
  const completed: CompletedRelayTicket = {
    id: ticket.id, kind: ticket.kind, tabId: ticket.tabId, name: ticket.name,
    expiresAt: Date.now() + TICKET_LIFETIME_MS
  }
  await completedStore.put(completed)
  await tx.done
  return completed
}

export async function assertTicketAvailable(id: string, senderTabId: number | undefined, ticketTabId: number, expiresAt: number, byteLength: number): Promise<void> {
  if (expiresAt <= Date.now()) {
    await deleteTicket(id, byteLength)
    throw new RelayStoreError('EXPIRED', '전달 티켓의 유효 시간이 지났습니다.')
  }
  const db = await getDatabase()
  const key = await db.getKey('tickets', id)
  if (key === undefined) throw new RelayStoreError('INVALID_TICKET', '전달 티켓을 찾을 수 없습니다.')
  if (!Number.isInteger(senderTabId) || senderTabId !== ticketTabId) throw new RelayStoreError('ACCESS_DENIED', '전달 티켓이 현재 탭에 속하지 않습니다.')
}

export async function deleteTicket(id: string, knownByteLength?: number): Promise<void> {
  const db = await getDatabase()
  const tx = db.transaction(['tickets', 'meta'], 'readwrite')
  const store = tx.objectStore('tickets')
  const key = await store.getKey(id)
  if (key !== undefined) {
    let byteLength = knownByteLength
    if (typeof byteLength !== 'number') byteLength = (await store.get(id))?.byteLength
    await store.delete(id)
    const meta = tx.objectStore('meta')
    const total = await meta.get(TOTAL_BYTES_KEY)
    if (typeof total === 'number' && typeof byteLength === 'number') await meta.put(Math.max(0, total - byteLength), TOTAL_BYTES_KEY)
  }
  await tx.done
}

export async function purgeExpiredTickets(): Promise<number> {
  const db = await getDatabase()
  const tx = db.transaction(['tickets', 'meta', 'completed'], 'readwrite')
  const store = tx.objectStore('tickets')
  const meta = tx.objectStore('meta')
  let total = await meta.get(TOTAL_BYTES_KEY)
  if (typeof total !== 'number') total = await calculateStoredBytes(store)
  let deleted = 0
  let cursor = await store.index('by-expires').openCursor(IDBKeyRange.upperBound(Date.now()))
  while (cursor) {
    total -= cursor.value.byteLength
    deleted += 1
    await cursor.delete()
    cursor = await cursor.continue()
  }
  const completed = tx.objectStore('completed')
  let completedCursor = await completed.index('by-expires').openCursor(IDBKeyRange.upperBound(Date.now()))
  while (completedCursor) {
    deleted += 1
    await completedCursor.delete()
    completedCursor = await completedCursor.continue()
  }
  await meta.put(Math.max(0, total), TOTAL_BYTES_KEY)
  await tx.done
  return deleted
}
