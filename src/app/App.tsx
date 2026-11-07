import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  Check, ClipboardPaste, FilePlus2, FolderOpen, X
} from 'lucide-react'
import { CommandMenu, type CommandItem } from '../components/CommandMenu'
import { SettingsDialog } from '../components/SettingsDialog'
import { useFocusTrap } from '../components/useFocusTrap'
import { ViewerZoom } from '../components/ViewerZoom'
import { FeatureLoadBoundary } from '../components/FeatureLoadBoundary'
import { RuntimeAssetDialog } from '../components/RuntimeAssetDialog'
import { settleCodeEditors } from '../components/editorSettling'
import { clearDocumentResources, disposeDocumentResources } from './documentResources'
import { DocumentActionBar, DocumentHeader } from './DocumentHeader'
import { DocumentStore, type DocumentStoreChange } from './documentStore'
import { WorkspaceOperationCoordinator } from './workspaceOperationCoordinator'
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
import type { FolderTransitionPhase } from '../domain/folderTransition'
import { LocalReferenceState, type MarkdownReferenceContext, type MarkdownReferenceServices } from '../features/markdown/localReferenceState'
import { FORMAT_LABEL, FORMAT_MIME, FORMATS, type DocumentModel, type Format, type ThemePreference, type ViewerDocument } from '../domain/types'
import { DocumentController } from '../domain/documentController'
import { buildExportSnapshot, canPersistRecovery, diagnosticsFromMessages, documentIsDirty, flushDocument, hasByteOrderMark, makeDocumentFromBytes, makeFileDocumentFromBytes } from '../domain/session'
import type { ParsedFile } from '../domain/formatParsing'
import { parseTextWithWorker, parseWithWorker } from '../domain/workerClient'
import { hasFatalDiagnostics } from '../domain/parseDiagnostics'
import { isStructuredFormat, type StructuredFormat } from '../domain/structured/model'
import { isBlockEditorFormat } from '../domain/blockDocuments'
import type { EnvModel } from '../domain/env/model'
import { isStructuredViewerDocument, matchDocumentModel, replaceDocumentModel } from '../domain/documentModel'
import { clearAllData, clearDocuments, clearWorkspace, completeShareTicketFile, loadWorkspace, loadTheme, readRawWorkspaceDocument, readSetting, readShareTicket, readShareTicketFile, readWorkspaceDocumentPayload, removeDocument, replaceWorkspace, retryLoadWorkspaceDocument, saveDocument, saveDocumentMode, writeSetting, type WorkspaceLoadIssue } from '../platform/storage'
import { DocumentWriteQueue } from '../platform/documentWriteQueue'
import { FilePicker, type FilePickerHandle } from '../platform/FilePicker'
import type { PickedFile } from '../platform/fileTypes'
import { downloadLocalFile, readClipboardText, readDroppedItems, readPickedFileBytes, receiveLaunchedFiles, saveLocalFile, shareLocalFile, supportsFileHandlePicker } from '../platform/browserFiles'
import { commitExtensionFile, parseRelayRoute, receiveExtensionFile, RelayTransferError, restoreLegacySnapshot, type ReceivedExtensionFile, type RelayRoute } from '../platform/pwa/extensionRelay'
import { continueWithoutRuntimeAssetGroup, ensureRuntimeAssetGroup, getRuntimeAssetProgress, retryRuntimeAssetGroup, subscribeRuntimeAssetProgress } from '../platform/pwa/runtimeAssets'

const CsvEditor = lazy(() => import('../features/CsvEditor').then((module) => ({ default: module.CsvEditor })))
const MarkdownEditor = lazy(() => import('../features/MarkdownEditor').then((module) => ({ default: module.MarkdownEditor })))
const EmailEditor = lazy(() => import('../features/EmailEditor').then((module) => ({ default: module.EmailEditor })))
const CalendarEditor = lazy(() => import('../features/CalendarEditor').then((module) => ({ default: module.CalendarEditor })))
const ContactsEditor = lazy(() => import('../features/ContactsEditor').then((module) => ({ default: module.ContactsEditor })))
const StructuredDataEditor = lazy(() => import('../features/structured/StructuredDataEditor').then((module) => ({ default: module.StructuredDataEditor })))
const EnvEditor = lazy(() => import('../features/env/EnvEditor').then((module) => ({ default: module.EnvEditor })))
const DiffView = lazy(() => import('../features/diff/DiffView').then((module) => ({ default: module.DiffView })))
const SourceEditor = lazy(() => import('../components/SourceEditor'))

interface Notice { id: number; tone: 'success' | 'error' | 'info'; message: string }
interface BeforeInstallPrompt extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
const labels = FORMAT_LABEL
const defaultStructuredOutputFormat = (document: ViewerDocument): StructuredFormat => isStructuredFormat(document.format) ? document.format : 'json'
function recoveryPayloadChanged(previous: ViewerDocument, current: ViewerDocument): boolean {
  const keys = new Set([...Object.keys(previous), ...Object.keys(current)] as Array<keyof ViewerDocument>)
  for (const key of keys) {
    if (key === 'mode' || key === 'payloadLoaded') continue
    if (!Object.is(previous[key], current[key])) return true
  }
  return false
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

function recoveryRecordJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item instanceof ArrayBuffer) return { $type: 'ArrayBuffer', base64: bytesToBase64(new Uint8Array(item)) }
    if (ArrayBuffer.isView(item)) return { $type: item.constructor.name, base64: bytesToBase64(new Uint8Array(item.buffer, item.byteOffset, item.byteLength)) }
    return item
  }, 2)
}

export function App() {
  const documentStoreRef = useRef<DocumentStore | null>(null)
  if (!documentStoreRef.current) documentStoreRef.current = new DocumentStore()
  const documentStore = documentStoreRef.current
  const subscribeDocumentList = useCallback((listener: () => void) => documentStore.subscribeList(listener), [documentStore])
  const readDocumentList = useCallback(() => documentStore.getListSnapshot(), [documentStore])
  const documents = useSyncExternalStore(subscribeDocumentList, readDocumentList, readDocumentList)
  const [activeId, setActiveId] = useState('')
  const subscribeActiveDocument = useCallback((listener: () => void) => documentStore.subscribeDocument(activeId, listener), [activeId, documentStore])
  const readActiveDocument = useCallback(() => documentStore.get(activeId), [activeId, documentStore])
  const activeDocumentSnapshot = useSyncExternalStore(subscribeActiveDocument, readActiveDocument, readActiveDocument)
  const [loaded, setLoaded] = useState(false)
  const [theme, setTheme] = useState<ThemePreference>('system')
  const [systemLight, setSystemLight] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: light)').matches)
  const [recoveryEnabled, setRecoveryEnabled] = useState(true)
  const [recoveryIssues, setRecoveryIssues] = useState<WorkspaceLoadIssue[]>([])
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [showCommand, setShowCommand] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showPaste, setShowPaste] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [pasteFormat, setPasteFormat] = useState<Format>('md')
  const [structuredFormats, setStructuredFormats] = useState<Record<string, StructuredFormat>>({})
  const [notices, setNotices] = useState<Notice[]>([])
  const runtimeAssetProgress = useSyncExternalStore(subscribeRuntimeAssetProgress, getRuntimeAssetProgress, getRuntimeAssetProgress)
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
  const recoverySaves = useRef(new Map<string, Promise<void>>())
  const recoveryTimers = useRef(new Map<string, number>())
  const recoveryObservedDocuments = useRef(new Map<string, ViewerDocument>())
  const documentPayloadReads = useRef(new Map<string, Promise<ViewerDocument>>())
  const recoveryEnabledRef = useRef(true)
  const recoveryWasEnabled = useRef(false)
  const closingDocumentIds = useRef(new Set<string>())
  const resettingData = useRef(false)
  const launchedFileQueue = useRef<PickedFile[][]>([])
  const workspaceOperations = useRef<WorkspaceOperationCoordinator>(null!)
  if (!workspaceOperations.current) workspaceOperations.current = new WorkspaceOperationCoordinator()
  const drainFileQueueRef = useRef<(() => void) | null>(null)
  const runRelayRef = useRef<((route: RelayRoute) => Promise<void>) | null>(null)
  const folderWorkspaceRef = useRef<ReturnType<typeof useFolderWorkspace> | null>(null)
  const workspaceMetadata = useRef<{ folderId: string; generation: number; folder: FolderWorkspace; source: FolderSource | null } | null>(null)
  const folderResources = useRef(new FolderResourceManager())
  const folderDocumentListeners = useRef(new Map<string, Set<() => void>>())
  const markdownReferenceState = useRef(new LocalReferenceState())
  const noticeTimer = useRef(new Map<number, number>())
  const relayRuns = useRef(new Set<string>())
  const receivedRelayFiles = useRef(new Map<string, ReceivedExtensionFile>())
  const activeDocument = activeDocumentSnapshot
  const activeSummary = documents.find((item) => item.id === activeId) ?? null
  const activeDocumentId = activeDocument?.id
  const activeDocumentPayloadLoaded = activeDocument?.payloadLoaded
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

  const trackWorkspaceOperation = useCallback(<T,>(operation: Promise<T>): Promise<T> => workspaceOperations.current.track(operation), [])
  const notifyFolderDocumentSubscribers = useCallback((updated: ViewerDocument) => {
    if (!updated.folderRef) return
    const listeners = folderDocumentListeners.current.get(folderDocumentKey(updated.folderRef.folderId, updated.folderRef.path))
    for (const listener of listeners ?? []) listener()
  }, [])

  const publishDocument = useCallback((updated: ViewerDocument) => {
    documentStore.update(updated)
    notifyFolderDocumentSubscribers(updated)
  }, [documentStore, notifyFolderDocumentSubscribers])

  const hydrateDocumentPayload = useCallback((id: string): Promise<ViewerDocument> => {
    const current = documentStore.get(id)
    if (!current) return Promise.reject(new Error('열린 문서를 찾을 수 없습니다.'))
    if (current.payloadLoaded !== false) return Promise.resolve(current)
    const existing = documentPayloadReads.current.get(id)
    if (existing) return existing
    const pending = (async () => {
      const payload = await readWorkspaceDocumentPayload(id)
      const latest = documentStore.get(id)
      if (!latest) return payload
      const hydrated: ViewerDocument = {
        ...payload,
        mode: latest.mode,
        folderRef: latest.folderRef,
        sourceFileHandle: latest.sourceFileHandle,
        fileSource: latest.fileSource,
        parentId: latest.parentId,
        shareTicketId: latest.shareTicketId,
        shareFileIndex: latest.shareFileIndex,
        relayTicketId: latest.relayTicketId,
        payloadLoaded: true
      }
      recoveryObservedDocuments.current.set(id, hydrated)
      publishDocument(hydrated)
      return hydrated
    })()
    documentPayloadReads.current.set(id, pending)
    void pending.finally(() => { if (documentPayloadReads.current.get(id) === pending) documentPayloadReads.current.delete(id) }).catch(() => undefined)
    return pending
  }, [documentStore, publishDocument])

  const settleWorkspaceOperations = useCallback(async () => {
    await settleCodeEditors()
    const activeElement = document.activeElement
    if (activeElement instanceof HTMLElement && activeElement !== document.body) activeElement.blur()
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    await workspaceOperations.current.waitForActive()
    const dirtyUnloaded = documentStore.getAll().filter((item) => item.payloadLoaded === false && item.isDirty)
    await Promise.all(dirtyUnloaded.map((item) => hydrateDocumentPayload(item.id)))
  }, [documentStore, hydrateDocumentPayload])

  const publishDocumentMode = useCallback((updated: ViewerDocument) => {
    publishDocument(updated)
    if (!recoveryEnabledRef.current) return
    void recoveryWriteQueue.current.enqueue(updated.id, () => saveDocumentMode(updated.id, updated.mode))
      .catch(() => notify('보기 모드를 이 기기에 저장하지 못했습니다.', 'error'))
  }, [notify, publishDocument])

  const documentSaveService = useMemo(() => createDocumentSaveService({
    getDocument: (id) => documentStore.get(id),
    getPendingSerialization: (id) => pendingSerializations.current.get(id),
    publishDocument,
    controller: documentController.current
  }), [documentStore, publishDocument])

  const parseNow = useCallback(async (id: string, revision: number) => {
    const scheduled = sourceParseTimers.current.get(id)
    if (scheduled) { window.clearTimeout(scheduled.timer); sourceParseTimers.current.delete(id) }
    const document = documentStore.get(id)
    if (!document || document.revision !== revision || document.textRevision !== revision || document.parseState !== 'pending') return
    const token = (sourceRequestTokens.current.get(id) ?? 0) + 1
    sourceRequestTokens.current.set(id, token)
    try {
      const parsed = await parseTextWithWorker(document.name, document.mimeType, document.text, document.format, { documentId: id, revision, csvHasHeader: document.format === 'csv' ? document.model.hasHeader : undefined })
      const latest = documentStore.get(id)
      if (sourceRequestTokens.current.get(id) !== token || !latest || latest.revision !== revision || latest.text !== document.text) return
      if (parsed.format !== latest.format) throw new Error('해석 결과의 문서 형식이 변경되어 적용하지 못했습니다.')
      if (hasFatalDiagnostics(parsed.format, parsed.model, parsed.diagnostics)) {
        const message = parsed.diagnostics[0] ?? '문서 구조를 해석하지 못했습니다.'
        publishDocument({ ...latest, parseState: 'error', diagnostics: diagnosticsFromMessages(parsed.diagnostics, 'error'), sourceError: message })
        return
      }
      let model = isStructuredViewerDocument(latest) && isStructuredParsedFile(parsed) ? { ...parsed.model, loose: latest.model.loose } : parsed.model
      if (latest.format === 'env' && parsed.format === 'env') model = preserveEnvRecovery(parsed.model, latest.model)
      const withModel = replaceDocumentModel(latest, model)
      publishDocument({ ...withModel, modelRevision: revision, parseState: 'ready', diagnostics: diagnosticsFromMessages(parsed.diagnostics), sourceError: undefined, isDirty: documentIsDirty(withModel) })
    } catch (error) {
      const latest = documentStore.get(id)
      if (sourceRequestTokens.current.get(id) !== token || !latest || latest.revision !== revision) return
      const message = error instanceof Error ? error.message : '원본 문법을 해석하지 못했습니다.'
      publishDocument({ ...latest, parseState: 'error', diagnostics: [{ severity: 'error', message }], sourceError: message })
    }
  }, [documentStore, publishDocument])

  const enqueueRecoverySave = useCallback((id: string): Promise<void> => {
    const active = recoverySaves.current.get(id)
    if (active) return active
    const pending = recoveryWriteQueue.current.enqueue(id, async () => {
      while (true) {
        if (workspaceOperations.current.locked) return
        let serialization = pendingSerializations.current.get(id)
        while (serialization) {
          await serialization
          const next = pendingSerializations.current.get(id)
          serialization = next && next !== serialization ? next : undefined
        }
        const current = documentStore.get(id)
        if (!recoveryEnabledRef.current || closingDocumentIds.current.has(id) || !current || !canPersistRecovery(current)) return
        await saveDocument(current)
        const latest = documentStore.get(id)
        if (!latest || !recoveryEnabledRef.current || closingDocumentIds.current.has(id) || !recoveryPayloadChanged(current, latest)) return
      }
    })
    recoverySaves.current.set(id, pending)
    void pending.finally(() => { if (recoverySaves.current.get(id) === pending) recoverySaves.current.delete(id) }).catch(() => undefined)
    return pending
  }, [documentStore])

  useEffect(() => {
    void ensureRuntimeAssetGroup('fonts').catch(() => undefined)
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [storedTheme, recover] = await Promise.all([loadTheme(), readSetting('recovery', true)])
        const restored = recover ? await loadWorkspace() : { documents: [], folder: null }
        const saved = restored.documents
        if ('issues' in restored && restored.issues?.length) {
          setRecoveryIssues(restored.issues)
          notify(`${restored.issues.length}개 저장 문서를 복원하지 못했습니다. 정상 문서는 계속 사용할 수 있습니다.`, 'error')
        }
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
        recoveryObservedDocuments.current = new Map(saved.map((item) => [item.id, item]))
        documentStore.replaceAll(saved)
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
  }, [documentStore, notify])

  useEffect(() => {
    if (!loaded || !activeDocumentId || activeDocumentPayloadLoaded !== false) return
    let cancelled = false
    const operation = hydrateDocumentPayload(activeDocumentId).catch((error: unknown) => {
      if (cancelled) return
      const issue = { id: activeDocumentId, message: error instanceof Error ? error.message : '저장 문서 본문을 읽지 못했습니다.' }
      setRecoveryIssues((items) => [...items.filter((item) => item.id !== issue.id), issue])
    })
    void trackWorkspaceOperation(operation)
    return () => { cancelled = true }
  }, [activeDocumentId, activeDocumentPayloadLoaded, hydrateDocumentPayload, loaded, trackWorkspaceOperation])

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
    const clearDocumentTimers = (id: string) => {
      const recoveryTimer = recoveryTimers.current.get(id)
      if (recoveryTimer !== undefined) { window.clearTimeout(recoveryTimer); recoveryTimers.current.delete(id) }
      const parseTimer = sourceParseTimers.current.get(id)
      if (parseTimer) { window.clearTimeout(parseTimer.timer); sourceParseTimers.current.delete(id) }
      recoveryObservedDocuments.current.delete(id)
    }
    const scheduleRecovery = (item: ViewerDocument, force = false) => {
      if (!recoveryEnabled || workspaceOperations.current.locked) return
      const previous = recoveryObservedDocuments.current.get(item.id)
      recoveryObservedDocuments.current.set(item.id, item)
      if (!force && previous && !recoveryPayloadChanged(previous, item)) return
      const previousTimer = recoveryTimers.current.get(item.id)
      if (previousTimer !== undefined) window.clearTimeout(previousTimer)
      const timer = window.setTimeout(() => {
        recoveryTimers.current.delete(item.id)
        if (workspaceOperations.current.locked) return
        void enqueueRecoverySave(item.id).catch(() => notify('로컬 작업 복구에 저장하지 못했습니다.', 'error'))
      }, 180)
      recoveryTimers.current.set(item.id, timer)
    }
    const scheduleParse = (item: ViewerDocument) => {
      const scheduled = sourceParseTimers.current.get(item.id)
      const pending = item.payloadLoaded !== false && item.parseState === 'pending' && item.modelRevision !== item.revision
      if (!pending || scheduled && scheduled.revision !== item.revision) {
        if (scheduled) { window.clearTimeout(scheduled.timer); sourceParseTimers.current.delete(item.id) }
      }
      if (!pending || sourceParseTimers.current.get(item.id)?.revision === item.revision) return
      const timer = window.setTimeout(() => { sourceParseTimers.current.delete(item.id); void parseNow(item.id, item.revision) }, 380)
      sourceParseTimers.current.set(item.id, { revision: item.revision, timer })
    }
    const syncAll = () => {
      if (workspaceOperations.current.locked) return
      const items = documentStore.getAll()
      const ids = new Set(items.map((item) => item.id))
      for (const id of recoveryObservedDocuments.current.keys()) if (!ids.has(id)) clearDocumentTimers(id)
      for (const id of recoveryTimers.current.keys()) if (!ids.has(id)) clearDocumentTimers(id)
      for (const id of sourceParseTimers.current.keys()) if (!ids.has(id)) clearDocumentTimers(id)
      if (!recoveryEnabled) recoveryWasEnabled.current = false
      const enabledAgain = recoveryEnabled && !recoveryWasEnabled.current
      if (recoveryEnabled) recoveryWasEnabled.current = true
      for (const item of items) {
        scheduleRecovery(item, enabledAgain)
        scheduleParse(item)
      }
    }
    const onStoreChange = (change: DocumentStoreChange) => {
      if (workspaceOperations.current.locked) return
      if (change.type === 'remove') { clearDocumentTimers(change.document.id); return }
      if (change.type === 'replace' || change.type === 'refresh') { syncAll(); return }
      if (!recoveryEnabled) recoveryWasEnabled.current = false
      const enabledAgain = recoveryEnabled && !recoveryWasEnabled.current
      if (recoveryEnabled) recoveryWasEnabled.current = true
      scheduleRecovery(change.document, enabledAgain)
      scheduleParse(change.document)
    }
    const unsubscribe = documentStore.subscribeChanges(onStoreChange)
    syncAll()
    return unsubscribe
  }, [documentStore, enqueueRecoverySave, loaded, notify, parseNow, recoveryEnabled])

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
      workspaceOperations.current.inputs.enqueueFiles({ files: files.slice(startIndex), format: forcedFormat, origin, resolve: (result) => resolve({ opened: [...opened, ...result.opened], errors: [...errors, ...result.errors] }) })
    })
    for (let index = 0; index < files.length; index += 1) {
      if (workspaceOperations.current.locked) return deferRemaining(index)
      const file = files[index]!
      try {
        const existingShared = origin && documentStore.getAll().find((item) => item.shareTicketId === origin.shareTicketId && item.shareFileIndex === origin.shareFileIndex)
        if (existingShared) {
          opened.push(existingShared)
          if (!first) first = existingShared
          continue
        }
        let folderRef: ViewerDocument['folderRef']
        const folderState = folderWorkspaceRef.current
        if (file.fileHandle && folderState?.folder && folderState.source?.kind === 'handle') {
          const path = await resolveFolderMembership(folderState.source, file.fileHandle).catch(() => null)
          if (workspaceOperations.current.locked) return deferRemaining(index)
          if (path !== null) {
            folderRef = { folderId: folderState.folder.id, path }
            const existing = documentStore.getAll().find((item) => item.folderRef?.folderId === folderRef!.folderId && item.folderRef.path === path)
            if (existing) {
              opened.push(existing)
              if (!first) first = existing
              continue
            }
          }
        }
        const bytes = await readPickedFileBytes(file)
        const document = forcedFormat
          ? await makeDocumentFromBytes(file.name, file.type, bytes, undefined, { transferInputBytes: true })
          : await makeFileDocumentFromBytes(file.name, file.type, bytes, undefined, { transferInputBytes: true })
        if (workspaceOperations.current.locked) return deferRemaining(index)
        if (forcedFormat && document.format !== forcedFormat) throw new Error(`선택한 형식 ${forcedFormat.toUpperCase()}과 파일 내용이 다릅니다.`)
        const openedDocument: ViewerDocument = {
          ...document,
          ...(file.fileHandle ? { sourceFileHandle: file.fileHandle } : {}),
          ...(folderRef ? { folderRef } : {}),
          ...(origin ? { ...origin } : {})
        }
        documentStore.upsert(openedDocument)
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
  }, [documentStore, notify, notifyFolderDocumentSubscribers])

  const openFiles = useCallback((files: PickedFile[], forcedFormat?: Format, origin?: { shareTicketId: string; shareFileIndex: number }): Promise<{ opened: ViewerDocument[]; errors: string[] }> => {
    if (workspaceOperations.current.locked) return new Promise((resolve) => workspaceOperations.current.inputs.enqueueFiles({ files, format: forcedFormat, origin, resolve }))
    return processOpenFiles(files, forcedFormat, origin)
  }, [processOpenFiles])

  const queueRelayRoute = useCallback((route: RelayRoute) => {
    workspaceOperations.current.inputs.enqueueRelay(route)
  }, [])

  const drainFileQueue = useCallback(() => {
    if (workspaceOperations.current.locked) return
    void (async () => {
      while (!workspaceOperations.current.locked && workspaceOperations.current.inputs.length) {
        const item = workspaceOperations.current.inputs.dequeue()
        if (!item) break
        if (item.kind === 'files') {
          const result = await processOpenFiles(item.files, item.format, item.origin)
          item.resolve(result)
        } else {
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
    if (workspaceOperations.current.locked) { queueRelayRoute(route); return Promise.resolve() }
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
        imported = documentStore.getAll().find((item) => item.relayTicketId === route.ticketId) ?? null
        if (!imported) {
          let received = receivedRelayFiles.current.get(route.ticketId)
          if (!received) {
            received = await receiveExtensionFile({ extensionId: route.extensionId, ticketId: route.ticketId })
            receivedRelayFiles.current.set(route.ticketId, received)
            if (workspaceOperations.current.locked) { queueRelayRoute(route); return }
          }
          if (workspaceOperations.current.locked) { queueRelayRoute(route); return }
          if (received.kind === 'workspace-snapshot') {
            imported = { ...restoreLegacySnapshot(received.file.bytes), relayTicketId: route.ticketId }
          } else {
            const document = await makeDocumentFromBytes(received.file.name, received.file.type, received.file.bytes)
            if (workspaceOperations.current.locked) { queueRelayRoute(route); return }
            if (document.format !== received.kind) throw new Error('전달된 파일 형식 정보와 실제 파일 내용이 다릅니다.')
            imported = { ...document, id: route.ticketId, relayTicketId: route.ticketId, ...(received.source === 'file-url' ? { fileSource: 'file-url' as const } : {}) }
          }
          if (workspaceOperations.current.locked) { queueRelayRoute(route); return }
          if (recoveryEnabled) await recoveryWriteQueue.current.enqueue(imported.id, () => saveDocument(imported!))
          if (workspaceOperations.current.locked) { queueRelayRoute(route); return }
          documentStore.upsert(imported)
        }
        setActiveId(imported.id)
        folderWorkspaceRef.current?.selectDocumentPath(imported.folderRef?.path ?? null)
        await commitExtensionFile({ extensionId: route.extensionId, ticketId: route.ticketId })
        const current = imported ? documentStore.get(imported.id) : null
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
  }, [documentStore, queueRelayRoute, recoveryEnabled, trackWorkspaceOperation])
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
        const payload = await readShareTicketFile(ticketId, index)
        if (!payload) { failed = true; continue }
        const result = await openFiles([{ name: item.name, type: item.type, bytes: new Uint8Array(payload.bytes) }], undefined, { shareTicketId: ticketId, shareFileIndex: index })
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
    if (workspaceOperations.current.locked || resettingData.current) return
    inputRef.current?.open(format)
  }, [])

  const retryRecoveryDocument = useCallback(async (issue: WorkspaceLoadIssue) => {
    if (!issue.id) return
    try {
      const document = await retryLoadWorkspaceDocument(issue.id)
      const next = [...documentStore.getAll().filter((item) => item.id !== document.id), document].sort((a, b) => b.openedAt - a.openedAt)
      documentStore.replaceAll(next)
      recoveryObservedDocuments.current.set(document.id, document)
      setRecoveryIssues((items) => items.filter((item) => item.id !== issue.id))
      if (!activeId) setActiveId(document.id)
      notify('저장 문서를 다시 읽었습니다.', 'success')
    } catch (error) {
      notify(error instanceof Error ? `저장 문서를 다시 읽지 못했습니다: ${error.message}` : '저장 문서를 다시 읽지 못했습니다.', 'error')
    }
  }, [activeId, documentStore, notify])

  const exportRecoveryDocument = useCallback(async (issue: WorkspaceLoadIssue) => {
    if (!issue.id) return
    try {
      const raw = await readRawWorkspaceDocument(issue.id)
      const bytes = new TextEncoder().encode(recoveryRecordJson(raw))
      downloadLocalFile(`the-viewer-recovery-${issue.id}.json`, 'application/json', bytes)
      notify('저장된 복구 레코드를 JSON 파일로 내보냈습니다.', 'success')
    } catch (error) {
      notify(error instanceof Error ? `복구 레코드를 내보내지 못했습니다: ${error.message}` : '복구 레코드를 내보내지 못했습니다.', 'error')
    }
  }, [notify])

  const changeModel = useCallback((id: string, baseRevision: number, model: DocumentModel, group: 'typing' | 'command' = 'command') => {
    if (resettingData.current || (workspaceOperations.current.locked && workspaceOperations.current.phase !== 'settling' && workspaceOperations.current.phase !== 'picking')) return
    const current = documentStore.get(id)
    if (!current || current.payloadLoaded === false) return
    if (current.revision !== baseRevision || current.parseState !== 'ready' || current.modelRevision !== current.revision) {
      notify('원본을 해석 중이거나 문서가 바뀌어 구조 편집을 잠시 사용할 수 없습니다.', 'info')
      return
    }
    let command
    try { command = documentController.current.prepareViewCommand(matchDocumentModel(current, model), baseRevision, group) }
    catch (error) { notify(error instanceof Error ? error.message : '보기 편집을 적용하지 못했습니다.', 'info'); return }
    if (!command) return
    publishDocument(command.optimisticDocument)

    const pending = command.serializedDocument.then((serialized) => {
      const latest = documentStore.get(id)
      if (!latest || latest.revision !== serialized.revision || latest.model !== model) return
      publishDocument({ ...serialized, mode: latest.mode, savedText: latest.savedText, savedBytes: latest.savedBytes, sourceText: latest.sourceText, initialBytes: latest.initialBytes, isDirty: documentIsDirty({ ...serialized, savedText: latest.savedText, savedBytes: latest.savedBytes }) })
    }).catch((error: unknown) => {
      const latest = documentStore.get(id)
      if (!latest || latest.revision !== command.optimisticDocument.revision || latest.model !== model) return
      const message = error instanceof Error ? error.message : '보기 변경을 원문으로 직렬화하지 못했습니다.'
      publishDocument({ ...latest, parseState: 'error', diagnostics: [{ severity: 'error', message }], sourceError: message })
      notify(message, 'error')
    }).finally(() => {
      if (pendingSerializations.current.get(id) === pending) pendingSerializations.current.delete(id)
    })
    pendingSerializations.current.set(id, pending)
  }, [documentStore, notify, publishDocument])

  const applySourceText = useCallback((id: string, nextText: string, group: 'typing' | 'command' = 'typing') => {
    if (resettingData.current || (workspaceOperations.current.locked && workspaceOperations.current.phase !== 'settling' && workspaceOperations.current.phase !== 'picking')) return
    const current = documentStore.get(id)
    if (!current || current.payloadLoaded === false || current.text === nextText) return
    sourceRequestTokens.current.set(id, (sourceRequestTokens.current.get(id) ?? 0) + 1)
    publishDocument(documentController.current.applySourceText(current, nextText, group))
  }, [documentStore, publishDocument])

  const setMode = useCallback((mode: ViewerDocument['mode']) => {
    if (workspaceOperations.current.locked) return
    const current = documentStore.get(activeId)
    if (!current || current.payloadLoaded === false || current.contentKind || current.mode === mode) return
    if (mode === 'source') {
      if (isBlockEditorFormat(current.format)) {
        void (pendingSerializations.current.get(current.id) ?? Promise.resolve()).then(() => {
          const latest = documentStore.get(current.id)
          if (latest) publishDocumentMode(documentController.current.changeMode(latest, 'source'))
        })
        return
      }
      void flushDocument(current.id, () => documentStore.get(current.id), () => pendingSerializations.current.get(current.id)).then((document) => {
        publishDocumentMode(documentController.current.changeMode(document, 'source'))
      }).catch((error: unknown) => notify(error instanceof Error ? error.message : '원본 편집기를 준비하지 못했습니다.', 'error'))
      return
    }
    publishDocumentMode(documentController.current.changeMode(current, 'view'))
    if (current.parseState === 'pending' && current.modelRevision !== current.revision) void parseNow(current.id, current.revision)
    else if (current.parseState === 'error') notify('원본 문법 오류가 있습니다. 마지막으로 유효했던 보기를 표시합니다.', 'info')
  }, [activeId, documentStore, notify, parseNow, publishDocumentMode])

  const undo = useCallback((redo = false) => {
    if (workspaceOperations.current.locked) return
    const current = documentStore.get(activeId)
    if (!current || current.payloadLoaded === false) return
    const next = documentController.current.restoreHistory(current, redo ? 'redo' : 'undo')
    if (!next) return
    sourceRequestTokens.current.set(current.id, (sourceRequestTokens.current.get(current.id) ?? 0) + 1)
    publishDocument(next)
    if (next.parseState === 'pending') void parseNow(current.id, next.revision)
  }, [activeId, documentStore, parseNow, publishDocument])

  const createBlank = useCallback((format: Format) => {
    if (resettingData.current || workspaceOperations.current.locked) return
    const operation = (async () => {
      const templates: Record<Format, string> = {
        eml: 'Subject: \r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n',
        csv: '', md: '',
        ics: 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//The Viewer//EN\r\nCALSCALE:GREGORIAN\r\nEND:VCALENDAR\r\n',
        vcf: 'BEGIN:VCARD\r\nVERSION:4.0\r\nFN:\r\nN:;;;;\r\nEND:VCARD\r\n',
        json: '{}', yaml: '{}\n', toml: '', diff: '', env: ''
      }
      const bytes = new TextEncoder().encode(templates[format])
      try {
        const document = await makeDocumentFromBytes(`Untitled.${format}`, FORMAT_MIME[format], bytes, undefined, { transferInputBytes: true })
        document.mode = 'view'
        documentStore.upsert(document)
        setActiveId(document.id)
        folderWorkspaceRef.current?.selectDocumentPath(null)
        setShowCommand(false)
        setTimeout(() => { location.hash = `/file/${document.id}` }, 0)
      } catch (error) { notify(error instanceof Error ? error.message : '새 파일을 만들지 못했습니다.', 'error') }
    })()
    return trackWorkspaceOperation(operation)
  }, [documentStore, notify, trackWorkspaceOperation])

  const saveCurrent = useCallback(() => {
    const active = documentStore.get(activeId)
    if (!active || active.payloadLoaded === false || active.contentKind === 'unsupported' || workspaceOperations.current.locked) return
    const operation = (async () => {
    const id = active.id
    const selectedFormat = structuredFormats[id] ?? defaultStructuredOutputFormat(active)
    if (active.mode === 'view' && isStructuredFormat(active.format) && selectedFormat !== active.format) {
      const current = documentStore.get(id)
      if (!current || !isStructuredViewerDocument(current) || current.parseState !== 'ready' || current.modelRevision !== current.revision) { notify('원본을 해석한 뒤 내보낼 수 있습니다.', 'error'); return }
      const { outputStructured } = await import('../domain/structured/output')
      const output = outputStructured(current.model, selectedFormat)
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
  }, [activeId, documentSaveService, documentStore, notify, structuredFormats, trackWorkspaceOperation])

  const revertCurrent = useCallback(() => {
    const active = documentStore.get(activeId)
    if (!active || active.payloadLoaded === false || workspaceOperations.current.locked || !window.confirm('마지막 저장·내보내기 기준으로 복원할까요? 현재 편집 내용은 사라집니다.')) return
    const operation = (async () => {
    const item = active
    try {
      const parsed = await parseWithWorker(item.name, item.mimeType, new Uint8Array(item.savedBytes), item.format, { documentId: item.id, revision: item.revision, csvHasHeader: item.format === 'csv' ? item.model.hasHeader : undefined })
      if (documentStore.get(item.id)?.revision !== item.revision) return
      if (parsed.format !== item.format) throw new Error('저장된 문서 형식이 변경되어 복원하지 못했습니다.')
      if (hasFatalDiagnostics(parsed.format, parsed.model, parsed.diagnostics)) throw new Error(parsed.diagnostics[0] ?? '저장된 원문을 해석하지 못했습니다.')
      const revision = item.revision + 1
      const withModel = replaceDocumentModel(item, parsed.model)
      publishDocument({ ...withModel, text: parsed.text, savedText: parsed.text, bom: hasByteOrderMark(item.savedBytes), sourceError: undefined, structuredDraft: false, isDirty: false, revision, modelRevision: revision, textRevision: revision, parseState: 'ready', diagnostics: diagnosticsFromMessages(parsed.diagnostics), encoding: parsed.encoding })
      documentController.current.clearHistory(item.id)
      notify('마지막 저장본으로 복원했습니다.', 'success')
    } catch (error) {
      const message = error instanceof Error ? error.message : '원본 파일을 해석하지 못했습니다.'
      if (documentStore.get(item.id)?.revision !== item.revision) return
      const revision = item.revision + 1
      const restored: ViewerDocument = { ...item, text: item.savedText, bom: hasByteOrderMark(item.savedBytes), textRevision: revision, revision, structuredDraft: false, parseState: 'error', diagnostics: [{ severity: 'error', message }], sourceError: message }
      publishDocument({ ...restored, isDirty: documentIsDirty(restored) })
      documentController.current.clearHistory(item.id)
      notify('저장된 원문으로 복원했습니다. 구조 편집에는 유효한 문서가 필요합니다.', 'info')
    }
    })()
    return trackWorkspaceOperation(operation)
  }, [activeId, documentStore, notify, publishDocument, trackWorkspaceOperation])

  const closeDocument = useCallback((id: string) => {
    if (workspaceOperations.current.locked) return
    const operation = (async () => {
      const item = documentStore.get(id)
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
      documentStore.remove(id)
      markdownReferenceState.current.clearOwner(id)
      documentController.current.clearHistory(id)
      sourceRequestTokens.current.delete(id)
      const scheduled = sourceParseTimers.current.get(id)
      if (scheduled) { window.clearTimeout(scheduled.timer); sourceParseTimers.current.delete(id) }
      pendingSerializations.current.delete(id)
      window.setTimeout(() => disposeDocumentResources(id), 0)
      if (activeId === id) {
        const next = documentStore.getAll()[0]
        setActiveId(next?.id ?? '')
        folderWorkspaceRef.current?.selectDocumentPath(next?.folderRef?.path ?? null)
        if (next) location.hash = `/file/${next.id}`
        else location.hash = '/'
      }
    })()
    return trackWorkspaceOperation(operation)
  }, [activeId, documentStore, notify, trackWorkspaceOperation])

  const openAttachment = useCallback((index: number) => {
    if (resettingData.current || workspaceOperations.current.locked) return
    const active = documentStore.get(activeId)
    if (!active || active.format !== 'eml') return
    const attachment = active.model.attachments[index]
    if (!attachment) return
    const operation = (async () => {
      try {
        const child = await makeFileDocumentFromBytes(attachment.filename, attachment.mimeType, attachment.content, active.id)
        documentStore.upsert(child)
        setActiveId(child.id)
        folderWorkspaceRef.current?.selectDocumentPath(null)
        location.hash = `/file/${child.id}`
      } catch (error) { notify(error instanceof Error ? error.message : '첨부 파일을 열지 못했습니다.', 'error') }
    })()
    return trackWorkspaceOperation(operation)
  }, [activeId, documentStore, notify, trackWorkspaceOperation])

  const downloadAttachment = useCallback((index: number) => {
    if (workspaceOperations.current.locked) return
    const active = documentStore.get(activeId)
    if (!active || active.format !== 'eml') return
    const attachment = active.model.attachments[index]
    if (!attachment) return
    downloadLocalFile(attachment.filename || 'attachment.bin', attachment.mimeType, attachment.content)
  }, [activeId, documentStore])

  const handlePaste = useCallback(async () => {
    if (workspaceOperations.current.locked) return
    try {
      const text = await readClipboardText()
      if (!text) { setShowPaste(true); return }
      setPasteText(text)
      setShowPaste(true)
    } catch { setShowPaste(true) }
  }, [])

  const createFromPaste = useCallback(async () => {
    if (workspaceOperations.current.locked) return
    const name = `Clipboard.${pasteFormat}`
    await openFiles([{ name, type: FORMAT_MIME[pasteFormat], bytes: new TextEncoder().encode(pasteText) }], pasteFormat)
    setShowPaste(false)
    setPasteText('')
  }, [openFiles, pasteText, pasteFormat])

  const changeTheme = useCallback((value: ThemePreference) => {
    if (workspaceOperations.current.locked) return
    setTheme(value)
    void writeSetting('theme', value).catch(() => notify('테마 설정을 이 기기에 저장하지 못했습니다.', 'error'))
  }, [notify])
  const changeRecovery = useCallback((enabled: boolean) => {
    if (workspaceOperations.current.locked) return
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
          setRecoveryIssues([])
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
    if (resettingData.current || workspaceOperations.current.locked) return
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
    const documentIds = documentStore.getAll().map((document) => document.id)
    documentController.current.clearHistory()
    documentStore.clear()
    setRecoveryIssues([])
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
  }, [documentStore, notify])

  const installApp = useCallback(async () => {
    if (!installPrompt) { notify('브라우저 메뉴에서 “앱 설치” 또는 “홈 화면에 추가”를 선택하세요.', 'info'); return }
    await installPrompt.prompt()
    const result = await installPrompt.userChoice
    setInstallPrompt(null)
    if (result.outcome === 'accepted') notify('앱 설치를 시작했습니다.', 'success')
  }, [installPrompt, notify])

  const closeCommandMenu = useCallback(() => setShowCommand(false), [])
  const closeSettings = useCallback(() => setShowSettings(false), [])
  const changeRecoveryFromSettings = useCallback((enabled: boolean) => { void changeRecovery(enabled) }, [changeRecovery])
  const clearDataFromSettings = useCallback(() => { void clearData() }, [clearData])
  const installFromSettings = useCallback(() => { void installApp() }, [installApp])

  const shareCurrent = useCallback(async () => {
    if (workspaceOperations.current.locked) return
    const active = documentStore.get(activeId)
    if (!active || active.payloadLoaded === false || active.contentKind === 'unsupported' || !navigator.share) { notify('이 브라우저에서는 시스템 공유를 사용할 수 없습니다.', 'info'); return }
    try {
      const item = await flushDocument(active.id, () => documentStore.get(active.id), () => pendingSerializations.current.get(active.id))
      const payload = buildExportSnapshot(item.id, item)
      await shareLocalFile(item.name, item.format, payload.bytes, item.contentKind === 'plain-text' ? 'text/plain' : undefined)
      notify('공유를 시작했습니다.', 'success')
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) notify('파일을 공유하지 못했습니다.', 'error')
    }
  }, [activeId, documentStore, notify])

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
    setRecoveryIssues([])

    const oldIds = documentStore.getAll().map((item) => item.id)
    documentStore.clear()
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
  }, [documentStore])

  const handleTransitionLock = useCallback((locked: boolean) => {
    workspaceOperations.current.setLocked(locked)
    if (locked) {
      for (const timer of recoveryTimers.current.values()) window.clearTimeout(timer)
      recoveryTimers.current.clear()
      return
    }
    if (!resettingData.current) {
      recoveryObservedDocuments.current.clear()
      documentStore.refresh()
    }
    window.setTimeout(() => {
      drainFileQueueRef.current?.()
    }, 0)
  }, [documentStore])

  const addFolderDocument = useCallback((document: ViewerDocument) => {
    if (workspaceOperations.current.locked) return
    documentStore.upsert(document)
    notifyFolderDocumentSubscribers(document)
    setActiveId(document.id)
    setShowCommand(false)
    history.replaceState(null, '', `#/file/${document.id}`)
  }, [documentStore, notifyFolderDocumentSubscribers])

  const selectFolderDocument = useCallback((id: string) => {
    if (workspaceOperations.current.locked) return
    setActiveId(id)
    setShowCommand(false)
    if (id) history.replaceState(null, '', `#/file/${id}`)
    else history.replaceState(null, '', '#/')
  }, [])

  const getDocuments = useCallback(() => documentStore.getAll(), [documentStore])
  const getDocumentSummaries = useCallback(() => documentStore.getListSnapshot(), [documentStore])
  const subscribeDocumentSummaries = useCallback((listener: () => void) => documentStore.subscribeList(listener), [documentStore])
  const getPendingSerializations = useCallback(() => pendingSerializations.current, [])
  const selectFolderAsset = useCallback((path: FolderPath | null) => {
    if (!path) return
    setActiveId('')
    setShowCommand(false)
    history.replaceState(null, '', '#/')
  }, [])
  const reportFolderError = useCallback((message: string) => notify(message, 'error'), [notify])
  const setFolderGeneration = useCallback((generation: number) => folderResources.current.setGeneration(generation), [])
  const setFolderTransitionPhase = useCallback((phase: FolderTransitionPhase) => { workspaceOperations.current.setPhase(phase) }, [])
  const folderWorkspaceOptions = useMemo(() => ({
    getDocuments,
    getDocumentSummaries,
    subscribeDocumentSummaries,
    getPendingSerializations,
    loadDocumentPayload: hydrateDocumentPayload,
    saveService: documentSaveService,
    onCommit: commitWorkspaceTransition,
    onDocumentOpen: addFolderDocument,
    onDocumentSelect: selectFolderDocument,
    onAssetSelect: selectFolderAsset,
    onError: reportFolderError,
    onMetadataChange: persistWorkspaceMetadata,
    onGenerationChange: setFolderGeneration,
    onTransitionLock: handleTransitionLock,
    onTransitionPhase: setFolderTransitionPhase,
    settleExternalWork: settleWorkspaceOperations
  }), [addFolderDocument, commitWorkspaceTransition, documentSaveService, getDocumentSummaries, getDocuments, getPendingSerializations, handleTransitionLock, hydrateDocumentPayload, persistWorkspaceMetadata, reportFolderError, selectFolderAsset, selectFolderDocument, setFolderGeneration, setFolderTransitionPhase, settleWorkspaceOperations, subscribeDocumentSummaries])
  const folderWorkspace = useFolderWorkspace(folderWorkspaceOptions)
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
    if (workspaceOperations.current.locked || resettingData.current) return
    folderWorkspaceRef.current?.beginPicking()
    folderInputRef.current?.open()
  }, [])
  const closeFolderWorkspace = useCallback(() => {
    if (workspaceOperations.current.locked || resettingData.current) return
    folderWorkspaceRef.current?.closeFolder()
  }, [])
  const selectFolderForRefresh = useCallback(() => {
    if (workspaceOperations.current.locked || resettingData.current) return
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
      if (!latest || latest.folder?.id !== folderId || latest.generation !== generation || latest.source !== source || workspaceOperations.current.locked) return
      if (permission !== 'granted') { notify('폴더 읽기 권한이 없습니다. 폴더 열기에서 현재 폴더를 선택하세요.', 'error'); return }
      latest.refreshFolder(path)
    }).catch((error: unknown) => notify(error instanceof Error ? error.message : '폴더를 새로고침하지 못했습니다.', 'error'))
  }, [notify, selectFolderForRefresh])

  const openFolderPathAction = folderWorkspace.openPath
  const openFolderPath = useCallback((path: FolderPath) => { void openFolderPathAction(path) }, [openFolderPathAction])
  const folderTreeProps = useMemo(() => folderWorkspace.folder ? {
    entriesByPath: folderWorkspace.entriesByPath,
    loadingPaths: folderWorkspace.loadingPaths,
    errorsByPath: folderWorkspace.errorsByPath,
    activePath: folderWorkspace.activePath,
    dirtyPaths: folderWorkspace.dirtyPaths,
    openPaths: new Set(documents.filter((item) => item.folderRef?.folderId === folderWorkspace.folder!.id).map((item) => item.folderRef!.path)),
    onToggleDirectory: folderWorkspace.toggleDirectory,
    onOpenPath: openFolderPath,
    onRefresh: refreshFolder
  } : undefined, [documents, folderWorkspace.activePath, folderWorkspace.dirtyPaths, folderWorkspace.entriesByPath, folderWorkspace.errorsByPath, folderWorkspace.folder, folderWorkspace.loadingPaths, folderWorkspace.toggleDirectory, openFolderPath, refreshFolder])

  const openDrawerFolderPath = useCallback((path: FolderPath) => {
    void openFolderPathAction(path)
    setShowFolderDrawer(false)
  }, [openFolderPathAction])
  const closeFolderDrawer = useCallback(() => setShowFolderDrawer(false), [])
  const drawerTree = useMemo(() => folderTreeProps ? {
    ...folderTreeProps,
    onOpenPath: openDrawerFolderPath
  } : undefined, [folderTreeProps, openDrawerFolderPath])

  const toggleSidebar = useCallback(() => setSidebarCollapsed((collapsed) => !collapsed), [])
  const openSidebarCommands = useCallback(() => { if (!workspaceOperations.current.locked) setShowCommand(true) }, [])
  const openSidebarSettings = useCallback(() => { if (!workspaceOperations.current.locked) setShowSettings(true) }, [])
  const closeSidebarDocument = useCallback((id: string) => { void closeDocument(id) }, [closeDocument])

  const switchTab = useCallback((id: string) => {
    if (workspaceOperations.current.locked) return
    const selected = documentStore.get(id)
    folderWorkspaceRef.current?.selectDocumentPath(selected?.folderRef?.path ?? null)
    setActiveId(id)
    location.hash = `/file/${id}`
  }, [documentStore])

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
    ...(activeSummary && activeSummary.contentKind !== 'unsupported' ? [{ id: 'revert', title: '처음 연 파일로 되돌리기', detail: activeSummary.name, section: '문서', icon: 'new' as const, run: () => { void revertCurrent() } }] : []),
    { id: 'paste', title: '클립보드에서 열기', detail: '붙여넣은 텍스트를 새 문서로 엽니다.', section: '입력', icon: 'paste', run: () => { void handlePaste() } },
    { id: 'settings', title: '설정', detail: '테마, 로컬 복구와 앱 정보', section: '앱', icon: 'settings', run: () => setShowSettings(true) },
    { id: 'theme', title: '테마 전환', detail: '시스템 · 라이트 · 다크', section: '앱', icon: 'theme', run: () => changeTheme(theme === 'dark' ? 'light' : 'dark') }
  ], [documents, pickFiles, openFolderPicker, folderWorkspace.folder, closeFolderWorkspace, refreshFolder, createBlank, handlePaste, changeTheme, theme, activeSummary, revertCurrent, switchTab])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (workspaceOperations.current.locked) return
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
      if (!editingText && activeSummary?.format === 'csv' && event.key === '/') {
        event.preventDefault()
        document.querySelector<HTMLInputElement>('.csv-toolbar input')?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeSummary?.format, changeTheme, theme, showCommand, showSettings, showPaste, pickFiles, saveCurrent, undo])

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
        if (workspaceOperations.current.locked || resettingData.current) return
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
    (model, group) => changeModel(document.id, documentStore.get(document.id)?.revision ?? document.revision, model, group),
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
  return <div className="app-shell" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
    <FilePicker ref={inputRef} onFiles={(files, format) => { void openFiles(files, format) }} onError={notify} />
    <FolderPicker ref={folderInputRef} onFolder={(picked) => { void folderWorkspace.acceptPickedFolder(picked) }} onCancel={() => { if (folderWorkspace.phase === 'picking') folderWorkspace.cancelTransition(); else folderWorkspace.cancelReconnect() }} onError={(message) => { if (folderWorkspace.phase === 'picking') folderWorkspace.cancelTransition(); else folderWorkspace.cancelReconnect(); notify(message, 'error') }} />
    <WorkspaceSidebar documents={documents} activeId={activeId} collapsed={sidebarCollapsed} onToggleCollapsed={toggleSidebar} onPickFiles={pickFiles} onOpenCommands={openSidebarCommands} onSelectDocument={switchTab} onCloseDocument={closeSidebarDocument} onOpenSettings={openSidebarSettings} folder={folderWorkspace.folder} folderTree={folderTreeProps} folderPickingAvailable={folderPickingAvailable} onOpenFolder={openFolderPicker} onCloseFolder={closeFolderWorkspace} />

    <main className="main-column">
      <DocumentHeader document={activeDocument} theme={resolvedTheme} canShare={'share' in navigator && activeDocument?.contentKind !== 'unsupported'} saveLabel={saveLabel} onModeChange={setMode} onThemeChange={changeTheme} onUndo={() => undo()} onRedo={() => undo(true)} onSave={() => { void saveCurrent() }} onShare={() => { void shareCurrent() }} onClose={() => { if (activeDocument) void closeDocument(activeDocument.id) }} onPickFiles={() => pickFiles()} onOpenCommands={() => { if (!workspaceOperations.current.locked) setShowCommand(true) }} onOpenSettings={() => { if (!workspaceOperations.current.locked) setShowSettings(true) }} onBrowseFolder={() => { if (!folderPickingAvailable) return; if (folderWorkspace.folder) setShowFolderDrawer(true); else openFolderPicker() }} />

      {recoveryIssues.length > 0 && <section className="source-diagnostic" role="alert" aria-label="복구하지 못한 저장 문서">
        <strong>복구하지 못한 저장 문서 {recoveryIssues.length}개</strong>
        <span>저장 데이터는 보존되어 있습니다. 다시 읽거나 복구 레코드를 내보낼 수 있습니다.</span>
        {recoveryIssues.map((issue, index) => <div className="recovery-issue-row" key={issue.id ?? index}>
          <span>{issue.id ?? '문서 식별자 없음'} · {issue.message}</span>
          {issue.id && <><button className="subtle-button" type="button" onClick={() => { void retryRecoveryDocument(issue) }}>다시 읽기</button><button className="subtle-button" type="button" onClick={() => { void exportRecoveryDocument(issue) }}>복구 데이터 내보내기</button></>}
        </div>)}
        <button className="icon-button" type="button" aria-label="복구 안내 닫기" onClick={() => setRecoveryIssues([])}><X size={14} /></button>
      </section>}

      {activeDocument ? <>
        <div id={`document-panel-${activeDocument.id}`} className="document-workspace" key={activeDocument.id} role="tabpanel" aria-label={`${activeDocument.mode === 'view' ? '보기' : '원본'} · ${activeDocument.name}`} tabIndex={0}>
          {activeDocument.payloadLoaded === false ? <div className="source-diagnostic" role="status"><span>저장 문서 본문을 불러오고 있습니다.</span></div> : <>
          {activeDocument.parseState === 'pending' && !(activeDocument.format === 'md' && activeDocument.mode === 'view') && <div className="source-diagnostic" role="status"><span>최신 원문을 해석하고 있습니다. 편집은 계속할 수 있습니다.</span></div>}
          {activeDocument.parseState === 'error' && <div className="source-diagnostic" role="alert"><span>원문을 해석하지 못했습니다. 마지막 유효 보기는 유지되며 구조 편집은 잠깁니다.</span><small>{activeDocument.diagnostics.find((item) => item.severity === 'error')?.message ?? activeDocument.sourceError}</small></div>}
          {activeDocument.parseState === 'ready' && activeDocument.diagnostics.some((item) => item.severity === 'warning') && <div className="inline-warning" role="status">진단 {activeDocument.diagnostics.filter((item) => item.severity === 'warning').length}개 · {activeDocument.diagnostics.find((item) => item.severity === 'warning')?.message}</div>}
          <FeatureLoadBoundary key={activeDocument.id} fileName={activeDocument.name} sourceText={activeDocument.text}>
            <Suspense fallback={null}>
              {activeDocument.mode === 'view' && !activeDocument.contentKind && !isBlockEditorFormat(activeDocument.format) ? <ViewerZoom>{renderActiveDocument(activeDocument)}</ViewerZoom> : renderActiveDocument(activeDocument)}
            </Suspense>
          </FeatureLoadBoundary>
          </>}
        </div>
        {activeDocument.payloadLoaded !== false && activeDocument.mode === 'source' && <div className="source-statusbar"><span>{activeDocument.contentKind === 'plain-text' ? '일반 텍스트 · 원본 보기' : '원본 텍스트 · UTF-8 출력'}</span><span>{activeDocument.text.split(/\r\n|\r|\n/).length}줄 · {activeDocument.text.length.toLocaleString()}자</span><div className="toolbar-spacer" />{activeDocument.parseState === 'pending' ? <span>해석 중</span> : activeDocument.parseState === 'error' ? <span className="error-label">문법 오류</span> : <span className="ready-label">{activeDocument.contentKind === 'plain-text' ? '텍스트' : '유효한 문서'}</span>}</div>}
      </> : folderWorkspace.folder ? (folderWorkspace.activeAssetPath && folderWorkspace.source
        ? <FolderAssetPreview source={folderWorkspace.source} generation={folderWorkspace.generation} path={folderWorkspace.activeAssetPath} resources={folderResources.current} onClose={() => folderWorkspace.selectDocumentPath(null)} />
        : <section className="folder-empty-state" aria-live="polite"><FolderOpen size={24} /><strong>{folderWorkspace.source ? '폴더에서 파일을 선택하세요' : '폴더에 접근할 수 없습니다'}</strong><p>{folderWorkspace.source ? `${folderWorkspace.folder.name} 폴더의 트리에서 문서를 열 수 있습니다.` : '복구된 작업본은 유지됩니다. 폴더 목록의 새로고침을 눌러 현재 폴더 접근을 복구하세요.'}</p></section>)
        : <WelcomeScreen onOpen={() => pickFiles()} onPaste={() => { void handlePaste() }} onCommand={() => { if (!workspaceOperations.current.locked) setShowCommand(true) }} />}

      <DocumentActionBar document={activeDocument?.payloadLoaded === false ? null : activeDocument} saveLabel={saveLabel} onModeChange={setMode} onUndo={() => undo()} onRedo={() => undo(true)} onSave={() => { void saveCurrent() }} />
      {offlineReady && <div className="status-banner"><Check size={15} />기본 파일을 오프라인에서 사용할 수 있습니다. 글꼴·편집기는 처음 사용할 때 준비합니다.<button className="icon-button" aria-label="알림 닫기" onClick={() => setOfflineReady(false)}><X size={14} /></button></div>}
      {updateReady && !relayRoute && <div className="status-banner update-banner"><span>새 버전을 사용할 수 있습니다. 업데이트는 사용자가 선택할 때 적용됩니다.</span><button className="subtle-button" disabled={folderWorkspace.isTransitioning || resettingData.current} onClick={() => { if (workspaceOperations.current.locked || resettingData.current) return; window.dispatchEvent(new Event('viewer:apply-update')) }}>업데이트</button><button className="icon-button" aria-label="업데이트 알림 닫기" onClick={() => setUpdateReady(false)}><X size={14} /></button></div>}
    </main>

    {showCommand && <CommandMenu commands={commands} onClose={closeCommandMenu} />}
    {(folderWorkspace.phase === 'confirming' || folderWorkspace.phase === 'saving') && <FolderTransitionDialog phase={folderWorkspace.phase} rows={folderWorkspace.rows} closing={folderWorkspace.isClosing} busyRowId={folderWorkspace.busyRowId} onSaveAll={() => { void folderWorkspace.saveAll() }} onDiscard={() => { void folderWorkspace.discardAndContinue() }} onCancel={folderWorkspace.cancelTransition} onContinue={(row) => { void folderWorkspace.continueSave(row) }} onConfirmDownload={(row) => { void folderWorkspace.confirmDownload(row) }} />}
    {showFolderDrawer && folderWorkspace.folder && drawerTree && <FolderTreeDrawer folder={folderWorkspace.folder} tree={drawerTree} onClose={closeFolderDrawer} />}
    {showSettings && <SettingsDialog theme={theme} onThemeChange={changeTheme} recoveryEnabled={recoveryEnabled} onRecoveryChange={changeRecoveryFromSettings} onClearData={clearDataFromSettings} onClose={closeSettings} onInstall={installFromSettings} canInstall={Boolean(installPrompt)} />}
    {showPaste && <PasteDialog text={pasteText} format={pasteFormat} onTextChange={setPasteText} onFormatChange={setPasteFormat} onClose={() => setShowPaste(false)} onOpen={() => { void createFromPaste() }} />}
    {runtimeAssetProgress && <RuntimeAssetDialog progress={runtimeAssetProgress} onRetry={() => { void retryRuntimeAssetGroup(runtimeAssetProgress.group).catch(() => undefined) }} onContinue={() => continueWithoutRuntimeAssetGroup(runtimeAssetProgress.group)} />}
    {relayRoute && relayError && <div className="status-banner relay-error-banner" role="status" aria-live="polite"><span>{relayError}</span><button className="subtle-button" onClick={() => { void runRelay(relayRoute) }}>다시 시도</button></div>}
    <div className="toast-stack" aria-live="polite" aria-atomic="false">{notices.map((notice) => <div className={`toast ${notice.tone}`} key={notice.id}><span>{notice.message}</span><button aria-label="알림 닫기" onClick={() => setNotices((items) => items.filter((item) => item.id !== notice.id))}><X size={13} /></button></div>)}</div>
  </div>
}

function renderDocument(document: ViewerDocument, onModel: (model: DocumentModel, group?: 'typing' | 'command') => void, onText: (text: string, group?: 'typing' | 'command') => void, onOpenAttachment: (index: number) => void, onDownloadAttachment: (index: number) => void, theme: 'light' | 'dark', onUndo: () => void, onRedo: () => void, structuredFormat: StructuredFormat, onStructuredFormat: (format: StructuredFormat) => void, markdownContext?: Omit<MarkdownReferenceContext, 'ownerText'>) {
  if (document.contentKind === 'unsupported') return <UnsupportedFilePage name={document.name} />
  if (document.contentKind === 'plain-text' || document.mode === 'source') return <SourceEditor documentId={document.id} format={document.format} plainText={document.contentKind === 'plain-text'} csvDelimiter={document.format === 'csv' ? document.model.delimiter : ','} value={document.text} diagnostics={document.diagnostics} theme={theme} onChange={onText} onUndo={onUndo} onRedo={onRedo} label={`${document.name} 원본 편집기`} />
  switch (document.format) {
    case 'csv': return <CsvEditor document={document} model={document.model} onChange={(model, group) => onModel(model, group)} theme={theme} />
    case 'md': return <MarkdownEditor document={document} text={document.text} theme={theme} onChange={onText} onUndo={onUndo} onRedo={onRedo} markdownContext={markdownContext} />
    case 'eml': return <EmailEditor document={document} model={document.model} onOpenAttachment={onOpenAttachment} onDownloadAttachment={onDownloadAttachment} />
    case 'ics': return <CalendarEditor document={document} model={document.model} onChange={(model, group) => onModel(model, group)} />
    case 'vcf': return <ContactsEditor document={document} model={document.model} onChange={(model, group) => onModel(model, group)} />
    case 'json': case 'yaml': case 'toml': return <StructuredDataEditor document={document} model={document.model} onChange={onModel} outputFormat={structuredFormat} onOutputFormat={onStructuredFormat} />
    case 'env': return <EnvEditor document={document} model={document.model} onChange={(model, group) => onModel(model, group)} />
    case 'diff': return <DiffView document={document} model={document.model} />
  }
}

type StructuredParsedFile = Extract<ParsedFile, { format: StructuredFormat }>

function isStructuredParsedFile(parsed: ParsedFile): parsed is StructuredParsedFile {
  return isStructuredFormat(parsed.format)
}

function preserveEnvRecovery(parsed: EnvModel, previous: EnvModel): EnvModel {
  const parsedRoot = parsed.blocks.root
  const previousRoot = previous.blocks.root
  if (!parsedRoot || parsedRoot.kind !== 'object' || !previousRoot || previousRoot.kind !== 'object') return parsed
  const items = parsedRoot.items.map((item, index) => {
    const old = previousRoot.items[index]
    if (!old || old.key !== item.key) return item
    const node = item.node?.kind === 'scalar' && old.node?.kind === 'scalar' ? { ...item.node, id: old.node.id } : item.node
    return { ...item, id: old.id, node }
  })
  const slots = new Set(previous.blocks.loose.flatMap((block) => block.slot ? [block.slot.id] : []))
  const detached = previous.detached.filter((item) => slots.has(item.slotId))
  let assignmentIndex = 0
  const records = parsed.syntax?.records.map((record) => {
    if (record.type !== 'assignment') return record
    const slotId = items[assignmentIndex]?.id ?? record.slotId
    assignmentIndex += 1
    return { ...record, slotId }
  })
  return {
    ...parsed,
    blocks: { ...parsed.blocks, root: { ...parsedRoot, id: previousRoot.id, items }, loose: previous.blocks.loose },
    syntax: parsed.syntax && records ? { ...parsed.syntax, records } : parsed.syntax,
    detached
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
