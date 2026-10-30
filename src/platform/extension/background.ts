import { ensureAutoOpenRules } from './autoOpen'
import { assertTicketAvailable, commitTicket, purgeExpiredTickets, readCompletedTicket, readTicket, RelayStoreError, type CompletedRelayTicket, type RelayTicket } from './relayStore'
import { bytesToBase64, isRelayMessage, isSupportedProtocolVersion, isTicketId, isTrustedPwaSender, PORT_NAME, PROTOCOL_VERSION, CHUNK_BYTES, type RelayErrorCode } from '../relay/protocol'

const MENU_ID = 'open-with-the-viewer'
const CLEANUP_ALARM = 'the-viewer-relay-expiry-cleanup'
const LEGACY_MIGRATION_KEY = 'legacy-migration-state'
const activeTickets = new Set<string>()

function registerAutoOpenRules(): void {
  void ensureAutoOpenRules().catch((error: unknown) => console.error('The Viewer could not register automatic open rules.', error))
}

function ensureMenus(): void {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_ID, title: 'The Viewer로 열기', contexts: ['link'], targetUrlPatterns: ['https://*/*', 'http://*/*'] })
  })
}

function initializeExtension(): void {
  ensureMenus()
  registerAutoOpenRules()
  chrome.alarms.create(CLEANUP_ALARM, { periodInMinutes: 1 })
  void purgeExpiredTickets().catch((error: unknown) => console.error('The Viewer could not purge expired relay data.', error))
}

chrome.runtime.onInstalled.addListener(initializeExtension)
chrome.runtime.onStartup.addListener(initializeExtension)
chrome.permissions.onAdded.addListener(registerAutoOpenRules)
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === CLEANUP_ALARM) void purgeExpiredTickets().catch((error: unknown) => console.error('The Viewer could not purge expired relay data.', error))
})

chrome.action.onClicked.addListener(() => {
  void chrome.tabs.create({ url: chrome.runtime.getURL('extension.html') })
})

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId !== MENU_ID || !info.linkUrl) return
  let url: URL
  try { url = new URL(info.linkUrl) } catch { return }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return
  const ticket = crypto.randomUUID()
  void chrome.storage.local.set({ [`link:${ticket}`]: { url: url.href, createdAt: Date.now() } }).then(() => {
    return chrome.tabs.create({ url: chrome.runtime.getURL(`extension.html#link/${ticket}`) })
  }).catch((error: unknown) => console.error('The Viewer could not open the selected link.', error))
})

chrome.runtime.onConnectExternal.addListener((port) => {
  if (port.name !== PORT_NAME) {
    port.disconnect()
    return
  }
  handleRelayPort(port)
})

function handleRelayPort(port: chrome.runtime.Port): void {
  let ticket: RelayTicket | null = null
  let lockedTicketId = ''
  let expectedSequence = 0
  let messageQueue = Promise.resolve()
  const senderTabId = port.sender?.tab?.id
  const senderInfo = {
    origin: port.sender?.origin,
    url: port.sender?.url,
    frameId: port.sender?.frameId,
    tabId: senderTabId
  }

  const respondError = (ticketId: string, code: RelayErrorCode, message: string) => {
    try { port.postMessage({ type: 'ERROR', ticketId, code, message }) } catch { /* The page may have disconnected. */ }
  }

  port.onMessage.addListener((raw: unknown) => {
    messageQueue = messageQueue.then(async () => {
      if (!isRelayMessage(raw)) {
        const malformedTicketId = typeof raw === 'object' && raw !== null && 'ticketId' in raw ? raw.ticketId : undefined
        if (isTicketId(malformedTicketId)) respondError(malformedTicketId, 'INVALID_MESSAGE', '전달 요청 형식이 올바르지 않습니다.')
        else port.disconnect()
        return
      }
      if (raw.type === 'HELLO') {
        if (ticket || lockedTicketId) {
          respondError(raw.ticketId, 'INVALID_MESSAGE', '연결 확인은 한 번만 보낼 수 있습니다.')
          return
        }
        if (!isSupportedProtocolVersion(raw.version)) {
          respondError(raw.ticketId, 'VERSION_MISMATCH', 'Chrome 확장과 PWA를 모두 최신 버전으로 업데이트한 뒤 다시 시도하세요.')
          return
        }
        if (!isTrustedPwaSender(senderInfo, senderTabId ?? -1)) {
          respondError(raw.ticketId, 'ACCESS_DENIED', '허용된 The Viewer PWA 탭에서 온 요청이 아닙니다.')
          return
        }
        try {
          let next: RelayTicket
          try {
            next = await readTicket(raw.ticketId, senderTabId)
          } catch (error) {
            if (!(error instanceof RelayStoreError) || error.code !== 'INVALID_TICKET') throw error
            const completed = await readCompletedTicket(raw.ticketId)
            if (!completed) throw error
            if (!isTrustedPwaSender(senderInfo, completed.tabId)) {
              throw new RelayStoreError('ACCESS_DENIED', '완료된 전달 티켓이 현재 탭에 속하지 않습니다.')
            }
            if (completed.kind === 'workspace-snapshot') await markLegacyMigrationCommitted(completed)
            port.postMessage({ type: 'COMMITTED', ticketId: completed.id })
            return
          }
          if (next.version !== raw.version) {
            respondError(raw.ticketId, 'VERSION_MISMATCH', 'Chrome 확장과 PWA를 모두 최신 버전으로 업데이트한 뒤 다시 시도하세요.')
            return
          }
          if (!isTrustedPwaSender(senderInfo, next.tabId)) {
            respondError(raw.ticketId, 'ACCESS_DENIED', '허용된 The Viewer PWA 탭에서 온 요청이 아닙니다.')
            return
          }
          if (activeTickets.has(next.id)) {
            respondError(raw.ticketId, 'BUSY', '이 파일은 다른 탭에서 이미 전달 중입니다.')
            return
          }
          activeTickets.add(next.id)
          ticket = next
          lockedTicketId = next.id
          port.postMessage({
            type: 'META', version: PROTOCOL_VERSION, ticketId: next.id, kind: next.kind,
            name: next.name, mimeType: next.mimeType, byteLength: next.byteLength,
            chunkCount: Math.ceil(next.byteLength / CHUNK_BYTES)
          })
        } catch (error) { respondError(raw.ticketId, relayErrorCode(error), errorMessage(error)) }
        return
      }

      const active = ticket
      if (!active || raw.ticketId !== active.id) {
        respondError(raw.ticketId, 'INVALID_TICKET', '전달 티켓이 이 연결과 일치하지 않습니다.')
        return
      }
      if (!isTrustedPwaSender(senderInfo, active.tabId)) {
        respondError(raw.ticketId, 'ACCESS_DENIED', 'The Viewer 탭 또는 프레임을 확인하지 못했습니다.')
        return
      }
      try {
        await assertTicketAvailable(active.id, senderTabId, active.tabId, active.expiresAt, active.byteLength)
        if (active.version !== PROTOCOL_VERSION) throw new RelayStoreError('ACCESS_DENIED', '전달 프로토콜 버전이 일치하지 않습니다.')
        if (raw.type === 'READ') {
          const chunkCount = Math.ceil(active.byteLength / CHUNK_BYTES)
          if (raw.sequence !== expectedSequence || raw.sequence >= chunkCount) {
            respondError(raw.ticketId, 'SEQUENCE', '요청 청크 순번이 올바르지 않습니다.')
            return
          }
          const start = raw.sequence * CHUNK_BYTES
          const end = Math.min(start + CHUNK_BYTES, active.byteLength)
          const base64 = bytesToBase64(new Uint8Array(active.bytes, start, end - start))
          port.postMessage({ type: 'CHUNK', ticketId: active.id, sequence: raw.sequence, base64 })
          expectedSequence += 1
          return
        }
        if (raw.type === 'COMMIT') {
          const chunkCount = Math.ceil(active.byteLength / CHUNK_BYTES)
          if (expectedSequence !== chunkCount) {
            respondError(raw.ticketId, 'SEQUENCE', '모든 파일 조각을 받기 전에는 완료할 수 없습니다.')
            return
          }
          const completed = await commitTicket(active.id)
          if (completed.kind === 'workspace-snapshot') await markLegacyMigrationCommitted(completed)
          activeTickets.delete(active.id)
          ticket = null
          lockedTicketId = ''
          port.postMessage({ type: 'COMMITTED', ticketId: active.id })
          return
        }
        respondError(raw.ticketId, 'INVALID_MESSAGE', '현재 전송 상태에서 허용되지 않은 메시지입니다.')
      } catch (error) { respondError(raw.ticketId, relayErrorCode(error), errorMessage(error)) }
    }).catch((error: unknown) => {
      respondError(ticket?.id ?? '', 'UNKNOWN', errorMessage(error))
    })
  })

  port.onDisconnect.addListener(() => {
    if (lockedTicketId) activeTickets.delete(lockedTicketId)
  })
}

async function markLegacyMigrationCommitted(ticket: Pick<RelayTicket | CompletedRelayTicket, 'name'>): Promise<void> {
  const prefix = 'legacy:'
  if (!ticket.name.startsWith(prefix)) return
  const documentId = ticket.name.slice(prefix.length)
  const stored = await chrome.storage.local.get(LEGACY_MIGRATION_KEY)
  const state = stored[LEGACY_MIGRATION_KEY] as { documentIds?: unknown; completedIds?: unknown; jobs?: Record<string, unknown> } | undefined
  if (!state || !Array.isArray(state.documentIds) || !Array.isArray(state.completedIds)) return
  if (!state.documentIds.includes(documentId)) return
  const completedIds = [...new Set([...state.completedIds.filter((id): id is string => typeof id === 'string'), documentId])]
  const jobs = { ...(state.jobs ?? {}) }
  delete jobs[documentId]
  await chrome.storage.local.set({ [LEGACY_MIGRATION_KEY]: { ...state, documentIds: state.documentIds, completedIds, jobs } })
}

function relayErrorCode(error: unknown): RelayErrorCode {
  if (error instanceof RelayStoreError) return error.code
  return 'UNKNOWN'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '전달 중 오류가 발생했습니다.'
}
