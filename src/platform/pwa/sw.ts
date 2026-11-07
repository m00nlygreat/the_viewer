/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { assertInputFileSize } from '../../domain/inputPolicy'

declare let self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision?: string | null }> }
const base = __APP_BASE__
const runtimeAssetCacheName = `viewer-runtime-assets:${base}:${__APP_VERSION__}`
const runtimeAssetCachePrefix = `viewer-runtime-assets:${base}:`
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()
registerRoute(new NavigationRoute(createHandlerBoundToURL(`${base}index.html`), { denylist: [/\/share\//] }))
registerRoute(
  ({ request, url }) => url.origin === self.location.origin &&
    url.pathname.startsWith(new URL(base, self.location.origin).pathname) &&
    (request.destination === 'font' || /\.(?:woff2?|ttf)$/iu.test(url.pathname) || /(?:monaco|monacosourceeditor|codeblockeditor|editor\.worker).*\.(?:js|css)$/iu.test(url.pathname)),
  async ({ request }) => {
    const cache = await caches.open(runtimeAssetCacheName)
    // Static runtime assets can vary by request headers. Once downloaded, the
    // bytes are identical, so don't let Vary prevent the offline cache hit.
    const cached = await cache.match(request, { ignoreVary: true })
    if (cached) return cached
    return fetch(request)
  }
)

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([
    self.clients.claim(),
    caches.keys().then((keys) => Promise.all(keys
      .filter((key) => key.startsWith(runtimeAssetCachePrefix) && key !== runtimeAssetCacheName)
      .map((key) => caches.delete(key))))
  ]))
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  const sharePath = new URL(`${base}share/`, self.location.origin).pathname
  if (event.request.method !== 'POST' || url.pathname !== sharePath) return
  event.respondWith((async () => {
    const form = await event.request.formData()
    const entries = form.getAll('files').filter((entry): entry is File => entry instanceof File).slice(0, 20)
    if (!entries.length) return Response.redirect(new URL(`${base}#/`, self.location.origin), 303)
    try { for (const file of entries) assertInputFileSize(file.name, file.size, self.navigator.userAgent) }
    catch (error) { return new Response(error instanceof Error ? error.message : '파일 크기 제한을 초과했습니다.', { status: 413 }) }
    const id = crypto.randomUUID()
    try { await storeShareTicket(id, entries) }
    catch (error) { return new Response(error instanceof Error ? error.message : '공유한 파일을 임시 저장하지 못했습니다.', { status: 500 }) }
    return Response.redirect(new URL(`${base}#/share/${id}`, self.location.origin), 303)
  })())
})

async function storeShareTicket(id: string, files: File[]): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(`the-viewer:${base}`)
    request.onerror = () => reject(request.error)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains('documents')) {
        const documents = database.createObjectStore('documents', { keyPath: 'id' })
        documents.createIndex('by-opened', 'openedAt')
      }
      if (!database.objectStoreNames.contains('settings')) database.createObjectStore('settings', { keyPath: 'key' })
      if (!database.objectStoreNames.contains('shares')) database.createObjectStore('shares', { keyPath: 'id' })
    }
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close()
      resolve(request.result)
    }
  })
  const fileInfo = files.map((file) => ({ name: file.name.slice(0, 255), type: file.type.slice(0, 128) }))
  const storeRecord = (records: Array<Record<string, unknown>>) => new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('shares', 'readwrite')
    const store = transaction.objectStore('shares')
    for (const record of records) store.put(record)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error ?? new Error('공유 파일 저장이 중단되었습니다.'))
  })
  const removePartial = () => new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('shares', 'readwrite')
    const store = transaction.objectStore('shares')
    store.delete(id)
    for (let index = 0; index < files.length; index += 1) store.delete(`${id}:file:${index}`)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error ?? new Error('공유 파일 정리가 중단되었습니다.'))
  })
  try {
    await storeRecord([{ id, kind: 'ticket', files: fileInfo, completed: files.map(() => false), createdAt: Date.now() }])
    for (const [index, file] of files.entries()) {
      const bytes = await file.arrayBuffer()
      await storeRecord([{ id: `${id}:file:${index}`, kind: 'payload', ticketId: id, index, bytes }])
    }
  } catch (error) {
    try { await removePartial() } catch { /* A partial ticket is left to its expiry cleanup. */ }
    throw error
  } finally { db.close() }
}
