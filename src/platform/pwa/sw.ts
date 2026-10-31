/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { assertInputFileSize } from '../../domain/inputPolicy'

declare let self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision?: string | null }> }
const base = __APP_BASE__
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()
registerRoute(new NavigationRoute(createHandlerBoundToURL(`${base}index.html`), { denylist: [/\/share\//] }))

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
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
    const files = await Promise.all(entries.map(async (file) => ({ name: file.name.slice(0, 255), type: file.type.slice(0, 128), bytes: await file.arrayBuffer() })))
    const id = crypto.randomUUID()
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(`the-viewer:${base}`, 1)
      request.onerror = () => reject(request.error)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains('documents')) {
          const documents = db.createObjectStore('documents', { keyPath: 'id' })
          documents.createIndex('by-opened', 'openedAt')
        }
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' })
        if (!db.objectStoreNames.contains('shares')) db.createObjectStore('shares', { keyPath: 'id' })
      }
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('shares', 'readwrite')
        tx.objectStore('shares').put({ id, files, completed: files.map(() => false), createdAt: Date.now() })
        tx.oncomplete = () => { db.close(); resolve() }
        tx.onerror = () => { db.close(); reject(tx.error) }
      }
    })
    return Response.redirect(new URL(`${base}#/share/${id}`, self.location.origin), 303)
  })())
})
