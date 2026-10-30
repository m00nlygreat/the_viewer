import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Check, ClipboardPaste, FilePlus2, FolderOpen, X
} from 'lucide-react'
import { CommandMenu, type CommandItem } from '../components/CommandMenu'
import { SettingsDialog } from '../components/SettingsDialog'
import { useFocusTrap } from '../components/useFocusTrap'
import { ViewerZoom } from '../components/ViewerZoom'
import { FeatureLoadBoundary } from '../components/FeatureLoadBoundary'
import { clearDocumentResources, disposeDocumentResources } from './documentResources'
import { DocumentActionBar, DocumentHeader } from './DocumentHeader'
import { safeDisplayFileName } from './displayName'
import { WorkspaceSidebar } from './WorkspaceSidebar'
import { FORMAT_LABEL, FORMAT_MIME, FORMATS, getFormat, type CalendarModel, type ContactModel, type CsvModel, type DocumentModel, type EmailModel, type Format, type ThemePreference, type ViewerDocument } from '../domain/types'
import { DocumentController } from '../domain/documentController'
import { buildExportSnapshot, diagnosticsFromMessages, documentIsDirty, flushDocument, hasByteOrderMark, makeDocumentFromBytes } from '../domain/session'
import { parseWithWorker } from '../domain/workerClient'
import { hasFatalDiagnostics } from '../domain/parseDiagnostics'
import { clearAllData, clearDocuments, completeShareTicketFile, loadDocuments, loadTheme, readSetting, readShareTicket, removeDocument, saveDocument, writeSetting } from '../platform/storage'
import { DocumentWriteQueue } from '../platform/documentWriteQueue'
import { FilePicker, type FilePickerHandle } from '../platform/FilePicker'
import type { PickedFile } from '../platform/fileTypes'
import { downloadLocalFile, readClipboardText, readDroppedFiles, receiveLaunchedFiles, saveLocalFile, shareLocalFile } from '../platform/browserFiles'
import { commitExtensionFile, parseRelayRoute, receiveExtensionFile, RelayTransferError, restoreLegacySnapshot, type ReceivedExtensionFile, type RelayRoute } from '../platform/pwa/extensionRelay'

const CsvEditor = lazy(() => import('../features/CsvEditor').then((module) => ({ default: module.CsvEditor })))
const MarkdownEditor = lazy(() => import('../features/MarkdownEditor').then((module) => ({ default: module.MarkdownEditor })))
const EmailEditor = lazy(() => import('../features/EmailEditor').then((module) => ({ default: module.EmailEditor })))
const CalendarEditor = lazy(() => import('../features/CalendarEditor').then((module) => ({ default: module.CalendarEditor })))
const ContactsEditor = lazy(() => import('../features/ContactsEditor').then((module) => ({ default: module.ContactsEditor })))
const SourceEditor = lazy(() => import('../components/SourceEditor'))

interface Notice { id: number; tone: 'success' | 'error' | 'info'; message: string }
interface BeforeInstallPrompt extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
const fileAccept = FORMATS.map((format) => `.${format}`).join(',')
const labels = FORMAT_LABEL

export function App() {
  const [documents, setDocuments] = useState<ViewerDocument[]>([])
  const documentsRef = useRef(documents)
  documentsRef.current = documents
  const [activeId, setActiveId] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [theme, setTheme] = useState<ThemePreference>('system')
  const [systemLight, setSystemLight] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: light)').matches)
  const [recoveryEnabled, setRecoveryEnabled] = useState(true)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [showCommand, setShowCommand] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showPaste, setShowPaste] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [pasteFormat, setPasteFormat] = useState<Format>('md')
  const [notices, setNotices] = useState<Notice[]>([])
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPrompt | null>(null)
  const [updateReady, setUpdateReady] = useState(false)
  const [offlineReady, setOfflineReady] = useState(false)
  const [relayRoute, setRelayRoute] = useState<RelayRoute | null>(() => parseRelayRoute(window.location.hash))
  const [relayError, setRelayError] = useState('')
  const inputRef = useRef<FilePickerHandle>(null)
  const documentController = useRef(new DocumentController())
  const sourceParseTimers = useRef(new Map<string, { revision: number; timer: number }>())
  const sourceRequestTokens = useRef(new Map<string, number>())
  const pendingSerializations = useRef(new Map<string, Promise<void>>())
  const recoveryWriteQueue = useRef(new DocumentWriteQueue())
  const recoveryTimers = useRef(new Map<string, number>())
  const recoveryObservedDocuments = useRef(new Map<string, ViewerDocument>())
  const recoveryEnabledRef = useRef(true)
  const recoveryWasEnabled = useRef(false)
  const closingDocumentIds = useRef(new Set<string>())
  const resettingData = useRef(false)
  const launchedFileQueue = useRef<PickedFile[][]>([])
  const noticeTimer = useRef(new Map<number, number>())
  const relayRuns = useRef(new Set<string>())
  const receivedRelayFiles = useRef(new Map<string, ReceivedExtensionFile>())
  const activeDocument = documents.find((document) => document.id === activeId) ?? null
  const resolvedTheme = theme === 'system' ? (systemLight ? 'light' : 'dark') : theme

  const notify = useCallback((message: string, tone: Notice['tone'] = 'info') => {
    const id = Date.now() + Math.random()
    setNotices((items) => [...items.slice(-2), { id, tone, message }])
    const timer = window.setTimeout(() => {
      noticeTimer.current.delete(id)
      setNotices((items) => items.filter((item) => item.id !== id))
    }, 4200)
    noticeTimer.current.set(id, timer)
  }, [])

  const publishDocument = useCallback((updated: ViewerDocument) => {
    documentsRef.current = documentsRef.current.map((item) => item.id === updated.id ? updated : item)
    setDocuments((items) => items.map((item) => item.id === updated.id ? updated : item))
  }, [])

  const parseNow = useCallback(async (id: string, revision: number) => {
    const scheduled = sourceParseTimers.current.get(id)
    if (scheduled) { window.clearTimeout(scheduled.timer); sourceParseTimers.current.delete(id) }
    const document = documentsRef.current.find((item) => item.id === id)
    if (!document || document.revision !== revision || document.textRevision !== revision || document.parseState !== 'pending') return
    const token = (sourceRequestTokens.current.get(id) ?? 0) + 1
    sourceRequestTokens.current.set(id, token)
    try {
      const parsed = await parseWithWorker(document.name, document.mimeType, new TextEncoder().encode(document.text), document.format, { documentId: id, revision, csvHasHeader: document.format === 'csv' ? (document.model as CsvModel).hasHeader : undefined })
      const latest = documentsRef.current.find((item) => item.id === id)
      if (sourceRequestTokens.current.get(id) !== token || !latest || latest.revision !== revision || latest.text !== document.text) return
      if (hasFatalDiagnostics(parsed.format, parsed.model, parsed.diagnostics)) {
        const message = parsed.diagnostics[0] ?? '문서 구조를 해석하지 못했습니다.'
        publishDocument({ ...latest, parseState: 'error', diagnostics: diagnosticsFromMessages(parsed.diagnostics, 'error'), sourceError: message })
        return
      }
      publishDocument({ ...latest, model: parsed.model, modelRevision: revision, parseState: 'ready', diagnostics: diagnosticsFromMessages(parsed.diagnostics), sourceError: undefined })
    } catch (error) {
      const latest = documentsRef.current.find((item) => item.id === id)
      if (sourceRequestTokens.current.get(id) !== token || !latest || latest.revision !== revision) return
      const message = error instanceof Error ? error.message : '원본 문법을 해석하지 못했습니다.'
      publishDocument({ ...latest, parseState: 'error', diagnostics: [{ severity: 'error', message }], sourceError: message })
    }
  }, [publishDocument])

  const enqueueRecoverySave = useCallback((id: string): Promise<void> => recoveryWriteQueue.current.enqueue(id, async () => {
    let pending = pendingSerializations.current.get(id)
    while (pending) {
      await pending
      const next = pendingSerializations.current.get(id)
      pending = next && next !== pending ? next : undefined
    }
    const current = documentsRef.current.find((item) => item.id === id)
    if (!recoveryEnabledRef.current || closingDocumentIds.current.has(id) || !current || current.textRevision !== current.revision) return
    await saveDocument(current)
  }), [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [storedTheme, recover] = await Promise.all([loadTheme(), readSetting('recovery', true)])
        const saved = recover ? await loadDocuments() : []
        if (cancelled) return
        setTheme(storedTheme)
        setRecoveryEnabled(recover)
        recoveryEnabledRef.current = recover
        recoveryWasEnabled.current = recover
        documentsRef.current = saved
        recoveryObservedDocuments.current = new Map(saved.map((item) => [item.id, item]))
        setDocuments(saved)
        setActiveId(saved[0]?.id ?? '')
      } catch {
        if (!cancelled) notify('이 기기의 저장 공간에 접근할 수 없습니다. 현재 탭에서만 작업합니다.', 'error')
      } finally { if (!cancelled) setLoaded(true) }
    })()
    const timers = noticeTimer.current
    return () => { cancelled = true; for (const timer of timers.values()) clearTimeout(timer) }
  }, [notify])

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme
    document.documentElement.dataset.themePreference = theme
    document.documentElement.style.colorScheme = resolvedTheme
  }, [resolvedTheme, theme])

  useEffect(() => {
    const preference = matchMedia('(prefers-color-scheme: light)')
    const update = (event: MediaQueryListEvent) => setSystemLight(event.matches)
    preference.addEventListener('change', update)
    return () => preference.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    if (!loaded) return
    const currentIds = new Set(documents.map((item) => item.id))
    for (const id of recoveryObservedDocuments.current.keys()) if (!currentIds.has(id)) recoveryObservedDocuments.current.delete(id)
    for (const [id, timer] of recoveryTimers.current) {
      if (currentIds.has(id)) continue
      window.clearTimeout(timer)
      recoveryTimers.current.delete(id)
    }
    if (!recoveryEnabled) { recoveryWasEnabled.current = false; return }
    const enabledAgain = !recoveryWasEnabled.current
    recoveryWasEnabled.current = true
    for (const item of documents) {
      if (!enabledAgain && recoveryObservedDocuments.current.get(item.id) === item) continue
      recoveryObservedDocuments.current.set(item.id, item)
      const previous = recoveryTimers.current.get(item.id)
      if (previous !== undefined) window.clearTimeout(previous)
      const timer = window.setTimeout(() => {
        recoveryTimers.current.delete(item.id)
        void enqueueRecoverySave(item.id).catch(() => notify('로컬 작업 복구에 저장하지 못했습니다.', 'error'))
      }, 180)
      recoveryTimers.current.set(item.id, timer)
    }
  }, [documents, loaded, recoveryEnabled, notify, enqueueRecoverySave])

  useEffect(() => () => {
    for (const timer of recoveryTimers.current.values()) window.clearTimeout(timer)
    recoveryTimers.current.clear()
  }, [])

  useEffect(() => {
    if (loaded && !relayRoute && documents.length === 0 && !sessionStorage.getItem('viewer-command-shown')) {
      setShowCommand(true)
      sessionStorage.setItem('viewer-command-shown', '1')
    }
  }, [loaded, documents.length, relayRoute])

  useEffect(() => {
    const onInstall = (event: Event) => { event.preventDefault(); setInstallPrompt(event as BeforeInstallPrompt) }
    const onUpdate = () => setUpdateReady(true)
    const onOffline = () => setOfflineReady(true)
    window.addEventListener('beforeinstallprompt', onInstall)
    window.addEventListener('viewer:update', onUpdate)
    window.addEventListener('viewer:offline-ready', onOffline)
    return () => { window.removeEventListener('beforeinstallprompt', onInstall); window.removeEventListener('viewer:update', onUpdate); window.removeEventListener('viewer:offline-ready', onOffline) }
  }, [])

  useEffect(() => {
    const pendingIds = new Set(documents.filter((item) => item.parseState === 'pending' && item.modelRevision !== item.revision).map((item) => item.id))
    for (const [id, scheduled] of sourceParseTimers.current) {
      const current = documents.find((item) => item.id === id)
      if (!pendingIds.has(id) || current?.revision !== scheduled.revision) {
        window.clearTimeout(scheduled.timer)
        sourceParseTimers.current.delete(id)
      }
    }
    for (const item of documents) {
      if (!pendingIds.has(item.id) || sourceParseTimers.current.get(item.id)?.revision === item.revision) continue
      const timer = window.setTimeout(() => { sourceParseTimers.current.delete(item.id); void parseNow(item.id, item.revision) }, 380)
      sourceParseTimers.current.set(item.id, { revision: item.revision, timer })
    }
  }, [documents, parseNow])

  useEffect(() => () => {
    for (const scheduled of sourceParseTimers.current.values()) window.clearTimeout(scheduled.timer)
    sourceParseTimers.current.clear()
  }, [])

  const openFiles = useCallback(async (files: PickedFile[], forcedFormat?: Format, origin?: { shareTicketId: string; shareFileIndex: number }): Promise<{ opened: ViewerDocument[]; errors: string[] }> => {
    if (resettingData.current) return { opened: [], errors: ['저장 데이터 정리 중에는 파일을 열 수 없습니다.'] }
    if (!files.length) return { opened: [], errors: [] }
    const opened: ViewerDocument[] = []
    const errors: string[] = []
    let first: ViewerDocument | null = null
    for (const file of files) {
      try {
        const existing = origin && documentsRef.current.find((item) => item.shareTicketId === origin.shareTicketId && item.shareFileIndex === origin.shareFileIndex)
        if (existing) {
          opened.push(existing)
          if (!first) first = existing
          continue
        }
        const document = await makeDocumentFromBytes(file.name, file.type, file.bytes, undefined)
        if (forcedFormat && document.format !== forcedFormat) throw new Error(`선택한 형식 ${forcedFormat.toUpperCase()}과 파일 내용이 다릅니다.`)
        const openedDocument = origin ? { ...document, ...origin } : document
        documentsRef.current = [openedDocument, ...documentsRef.current.filter((item) => item.id !== openedDocument.id)]
        setDocuments((items) => [openedDocument, ...items.filter((item) => item.id !== openedDocument.id)])
        opened.push(openedDocument)
        if (!first) first = openedDocument
      } catch (error) {
        const message = `${file.name}: ${error instanceof Error ? error.message : '파일을 열지 못했습니다.'}`
        errors.push(message)
        notify(message, 'error')
      }
    }
    if (first) { setActiveId(first.id); setShowCommand(false); setTimeout(() => { location.hash = `/file/${first!.id}` }, 0) }
    return { opened, errors }
  }, [notify])

  useEffect(() => {
    receiveLaunchedFiles((files) => {
      if (!loaded) { launchedFileQueue.current.push(files); return }
      void openFiles(files)
    }, (message) => notify(message, 'error'))
  }, [loaded, notify, openFiles])

  useEffect(() => {
    if (!loaded) return
    const queued = launchedFileQueue.current.splice(0)
    for (const files of queued) void openFiles(files)
  }, [loaded, openFiles])

  const runRelay = useCallback(async (route: RelayRoute) => {
    if (relayRuns.current.has(route.ticketId)) return
    relayRuns.current.add(route.ticketId)
    setRelayError('')
    let imported: ViewerDocument | null = null
    const finish = (item: ViewerDocument) => {
      setActiveId(item.id)
      setShowCommand(false)
      history.replaceState(null, '', `#/file/${item.id}`)
      receivedRelayFiles.current.delete(route.ticketId)
      setRelayRoute(null)
      setRelayError('')
    }
    try {
      imported = documentsRef.current.find((item) => item.relayTicketId === route.ticketId) ?? null
      if (!imported) {
        let received = receivedRelayFiles.current.get(route.ticketId)
        if (!received) {
          received = await receiveExtensionFile({
            extensionId: route.extensionId,
            ticketId: route.ticketId
          })
          receivedRelayFiles.current.set(route.ticketId, received)
        }
        if (received.kind === 'workspace-snapshot') {
          imported = { ...restoreLegacySnapshot(received.file.bytes), relayTicketId: route.ticketId }
        } else {
          const document = await makeDocumentFromBytes(received.file.name, received.file.type, received.file.bytes)
          if (document.format !== received.kind) throw new Error('전달된 파일 형식 정보와 실제 파일 내용이 다릅니다.')
          imported = { ...document, id: route.ticketId, relayTicketId: route.ticketId }
        }
        if (recoveryEnabled) await saveDocument(imported)
        documentsRef.current = [imported, ...documentsRef.current.filter((item) => item.id !== imported!.id)]
        setDocuments((items) => [imported!, ...items.filter((item) => item.id !== imported!.id)])
      }
      setActiveId(imported.id)
      await commitExtensionFile({ extensionId: route.extensionId, ticketId: route.ticketId })
      finish(imported)
    } catch (error) {
      if (imported && error instanceof RelayTransferError && (error.code === 'INVALID_TICKET' || error.code === 'EXPIRED')) {
        finish(imported)
      } else {
        setRelayError(error instanceof Error ? error.message : '파일 전달에 실패했습니다.')
      }
    } finally { relayRuns.current.delete(route.ticketId) }
  }, [recoveryEnabled])

  useEffect(() => {
    if (loaded && relayRoute) void runRelay(relayRoute)
  }, [loaded, relayRoute, runRelay])

  useEffect(() => {
    if (!loaded) return
    const match = location.hash.match(/^#\/?share\/([0-9a-f-]+)$/i)
    if (!match) return
    const ticketId = match[1]!
    void readShareTicket(ticketId).then(async (ticket) => {
      if (!ticket?.files.length) { notify('공유한 파일이 없거나 보관 시간이 지났습니다.', 'error'); return }
      let failed = false
      for (const [index, item] of ticket.files.entries()) {
        if (ticket.completed[index]) continue
        const result = await openFiles([{ name: item.name, type: item.type, bytes: new Uint8Array(item.bytes) }], undefined, { shareTicketId: ticketId, shareFileIndex: index })
        const opened = result.opened[0]
        if (!opened || result.errors.length) { failed = true; continue }
        try {
          if (recoveryEnabled) await enqueueRecoverySave(opened.id)
          await completeShareTicketFile(ticketId, index)
        } catch (error) {
          failed = true
          notify(error instanceof Error ? error.message : '공유한 파일을 저장하지 못했습니다.', 'error')
        }
      }
      if (failed) history.replaceState(null, '', `#/share/${ticketId}`)
    }).catch((error: unknown) => notify(error instanceof Error ? error.message : '공유한 파일을 복구하지 못했습니다.', 'error'))
  }, [loaded, recoveryEnabled, notify, openFiles, enqueueRecoverySave])

  const pickFiles = useCallback((format?: Format) => {
    inputRef.current?.open(format)
  }, [])

  const changeModel = useCallback((id: string, baseRevision: number, model: DocumentModel, group: 'typing' | 'command' = 'command') => {
    if (resettingData.current) return
    const current = documentsRef.current.find((item) => item.id === id)
    if (!current) return
    if (current.revision !== baseRevision || current.parseState !== 'ready' || current.modelRevision !== current.revision) {
      notify('원본을 해석 중이거나 문서가 바뀌어 구조 편집을 잠시 사용할 수 없습니다.', 'info')
      return
    }
    let command
    try { command = documentController.current.prepareViewCommand(current, baseRevision, model, group) }
    catch (error) { notify(error instanceof Error ? error.message : '보기 편집을 적용하지 못했습니다.', 'info'); return }
    if (!command) return
    publishDocument(command.optimisticDocument)

    const pending = command.serializedDocument.then((serialized) => {
      const latest = documentsRef.current.find((item) => item.id === id)
      if (!latest || latest.revision !== serialized.revision || latest.model !== model) return
      publishDocument({ ...serialized, mode: latest.mode, savedText: latest.savedText, savedBytes: latest.savedBytes, sourceText: latest.sourceText, initialBytes: latest.initialBytes, isDirty: documentIsDirty({ ...serialized, savedText: latest.savedText, savedBytes: latest.savedBytes }) })
    }).catch((error: unknown) => {
      const latest = documentsRef.current.find((item) => item.id === id)
      if (!latest || latest.revision !== command.optimisticDocument.revision || latest.model !== model) return
      const message = error instanceof Error ? error.message : '보기 변경을 원문으로 직렬화하지 못했습니다.'
      publishDocument({ ...latest, parseState: 'error', diagnostics: [{ severity: 'error', message }], sourceError: message })
      notify(message, 'error')
    }).finally(() => {
      if (pendingSerializations.current.get(id) === pending) pendingSerializations.current.delete(id)
    })
    pendingSerializations.current.set(id, pending)
  }, [notify, publishDocument])

  const applySourceText = useCallback((id: string, nextText: string, group: 'typing' | 'command' = 'typing') => {
    if (resettingData.current) return
    const current = documentsRef.current.find((item) => item.id === id)
    if (!current || current.text === nextText) return
    sourceRequestTokens.current.set(id, (sourceRequestTokens.current.get(id) ?? 0) + 1)
    publishDocument(documentController.current.applySourceText(current, nextText, group))
  }, [publishDocument])

  const setMode = useCallback((mode: ViewerDocument['mode']) => {
    const current = documentsRef.current.find((item) => item.id === activeId)
    if (!current || current.mode === mode) return
    if (mode === 'source') {
      void flushDocument(current.id, () => documentsRef.current.find((item) => item.id === current.id) ?? null, () => pendingSerializations.current.get(current.id)).then((document) => {
        publishDocument(documentController.current.changeMode(document, 'source'))
      }).catch((error: unknown) => notify(error instanceof Error ? error.message : '원본 편집기를 준비하지 못했습니다.', 'error'))
      return
    }
    publishDocument(documentController.current.changeMode(current, 'view'))
    if (current.parseState === 'pending' && current.modelRevision !== current.revision) void parseNow(current.id, current.revision)
    else if (current.parseState === 'error') notify('원본 문법 오류가 있습니다. 마지막으로 유효했던 보기를 표시합니다.', 'info')
  }, [activeId, notify, parseNow, publishDocument])

  const undo = useCallback((redo = false) => {
    const current = documentsRef.current.find((item) => item.id === activeId)
    if (!current) return
    const next = documentController.current.restoreHistory(current, redo ? 'redo' : 'undo')
    if (!next) return
    sourceRequestTokens.current.set(current.id, (sourceRequestTokens.current.get(current.id) ?? 0) + 1)
    publishDocument(next)
    if (next.parseState === 'pending') void parseNow(current.id, next.revision)
  }, [activeId, parseNow, publishDocument])

  const createBlank = useCallback(async (format: Format) => {
    if (resettingData.current) return
    const templates: Record<Format, string> = {
      eml: 'Subject: \r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n',
      csv: '', md: '',
      ics: 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//The Viewer//EN\r\nCALSCALE:GREGORIAN\r\nEND:VCALENDAR\r\n',
      vcf: 'BEGIN:VCARD\r\nVERSION:4.0\r\nFN:\r\nN:;;;;\r\nEND:VCARD\r\n'
    }
    const bytes = new TextEncoder().encode(templates[format])
    try {
      const document = await makeDocumentFromBytes(`Untitled.${format}`, FORMAT_MIME[format], bytes)
      document.mode = 'view'
      documentsRef.current = [document, ...documentsRef.current.filter((item) => item.id !== document.id)]
      setDocuments((items) => [document, ...items])
      setActiveId(document.id)
      setShowCommand(false)
      setTimeout(() => { location.hash = `/file/${document.id}` }, 0)
    } catch (error) { notify(error instanceof Error ? error.message : '새 파일을 만들지 못했습니다.', 'error') }
  }, [notify])

  const saveCurrent = useCallback(async () => {
    if (!activeDocument) return
    const id = activeDocument.id
    let snapshot: ReturnType<typeof buildExportSnapshot>
    try {
      const item = await flushDocument(id, () => documentsRef.current.find((document) => document.id === id) ?? null, () => pendingSerializations.current.get(id))
      snapshot = buildExportSnapshot(id, item)
    } catch (error) { notify(error instanceof Error ? `파일을 구성하지 못했습니다: ${error.message}` : '파일을 구성하지 못했습니다.', 'error'); return }
    let status: 'saved' | 'started' | 'cancelled' = 'started'
    try {
      status = await saveLocalFile(activeDocument.name, activeDocument.format, snapshot.bytes)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') { status = 'cancelled' }
      else { notify(error instanceof Error ? `내보내기 실패: ${error.message}` : '내보내기 실패', 'error'); return }
    }
    if (status === 'cancelled') return
    const current = documentsRef.current.find((document) => document.id === id)
    if (current) {
      publishDocument(documentController.current.markSaved(current, snapshot))
    }
    notify(status === 'saved' ? '파일을 저장했습니다.' : '내려받기를 시작했습니다.', 'success')
  }, [activeDocument, notify, publishDocument])

  const revertCurrent = useCallback(async () => {
    if (!activeDocument || !window.confirm('마지막 저장·내보내기 기준으로 복원할까요? 현재 편집 내용은 사라집니다.')) return
    const item = activeDocument
    try {
      const parsed = await parseWithWorker(item.name, item.mimeType, new Uint8Array(item.savedBytes), item.format, { documentId: item.id, revision: item.revision, csvHasHeader: item.format === 'csv' ? (item.model as CsvModel).hasHeader : undefined })
      if (documentsRef.current.find((document) => document.id === item.id)?.revision !== item.revision) return
      const revision = item.revision + 1
      publishDocument({ ...item, text: parsed.text, model: parsed.model, savedText: parsed.text, bom: hasByteOrderMark(item.savedBytes), sourceError: undefined, isDirty: false, revision, modelRevision: revision, textRevision: revision, parseState: 'ready', diagnostics: diagnosticsFromMessages(parsed.diagnostics), encoding: parsed.encoding })
      documentController.current.clearHistory(item.id)
      notify('마지막 저장본으로 복원했습니다.', 'success')
    } catch (error) {
      const message = error instanceof Error ? error.message : '원본 파일을 해석하지 못했습니다.'
      if (documentsRef.current.find((document) => document.id === item.id)?.revision !== item.revision) return
      const revision = item.revision + 1
      publishDocument({ ...item, text: item.savedText, bom: hasByteOrderMark(item.savedBytes), textRevision: revision, revision, parseState: 'error', diagnostics: [{ severity: 'error', message }], sourceError: message, isDirty: false })
      documentController.current.clearHistory(item.id)
      notify('저장된 원문으로 복원했습니다. 구조 편집에는 유효한 문서가 필요합니다.', 'info')
    }
  }, [activeDocument, notify, publishDocument])

  const closeDocument = useCallback(async (id: string) => {
    const item = documentsRef.current.find((document) => document.id === id)
    if (!item) return
    if (item.isDirty && !window.confirm(`“${item.name}”에 내보내지 않은 변경이 있습니다. 닫을까요?`)) return
    const recoveryTimer = recoveryTimers.current.get(id)
    if (recoveryTimer !== undefined) { window.clearTimeout(recoveryTimer); recoveryTimers.current.delete(id) }
    closingDocumentIds.current.add(id)
    try {
      await recoveryWriteQueue.current.enqueue(id, () => removeDocument(id))
    } catch (error) {
      closingDocumentIds.current.delete(id)
      notify(error instanceof Error ? `“${item.name}”의 복구 데이터를 정리하지 못했습니다: ${error.message}` : '복구 데이터를 정리하지 못했습니다.', 'error')
      return
    }
    closingDocumentIds.current.delete(id)
    recoveryObservedDocuments.current.delete(id)
    setDocuments((items) => items.filter((document) => document.id !== id))
    documentsRef.current = documentsRef.current.filter((document) => document.id !== id)
    documentController.current.clearHistory(id)
    sourceRequestTokens.current.delete(id)
    const scheduled = sourceParseTimers.current.get(id)
    if (scheduled) { window.clearTimeout(scheduled.timer); sourceParseTimers.current.delete(id) }
    pendingSerializations.current.delete(id)
    window.setTimeout(() => disposeDocumentResources(id), 0)
    if (activeId === id) {
      const next = documentsRef.current[0]
      setActiveId(next?.id ?? '')
      if (next) location.hash = `/file/${next.id}`
      else location.hash = '/'
    }
  }, [activeId, notify])

  const openAttachment = useCallback(async (index: number) => {
    if (resettingData.current) return
    if (!activeDocument || activeDocument.format !== 'eml') return
    const attachment = (activeDocument.model as EmailModel).attachments[index]
    if (!attachment) return
    const format = getFormat(attachment.filename, attachment.mimeType)
    if (!format) { notify('이 파일 형식은 뷰어에서 열 수 없습니다. 내려받기를 사용하세요.', 'info'); return }
    try {
      const child = await makeDocumentFromBytes(attachment.filename, attachment.mimeType, attachment.content, activeDocument.id)
      documentsRef.current = [child, ...documentsRef.current.filter((item) => item.id !== child.id)]
      setDocuments((items) => [child, ...items])
      setActiveId(child.id)
      location.hash = `/file/${child.id}`
    } catch (error) { notify(error instanceof Error ? error.message : '첨부 파일을 열지 못했습니다.', 'error') }
  }, [activeDocument, notify])

  const downloadAttachment = useCallback((index: number) => {
    if (!activeDocument || activeDocument.format !== 'eml') return
    const attachment = (activeDocument.model as EmailModel).attachments[index]
    if (!attachment) return
    downloadLocalFile(attachment.filename || 'attachment.bin', attachment.mimeType, attachment.content)
  }, [activeDocument])

  const handlePaste = useCallback(async () => {
    try {
      const text = await readClipboardText()
      if (!text) { setShowPaste(true); return }
      setPasteText(text)
      setShowPaste(true)
    } catch { setShowPaste(true) }
  }, [])

  const createFromPaste = useCallback(async () => {
    const name = `Clipboard.${pasteFormat}`
    await openFiles([{ name, type: FORMAT_MIME[pasteFormat], bytes: new TextEncoder().encode(pasteText) }], pasteFormat)
    setShowPaste(false)
    setPasteText('')
  }, [openFiles, pasteText, pasteFormat])

  const changeTheme = useCallback((value: ThemePreference) => {
    setTheme(value)
    void writeSetting('theme', value).catch(() => notify('테마 설정을 이 기기에 저장하지 못했습니다.', 'error'))
  }, [notify])
  const changeRecovery = useCallback(async (enabled: boolean) => {
    const wasEnabled = recoveryEnabledRef.current
    try {
      if (!enabled) {
        recoveryEnabledRef.current = false
        for (const timer of recoveryTimers.current.values()) window.clearTimeout(timer)
        recoveryTimers.current.clear()
        await recoveryWriteQueue.current.flush()
        await clearDocuments()
      }
      await writeSetting('recovery', enabled)
      recoveryEnabledRef.current = enabled
      setRecoveryEnabled(enabled)
    } catch (error) {
      recoveryEnabledRef.current = wasEnabled
      notify(error instanceof Error ? `복구 설정을 변경하지 못했습니다: ${error.message}` : '복구 설정을 변경하지 못했습니다.', 'error')
    }
  }, [notify])
  const clearData = useCallback(async () => {
    if (resettingData.current) return
    resettingData.current = true
    const wasEnabled = recoveryEnabledRef.current
    recoveryEnabledRef.current = false
    for (const timer of recoveryTimers.current.values()) window.clearTimeout(timer)
    recoveryTimers.current.clear()
    try {
      await Promise.all([...pendingSerializations.current.values()].map((pending) => pending.catch(() => undefined)))
      await recoveryWriteQueue.current.flush().catch(() => undefined)
      await clearAllData()
    } catch (error) {
      recoveryEnabledRef.current = wasEnabled
      resettingData.current = false
      notify(error instanceof Error ? `저장된 데이터를 삭제하지 못했습니다: ${error.message}` : '저장된 데이터를 삭제하지 못했습니다.', 'error')
      return
    }
    const documentIds = documentsRef.current.map((document) => document.id)
    documentController.current.clearHistory()
    documentsRef.current = []
    setDocuments([])
    window.setTimeout(() => clearDocumentResources(documentIds), 0)
    for (const scheduled of sourceParseTimers.current.values()) window.clearTimeout(scheduled.timer)
    sourceParseTimers.current.clear()
    sourceRequestTokens.current.clear()
    pendingSerializations.current.clear()
    for (const timer of noticeTimer.current.values()) window.clearTimeout(timer)
    noticeTimer.current.clear()
    setNotices([])
    setActiveId('')
    setTheme('system')
    setRecoveryEnabled(true)
    recoveryEnabledRef.current = true
    recoveryWasEnabled.current = true
    recoveryObservedDocuments.current.clear()
    setShowSettings(false)
    resettingData.current = false
    notify('이 기기에 저장된 작업 데이터를 삭제했습니다.', 'success')
  }, [notify])

  const installApp = useCallback(async () => {
    if (!installPrompt) { notify('브라우저 메뉴에서 “앱 설치” 또는 “홈 화면에 추가”를 선택하세요.', 'info'); return }
    await installPrompt.prompt()
    const result = await installPrompt.userChoice
    setInstallPrompt(null)
    if (result.outcome === 'accepted') notify('앱 설치를 시작했습니다.', 'success')
  }, [installPrompt, notify])

  const shareCurrent = useCallback(async () => {
    if (!activeDocument || !navigator.share) { notify('이 브라우저에서는 시스템 공유를 사용할 수 없습니다.', 'info'); return }
    try {
      const item = await flushDocument(activeDocument.id, () => documentsRef.current.find((document) => document.id === activeDocument.id) ?? null, () => pendingSerializations.current.get(activeDocument.id))
      const payload = buildExportSnapshot(item.id, item)
      await shareLocalFile(item.name, item.format, payload.bytes)
      notify('공유를 시작했습니다.', 'success')
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) notify('파일을 공유하지 못했습니다.', 'error')
    }
  }, [activeDocument, notify])

  const commands = useMemo<CommandItem[]>(() => [
    ...documents.map((item) => ({ id: `switch-${item.id}`, title: `열린 파일 · ${safeDisplayFileName(item.name)}`, detail: `${labels[item.format]}${item.isDirty ? ' · 수정됨' : ''}`, section: '열린 파일', icon: 'open' as const, run: () => { setActiveId(item.id); location.hash = `/file/${item.id}` } })),
    { id: 'open', title: '파일 열기', detail: `지원 형식 ${fileAccept}`, section: '파일', icon: 'open', run: () => pickFiles() },
    ...FORMATS.map((format) => ({ id: `new-${format}`, title: `새 ${labels[format]} 만들기`, detail: `Untitled.${format}`, section: '새 파일', icon: 'new' as const, run: () => { void createBlank(format) } })),
    ...(activeDocument ? [{ id: 'revert', title: '처음 연 파일로 되돌리기', detail: activeDocument.name, section: '문서', icon: 'new' as const, run: () => { void revertCurrent() } }] : []),
    { id: 'paste', title: '클립보드에서 열기', detail: '붙여넣은 텍스트를 새 문서로 엽니다.', section: '입력', icon: 'paste', run: () => { void handlePaste() } },
    { id: 'settings', title: '설정', detail: '테마, 로컬 복구와 앱 정보', section: '앱', icon: 'settings', run: () => setShowSettings(true) },
    { id: 'theme', title: '테마 전환', detail: '시스템 · 라이트 · 다크', section: '앱', icon: 'theme', run: () => changeTheme(theme === 'dark' ? 'light' : 'dark') }
  ], [documents, pickFiles, createBlank, handlePaste, changeTheme, theme, activeDocument, revertCurrent])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      const target = event.target as HTMLElement | null
      const editingText = Boolean(target?.closest('input, textarea, select, [contenteditable="true"], .cm-content'))
      const command = event.metaKey || event.ctrlKey
      if (command && event.key.toLowerCase() === 'k') { event.preventDefault(); setShowCommand((open) => !open); return }
      if (command && event.key.toLowerCase() === 'o') { event.preventDefault(); pickFiles(); return }
      if (command && event.shiftKey && event.key.toLowerCase() === 'l') { event.preventDefault(); changeTheme(theme === 'dark' ? 'light' : 'dark'); return }
      if (command && event.key.toLowerCase() === 's') { event.preventDefault(); void saveCurrent(); return }
      if (command && event.key.toLowerCase() === 'z') { event.preventDefault(); undo(event.shiftKey); return }
      if (command && event.key.toLowerCase() === 'y') { event.preventDefault(); undo(true); return }
      if (event.key === 'Escape') { if (showCommand) setShowCommand(false); if (showSettings) setShowSettings(false); if (showPaste) setShowPaste(false); return }
      if (!editingText && activeDocument?.format === 'csv' && event.key === '/') {
        event.preventDefault()
        document.querySelector<HTMLInputElement>('.csv-toolbar input')?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeDocument, changeTheme, theme, showCommand, showSettings, showPaste, pickFiles, saveCurrent, undo])

  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    void readDroppedFiles(event.dataTransfer.files).then((files) => openFiles(files)).catch((error: unknown) => notify(error instanceof Error ? error.message : '놓은 파일을 읽지 못했습니다.', 'error'))
  }, [openFiles, notify])
  const switchTab = (id: string) => { setActiveId(id); location.hash = `/file/${id}` }
  const renderActiveDocument = (document: ViewerDocument) => renderDocument(
    document,
    (model, group) => changeModel(document.id, document.revision, model, group),
    (text, group) => applySourceText(document.id, text, group),
    openAttachment, downloadAttachment, resolvedTheme,
    () => undo(), () => undo(true)
  )

  return <div className="app-shell" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
    <FilePicker ref={inputRef} onFiles={(files, format) => { void openFiles(files, format) }} onError={notify} />
    <WorkspaceSidebar documents={documents} activeId={activeId} collapsed={sidebarCollapsed} onToggleCollapsed={() => setSidebarCollapsed((collapsed) => !collapsed)} onPickFiles={() => pickFiles()} onOpenCommands={() => setShowCommand(true)} onSelectDocument={switchTab} onCloseDocument={(id) => { void closeDocument(id) }} onOpenSettings={() => setShowSettings(true)} />

    <main className="main-column">
      <DocumentHeader document={activeDocument} theme={resolvedTheme} canShare={'share' in navigator} onModeChange={setMode} onThemeChange={changeTheme} onUndo={() => undo()} onRedo={() => undo(true)} onSave={() => { void saveCurrent() }} onShare={() => { void shareCurrent() }} onClose={() => { if (activeDocument) void closeDocument(activeDocument.id) }} onPickFiles={() => pickFiles()} onOpenCommands={() => setShowCommand(true)} onOpenSettings={() => setShowSettings(true)} />

      {activeDocument ? <>
        <div id={`document-panel-${activeDocument.id}`} className="document-workspace" key={activeDocument.id} role="tabpanel" aria-label={`${activeDocument.mode === 'view' ? '보기' : '원본'} · ${activeDocument.name}`} tabIndex={0}>
          {activeDocument.parseState === 'pending' && !(activeDocument.format === 'md' && activeDocument.mode === 'view') && <div className="source-diagnostic" role="status"><span>최신 원문을 해석하고 있습니다. 편집은 계속할 수 있습니다.</span></div>}
          {activeDocument.parseState === 'error' && <div className="source-diagnostic" role="alert"><span>원문을 해석하지 못했습니다. 마지막 유효 보기는 유지되며 구조 편집은 잠깁니다.</span><small>{activeDocument.diagnostics.find((item) => item.severity === 'error')?.message ?? activeDocument.sourceError}</small></div>}
          {activeDocument.parseState === 'ready' && activeDocument.diagnostics.some((item) => item.severity === 'warning') && <div className="inline-warning" role="status">진단 {activeDocument.diagnostics.filter((item) => item.severity === 'warning').length}개 · {activeDocument.diagnostics.find((item) => item.severity === 'warning')?.message}</div>}
          <FeatureLoadBoundary key={activeDocument.id} fileName={activeDocument.name} sourceText={activeDocument.text}>
            <Suspense fallback={null}>
              {activeDocument.mode === 'view' ? <ViewerZoom>{renderActiveDocument(activeDocument)}</ViewerZoom> : renderActiveDocument(activeDocument)}
            </Suspense>
          </FeatureLoadBoundary>
        </div>
        {activeDocument.mode === 'source' && <div className="source-statusbar"><span>원본 텍스트 · UTF-8 출력</span><span>{activeDocument.text.split(/\r\n|\r|\n/).length}줄 · {activeDocument.text.length.toLocaleString()}자</span><div className="toolbar-spacer" />{activeDocument.parseState === 'pending' ? <span>해석 중</span> : activeDocument.parseState === 'error' ? <span className="error-label">문법 오류</span> : <span className="ready-label">유효한 문서</span>}</div>}
      </> : <WelcomeScreen onOpen={() => pickFiles()} onPaste={() => { void handlePaste() }} onCommand={() => setShowCommand(true)} />}

      <DocumentActionBar document={activeDocument} onModeChange={setMode} onUndo={() => undo()} onRedo={() => undo(true)} onSave={() => { void saveCurrent() }} />
      {offlineReady && <div className="status-banner"><Check size={15} />오프라인에서 사용할 파일을 준비했습니다.<button className="icon-button" aria-label="알림 닫기" onClick={() => setOfflineReady(false)}><X size={14} /></button></div>}
      {updateReady && !relayRoute && <div className="status-banner update-banner"><span>새 버전을 사용할 수 있습니다. 업데이트는 사용자가 선택할 때 적용됩니다.</span><button className="subtle-button" onClick={() => window.dispatchEvent(new Event('viewer:apply-update'))}>업데이트</button><button className="icon-button" aria-label="업데이트 알림 닫기" onClick={() => setUpdateReady(false)}><X size={14} /></button></div>}
    </main>

    {showCommand && <CommandMenu commands={commands} onClose={() => setShowCommand(false)} />}
    {showSettings && <SettingsDialog theme={theme} onThemeChange={changeTheme} recoveryEnabled={recoveryEnabled} onRecoveryChange={(enabled) => { void changeRecovery(enabled) }} onClearData={() => { void clearData() }} onClose={() => setShowSettings(false)} onInstall={() => { void installApp() }} canInstall={Boolean(installPrompt)} />}
    {showPaste && <PasteDialog text={pasteText} format={pasteFormat} onTextChange={setPasteText} onFormatChange={setPasteFormat} onClose={() => setShowPaste(false)} onOpen={() => { void createFromPaste() }} />}
    {relayRoute && relayError && <div className="status-banner relay-error-banner" role="status" aria-live="polite"><span>{relayError}</span><button className="subtle-button" onClick={() => { void runRelay(relayRoute) }}>다시 시도</button></div>}
    <div className="toast-stack" aria-live="polite" aria-atomic="false">{notices.map((notice) => <div className={`toast ${notice.tone}`} key={notice.id}><span>{notice.message}</span><button aria-label="알림 닫기" onClick={() => setNotices((items) => items.filter((item) => item.id !== notice.id))}><X size={13} /></button></div>)}</div>
  </div>
}

function renderDocument(document: ViewerDocument, onModel: (model: DocumentModel, group?: 'typing' | 'command') => void, onText: (text: string, group?: 'typing' | 'command') => void, onOpenAttachment: (index: number) => void, onDownloadAttachment: (index: number) => void, theme: 'light' | 'dark', onUndo: () => void, onRedo: () => void) {
  if (document.mode === 'source') return <SourceEditor documentId={document.id} format={document.format} csvDelimiter={document.format === 'csv' ? (document.model as CsvModel).delimiter : ','} value={document.text} diagnostics={document.diagnostics} theme={theme} onChange={onText} onUndo={onUndo} onRedo={onRedo} label={`${document.name} 원본 편집기`} />
  switch (document.format) {
    case 'csv': return <CsvEditor document={document} model={document.model as CsvModel} onChange={(model, group) => onModel(model, group)} theme={theme} />
    case 'md': return <MarkdownEditor document={document} text={document.text} theme={theme} onChange={onText} onUndo={onUndo} onRedo={onRedo} />
    case 'eml': return <EmailEditor document={document} model={document.model as EmailModel} onOpenAttachment={onOpenAttachment} onDownloadAttachment={onDownloadAttachment} />
    case 'ics': return <CalendarEditor document={document} model={document.model as CalendarModel} onChange={(model, group) => onModel(model, group)} />
    case 'vcf': return <ContactsEditor document={document} model={document.model as ContactModel} onChange={(model, group) => onModel(model, group)} />
  }
}

function WelcomeScreen({ onOpen, onPaste, onCommand }: { onOpen: () => void; onPaste: () => void; onCommand: () => void }) {
  return <section className="welcome-screen" aria-label="시작 화면"><div className="welcome-card">
    <div className="welcome-icon"><img src={`${__APP_BASE__}icons/viewer.svg`} alt="" /></div><h1>파일을 열어 시작하세요</h1><p>텍스트 기반 파일을 브라우저 안에서 보고 편집할 수 있습니다.<br />파일은 이 기기에서 처리됩니다.</p>
    <div className="welcome-actions"><button className="primary-button large" onClick={onOpen}><FolderOpen size={15} /> 파일 열기</button><button className="secondary-button large" onClick={onPaste}><ClipboardPaste size={15} /> 붙여넣기</button></div>
    <button className="drop-hint" onClick={onOpen}><span className="drop-rule" />파일을 여기에 놓거나 <u>선택하세요</u><span className="drop-rule" /></button>
    <div className="supported-formats">{FORMATS.map((format) => <span key={format}><b className={`file-badge format-${format}`}>{format}</b>{labels[format]}</span>)}</div>
    <button className="welcome-command" onClick={onCommand}><kbd>⌘ K</kbd> 명령 메뉴 열기</button>
  </div></section>
}

function PasteDialog({ text, format, onTextChange, onFormatChange, onClose, onOpen }: { text: string; format: Format; onTextChange: (text: string) => void; onFormatChange: (format: Format) => void; onClose: () => void; onOpen: () => void }) {
  const dialog = useFocusTrap<HTMLElement>()
  return <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section ref={dialog} className="paste-dialog" role="dialog" aria-modal="true" aria-labelledby="paste-title">
    <header className="dialog-header"><div><h2 id="paste-title">클립보드에서 열기</h2><p>텍스트를 문서로 엽니다. 클립보드를 자동으로 읽지 않습니다.</p></div><button className="icon-button" aria-label="닫기" onClick={onClose}><X size={16} /></button></header>
    <label className="form-field"><span>파일 형식</span><select value={format} onChange={(event) => onFormatChange(event.target.value as Format)}>{FORMATS.map((item) => <option value={item} key={item}>{labels[item]} (.{item})</option>)}</select></label>
    <textarea autoFocus aria-label="붙여넣을 텍스트" value={text} onChange={(event) => onTextChange(event.target.value)} onPaste={(event) => { const pasted = event.clipboardData.getData('text/plain'); if (pasted) onTextChange(pasted) }} placeholder="여기에 텍스트를 붙여넣으세요." rows={13} />
    <div className="dialog-actions"><button className="secondary-button" onClick={onClose}>취소</button><button className="primary-button" disabled={!text} onClick={onOpen}><FilePlus2 size={14} /> 문서 열기</button></div>
  </section></div>
}
