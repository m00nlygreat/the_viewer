import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Check, ClipboardPaste, FilePlus2, FolderOpen, X
} from 'lucide-react'
import { CommandMenu, type CommandItem } from '../components/CommandMenu'
import { SettingsDialog } from '../components/SettingsDialog'
import { useFocusTrap } from '../components/useFocusTrap'
import { ViewerZoom } from '../components/ViewerZoom'
import { FeatureLoadBoundary } from '../components/FeatureLoadBoundary'
import { settleCodeEditors } from '../components/editorSettling'
import { clearDocumentResources, disposeDocumentResources } from './documentResources'
import { DocumentActionBar, DocumentHeader } from './DocumentHeader'
import { safeDisplayFileName } from './displayName'
import { WorkspaceSidebar } from './WorkspaceSidebar'
import { FolderPicker, type FolderPickerHandle } from '../platform/FolderPicker'
import { supportsDirectoryPicker, supportsFolderInput, listFolderChildren, resolveFolderMembership, type FolderSource } from '../platform/folderAccess'
import { FolderTransitionDialog } from './FolderTransitionDialog'
import { FolderAssetPreview } from './FolderAssetPreview'
import { UnsupportedFilePage } from './UnsupportedFilePage'
import { FolderTreeDrawer } from './FolderTreeDrawer'
import { useFolderWorkspace } from './useFolderWorkspace'
import { createDocumentSaveService } from './documentSave'
import { FolderResourceManager } from '../platform/folderResources'
import { folderDocumentKey, type FolderPath, type FolderWorkspace, type FolderEntry } from '../domain/workspace'
import { LocalReferenceState, type MarkdownReferenceContext, type MarkdownReferenceServices } from '../features/markdown/localReferenceState'
import { FORMAT_LABEL, FORMAT_MIME, FORMATS, type CalendarModel, type ContactModel, type CsvModel, type DocumentModel, type EmailModel, type Format, type ThemePreference, type ViewerDocument } from '../domain/types'
import { DocumentController } from '../domain/documentController'
import { buildExportSnapshot, canPersistRecovery, diagnosticsFromMessages, documentIsDirty, flushDocument, hasByteOrderMark, makeDocumentFromBytes, makeFileDocumentFromBytes } from '../domain/session'
import { parseWithWorker } from '../domain/workerClient'
import { hasFatalDiagnostics } from '../domain/parseDiagnostics'
import { isStructuredFormat, type StructuredFormat, type StructuredModel } from '../domain/structured/model'
import { outputStructured } from '../domain/structured/output'
import { clearAllData, clearDocuments, clearWorkspace, completeShareTicketFile, loadWorkspace, loadTheme, readSetting, readShareTicket, removeDocument, replaceWorkspace, saveDocument, writeSetting } from '../platform/storage'
import { DocumentWriteQueue } from '../platform/documentWriteQueue'
import { FilePicker, type FilePickerHandle } from '../platform/FilePicker'
import type { PickedFile } from '../platform/fileTypes'
import { downloadLocalFile, readClipboardText, readDroppedItems, receiveLaunchedFiles, saveLocalFile, shareLocalFile, supportsFileHandlePicker } from '../platform/browserFiles'
import { commitExtensionFile, parseRelayRoute, receiveExtensionFile, RelayTransferError, restoreLegacySnapshot, type ReceivedExtensionFile, type RelayRoute } from '../platform/pwa/extensionRelay'

const CsvEditor = lazy(() => import('../features/CsvEditor').then((module) => ({ default: module.CsvEditor })))
const MarkdownEditor = lazy(() => import('../features/MarkdownEditor').then((module) => ({ default: module.MarkdownEditor })))
const EmailEditor = lazy(() => import('../features/EmailEditor').then((module) => ({ default: module.EmailEditor })))
const CalendarEditor = lazy(() => import('../features/CalendarEditor').then((module) => ({ default: module.CalendarEditor })))
const ContactsEditor = lazy(() => import('../features/ContactsEditor').then((module) => ({ default: module.ContactsEditor })))
const StructuredDataEditor = lazy(() => import('../features/structured/StructuredDataEditor').then((module) => ({ default: module.StructuredDataEditor })))
const SourceEditor = lazy(() => import('../components/SourceEditor'))

interface Notice { id: number; tone: 'success' | 'error' | 'info'; message: string }
interface BeforeInstallPrompt extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
const labels = FORMAT_LABEL
const defaultStructuredOutputFormat = (document: ViewerDocument): StructuredFormat => isStructuredFormat(document.format) ? document.format : 'json'
type QueuedWorkspaceInput =
  | { kind: 'files'; files: PickedFile[]; format?: Format; origin?: { shareTicketId: string; shareFileIndex: number }; resolve: (result: { opened: ViewerDocument[]; errors: string[] }) => void }
  | { kind: 'relay'; route: RelayRoute }

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
  const [structuredFormats, setStructuredFormats] = useState<Record<string, StructuredFormat>>({})
  const [notices, setNotices] = useState<Notice[]>([])
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPrompt | null>(null)
  const [updateReady, setUpdateReady] = useState(false)
  const [offlineReady, setOfflineReady] = useState(false)
  const [showFolderDrawer, setShowFolderDrawer] = useState(false)
  const [relayRoute, setRelayRoute] = useState<RelayRoute | null>(() => parseRelayRoute(window.location.hash))
  const [relayError, setRelayError] = useState('')
  const inputRef = useRef<FilePickerHandle>(null)
  const folderInputRef = useRef<FolderPickerHandle>(null)
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
  const transitionLocked = useRef(false)
  const transitionPhaseRef = useRef<'idle' | 'settling' | 'confirming' | 'saving' | 'ready-to-pick' | 'picking' | 'committing'>('idle')
  const activeWorkspaceOperations = useRef(new Set<Promise<unknown>>())
  const queuedFileInputs = useRef<QueuedWorkspaceInput[]>([])
  const drainFileQueueRef = useRef<(() => void) | null>(null)
  const runRelayRef = useRef<((route: RelayRoute) => Promise<void>) | null>(null)
  const queuedRelayIds = useRef(new Set<string>())
  const folderWorkspaceRef = useRef<ReturnType<typeof useFolderWorkspace> | null>(null)
  const workspaceMetadata = useRef<{ folderId: string; generation: number; folder: FolderWorkspace; source: FolderSource | null } | null>(null)
  const folderResources = useRef(new FolderResourceManager())
  const folderDocumentListeners = useRef(new Map<string, Set<() => void>>())
  const markdownReferenceState = useRef(new LocalReferenceState())
  const noticeTimer = useRef(new Map<number, number>())
  const relayRuns = useRef(new Set<string>())
  const receivedRelayFiles = useRef(new Map<string, ReceivedExtensionFile>())
  const activeDocument = documents.find((document) => document.id === activeId) ?? null
  const resolvedTheme = theme === 'system' ? (systemLight ? 'light' : 'dark') : theme
  const exportsAnotherFormat = Boolean(activeDocument && activeDocument.mode === 'view' && isStructuredFormat(activeDocument.format) && (structuredFormats[activeDocument.id] ?? defaultStructuredOutputFormat(activeDocument)) !== activeDocument.format)
  const canSaveSource = Boolean(activeDocument?.sourceFileHandle || (activeDocument?.fileSource === 'file-url' && supportsFileHandlePicker()))
  const saveLabel: '저장' | '다운로드' = canSaveSource && !exportsAnotherFormat ? '저장' : '다운로드'

  const notify = useCallback((message: string, tone: Notice['tone'] = 'info') => {
    const id = Date.now() + Math.random()
    setNotices((items) => [...items.slice(-2), { id, tone, message }])
    const timer = window.setTimeout(() => {
      noticeTimer.current.delete(id)
      setNotices((items) => items.filter((item) => item.id !== id))
    }, 4200)
    noticeTimer.current.set(id, timer)
  }, [])

  const trackWorkspaceOperation = useCallback(<T,>(operation: Promise<T>): Promise<T> => {
    const tracked = operation.finally(() => activeWorkspaceOperations.current.delete(tracked))
    activeWorkspaceOperations.current.add(tracked)
    return tracked
  }, [])
  const settleWorkspaceOperations = useCallback(async () => {
    await settleCodeEditors()
    const activeElement = document.activeElement
    if (activeElement instanceof HTMLElement && activeElement !== document.body) activeElement.blur()
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    while (activeWorkspaceOperations.current.size) {
      await Promise.all([...activeWorkspaceOperations.current].map((operation) => operation.catch(() => undefined)))
    }
  }, [])

  const notifyFolderDocumentSubscribers = useCallback((updated: ViewerDocument) => {
    if (!updated.folderRef) return
    const listeners = folderDocumentListeners.current.get(folderDocumentKey(updated.folderRef.folderId, updated.folderRef.path))
    for (const listener of listeners ?? []) listener()
  }, [])

  const publishDocument = useCallback((updated: ViewerDocument) => {
    documentsRef.current = documentsRef.current.map((item) => item.id === updated.id ? updated : item)
    setDocuments((items) => items.map((item) => item.id === updated.id ? updated : item))
    notifyFolderDocumentSubscribers(updated)
  }, [notifyFolderDocumentSubscribers])

  const documentSaveService = useMemo(() => createDocumentSaveService({
    getDocument: (id) => documentsRef.current.find((item) => item.id === id) ?? null,
    getPendingSerialization: (id) => pendingSerializations.current.get(id),
    publishDocument,
    controller: documentController.current
  }), [publishDocument])

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
      const model = isStructuredFormat(latest.format) ? { ...(parsed.model as StructuredModel), loose: (latest.model as StructuredModel).loose } : parsed.model
      publishDocument({ ...latest, model, modelRevision: revision, parseState: 'ready', diagnostics: diagnosticsFromMessages(parsed.diagnostics), sourceError: undefined, isDirty: documentIsDirty({ ...latest, model }) })
    } catch (error) {
      const latest = documentsRef.current.find((item) => item.id === id)
      if (sourceRequestTokens.current.get(id) !== token || !latest || latest.revision !== revision) return
      const message = error instanceof Error ? error.message : '원본 문법을 해석하지 못했습니다.'
      publishDocument({ ...latest, parseState: 'error', diagnostics: [{ severity: 'error', message }], sourceError: message })
    }
  }, [publishDocument])

  const enqueueRecoverySave = useCallback((id: string): Promise<void> => recoveryWriteQueue.current.enqueue(id, async () => {
    if (transitionLocked.current) return
    let pending = pendingSerializations.current.get(id)
    while (pending) {
      await pending
      const next = pendingSerializations.current.get(id)
      pending = next && next !== pending ? next : undefined
    }
    const current = documentsRef.current.find((item) => item.id === id)
    if (!recoveryEnabledRef.current || closingDocumentIds.current.has(id) || !current || !canPersistRecovery(current)) return
    await saveDocument(current)
  }), [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [storedTheme, recover] = await Promise.all([loadTheme(), readSetting('recovery', true)])
        const restored = recover ? await loadWorkspace() : { documents: [], folder: null }
        const saved = restored.documents
        const folder = restored.folder?.folder ?? null
        let source: FolderSource | null = null
        let rootEntries: FolderEntry[] = []
        let rootError: string | undefined
        if (folder?.access === 'handle' && restored.folder?.rootHandle) {
          source = { kind: 'handle', root: restored.folder.rootHandle }
          try {
            const permission = await restored.folder.rootHandle.queryPermission?.({ mode: 'read' })
            if (permission === 'granted') rootEntries = await listFolderChildren(source, '', new AbortController().signal)
            else rootError = '폴더 새로고침을 눌러 현재 폴더를 선택하면 항목을 표시합니다.'
          } catch { rootError = '폴더 새로고침을 눌러 현재 폴더를 선택하면 항목을 표시합니다.' }
        } else if (folder?.access === 'input') {
          rootError = '폴더 새로고침을 눌러 현재 폴더를 선택하면 항목을 표시합니다.'
        }
        if (cancelled) return
        setTheme(storedTheme)
        setRecoveryEnabled(recover)
        recoveryEnabledRef.current = recover
        recoveryWasEnabled.current = recover
        documentsRef.current = saved
        recoveryObservedDocuments.current = new Map(saved.map((item) => [item.id, item]))
        setDocuments(saved)
        folderWorkspaceRef.current?.restoreWorkspace(folder, source, rootEntries, rootError)
        folderResources.current.setGeneration(folderWorkspaceRef.current?.generation ?? 0)
        const folderActive = folder?.activePath ? saved.find((item) => item.folderRef?.folderId === folder.id && item.folderRef.path === folder.activePath) : undefined
        const first = folderActive ?? saved[0]
        setActiveId(first?.id ?? '')
        if (folderActive) location.hash = `/file/${folderActive.id}`
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
    if (transitionLocked.current) return
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
        if (transitionLocked.current) return
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
    if (loaded && !relayRoute && documents.length === 0 && !folderWorkspaceRef.current?.folder && !sessionStorage.getItem('viewer-command-shown')) {
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

  const processOpenFiles = useCallback(async (files: PickedFile[], forcedFormat?: Format, origin?: { shareTicketId: string; shareFileIndex: number }): Promise<{ opened: ViewerDocument[]; errors: string[] }> => {
    if (resettingData.current) return { opened: [], errors: ['저장 데이터 정리 중에는 파일을 열 수 없습니다.'] }
    const opened: ViewerDocument[] = []
    const errors: string[] = []
    let first: ViewerDocument | null = null
    const deferRemaining = (startIndex: number): Promise<{ opened: ViewerDocument[]; errors: string[] }> => new Promise((resolve) => {
      queuedFileInputs.current.push({ kind: 'files', files: files.slice(startIndex), format: forcedFormat, origin, resolve: (result) => resolve({ opened: [...opened, ...result.opened], errors: [...errors, ...result.errors] }) })
    })
    for (let index = 0; index < files.length; index += 1) {
      if (transitionLocked.current) return deferRemaining(index)
      const file = files[index]!
      try {
        const existingShared = origin && documentsRef.current.find((item) => item.shareTicketId === origin.shareTicketId && item.shareFileIndex === origin.shareFileIndex)
        if (existingShared) {
          opened.push(existingShared)
          if (!first) first = existingShared
          continue
        }
        let folderRef: ViewerDocument['folderRef']
        const folderState = folderWorkspaceRef.current
        if (file.fileHandle && folderState?.folder && folderState.source?.kind === 'handle') {
          const path = await resolveFolderMembership(folderState.source, file.fileHandle).catch(() => null)
          if (transitionLocked.current) return deferRemaining(index)
          if (path !== null) {
            folderRef = { folderId: folderState.folder.id, path }
            const existing = documentsRef.current.find((item) => item.folderRef?.folderId === folderRef!.folderId && item.folderRef.path === path)
            if (existing) {
              opened.push(existing)
              if (!first) first = existing
              continue
            }
          }
        }
        const document = forcedFormat
          ? await makeDocumentFromBytes(file.name, file.type, file.bytes)
          : await makeFileDocumentFromBytes(file.name, file.type, file.bytes)
        if (transitionLocked.current) return deferRemaining(index)
        if (forcedFormat && document.format !== forcedFormat) throw new Error(`선택한 형식 ${forcedFormat.toUpperCase()}과 파일 내용이 다릅니다.`)
        const openedDocument: ViewerDocument = {
          ...document,
          ...(file.fileHandle ? { sourceFileHandle: file.fileHandle } : {}),
          ...(folderRef ? { folderRef } : {}),
          ...(origin ? { ...origin } : {})
        }
        documentsRef.current = [openedDocument, ...documentsRef.current.filter((item) => item.id !== openedDocument.id)]
        setDocuments((items) => [openedDocument, ...items.filter((item) => item.id !== openedDocument.id)])
        notifyFolderDocumentSubscribers(openedDocument)
        opened.push(openedDocument)
        if (!first) first = openedDocument
      } catch (error) {
        const message = `${file.name}: ${error instanceof Error ? error.message : '파일을 열지 못했습니다.'}`
        errors.push(message)
        notify(message, 'error')
      }
    }
    if (first) {
      setActiveId(first.id)
      folderWorkspaceRef.current?.selectDocumentPath(first.folderRef?.path ?? null)
      setShowCommand(false)
      setTimeout(() => { location.hash = `/file/${first!.id}` }, 0)
    }
    return { opened, errors }
  }, [notify, notifyFolderDocumentSubscribers])

  const openFiles = useCallback((files: PickedFile[], forcedFormat?: Format, origin?: { shareTicketId: string; shareFileIndex: number }): Promise<{ opened: ViewerDocument[]; errors: string[] }> => {
    if (transitionLocked.current) return new Promise((resolve) => queuedFileInputs.current.push({ kind: 'files', files, format: forcedFormat, origin, resolve }))
    return processOpenFiles(files, forcedFormat, origin)
  }, [processOpenFiles])

  const queueRelayRoute = useCallback((route: RelayRoute) => {
    if (queuedRelayIds.current.has(route.ticketId)) return
    queuedRelayIds.current.add(route.ticketId)
    queuedFileInputs.current.push({ kind: 'relay', route })
  }, [])

  const drainFileQueue = useCallback(() => {
    if (transitionLocked.current) return
    void (async () => {
      while (!transitionLocked.current && queuedFileInputs.current.length) {
        const item = queuedFileInputs.current.shift()!
        if (item.kind === 'files') {
          const result = await processOpenFiles(item.files, item.format, item.origin)
          item.resolve(result)
        } else {
          queuedRelayIds.current.delete(item.route.ticketId)
          await runRelayRef.current?.(item.route)
        }
      }
    })()
  }, [processOpenFiles])
  drainFileQueueRef.current = drainFileQueue

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

  const runRelay = useCallback((route: RelayRoute): Promise<void> => {
    if (transitionLocked.current) { queueRelayRoute(route); return Promise.resolve() }
    if (relayRuns.current.has(route.ticketId)) return Promise.resolve()
    relayRuns.current.add(route.ticketId)
    setRelayError('')
    const operation = (async () => {
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
            received = await receiveExtensionFile({ extensionId: route.extensionId, ticketId: route.ticketId })
            receivedRelayFiles.current.set(route.ticketId, received)
            if (transitionLocked.current) { queueRelayRoute(route); return }
          }
          if (transitionLocked.current) { queueRelayRoute(route); return }
          if (received.kind === 'workspace-snapshot') {
            imported = { ...restoreLegacySnapshot(received.file.bytes), relayTicketId: route.ticketId }
          } else {
            const document = await makeDocumentFromBytes(received.file.name, received.file.type, received.file.bytes)
            if (transitionLocked.current) { queueRelayRoute(route); return }
            if (document.format !== received.kind) throw new Error('전달된 파일 형식 정보와 실제 파일 내용이 다릅니다.')
            imported = { ...document, id: route.ticketId, relayTicketId: route.ticketId, ...(received.source === 'file-url' ? { fileSource: 'file-url' as const } : {}) }
          }
          if (transitionLocked.current) { queueRelayRoute(route); return }
          if (recoveryEnabled) await recoveryWriteQueue.current.enqueue(imported.id, () => saveDocument(imported!))
          if (transitionLocked.current) { queueRelayRoute(route); return }
          documentsRef.current = [imported, ...documentsRef.current.filter((item) => item.id !== imported!.id)]
          setDocuments((items) => [imported!, ...items.filter((item) => item.id !== imported!.id)])
        }
        setActiveId(imported.id)
        folderWorkspaceRef.current?.selectDocumentPath(imported.folderRef?.path ?? null)
        await commitExtensionFile({ extensionId: route.extensionId, ticketId: route.ticketId })
        const current = documentsRef.current.find((item) => item.id === imported?.id)
        if (current) finish(current)
        else { receivedRelayFiles.current.delete(route.ticketId); setRelayRoute(null); setRelayError('') }
      } catch (error) {
        if (imported && error instanceof RelayTransferError && (error.code === 'INVALID_TICKET' || error.code === 'EXPIRED')) {
          finish(imported)
        } else {
          setRelayError(error instanceof Error ? error.message : '파일 전달에 실패했습니다.')
        }
      }
    })()
    return trackWorkspaceOperation(operation).finally(() => relayRuns.current.delete(route.ticketId))
  }, [queueRelayRoute, recoveryEnabled, trackWorkspaceOperation])
  runRelayRef.current = runRelay

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
    if (transitionLocked.current || resettingData.current) return
    inputRef.current?.open(format)
  }, [])

  const changeModel = useCallback((id: string, baseRevision: number, model: DocumentModel, group: 'typing' | 'command' = 'command') => {
    if (resettingData.current || (transitionLocked.current && transitionPhaseRef.current !== 'settling' && transitionPhaseRef.current !== 'picking')) return
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
    if (resettingData.current || (transitionLocked.current && transitionPhaseRef.current !== 'settling' && transitionPhaseRef.current !== 'picking')) return
    const current = documentsRef.current.find((item) => item.id === id)
    if (!current || current.text === nextText) return
    sourceRequestTokens.current.set(id, (sourceRequestTokens.current.get(id) ?? 0) + 1)
    publishDocument(documentController.current.applySourceText(current, nextText, group))
  }, [publishDocument])

  const setMode = useCallback((mode: ViewerDocument['mode']) => {
    if (transitionLocked.current) return
    const current = documentsRef.current.find((item) => item.id === activeId)
    if (!current || current.contentKind || current.mode === mode) return
    if (mode === 'source') {
      if (isStructuredFormat(current.format)) {
        void (pendingSerializations.current.get(current.id) ?? Promise.resolve()).then(() => {
          const latest = documentsRef.current.find((item) => item.id === current.id)
          if (latest) publishDocument(documentController.current.changeMode(latest, 'source'))
        })
        return
      }
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
    if (transitionLocked.current) return
    const current = documentsRef.current.find((item) => item.id === activeId)
    if (!current) return
    const next = documentController.current.restoreHistory(current, redo ? 'redo' : 'undo')
    if (!next) return
    sourceRequestTokens.current.set(current.id, (sourceRequestTokens.current.get(current.id) ?? 0) + 1)
    publishDocument(next)
    if (next.parseState === 'pending') void parseNow(current.id, next.revision)
  }, [activeId, parseNow, publishDocument])

  const createBlank = useCallback((format: Format) => {
    if (resettingData.current || transitionLocked.current) return
    const operation = (async () => {
      const templates: Record<Format, string> = {
        eml: 'Subject: \r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n',
        csv: '', md: '',
        ics: 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//The Viewer//EN\r\nCALSCALE:GREGORIAN\r\nEND:VCALENDAR\r\n',
        vcf: 'BEGIN:VCARD\r\nVERSION:4.0\r\nFN:\r\nN:;;;;\r\nEND:VCARD\r\n',
        json: '{}', yaml: '{}\n', toml: ''
      }
      const bytes = new TextEncoder().encode(templates[format])
      try {
        const document = await makeDocumentFromBytes(`Untitled.${format}`, FORMAT_MIME[format], bytes)
        document.mode = 'view'
        documentsRef.current = [document, ...documentsRef.current.filter((item) => item.id !== document.id)]
        setDocuments((items) => [document, ...items])
        setActiveId(document.id)
        folderWorkspaceRef.current?.selectDocumentPath(null)
        setShowCommand(false)
        setTimeout(() => { location.hash = `/file/${document.id}` }, 0)
      } catch (error) { notify(error instanceof Error ? error.message : '새 파일을 만들지 못했습니다.', 'error') }
    })()
    return trackWorkspaceOperation(operation)
  }, [notify, trackWorkspaceOperation])

  const saveCurrent = useCallback(() => {
    if (!activeDocument || activeDocument.contentKind === 'unsupported' || transitionLocked.current) return
    const operation = (async () => {
    const id = activeDocument.id
    const selectedFormat = structuredFormats[id] ?? defaultStructuredOutputFormat(activeDocument)
    if (activeDocument.mode === 'view' && isStructuredFormat(activeDocument.format) && selectedFormat !== activeDocument.format) {
      const current = documentsRef.current.find((item) => item.id === id)
      if (!current || current.parseState !== 'ready' || current.modelRevision !== current.revision) { notify('원본을 해석한 뒤 내보낼 수 있습니다.', 'error'); return }
      const output = outputStructured(current.model as StructuredModel, selectedFormat)
      if (output.text === null) { notify(output.issues[0] ?? '선택한 형식으로 내보낼 수 없습니다.', 'error'); return }
      const name = current.name.replace(/\.[^.]+$/, '') + `.${selectedFormat}`
      try {
        const status = await saveLocalFile(name, selectedFormat, new TextEncoder().encode(output.text))
        if (status !== 'cancelled') notify(status === 'saved' ? '선택한 형식의 파일을 저장했습니다.' : '선택한 형식의 내려받기를 시작했습니다.', 'success')
      } catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) notify(error instanceof Error ? `내보내기 실패: ${error.message}` : '내보내기 실패', 'error') }
      return
    }
    try {
      let result = await documentSaveService.saveDocumentById(id)
      if (result.status === 'needs-user-action') {
        const action = result.action
        result = await documentSaveService.continueDocumentSave(result.plan, action)
        if (result.status === 'needs-user-action') {
          notify(result.action === 'grant-write'
            ? '원본 파일을 연결했습니다. 저장을 한 번 더 눌러 쓰기 권한을 허용하세요.'
            : '저장에 필요한 사용자 동작을 완료하지 못했습니다.', 'info')
          return
        }
      }
      if (result.status === 'download-started') {
        const confirmed = await documentSaveService.confirmDownload(result.plan)
        if (confirmed.status === 'saved') notify('내려받기를 시작했습니다.', 'success')
        else if (confirmed.status === 'failed') notify(confirmed.message, 'error')
        return
      }
      if (result.status === 'saved') { notify('파일을 저장했습니다.', 'success'); return }
      if (result.status === 'failed') { notify(result.message, 'error'); return }
      if (result.status === 'cancelled') return
      notify('저장 작업을 완료하지 못했습니다.', 'error')
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) notify(error instanceof Error ? `파일 저장 실패: ${error.message}` : '파일을 저장하지 못했습니다.', 'error')
    }
    })()
    return trackWorkspaceOperation(operation)
  }, [activeDocument, documentSaveService, notify, structuredFormats, trackWorkspaceOperation])

  const revertCurrent = useCallback(() => {
    if (!activeDocument || transitionLocked.current || !window.confirm('마지막 저장·내보내기 기준으로 복원할까요? 현재 편집 내용은 사라집니다.')) return
    const operation = (async () => {
    const item = activeDocument
    try {
      const parsed = await parseWithWorker(item.name, item.mimeType, new Uint8Array(item.savedBytes), item.format, { documentId: item.id, revision: item.revision, csvHasHeader: item.format === 'csv' ? (item.model as CsvModel).hasHeader : undefined })
      if (documentsRef.current.find((document) => document.id === item.id)?.revision !== item.revision) return
      if (hasFatalDiagnostics(parsed.format, parsed.model, parsed.diagnostics)) throw new Error(parsed.diagnostics[0] ?? '저장된 원문을 해석하지 못했습니다.')
      const revision = item.revision + 1
      publishDocument({ ...item, text: parsed.text, model: parsed.model, savedText: parsed.text, bom: hasByteOrderMark(item.savedBytes), sourceError: undefined, structuredDraft: false, isDirty: false, revision, modelRevision: revision, textRevision: revision, parseState: 'ready', diagnostics: diagnosticsFromMessages(parsed.diagnostics), encoding: parsed.encoding })
      documentController.current.clearHistory(item.id)
      notify('마지막 저장본으로 복원했습니다.', 'success')
    } catch (error) {
      const message = error instanceof Error ? error.message : '원본 파일을 해석하지 못했습니다.'
      if (documentsRef.current.find((document) => document.id === item.id)?.revision !== item.revision) return
      const revision = item.revision + 1
      const restored: ViewerDocument = { ...item, text: item.savedText, bom: hasByteOrderMark(item.savedBytes), textRevision: revision, revision, structuredDraft: false, parseState: 'error', diagnostics: [{ severity: 'error', message }], sourceError: message }
      publishDocument({ ...restored, isDirty: documentIsDirty(restored) })
      documentController.current.clearHistory(item.id)
      notify('저장된 원문으로 복원했습니다. 구조 편집에는 유효한 문서가 필요합니다.', 'info')
    }
    })()
    return trackWorkspaceOperation(operation)
  }, [activeDocument, notify, publishDocument, trackWorkspaceOperation])

  const closeDocument = useCallback((id: string) => {
    if (transitionLocked.current) return
    const operation = (async () => {
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
      markdownReferenceState.current.clearOwner(id)
      documentController.current.clearHistory(id)
      sourceRequestTokens.current.delete(id)
      const scheduled = sourceParseTimers.current.get(id)
      if (scheduled) { window.clearTimeout(scheduled.timer); sourceParseTimers.current.delete(id) }
      pendingSerializations.current.delete(id)
      window.setTimeout(() => disposeDocumentResources(id), 0)
      if (activeId === id) {
        const next = documentsRef.current[0]
        setActiveId(next?.id ?? '')
        folderWorkspaceRef.current?.selectDocumentPath(next?.folderRef?.path ?? null)
        if (next) location.hash = `/file/${next.id}`
        else location.hash = '/'
      }
    })()
    return trackWorkspaceOperation(operation)
  }, [activeId, notify, trackWorkspaceOperation])

  const openAttachment = useCallback((index: number) => {
    if (resettingData.current || transitionLocked.current) return
    if (!activeDocument || activeDocument.format !== 'eml') return
    const attachment = (activeDocument.model as EmailModel).attachments[index]
    if (!attachment) return
    const operation = (async () => {
      try {
        const child = await makeFileDocumentFromBytes(attachment.filename, attachment.mimeType, attachment.content, activeDocument.id)
        documentsRef.current = [child, ...documentsRef.current.filter((item) => item.id !== child.id)]
        setDocuments((items) => [child, ...items])
        setActiveId(child.id)
        folderWorkspaceRef.current?.selectDocumentPath(null)
        location.hash = `/file/${child.id}`
      } catch (error) { notify(error instanceof Error ? error.message : '첨부 파일을 열지 못했습니다.', 'error') }
    })()
    return trackWorkspaceOperation(operation)
  }, [activeDocument, notify, trackWorkspaceOperation])

  const downloadAttachment = useCallback((index: number) => {
    if (transitionLocked.current) return
    if (!activeDocument || activeDocument.format !== 'eml') return
    const attachment = (activeDocument.model as EmailModel).attachments[index]
    if (!attachment) return
    downloadLocalFile(attachment.filename || 'attachment.bin', attachment.mimeType, attachment.content)
  }, [activeDocument])

  const handlePaste = useCallback(async () => {
    if (transitionLocked.current) return
    try {
      const text = await readClipboardText()
      if (!text) { setShowPaste(true); return }
      setPasteText(text)
      setShowPaste(true)
    } catch { setShowPaste(true) }
  }, [])

  const createFromPaste = useCallback(async () => {
    if (transitionLocked.current) return
    const name = `Clipboard.${pasteFormat}`
    await openFiles([{ name, type: FORMAT_MIME[pasteFormat], bytes: new TextEncoder().encode(pasteText) }], pasteFormat)
    setShowPaste(false)
    setPasteText('')
  }, [openFiles, pasteText, pasteFormat])

  const changeTheme = useCallback((value: ThemePreference) => {
    if (transitionLocked.current) return
    setTheme(value)
    void writeSetting('theme', value).catch(() => notify('테마 설정을 이 기기에 저장하지 못했습니다.', 'error'))
  }, [notify])
  const changeRecovery = useCallback((enabled: boolean) => {
    if (transitionLocked.current) return
    const operation = (async () => {
      const wasEnabled = recoveryEnabledRef.current
      try {
        if (!enabled) {
          recoveryEnabledRef.current = false
          for (const timer of recoveryTimers.current.values()) window.clearTimeout(timer)
          recoveryTimers.current.clear()
          await recoveryWriteQueue.current.flush()
          await clearDocuments()
          await clearWorkspace()
        }
        await writeSetting('recovery', enabled)
        recoveryEnabledRef.current = enabled
        setRecoveryEnabled(enabled)
      } catch (error) {
        recoveryEnabledRef.current = wasEnabled
        notify(error instanceof Error ? `복구 설정을 변경하지 못했습니다: ${error.message}` : '복구 설정을 변경하지 못했습니다.', 'error')
      }
    })()
    return trackWorkspaceOperation(operation)
  }, [notify, trackWorkspaceOperation])
  const clearData = useCallback(async () => {
    if (resettingData.current || transitionLocked.current) return
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
    folderWorkspaceRef.current?.restoreWorkspace(null, null)
    markdownReferenceState.current.clear()
    workspaceMetadata.current = null
    setShowFolderDrawer(false)
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
    if (transitionLocked.current) return
    if (!activeDocument || activeDocument.contentKind === 'unsupported' || !navigator.share) { notify('이 브라우저에서는 시스템 공유를 사용할 수 없습니다.', 'info'); return }
    try {
      const item = await flushDocument(activeDocument.id, () => documentsRef.current.find((document) => document.id === activeDocument.id) ?? null, () => pendingSerializations.current.get(activeDocument.id))
      const payload = buildExportSnapshot(item.id, item)
      await shareLocalFile(item.name, item.format, payload.bytes, item.contentKind === 'plain-text' ? 'text/plain' : undefined)
      notify('공유를 시작했습니다.', 'success')
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) notify('파일을 공유하지 못했습니다.', 'error')
    }
  }, [activeDocument, notify])

  const persistWorkspaceMetadata = useCallback((folder: FolderWorkspace, source: FolderSource | null, generation: number) => {
    workspaceMetadata.current = { folderId: folder.id, generation, folder, source }
    void recoveryWriteQueue.current.enqueue('workspace', async () => {
      const latest = workspaceMetadata.current
      if (!latest || latest.folderId !== folder.id || latest.generation !== generation) return
      if (!recoveryEnabledRef.current) { await clearWorkspace(); return }
      await writeSetting('workspace', { schemaVersion: 1, folder: latest.folder, ...(latest.source?.kind === 'handle' ? { rootHandle: latest.source.root } : {}) })
    }).catch((error: unknown) => notify(error instanceof Error ? `폴더 상태를 저장하지 못했습니다: ${error.message}` : '폴더 상태를 저장하지 못했습니다.', 'error'))
  }, [notify])

  const commitWorkspaceTransition = useCallback(async (folder: FolderWorkspace | null, source: FolderSource | null) => {
    if (resettingData.current) throw new Error('저장 데이터 정리 중입니다.')
    for (const timer of recoveryTimers.current.values()) window.clearTimeout(timer)
    recoveryTimers.current.clear()
    let pending = [...pendingSerializations.current.values()]
    while (pending.length) {
      await Promise.all(pending)
      const next = [...pendingSerializations.current.values()]
      if (next.length === 0 || next.every((item) => pending.includes(item))) break
      pending = next
    }
    await recoveryWriteQueue.current.flush()
    const persistedFolder = folder ? { schemaVersion: 1 as const, folder, ...(source?.kind === 'handle' ? { rootHandle: source.root } : {}) } : null
    await replaceWorkspace(persistedFolder, recoveryEnabledRef.current)

    const oldIds = documentsRef.current.map((item) => item.id)
    documentsRef.current = []
    setDocuments([])
    setActiveId('')
    setStructuredFormats({})
    setShowCommand(false)
    for (const timer of recoveryTimers.current.values()) window.clearTimeout(timer)
    recoveryTimers.current.clear()
    for (const scheduled of sourceParseTimers.current.values()) window.clearTimeout(scheduled.timer)
    sourceParseTimers.current.clear()
    sourceRequestTokens.current.clear()
    pendingSerializations.current.clear()
    documentController.current.clearHistory()
    recoveryObservedDocuments.current.clear()
    recoveryWasEnabled.current = recoveryEnabledRef.current
    markdownReferenceState.current.clear()
    workspaceMetadata.current = folder ? { folderId: folder.id, generation: (folderWorkspaceRef.current?.generation ?? 0) + 1, folder, source } : null
    history.replaceState(null, '', `${location.pathname}${location.search}#/`)
    window.setTimeout(() => clearDocumentResources(oldIds), 0)
  }, [])

  const handleTransitionLock = useCallback((locked: boolean) => {
    transitionLocked.current = locked
    if (locked) {
      for (const timer of recoveryTimers.current.values()) window.clearTimeout(timer)
      recoveryTimers.current.clear()
      return
    }
    if (!resettingData.current) {
      recoveryObservedDocuments.current.clear()
      setDocuments([...documentsRef.current])
    }
    window.setTimeout(() => {
      drainFileQueueRef.current?.()
    }, 0)
  }, [])

  const addFolderDocument = useCallback((document: ViewerDocument) => {
    if (transitionLocked.current) return
    documentsRef.current = [document, ...documentsRef.current.filter((item) => item.id !== document.id)]
    setDocuments((items) => [document, ...items.filter((item) => item.id !== document.id)])
    notifyFolderDocumentSubscribers(document)
    setActiveId(document.id)
    setShowCommand(false)
    history.replaceState(null, '', `#/file/${document.id}`)
  }, [notifyFolderDocumentSubscribers])

  const selectFolderDocument = useCallback((id: string) => {
    if (transitionLocked.current) return
    setActiveId(id)
    setShowCommand(false)
    if (id) history.replaceState(null, '', `#/file/${id}`)
    else history.replaceState(null, '', '#/')
  }, [])

  const folderWorkspace = useFolderWorkspace({
    getDocuments: () => documentsRef.current,
    getPendingSerializations: () => pendingSerializations.current,
    saveService: documentSaveService,
    onCommit: commitWorkspaceTransition,
    onDocumentOpen: addFolderDocument,
    onDocumentSelect: selectFolderDocument,
    onAssetSelect: (path) => { if (path) { setActiveId(''); setShowCommand(false); history.replaceState(null, '', '#/') } },
    onError: (message) => notify(message, 'error'),
    onMetadataChange: persistWorkspaceMetadata,
    onGenerationChange: (generation) => folderResources.current.setGeneration(generation),
    onTransitionLock: handleTransitionLock,
    onTransitionPhase: (phase) => { transitionPhaseRef.current = phase },
    settleExternalWork: settleWorkspaceOperations
  })
  folderWorkspaceRef.current = folderWorkspace

  const markdownReferenceServices = useMemo<MarkdownReferenceServices>(() => ({
    resolveReference: (ownerPath, ownerText, reference, syntax, generation, signal) => {
      const current = folderWorkspaceRef.current
      if (!current) return Promise.resolve({ status: 'error', kind: 'missing', message: '폴더 새로고침으로 접근을 복구해야 로컬 참조를 열 수 있습니다.' })
      return current.resolveReference(ownerPath, ownerText, reference, syntax, generation, signal)
    },
    acquireImage: (path, generation, signal) => {
      const current = folderWorkspaceRef.current
      if (!current?.source || current.generation !== generation) return Promise.reject(new DOMException('폴더 이미지 자원이 만료되었습니다.', 'AbortError'))
      return folderResources.current.acquire(current.source, generation, path, signal)
    },
    openFile: (path) => { void folderWorkspaceRef.current?.openPath(path) },
    downloadFile: (path) => { void folderWorkspaceRef.current?.downloadPath(path) },
    subscribeDocument: (folderId, path, listener) => {
      const key = folderDocumentKey(folderId, path)
      const listeners = folderDocumentListeners.current.get(key) ?? new Set<() => void>()
      listeners.add(listener)
      folderDocumentListeners.current.set(key, listeners)
      return () => {
        listeners.delete(listener)
        if (!listeners.size) folderDocumentListeners.current.delete(key)
      }
    }
  }), [])

  const openFolderPicker = useCallback(() => {
    if (transitionLocked.current || resettingData.current) return
    folderWorkspaceRef.current?.beginPicking()
    folderInputRef.current?.open()
  }, [])
  const closeFolderWorkspace = useCallback(() => {
    if (transitionLocked.current || resettingData.current) return
    folderWorkspaceRef.current?.closeFolder()
  }, [])
  const selectFolderForRefresh = useCallback(() => {
    if (transitionLocked.current || resettingData.current) return
    folderWorkspaceRef.current?.beginReconnect()
    folderInputRef.current?.open()
  }, [])
  const refreshFolder = useCallback((path: FolderPath) => {
    const current = folderWorkspaceRef.current
    const folder = current?.folder
    const source = current?.source
    if (!folder || folder.access === 'input' || !source) { selectFolderForRefresh(); return }
    if (source.kind !== 'handle' || !source.root.requestPermission) { current.refreshFolder(path); return }
    const folderId = folder.id
    const generation = current.generation
    void source.root.requestPermission({ mode: 'read' }).then((permission) => {
      const latest = folderWorkspaceRef.current
      if (!latest || latest.folder?.id !== folderId || latest.generation !== generation || latest.source !== source || transitionLocked.current) return
      if (permission !== 'granted') { notify('폴더 읽기 권한이 없습니다. 폴더 열기에서 현재 폴더를 선택하세요.', 'error'); return }
      latest.refreshFolder(path)
    }).catch((error: unknown) => notify(error instanceof Error ? error.message : '폴더를 새로고침하지 못했습니다.', 'error'))
  }, [notify, selectFolderForRefresh])

  const folderTreeProps = folderWorkspace.folder ? {
    entriesByPath: folderWorkspace.entriesByPath,
    loadingPaths: folderWorkspace.loadingPaths,
    errorsByPath: folderWorkspace.errorsByPath,
    activePath: folderWorkspace.activePath,
    dirtyPaths: folderWorkspace.dirtyPaths,
    openPaths: new Set(documents.filter((item) => item.folderRef?.folderId === folderWorkspace.folder!.id).map((item) => item.folderRef!.path)),
    onToggleDirectory: folderWorkspace.toggleDirectory,
    onOpenPath: (path: FolderPath) => { void folderWorkspace.openPath(path) },
    onRefresh: refreshFolder
  } : undefined

  const switchTab = useCallback((id: string) => {
    if (transitionLocked.current) return
    const selected = documentsRef.current.find((item) => item.id === id)
    folderWorkspaceRef.current?.selectDocumentPath(selected?.folderRef?.path ?? null)
    setActiveId(id)
    location.hash = `/file/${id}`
  }, [])

  const commands = useMemo<CommandItem[]>(() => [
    ...documents.map((item) => ({ id: `switch-${item.id}`, title: `열린 파일 · ${safeDisplayFileName(item.name)}`, detail: `${item.contentKind === 'plain-text' ? '일반 텍스트' : item.contentKind === 'unsupported' ? '지원하지 않는 파일' : labels[item.format]}${item.isDirty ? ' · 수정됨' : ''}`, section: '열린 파일', icon: 'open' as const, run: () => switchTab(item.id) })),
    { id: 'open', title: '파일 열기', detail: '모든 파일을 열어 형식과 텍스트 여부를 판별합니다.', section: '파일', icon: 'open', run: () => pickFiles() },
    { id: 'open-folder', title: '폴더 열기', detail: '폴더를 선택한 뒤 변경 사항을 확인합니다.', section: '폴더', icon: 'folder', run: openFolderPicker },
    ...(folderWorkspace.folder ? [
      { id: 'close-folder', title: '폴더 닫기', detail: folderWorkspace.folder.name, section: '폴더', icon: 'open' as const, run: closeFolderWorkspace },
      { id: 'refresh-folder', title: '폴더 새로고침', detail: folderWorkspace.folder.name, section: '폴더', icon: 'refresh' as const, run: () => refreshFolder('') },
      { id: 'browse-folder', title: '폴더 탐색', detail: '폴더 트리를 엽니다.', section: '폴더', icon: 'open' as const, run: () => { if (window.matchMedia('(max-width: 760px)').matches) setShowFolderDrawer(true); else setSidebarCollapsed(false) } }
    ] : []),
    ...FORMATS.map((format) => ({ id: `new-${format}`, title: `새 ${labels[format]} 만들기`, detail: `Untitled.${format}`, section: '새 파일', icon: 'new' as const, run: () => { void createBlank(format) } })),
    ...(activeDocument && activeDocument.contentKind !== 'unsupported' ? [{ id: 'revert', title: '처음 연 파일로 되돌리기', detail: activeDocument.name, section: '문서', icon: 'new' as const, run: () => { void revertCurrent() } }] : []),
    { id: 'paste', title: '클립보드에서 열기', detail: '붙여넣은 텍스트를 새 문서로 엽니다.', section: '입력', icon: 'paste', run: () => { void handlePaste() } },
    { id: 'settings', title: '설정', detail: '테마, 로컬 복구와 앱 정보', section: '앱', icon: 'settings', run: () => setShowSettings(true) },
    { id: 'theme', title: '테마 전환', detail: '시스템 · 라이트 · 다크', section: '앱', icon: 'theme', run: () => changeTheme(theme === 'dark' ? 'light' : 'dark') }
  ], [documents, pickFiles, openFolderPicker, folderWorkspace.folder, closeFolderWorkspace, refreshFolder, createBlank, handlePaste, changeTheme, theme, activeDocument, revertCurrent, switchTab])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (transitionLocked.current) return
      const target = event.target as HTMLElement | null
      const editingText = Boolean(target?.closest('input, textarea, select, [contenteditable="true"], .cm-content'))
      const command = event.metaKey || event.ctrlKey
      if (editingText && target?.closest('.structured-editor') && command && ['z', 'y'].includes(event.key.toLowerCase())) return
      if (command && event.key.toLowerCase() === 'k') { event.preventDefault(); setShowCommand((open) => !open); return }
      if (command && event.key.toLowerCase() === 'o') { event.preventDefault(); pickFiles(); return }
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

  useEffect(() => {
    if (!activeId) return
    const begin = () => documentController.current.beginContinuousGroup(activeId)
    const end = () => documentController.current.endContinuousGroup(activeId)
    window.addEventListener('structured:group-start', begin)
    window.addEventListener('structured:group-end', end)
    return () => { window.removeEventListener('structured:group-start', begin); window.removeEventListener('structured:group-end', end); end() }
  }, [activeId])

  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    void readDroppedItems(event.dataTransfer.items).then(async ({ files, folders }) => {
      if (folders.length) {
        if (folders.length !== 1 || files.length) {
          notify('폴더는 한 번에 하나씩 열 수 있습니다. 폴더와 파일을 함께 놓을 수 없습니다.', 'error')
          return
        }
        if (transitionLocked.current || resettingData.current) return
        const workspace = folderWorkspaceRef.current
        if (!workspace) return
        workspace.beginPicking()
        await workspace.acceptPickedFolder(folders[0]!)
        return
      }
      if (files.length) await openFiles(files)
    }).catch((error: unknown) => notify(error instanceof Error ? error.message : '놓은 항목을 읽지 못했습니다.', 'error'))
  }, [openFiles, notify])
  const renderActiveDocument = (document: ViewerDocument) => renderDocument(
    document,
    (model, group) => changeModel(document.id, isStructuredFormat(document.format) ? documentsRef.current.find((item) => item.id === document.id)?.revision ?? document.revision : document.revision, model, group),
    (text, group) => applySourceText(document.id, text, group),
    openAttachment, downloadAttachment, resolvedTheme,
    () => undo(), () => undo(true), structuredFormats[document.id] ?? defaultStructuredOutputFormat(document),
    (format) => setStructuredFormats((current) => ({ ...current, [document.id]: format })),
    document.folderRef ? {
      services: markdownReferenceServices,
      referenceState: markdownReferenceState.current,
      instanceId: document.id,
      folderId: document.folderRef.folderId,
      generation: folderWorkspace.generation,
      ownerPath: document.folderRef.path,
      ancestors: [{ folderId: document.folderRef.folderId, path: document.folderRef.path, fragment: '' }],
      depth: 0
    } : undefined
  )

  const folderPickingAvailable = supportsDirectoryPicker() || supportsFolderInput()
  const drawerTree = folderTreeProps ? {
    ...folderTreeProps,
    onOpenPath: (path: FolderPath) => { void folderWorkspace.openPath(path); setShowFolderDrawer(false) }
  } : undefined

  return <div className="app-shell" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
    <FilePicker ref={inputRef} onFiles={(files, format) => { void openFiles(files, format) }} onError={notify} />
    <FolderPicker ref={folderInputRef} onFolder={(picked) => { void folderWorkspace.acceptPickedFolder(picked) }} onCancel={() => { if (folderWorkspace.phase === 'picking') folderWorkspace.cancelTransition(); else folderWorkspace.cancelReconnect() }} onError={(message) => { if (folderWorkspace.phase === 'picking') folderWorkspace.cancelTransition(); else folderWorkspace.cancelReconnect(); notify(message, 'error') }} />
    <WorkspaceSidebar documents={documents} activeId={activeId} collapsed={sidebarCollapsed} onToggleCollapsed={() => setSidebarCollapsed((collapsed) => !collapsed)} onPickFiles={() => pickFiles()} onOpenCommands={() => { if (!transitionLocked.current) setShowCommand(true) }} onSelectDocument={switchTab} onCloseDocument={(id) => { void closeDocument(id) }} onOpenSettings={() => { if (!transitionLocked.current) setShowSettings(true) }} folder={folderWorkspace.folder} folderTree={folderTreeProps} folderPickingAvailable={folderPickingAvailable} onOpenFolder={openFolderPicker} onCloseFolder={closeFolderWorkspace} />

    <main className="main-column">
      <DocumentHeader document={activeDocument} theme={resolvedTheme} canShare={'share' in navigator && activeDocument?.contentKind !== 'unsupported'} saveLabel={saveLabel} onModeChange={setMode} onThemeChange={changeTheme} onUndo={() => undo()} onRedo={() => undo(true)} onSave={() => { void saveCurrent() }} onShare={() => { void shareCurrent() }} onClose={() => { if (activeDocument) void closeDocument(activeDocument.id) }} onPickFiles={() => pickFiles()} onOpenCommands={() => { if (!transitionLocked.current) setShowCommand(true) }} onOpenSettings={() => { if (!transitionLocked.current) setShowSettings(true) }} onBrowseFolder={() => { if (!folderPickingAvailable) return; if (folderWorkspace.folder) setShowFolderDrawer(true); else openFolderPicker() }} />

      {activeDocument ? <>
        <div id={`document-panel-${activeDocument.id}`} className="document-workspace" key={activeDocument.id} role="tabpanel" aria-label={`${activeDocument.mode === 'view' ? '보기' : '원본'} · ${activeDocument.name}`} tabIndex={0}>
          {activeDocument.parseState === 'pending' && !(activeDocument.format === 'md' && activeDocument.mode === 'view') && <div className="source-diagnostic" role="status"><span>최신 원문을 해석하고 있습니다. 편집은 계속할 수 있습니다.</span></div>}
          {activeDocument.parseState === 'error' && <div className="source-diagnostic" role="alert"><span>원문을 해석하지 못했습니다. 마지막 유효 보기는 유지되며 구조 편집은 잠깁니다.</span><small>{activeDocument.diagnostics.find((item) => item.severity === 'error')?.message ?? activeDocument.sourceError}</small></div>}
          {activeDocument.parseState === 'ready' && activeDocument.diagnostics.some((item) => item.severity === 'warning') && <div className="inline-warning" role="status">진단 {activeDocument.diagnostics.filter((item) => item.severity === 'warning').length}개 · {activeDocument.diagnostics.find((item) => item.severity === 'warning')?.message}</div>}
          <FeatureLoadBoundary key={activeDocument.id} fileName={activeDocument.name} sourceText={activeDocument.text}>
            <Suspense fallback={null}>
              {activeDocument.mode === 'view' && !activeDocument.contentKind && !isStructuredFormat(activeDocument.format) ? <ViewerZoom>{renderActiveDocument(activeDocument)}</ViewerZoom> : renderActiveDocument(activeDocument)}
            </Suspense>
          </FeatureLoadBoundary>
        </div>
        {activeDocument.mode === 'source' && <div className="source-statusbar"><span>{activeDocument.contentKind === 'plain-text' ? '일반 텍스트 · 원본 보기' : '원본 텍스트 · UTF-8 출력'}</span><span>{activeDocument.text.split(/\r\n|\r|\n/).length}줄 · {activeDocument.text.length.toLocaleString()}자</span><div className="toolbar-spacer" />{activeDocument.parseState === 'pending' ? <span>해석 중</span> : activeDocument.parseState === 'error' ? <span className="error-label">문법 오류</span> : <span className="ready-label">{activeDocument.contentKind === 'plain-text' ? '텍스트' : '유효한 문서'}</span>}</div>}
      </> : folderWorkspace.folder ? (folderWorkspace.activeAssetPath && folderWorkspace.source
        ? <FolderAssetPreview source={folderWorkspace.source} generation={folderWorkspace.generation} path={folderWorkspace.activeAssetPath} resources={folderResources.current} onClose={() => folderWorkspace.selectDocumentPath(null)} />
        : folderWorkspace.activeFilePath && folderWorkspace.source
          ? <UnsupportedFilePage name={folderWorkspace.activeFilePath} />
          : <section className="folder-empty-state" aria-live="polite"><FolderOpen size={24} /><strong>{folderWorkspace.source ? '폴더에서 파일을 선택하세요' : '폴더에 접근할 수 없습니다'}</strong><p>{folderWorkspace.source ? `${folderWorkspace.folder.name} 폴더의 트리에서 문서를 열 수 있습니다.` : '복구된 작업본은 유지됩니다. 폴더 목록의 새로고침을 눌러 현재 폴더 접근을 복구하세요.'}</p></section>)
        : <WelcomeScreen onOpen={() => pickFiles()} onPaste={() => { void handlePaste() }} onCommand={() => { if (!transitionLocked.current) setShowCommand(true) }} />}

      <DocumentActionBar document={activeDocument} saveLabel={saveLabel} onModeChange={setMode} onUndo={() => undo()} onRedo={() => undo(true)} onSave={() => { void saveCurrent() }} />
      {offlineReady && <div className="status-banner"><Check size={15} />오프라인에서 사용할 파일을 준비했습니다.<button className="icon-button" aria-label="알림 닫기" onClick={() => setOfflineReady(false)}><X size={14} /></button></div>}
      {updateReady && !relayRoute && <div className="status-banner update-banner"><span>새 버전을 사용할 수 있습니다. 업데이트는 사용자가 선택할 때 적용됩니다.</span><button className="subtle-button" disabled={folderWorkspace.isTransitioning || resettingData.current} onClick={() => { if (transitionLocked.current || resettingData.current) return; window.dispatchEvent(new Event('viewer:apply-update')) }}>업데이트</button><button className="icon-button" aria-label="업데이트 알림 닫기" onClick={() => setUpdateReady(false)}><X size={14} /></button></div>}
    </main>

    {showCommand && <CommandMenu commands={commands} onClose={() => setShowCommand(false)} />}
    {(folderWorkspace.phase === 'confirming' || folderWorkspace.phase === 'saving') && <FolderTransitionDialog phase={folderWorkspace.phase} rows={folderWorkspace.rows} closing={folderWorkspace.isClosing} busyRowId={folderWorkspace.busyRowId} onSaveAll={() => { void folderWorkspace.saveAll() }} onDiscard={() => { void folderWorkspace.discardAndContinue() }} onCancel={folderWorkspace.cancelTransition} onContinue={(row) => { void folderWorkspace.continueSave(row) }} onConfirmDownload={(row) => { void folderWorkspace.confirmDownload(row) }} />}
    {showFolderDrawer && folderWorkspace.folder && drawerTree && <FolderTreeDrawer folder={folderWorkspace.folder} tree={drawerTree} onClose={() => setShowFolderDrawer(false)} />}
    {showSettings && <SettingsDialog theme={theme} onThemeChange={changeTheme} recoveryEnabled={recoveryEnabled} onRecoveryChange={(enabled) => { void changeRecovery(enabled) }} onClearData={() => { void clearData() }} onClose={() => setShowSettings(false)} onInstall={() => { void installApp() }} canInstall={Boolean(installPrompt)} />}
    {showPaste && <PasteDialog text={pasteText} format={pasteFormat} onTextChange={setPasteText} onFormatChange={setPasteFormat} onClose={() => setShowPaste(false)} onOpen={() => { void createFromPaste() }} />}
    {relayRoute && relayError && <div className="status-banner relay-error-banner" role="status" aria-live="polite"><span>{relayError}</span><button className="subtle-button" onClick={() => { void runRelay(relayRoute) }}>다시 시도</button></div>}
    <div className="toast-stack" aria-live="polite" aria-atomic="false">{notices.map((notice) => <div className={`toast ${notice.tone}`} key={notice.id}><span>{notice.message}</span><button aria-label="알림 닫기" onClick={() => setNotices((items) => items.filter((item) => item.id !== notice.id))}><X size={13} /></button></div>)}</div>
  </div>
}

function renderDocument(document: ViewerDocument, onModel: (model: DocumentModel, group?: 'typing' | 'command') => void, onText: (text: string, group?: 'typing' | 'command') => void, onOpenAttachment: (index: number) => void, onDownloadAttachment: (index: number) => void, theme: 'light' | 'dark', onUndo: () => void, onRedo: () => void, structuredFormat: StructuredFormat, onStructuredFormat: (format: StructuredFormat) => void, markdownContext?: Omit<MarkdownReferenceContext, 'ownerText'>) {
  if (document.contentKind === 'unsupported') return <UnsupportedFilePage name={document.name} />
  if (document.contentKind === 'plain-text' || document.mode === 'source') return <SourceEditor documentId={document.id} format={document.format} plainText={document.contentKind === 'plain-text'} csvDelimiter={document.format === 'csv' ? (document.model as CsvModel).delimiter : ','} value={document.text} diagnostics={document.diagnostics} theme={theme} onChange={onText} onUndo={onUndo} onRedo={onRedo} label={`${document.name} 원본 편집기`} />
  switch (document.format) {
    case 'csv': return <CsvEditor document={document} model={document.model as CsvModel} onChange={(model, group) => onModel(model, group)} theme={theme} />
    case 'md': return <MarkdownEditor document={document} text={document.text} theme={theme} onChange={onText} onUndo={onUndo} onRedo={onRedo} markdownContext={markdownContext} />
    case 'eml': return <EmailEditor document={document} model={document.model as EmailModel} onOpenAttachment={onOpenAttachment} onDownloadAttachment={onDownloadAttachment} />
    case 'ics': return <CalendarEditor document={document} model={document.model as CalendarModel} onChange={(model, group) => onModel(model, group)} />
    case 'vcf': return <ContactsEditor document={document} model={document.model as ContactModel} onChange={(model, group) => onModel(model, group)} />
    case 'json': case 'yaml': case 'toml': return <StructuredDataEditor document={document} model={document.model as StructuredModel} onChange={onModel} outputFormat={structuredFormat} onOutputFormat={onStructuredFormat} />
  }
}

function WelcomeScreen({ onOpen, onPaste, onCommand }: { onOpen: () => void; onPaste: () => void; onCommand: () => void }) {
  return <section className="welcome-screen" aria-label="시작 화면"><div className="welcome-card">
    <div className="welcome-icon"><img src={`${__APP_BASE__}icons/viewer.svg`} alt="" /></div><h1>파일을 열어 시작하세요</h1><p>텍스트 기반 파일을 브라우저 안에서 보고 편집할 수 있습니다.<br />파일은 이 기기에서 처리됩니다.</p>
    <div className="welcome-actions"><button className="primary-button large" onClick={onOpen}><FolderOpen size={15} /> 파일 열기</button><button className="secondary-button large" onClick={onPaste}><ClipboardPaste size={15} /> 붙여넣기</button></div>
    <button className="drop-hint" onClick={onOpen}><span className="drop-rule" />파일·폴더를 여기에 놓거나 <u>파일 열기</u><span className="drop-rule" /></button>
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
