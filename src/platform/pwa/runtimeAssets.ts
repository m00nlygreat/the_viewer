export type RuntimeAssetGroup = 'fonts' | 'monaco'

export interface RuntimeAssetProgress {
  group: RuntimeAssetGroup
  status: 'loading' | 'error'
  loadedBytes: number
  totalBytes: number
  loadedFiles: number
  totalFiles: number
  error?: string
}

interface RuntimeAsset { url: string; size: number }
interface RuntimeAssetManifest { fonts: RuntimeAsset[]; monaco: RuntimeAsset[] }

const appBase = typeof __APP_BASE__ === 'string' ? __APP_BASE__ : '/'
const appVersion = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'
export const RUNTIME_ASSET_CACHE_NAME = `viewer-runtime-assets:${appBase}:${appVersion}`

let progress: RuntimeAssetProgress | null = null
const listeners = new Set<() => void>()
const pending = new Map<RuntimeAssetGroup, Promise<void>>()
const completed = new Set<RuntimeAssetGroup>()
const skipped = new Set<RuntimeAssetGroup>()
let loadQueue: Promise<void> = Promise.resolve()

export function subscribeRuntimeAssetProgress(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getRuntimeAssetProgress(): RuntimeAssetProgress | null { return progress }

export function ensureRuntimeAssetGroup(group: RuntimeAssetGroup): Promise<void> {
  if (import.meta.env.DEV || completed.has(group) || skipped.has(group)) return Promise.resolve()
  const existing = pending.get(group)
  if (existing) return existing
  const task = loadQueue.then(() => loadRuntimeAssetGroup(group))
  loadQueue = task.then(() => undefined, () => undefined)
  pending.set(group, task)
  const clearPending = () => { if (pending.get(group) === task) pending.delete(group) }
  void task.then(clearPending, clearPending)
  return task
}

export async function retryRuntimeAssetGroup(group: RuntimeAssetGroup): Promise<void> {
  skipped.delete(group)
  if (progress?.group === group && progress.status === 'error') publish(null)
  return ensureRuntimeAssetGroup(group)
}

export function continueWithoutRuntimeAssetGroup(group: RuntimeAssetGroup): void {
  if (progress?.group !== group || progress.status !== 'error') return
  skipped.add(group)
  publish(null)
}

async function loadRuntimeAssetGroup(group: RuntimeAssetGroup): Promise<void> {
  const failureContext: { stage: 'manifest' | 'asset' | 'cache'; assetUrl: string | null } = { stage: 'manifest', assetUrl: null }
  try {
    await waitForServiceWorkerController()
    const manifestUrl = new URL(`${appBase}runtime-assets.json`, window.location.href)
    const cache = await caches.open(RUNTIME_ASSET_CACHE_NAME)
    const cachedManifest = await cache.match(manifestUrl) ?? await caches.match(manifestUrl, { ignoreSearch: true })
    const response = cachedManifest ?? await fetch(manifestUrl, { cache: 'no-cache' })
    if (!response.ok) throw new Error('필요한 파일 목록을 읽지 못했습니다.')
    if (!cachedManifest) await cache.put(manifestUrl, response.clone())
    const manifest = parseRuntimeAssetManifest(await response.json())
    const assets = manifest[group]
    const cached = await Promise.all(assets.map((asset) => cache.match(new URL(asset.url, window.location.href), { ignoreVary: true })))
    let loadedBytes = 0
    let loadedFiles = 0
    const missing: RuntimeAsset[] = []
    assets.forEach((asset, index) => {
      if (cached[index]) { loadedBytes += asset.size; loadedFiles += 1 }
      else missing.push(asset)
    })
    if (!missing.length) {
      completed.add(group)
      publish(null)
      return
    }
    const totalBytes = assets.reduce((total, asset) => total + asset.size, 0)
    const dialogStartedAt = performance.now()
    publish({ group, status: 'loading', loadedBytes, totalBytes, loadedFiles, totalFiles: assets.length })
    let completedBytes = loadedBytes
    const inFlightBytes = new Map<string, number>()
    const controller = new AbortController()
    let failed = false
    let nextIndex = 0
    const loadNext = async (): Promise<void> => {
      while (nextIndex < missing.length && !failed) {
        const asset = missing[nextIndex++]!
        failureContext.assetUrl = asset.url
        failureContext.stage = 'asset'
        const assetUrl = new URL(asset.url, window.location.href)
        let assetBytes = 0
        inFlightBytes.set(asset.url, 0)
        try {
          const response = await fetch(assetUrl, { cache: 'reload', signal: controller.signal })
          if (!response.ok) throw new Error(`필요한 파일을 불러오지 못했습니다: ${assetUrl.pathname.split('/').at(-1)}`)
          const cachedResponse = response.clone()
          failureContext.stage = 'cache'
          const cacheWrite = cache.put(assetUrl, cachedResponse)
          failureContext.stage = 'asset'
          if (response.body) {
            const reader = response.body.getReader()
            while (true) {
              const result = await reader.read()
              if (result.done) break
              assetBytes += result.value.byteLength
              inFlightBytes.set(asset.url, Math.min(assetBytes, asset.size))
              if (!failed) publish({ group, status: 'loading', loadedBytes: completedBytes + [...inFlightBytes.values()].reduce((total, bytes) => total + bytes, 0), totalBytes, loadedFiles, totalFiles: assets.length })
            }
          } else {
            assetBytes = (await response.arrayBuffer()).byteLength
          }
          failureContext.stage = 'cache'
          await cacheWrite
          await waitForAssetCache(cache, assetUrl)
          inFlightBytes.delete(asset.url)
          completedBytes += asset.size
          loadedBytes = completedBytes
          loadedFiles += 1
          failureContext.assetUrl = null
          failureContext.stage = 'asset'
          if (!failed) publish({ group, status: 'loading', loadedBytes, totalBytes, loadedFiles, totalFiles: assets.length })
        } catch (error) {
          failed = true
          controller.abort()
          throw error
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, missing.length) }, () => loadNext()))
    await keepDialogVisible(dialogStartedAt)
    completed.add(group)
    publish(null)
  } catch (error) {
    const message = error instanceof Error ? error.message : '필요한 파일을 불러오지 못했습니다.'
    const activeAssetName = failureContext.assetUrl?.split('/').at(-1)
    const detail = failureContext.stage === 'manifest'
      ? `필요한 파일 목록을 읽지 못했습니다: ${message}`
      : failureContext.stage === 'cache'
        ? `파일을 오프라인 저장소에 저장하지 못했습니다: ${activeAssetName ?? message}`
        : `${activeAssetName ?? '필요한 파일'}을 불러오지 못했습니다: ${message}`
    publish({ group, status: 'error', loadedBytes: progress?.group === group ? progress.loadedBytes : 0,
      totalBytes: progress?.group === group ? progress.totalBytes : 0, loadedFiles: progress?.group === group ? progress.loadedFiles : 0,
      totalFiles: progress?.group === group ? progress.totalFiles : 0,
      error: detail })
    throw error
  }
}

async function keepDialogVisible(startedAt: number): Promise<void> {
  const remaining = 1_200 - (performance.now() - startedAt)
  if (remaining > 0) await new Promise<void>((resolve) => window.setTimeout(resolve, remaining))
}

async function waitForAssetCache(cache: Cache, request: RequestInfo | URL): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await cache.match(request, { ignoreVary: true })) return
    await new Promise<void>((resolve) => window.setTimeout(resolve, 25))
  }
  throw new Error('필요한 파일을 오프라인 저장소에 기록하지 못했습니다.')
}

async function waitForServiceWorkerController(): Promise<void> {
  if (!('serviceWorker' in navigator) || !('caches' in window)) throw new Error('오프라인 저장을 지원하지 않는 브라우저입니다.')
  await navigator.serviceWorker.ready
  if (navigator.serviceWorker.controller) return
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
      reject(new Error('오프라인 저장 기능을 시작하지 못했습니다.'))
    }, 10_000)
    const onControllerChange = () => {
      window.clearTimeout(timeout)
      resolve()
    }
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange, { once: true })
  })
}

function parseRuntimeAssetManifest(value: unknown): RuntimeAssetManifest {
  if (!isRecord(value) || !isRuntimeAssetArray(value.fonts) || !isRuntimeAssetArray(value.monaco)) {
    throw new Error('필요한 파일 목록 형식이 올바르지 않습니다.')
  }
  return { fonts: value.fonts, monaco: value.monaco }
}

function isRuntimeAssetArray(value: unknown): value is RuntimeAsset[] {
  return Array.isArray(value) && value.every((asset) => isRecord(asset) && typeof asset.url === 'string' &&
    asset.url.length > 0 && Number.isSafeInteger(asset.size) && Number(asset.size) >= 0)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function publish(value: RuntimeAssetProgress | null): void {
  if (progress === value) return
  progress = value
  for (const listener of listeners) listener()
}
