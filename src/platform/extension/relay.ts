import './relay.css'
import { fetchAutoOpenedFile, fetchRemoteLinkFile, readRemoteLinkTicket, deleteRemoteLinkTicket } from './links'
import { createLegacySnapshot, readLegacyDocuments } from './legacyMigration'
import { createTicket, readTicket } from './relayStore'
import { isTicketId, SNAPSHOT_MIME, type RelayKind } from '../relay/protocol'
import { getFormat } from '../fileTypes'
import { isAutoOpenTokenValid, isLocalFileAccessAllowed, openExtensionDetails } from './autoOpen'

const PWA_URL = 'https://m00nlygreat.github.io/the_viewer/'
const root = document.querySelector<HTMLElement>('#relay-root')!
const migrationKey = 'legacy-migration-state'
const currentTabPromise = chrome.tabs.getCurrent()

interface Action { label: string; run: () => void | Promise<void>; primary?: boolean }

function render(title: string, message: string, options: { detail?: string; error?: boolean; progress?: number; actions?: Action[] } = {}): void {
  const card = document.createElement('main')
  card.className = 'relay-card'
  const mark = document.createElement('div')
  mark.className = 'relay-mark'
  mark.textContent = 'V'
  const heading = document.createElement('h1')
  heading.textContent = title
  const paragraph = document.createElement('p')
  if (options.error) paragraph.className = 'relay-error'
  paragraph.textContent = message
  card.append(mark, heading, paragraph)
  if (options.detail) {
    const detail = document.createElement('div')
    detail.className = 'relay-detail'
    detail.textContent = options.detail
    card.append(detail)
  }
  if (options.progress !== undefined) {
    const progress = document.createElement('div')
    progress.className = 'relay-progress'
    progress.setAttribute('role', 'progressbar')
    progress.setAttribute('aria-valuemin', '0')
    progress.setAttribute('aria-valuemax', '100')
    progress.setAttribute('aria-valuenow', String(Math.round(options.progress)))
    const bar = document.createElement('span')
    bar.style.width = `${Math.max(0, Math.min(100, options.progress))}%`
    progress.append(bar)
    card.append(progress)
  }
  if (options.actions?.length) {
    const actions = document.createElement('div')
    actions.className = 'relay-actions'
    for (const action of options.actions) {
      const button = document.createElement('button')
      button.textContent = action.label
      if (action.primary) button.classList.add('primary')
      button.addEventListener('click', () => { void action.run() })
      actions.append(button)
    }
    card.append(actions)
  }
  root.replaceChildren(card)
}

async function getCurrentTabId(): Promise<number> {
  const tab = await currentTabPromise
  if (typeof tab?.id !== 'number') throw new Error('현재 Chrome 탭을 확인하지 못했습니다.')
  return tab.id
}

async function goToPwa(ticketId?: string): Promise<void> {
  const tabId = await getCurrentTabId()
  const url = ticketId ? `${PWA_URL}#/relay/${chrome.runtime.id}/${ticketId}` : PWA_URL
  await chrome.tabs.update(tabId, { url })
}

async function createAndOpenTicket(input: { kind: RelayKind; name: string; mimeType: string; bytes: Uint8Array }): Promise<void> {
  const ticket = await createTicket({ ...input, tabId: await getCurrentTabId() })
  history.replaceState(null, '', `#ready/${ticket.id}`)
  await goToPwa(ticket.id)
}

async function readAutoFile(token: string, source: string): Promise<void> {
  render('자동으로 파일을 여는 중', 'Chrome이 확인한 파일을 기기 안에서 읽고 있습니다.')
  try {
    if (!await isAutoOpenTokenValid(token)) throw new Error('자동 열기 요청이 유효하지 않습니다. 다시 파일을 여세요.')
    const file = await fetchAutoOpenedFile(source)
    await createAndOpenTicket({ kind: formatKind(file.name, file.type), name: file.name, mimeType: file.type, bytes: file.bytes })
  } catch (error) {
    const message = error instanceof Error ? error.message : '파일을 읽지 못했습니다.'
    const actions: Action[] = [{ label: '다시 시도', primary: true, run: () => readAutoFile(token, source) }]
    let localAccessAllowed = true
    if (source.startsWith('file:')) {
      try { localAccessAllowed = await isLocalFileAccessAllowed() } catch { localAccessAllowed = false }
    }
    if (source.startsWith('file:') && !localAccessAllowed) {
      actions.unshift({ label: 'Chrome 파일 권한 열기', run: async () => {
        await openExtensionDetails()
      } })
    }
    render('파일을 열지 못했습니다', message, { error: true, actions })
  }
}

async function confirmAndReadLink(id: string): Promise<void> {
  let url: string | null
  try { url = await readRemoteLinkTicket(id) } catch { url = null }
  if (!url) {
    render('링크 요청이 만료되었습니다', '링크 메뉴에서 다시 The Viewer로 열기를 선택하세요.', { error: true })
    return
  }
  const parsed = new URL(url)
  const basename = decodeName(parsed.pathname)
  render('링크 파일을 열까요?', '대상 사이트에서 파일을 가져와 현재 기기의 브라우저 안에서 엽니다. 로그인 쿠키와 리퍼러는 보내지 않습니다.', {
    detail: `${parsed.protocol.toUpperCase()} · ${parsed.hostname}\n${basename}`,
    actions: [
      { label: '취소', run: async () => { await deleteRemoteLinkTicket(id); await goToPwa() } },
      { label: '사이트에서 가져오기', primary: true, run: async () => {
        render('링크 파일을 가져오는 중', `${parsed.hostname}에 파일을 요청하고 있습니다.`)
        try {
          const file = await fetchRemoteLinkFile(url!, { requestPermission: true })
          const ticket = await createTicket({ kind: formatKind(file.name, file.type), tabId: await getCurrentTabId(), name: file.name, mimeType: file.type, bytes: file.bytes })
          await deleteRemoteLinkTicket(id)
          history.replaceState(null, '', `#ready/${ticket.id}`)
          await goToPwa(ticket.id)
        } catch (error) {
          render('링크 파일을 가져오지 못했습니다', error instanceof Error ? error.message : '파일 요청이 실패했습니다.', {
            error: true,
            actions: [{ label: '다시 시도', primary: true, run: () => confirmAndReadLink(id) }, { label: '취소', run: async () => { await deleteRemoteLinkTicket(id); await goToPwa() } }]
          })
        }
      } }
    ]
  })
}

async function reopenTicket(id: string): Promise<void> {
  try {
    const ticket = await readTicket(id, await getCurrentTabId())
    await goToPwa(ticket.id)
  } catch (error) {
    render('파일 전달을 다시 시작할 수 없습니다', error instanceof Error ? error.message : '전달 티켓을 찾을 수 없습니다.', {
      error: true,
      actions: [{ label: 'The Viewer 열기', primary: true, run: () => goToPwa() }]
    })
  }
}

interface MigrationState { documentIds: string[]; completedIds: string[] }

async function showLanding(): Promise<void> {
  let documents: Awaited<ReturnType<typeof readLegacyDocuments>> = []
  let state: MigrationState | null = null
  try {
    const stored = await chrome.storage.local.get(migrationKey)
    const value = stored[migrationKey] as MigrationState | undefined
    if (value && Array.isArray(value.documentIds) && Array.isArray(value.completedIds)) state = value
    documents = await readLegacyDocuments()
  } catch { /* Opening The Viewer remains available if migration inspection fails. */ }
  const incomplete = documents.filter((item) => !state?.completedIds.includes(item.id))
  const dirtyCount = incomplete.filter((item) => item.isDirty).length
  const detail = incomplete.length
    ? `${incomplete.length}개 저장 문서${dirtyCount ? ` · 편집 중인 문서 ${dirtyCount}개 포함` : ''}\n기존 편집 상태를 그대로 이전합니다. 원본 저장 데이터는 유지됩니다.`
    : '파일 보기·편집과 저장된 작업 복구는 The Viewer PWA에서 사용할 수 있습니다.'
  const actions: Action[] = [{ label: 'The Viewer 열기', primary: true, run: () => goToPwa() }]
  if (incomplete.length) actions.unshift({ label: `${incomplete.length}개 기존 작업 이전`, run: () => migrateLegacyDocuments(incomplete, state) })
  render(incomplete.length ? '기존 작업을 찾았습니다' : 'The Viewer', incomplete.length ? '저장된 작업을 새 PWA로 옮길 수 있습니다.' : '파일을 확인하고 편집하려면 The Viewer PWA를 여세요.', { detail, actions })
}

async function migrateLegacyDocuments(documents: Awaited<ReturnType<typeof readLegacyDocuments>>, current: MigrationState | null): Promise<void> {
  render('기존 작업을 준비하는 중', `${documents.length}개 문서를 PWA로 전달합니다. 문서 본문은 서버에 업로드되지 않습니다.`)
  const allIds = [...new Set([...(current?.documentIds ?? []), ...documents.map((document) => document.id)])]
  const completedIds = current?.completedIds ?? []
  const prepared: Array<{ tabId: number; ticketId: string }> = []
  try {
    for (const document of documents) {
      const tab = await chrome.tabs.create({ url: 'about:blank', active: false })
      if (typeof tab.id !== 'number') throw new Error('PWA 탭을 만들지 못했습니다.')
      const snapshot = createLegacySnapshot(document)
      const ticket = await createTicket({
        kind: 'workspace-snapshot', tabId: tab.id, name: `legacy:${document.id}`,
        mimeType: SNAPSHOT_MIME, bytes: snapshot.bytes
      })
      prepared.push({ tabId: tab.id, ticketId: ticket.id })
    }
    await chrome.storage.local.set({ [migrationKey]: { documentIds: allIds, completedIds } satisfies MigrationState })
    for (const item of prepared) {
      await chrome.tabs.update(item.tabId, { url: `${PWA_URL}#/relay/${chrome.runtime.id}/${item.ticketId}` })
    }
    render('기존 작업을 PWA로 전달했습니다', `전달을 시작했습니다. PWA가 각 문서를 복원하고 저장한 뒤 확장에 완료를 알립니다.`, {
      detail: `${prepared.length}개 문서 · 완료되면 다음에 이 페이지를 열 때 이전 안내가 사라집니다.`
    })
  } catch (error) {
    render('일부 작업을 준비하지 못했습니다', error instanceof Error ? error.message : '저장된 작업을 전달하지 못했습니다.', {
      error: true,
      actions: [{ label: '다시 시도', primary: true, run: () => showLanding() }, { label: 'PWA 열기', run: () => goToPwa() }]
    })
  }
}

function formatKind(name: string, mimeType: string): RelayKind {
  const kind = getFormat(name, mimeType)
  if (!kind) throw new Error('지원되는 EML·CSV·Markdown·ICS·VCF 파일이 아닙니다.')
  return kind
}

function decodeName(pathname: string): string {
  const encoded = pathname.split('/').filter(Boolean).pop() || '파일'
  try { return decodeURIComponent(encoded) } catch { return encoded }
}

async function start(): Promise<void> {
  const auto = /^#auto\/([0-9a-f-]+)\/((?:https?|file):\/\/.+)$/i.exec(location.hash)
  if (auto) { await readAutoFile(auto[1], auto[2]); return }
  const link = /^#link\/([0-9a-f-]+)$/i.exec(location.hash)
  if (link && isTicketId(link[1])) { await confirmAndReadLink(link[1]); return }
  const ready = /^#ready\/([0-9a-f-]+)$/i.exec(location.hash)
  if (ready && isTicketId(ready[1])) { await reopenTicket(ready[1]); return }
  await showLanding()
}

void start().catch((error: unknown) => render('중계 페이지를 열지 못했습니다', error instanceof Error ? error.message : '예기치 않은 오류가 발생했습니다.', { error: true, actions: [{ label: 'The Viewer 열기', primary: true, run: () => goToPwa() }] }))
