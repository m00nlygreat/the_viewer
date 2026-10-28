import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Check, ChevronDown, ClipboardPaste, Command, FilePlus2, FileText,
  FolderOpen, LogOut, Moon, PanelLeftClose, PanelLeftOpen, Redo2, Settings2, Share2,
  Sun, Undo2, Upload, X
} from 'lucide-react'
import { CommandMenu, type CommandItem } from '../components/CommandMenu'
import { SettingsDialog } from '../components/SettingsDialog'
import { useFocusTrap } from '../components/useFocusTrap'
import { ViewerZoom } from '../components/ViewerZoom'
import { FORMAT_MIME, FORMATS, getFormat, type CalendarModel, type ContactModel, type CsvModel, type DocumentModel, type EmailModel, type Format, type ThemePreference, type ViewerDocument } from '../domain/types'
import { makeDocumentFromBytes } from '../domain/session'
import { parseWithWorker } from '../domain/workerClient'
import { serializeDocument } from '../domain/serialize'
import { clearAllData, clearDocuments, loadDocuments, loadTheme, readSetting, removeDocument, saveDocument, takeShareTicket, writeSetting } from '../platform/storage'
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

interface HistoryEntry { model: DocumentModel; text: string; sourceError?: string; isDirty: boolean }
interface Notice { id: number; tone: 'success' | 'error' | 'info'; message: string }
interface BeforeInstallPrompt extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
const fileAccept = FORMATS.map((format) => `.${format}`).join(',')
const labels = { eml: '이메일', csv: '표', md: '문서', ics: '일정', vcf: '연락처' } satisfies Record<Format, string>

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
  const attachmentInputRef = useRef<FilePickerHandle>(null)
  const attachmentTarget = useRef('')
  const historyRef = useRef(new Map<string, { undo: HistoryEntry[]; redo: HistoryEntry[] }>())
  const sourceParseTimer = useRef<number | undefined>(undefined)
  const sourceRequest = useRef(0)
  const noticeTimer = useRef(new Map<number, number>())
  const relayRuns = useRef(new Set<string>())
  const receivedRelayFiles = useRef(new Map<string, ReceivedExtensionFile>())
  const activeDocument = documents.find((document) => document.id === activeId) ?? null
  const resolvedTheme = theme === 'system' ? (systemLight ? 'light' : 'dark') : theme

  const notify = useCallback((message: string, tone: Notice['tone'] = 'info') => {
    const id = Date.now() + Math.random()
    setNotices((items) => [...items.slice(-2), { id, tone, message }])
    const timer = window.setTimeout(() => setNotices((items) => items.filter((item) => item.id !== id)), 4200)
    noticeTimer.current.set(id, timer)
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [storedTheme, recover] = await Promise.all([loadTheme(), readSetting('recovery', true)])
        const saved = recover ? await loadDocuments() : []
        if (cancelled) return
        setTheme(storedTheme)
        setRecoveryEnabled(recover)
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
    if (!loaded || !recoveryEnabled) return
    const timer = window.setTimeout(() => {
      for (const item of documents) void saveDocument(item).catch(() => notify('로컬 작업 복구에 저장하지 못했습니다.', 'error'))
    }, 180)
    return () => clearTimeout(timer)
  }, [documents, loaded, recoveryEnabled, notify])

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
    if (activeDocument?.mode !== 'source') return
    const id = activeDocument.id
    const text = activeDocument.text
    const revision = ++sourceRequest.current
    window.clearTimeout(sourceParseTimer.current)
    sourceParseTimer.current = window.setTimeout(() => {
      const bytes = new TextEncoder().encode(text)
      void parseWithWorker(activeDocument.name, activeDocument.mimeType, bytes, activeDocument.format).then((parsed) => {
        if (sourceRequest.current !== revision) return
        setDocuments((items) => items.map((item) => item.id === id && item.text === text ? { ...item, model: parsed.model, sourceError: undefined } : item))
      }).catch((error: unknown) => {
        if (sourceRequest.current !== revision) return
        const message = error instanceof Error ? error.message : '원본 문법을 해석하지 못했습니다.'
        setDocuments((items) => items.map((item) => item.id === id && item.text === text ? { ...item, sourceError: message } : item))
      })
    }, 450)
    return () => window.clearTimeout(sourceParseTimer.current)
  }, [activeDocument?.id, activeDocument?.mode, activeDocument?.text, activeDocument?.format, activeDocument?.mimeType, activeDocument?.name])

  const openFiles = useCallback(async (files: PickedFile[], forcedFormat?: Format): Promise<{ opened: ViewerDocument[]; errors: string[] }> => {
    if (!files.length) return { opened: [], errors: [] }
    const opened: ViewerDocument[] = []
    const errors: string[] = []
    let first: ViewerDocument | null = null
    for (const file of files) {
      try {
        const document = await makeDocumentFromBytes(file.name, file.type, file.bytes, undefined)
        if (forcedFormat && document.format !== forcedFormat) throw new Error(`선택한 형식 ${forcedFormat.toUpperCase()}과 파일 내용이 다릅니다.`)
        setDocuments((items) => [document, ...items.filter((item) => item.id !== document.id)])
        opened.push(document)
        if (!first) first = document
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
    receiveLaunchedFiles((files) => { void openFiles(files) })
  }, [openFiles])

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
    const match = location.hash.match(/^#\/?share\/([0-9a-f-]+)$/i)
    if (!match) return
    void takeShareTicket(match[1]).then(async (files) => {
      if (!files?.length) { notify('공유한 파일이 없거나 보관 시간이 지났습니다.', 'error'); return }
      for (const item of files) {
        try { await openFiles([{ name: item.name, type: item.type, bytes: new Uint8Array(item.bytes) }]) }
        catch (error) { notify(error instanceof Error ? error.message : '공유한 파일을 열지 못했습니다.', 'error') }
      }
    }).catch(() => notify('공유한 파일을 복구하지 못했습니다.', 'error'))
  }, [notify, openFiles])

  const pickFiles = useCallback((format?: Format) => {
    inputRef.current?.open(format)
  }, [])

  const updateDocument = useCallback((id: string, update: (document: ViewerDocument) => ViewerDocument, contentChanged = true, dirtyState?: boolean) => {
    setDocuments((items) => items.map((document) => {
      if (document.id !== id) return document
      if (contentChanged) {
        const history = historyRef.current.get(id) ?? { undo: [], redo: [] }
        history.undo.push({ model: document.model, text: document.text, sourceError: document.sourceError, isDirty: document.isDirty })
        if (history.undo.length > 80) history.undo.shift()
        history.redo = []
        historyRef.current.set(id, history)
      }
      return { ...update(document), revision: document.revision + (contentChanged ? 1 : 0), isDirty: contentChanged ? (dirtyState ?? true) : document.isDirty, lastEditedAt: contentChanged ? Date.now() : document.lastEditedAt }
    }))
  }, [])

  const changeModel = useCallback((id: string, model: DocumentModel) => {
    const item = documents.find((document) => document.id === id)
    if (!item) return
    updateDocument(id, (current) => ({ ...current, model, sourceError: undefined }))
    void serializeDocument(item.format, model).then((text) => setDocuments((items) => items.map((current) => current.id === id && current.model === model ? { ...current, text } : current)))
  }, [documents, updateDocument])

  const setMode = useCallback((mode: ViewerDocument['mode']) => {
    if (!activeDocument) return
    if (activeDocument.sourceError && mode !== 'source') notify('원본 문법 오류가 남아 있습니다. 마지막으로 해석한 구조를 표시합니다.', 'info')
    updateDocument(activeDocument.id, (item) => ({ ...item, mode }), false)
  }, [activeDocument, notify, updateDocument])

  const undo = useCallback((redo = false) => {
    if (!activeDocument) return
    const stack = historyRef.current.get(activeDocument.id) ?? { undo: [], redo: [] }
    const from = redo ? stack.redo : stack.undo
    const to = redo ? stack.undo : stack.redo
    const previous = from.pop()
    if (!previous) return
    to.push({ model: activeDocument.model, text: activeDocument.text, sourceError: activeDocument.sourceError, isDirty: activeDocument.isDirty })
    historyRef.current.set(activeDocument.id, stack)
    setDocuments((items) => items.map((item) => item.id === activeDocument.id ? { ...item, ...previous, revision: item.revision + 1, lastEditedAt: Date.now() } : item))
  }, [activeDocument])

  const createBlank = useCallback(async (format: Format) => {
    const templates: Record<Format, string> = {
      eml: 'Subject: \r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n',
      csv: '', md: '',
      ics: 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//The Viewer//EN\r\nCALSCALE:GREGORIAN\r\nEND:VCALENDAR\r\n',
      vcf: 'BEGIN:VCARD\r\nVERSION:4.0\r\nFN:\r\nN:;;;;\r\nEND:VCARD\r\n'
    }
    const bytes = new TextEncoder().encode(templates[format])
    try {
      const document = await makeDocumentFromBytes(`Untitled.${format}`, FORMAT_MIME[format], bytes)
      document.mode = 'edit'
      setDocuments((items) => [document, ...items])
      setActiveId(document.id)
      setShowCommand(false)
      setTimeout(() => { location.hash = `/file/${document.id}` }, 0)
    } catch (error) { notify(error instanceof Error ? error.message : '새 파일을 만들지 못했습니다.', 'error') }
  }, [notify])

  const outputPayload = useCallback(async (item: ViewerDocument): Promise<{ bytes: Uint8Array; text: string }> => {
    if (!item.isDirty) return { bytes: new Uint8Array(item.sourceBytes.slice(0)), text: item.savedText }
    const text = item.sourceError ? item.text : await serializeDocument(item.format, item.model)
    const output = item.format === 'csv' && (item.model as CsvModel).bom ? `\uFEFF${text}` : text
    return { bytes: new TextEncoder().encode(output), text }
  }, [])

  const saveCurrent = useCallback(async () => {
    if (!activeDocument) return
    const item = activeDocument
    let payload: { bytes: Uint8Array; text: string }
    try { payload = await outputPayload(item) }
    catch (error) { notify(error instanceof Error ? `파일을 구성하지 못했습니다: ${error.message}` : '파일을 구성하지 못했습니다.', 'error'); return }
    let status: 'saved' | 'started' | 'cancelled' = 'started'
    try {
      status = await saveLocalFile(item.name, item.format, payload.bytes)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') { status = 'cancelled' }
      else { notify(error instanceof Error ? `내보내기 실패: ${error.message}` : '내보내기 실패', 'error'); return }
    }
    if (status === 'cancelled') return
    const savedBytes = payload.bytes.slice().buffer as ArrayBuffer
    setDocuments((items) => items.map((document) => document.id === item.id ? { ...document, savedText: payload.text, sourceText: payload.text, sourceBytes: savedBytes, isDirty: document.revision === item.revision ? false : document.isDirty } : document))
    notify(status === 'saved' ? '파일을 저장했습니다.' : '내려받기를 시작했습니다.', 'success')
  }, [activeDocument, notify, outputPayload])

  const revertCurrent = useCallback(async () => {
    if (!activeDocument || !window.confirm('마지막 저장·내보내기 기준으로 복원할까요? 현재 편집 내용은 사라집니다.')) return
    const item = activeDocument
    try {
      const parsed = await parseWithWorker(item.name, item.mimeType, new Uint8Array(item.sourceBytes))
      if (documentsRef.current.find((document) => document.id === item.id)?.revision !== item.revision) return
      setDocuments((items) => items.map((document) => document.id === item.id ? { ...document, text: parsed.text, model: parsed.model, sourceText: parsed.text, savedText: parsed.text, sourceError: undefined, isDirty: false, revision: document.revision + 1 } : document))
      historyRef.current.set(item.id, { undo: [], redo: [] })
      notify('마지막 저장본으로 복원했습니다.', 'success')
    } catch (error) {
      const message = error instanceof Error ? error.message : '원본 파일을 해석하지 못했습니다.'
      if (documentsRef.current.find((document) => document.id === item.id)?.revision !== item.revision) return
      setDocuments((items) => items.map((document) => document.id === item.id ? { ...document, text: item.savedText, sourceError: message, isDirty: false, revision: document.revision + 1 } : document))
      historyRef.current.set(item.id, { undo: [], redo: [] })
      notify('저장된 원문으로 복원했습니다. 구조 편집에는 유효한 문서가 필요합니다.', 'info')
    }
  }, [activeDocument, notify])

  const closeDocument = useCallback(async (id: string) => {
    const item = documents.find((document) => document.id === id)
    if (!item) return
    if (item.isDirty && !window.confirm(`“${item.name}”에 내보내지 않은 변경이 있습니다. 닫을까요?`)) return
    setDocuments((items) => items.filter((document) => document.id !== id))
    await removeDocument(id).catch(() => undefined)
    historyRef.current.delete(id)
    if (activeId === id) {
      const next = documents.find((document) => document.id !== id)
      setActiveId(next?.id ?? '')
      if (next) location.hash = `/file/${next.id}`
      else location.hash = '/'
    }
  }, [documents, activeId])

  const openAttachment = useCallback(async (index: number) => {
    if (!activeDocument || activeDocument.format !== 'eml') return
    const attachment = (activeDocument.model as EmailModel).attachments[index]
    if (!attachment) return
    const format = getFormat(attachment.filename, attachment.mimeType)
    if (!format) { notify('이 파일 형식은 뷰어에서 열 수 없습니다. 내려받기를 사용하세요.', 'info'); return }
    try {
      const child = await makeDocumentFromBytes(attachment.filename, attachment.mimeType, new Uint8Array(attachment.content), activeDocument.id)
      setDocuments((items) => [child, ...items])
      setActiveId(child.id)
      location.hash = `/file/${child.id}`
    } catch (error) { notify(error instanceof Error ? error.message : '첨부 파일을 열지 못했습니다.', 'error') }
  }, [activeDocument, notify])

  const downloadAttachment = useCallback((index: number) => {
    if (!activeDocument || activeDocument.format !== 'eml') return
    const attachment = (activeDocument.model as EmailModel).attachments[index]
    if (!attachment) return
    downloadLocalFile(attachment.filename || 'attachment.bin', attachment.mimeType, new Uint8Array(attachment.content))
  }, [activeDocument])

  const receiveAttachments = useCallback((files: PickedFile[]) => {
    const id = attachmentTarget.current
    attachmentTarget.current = ''
    const item = documents.find((document) => document.id === id)
    if (!item || item.format !== 'eml') return
    const model = item.model as EmailModel
    const attachments = files.map((file) => ({ filename: file.name, mimeType: file.type || 'application/octet-stream', content: Array.from(file.bytes) }))
    changeModel(item.id, { ...model, attachments: [...model.attachments, ...attachments] })
  }, [documents, changeModel])

  const addAttachment = useCallback(() => {
    if (!activeDocument || activeDocument.format !== 'eml') return
    attachmentTarget.current = activeDocument.id
    attachmentInputRef.current?.open(undefined, '*/*')
  }, [activeDocument])

  const removeAttachment = useCallback((index: number) => {
    if (!activeDocument || activeDocument.format !== 'eml') return
    const model = activeDocument.model as EmailModel
    changeModel(activeDocument.id, { ...model, attachments: model.attachments.filter((_, itemIndex) => itemIndex !== index) })
  }, [activeDocument, changeModel])

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
    void writeSetting('theme', value).catch(() => undefined)
  }, [])
  const changeRecovery = useCallback(async (enabled: boolean) => {
    setRecoveryEnabled(enabled)
    await writeSetting('recovery', enabled).catch(() => undefined)
    if (!enabled) await clearDocuments().catch(() => undefined)
  }, [])
  const clearData = useCallback(async () => {
    await clearAllData().catch(() => undefined)
    setDocuments([])
    setActiveId('')
    setTheme('system')
    setRecoveryEnabled(true)
    setShowSettings(false)
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
      const payload = await outputPayload(activeDocument)
      await shareLocalFile(activeDocument.name, activeDocument.format, payload.bytes)
      notify('공유를 시작했습니다.', 'success')
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) notify('파일을 공유하지 못했습니다.', 'error')
    }
  }, [activeDocument, notify, outputPayload])

  const commands = useMemo<CommandItem[]>(() => [
    ...documents.map((item) => ({ id: `switch-${item.id}`, title: `열린 파일 · ${safeFilename(item.name)}`, detail: `${labels[item.format]}${item.isDirty ? ' · 수정됨' : ''}`, section: '열린 파일', icon: 'open' as const, run: () => { setActiveId(item.id); location.hash = `/file/${item.id}` } })),
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
    void readDroppedFiles(event.dataTransfer.files).then((files) => openFiles(files)).catch(() => notify('놓은 파일을 읽지 못했습니다.', 'error'))
  }, [openFiles, notify])
  const dirty = activeDocument?.isDirty ?? false
  const switchTab = (id: string) => { setActiveId(id); location.hash = `/file/${id}` }
  const modeLabel: Record<ViewerDocument['mode'], string> = { view: '보기', edit: '편집', source: '원본' }
  const renderActiveDocument = (document: ViewerDocument) => renderDocument(document, (model) => changeModel(document.id, model), (text) => updateDocument(document.id, (item) => ({ ...item, text, sourceError: undefined }), true, text !== document.savedText), openAttachment, downloadAttachment, addAttachment, removeAttachment, resolvedTheme)

  return <div className="app-shell" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
    <FilePicker ref={inputRef} onFiles={(files, format) => { void openFiles(files, format) }} onError={notify} />
    <FilePicker ref={attachmentInputRef} onFiles={(files) => { void receiveAttachments(files) }} onError={notify} />
    <aside id="document-sidebar" className={`sidebar${sidebarCollapsed ? ' collapsed' : ''}`}>
      <div className="sidebar-brand"><img src={`${__APP_BASE__}icons/viewer.svg`} alt="" /><span>The Viewer</span><button className="sidebar-toggle" aria-label={sidebarCollapsed ? '사이드바 펼치기' : '사이드바 접기'} title={sidebarCollapsed ? '사이드바 펼치기' : '사이드바 접기'} aria-controls="document-sidebar" aria-expanded={!sidebarCollapsed} onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}>{sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}</button></div>
      <button className="sidebar-open" aria-label="파일 열기" title="파일 열기" onClick={() => pickFiles()}><FolderOpen size={15} /><span>파일 열기</span><kbd>⌘ O</kbd></button>
      <button className="sidebar-command" aria-label="명령 메뉴" title="명령 메뉴" onClick={() => setShowCommand(true)}><Command size={14} /><span>명령 메뉴</span><kbd>⌘ K</kbd></button>
      <div className="sidebar-section-title"><span>열린 파일</span><button aria-label="파일 열기" onClick={() => pickFiles()}><FilePlus2 size={14} /></button></div>
      <nav className="document-nav" aria-label="열린 파일">
        {documents.map((item) => <div className={`document-nav-row${item.id === activeId ? ' active' : ''}`} key={item.id}>
          <button className="document-nav-select" aria-label={item.name} title={item.name} onClick={() => switchTab(item.id)}><span className={`file-badge format-${item.format}`}>{item.format.toUpperCase()}</span><span className="document-nav-name">{safeFilename(item.name)}</span>{item.isDirty && <i className="dirty-dot" aria-label="수정됨" />}</button>
          <button className="document-nav-close" aria-label={`${item.name} 닫기`} onClick={() => { void closeDocument(item.id) }}><X size={13} /></button>
        </div>)}
        {!documents.length && <div className="sidebar-empty">열린 파일이 없습니다.</div>}
      </nav>
      <div className="sidebar-bottom"><button className="sidebar-settings" aria-label="설정" title="설정" onClick={() => setShowSettings(true)}><Settings2 size={14} /><span className="sidebar-settings-label">설정</span><span className="sidebar-version">v{__APP_VERSION__}</span></button></div>
    </aside>

    <main className="main-column">
      <header className="topbar">
        <button className="mobile-menu icon-button" aria-label="열린 파일" onClick={() => setShowCommand(true)}><Command size={17} /></button>
        <div className="topbar-document"><span className="topbar-file-icon">{activeDocument ? <span className={`file-badge format-${activeDocument.format}`}>{activeDocument.format.toUpperCase()}</span> : <FileText size={16} />}</span><span className="topbar-name">{activeDocument ? safeFilename(activeDocument.name) : '작업 공간'}</span>{dirty && <span className="modified-pill">수정됨</span>}{activeDocument?.parentId && <span className="parent-tag">첨부에서 열림</span>}</div>
        <div className="topbar-actions">
          {activeDocument && <>
            <button className="icon-button desktop-only" aria-label="실행 취소" title="실행 취소" onClick={() => undo()}><Undo2 size={15} /></button>
            <button className="icon-button desktop-only" aria-label="다시 실행" title="다시 실행" onClick={() => undo(true)}><Redo2 size={15} /></button>
            <div className="topbar-divider desktop-only" />
            <div className="mode-switch" role="group" aria-label="문서 모드">{(['view', 'edit', 'source'] as const).map((mode) => <button key={mode} aria-pressed={activeDocument.mode === mode} className={activeDocument.mode === mode ? 'active' : ''} onClick={() => setMode(mode)}>{modeLabel[mode]}</button>)}</div>
            <button className="icon-button theme-toggle" aria-label={`현재 ${resolvedTheme === 'dark' ? '다크' : '라이트'} 테마; 테마 변경`} title="테마 전환" onClick={() => changeTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}>{resolvedTheme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}</button>
            <button className="primary-button export-button" onClick={() => { void saveCurrent() }}><Upload size={14} /><span>내보내기</span><ChevronDown size={12} /></button>
            {'share' in navigator && <button className="icon-button desktop-only" aria-label="시스템 공유" title="시스템 공유" onClick={() => { void shareCurrent() }}><Share2 size={15} /></button>}
            <button className="icon-button close-current" aria-label="현재 파일 닫기" onClick={() => { void closeDocument(activeDocument.id) }}><LogOut size={15} /></button>
          </>}
          {!activeDocument && <><button className="icon-button theme-toggle" aria-label="테마 설정" onClick={() => changeTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}>{resolvedTheme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}</button><button className="icon-button" aria-label="설정" onClick={() => setShowSettings(true)}><Settings2 size={16} /></button><button className="primary-button" onClick={() => pickFiles()}><FolderOpen size={14} /><span>파일 열기</span></button></>}
        </div>
      </header>

      {activeDocument ? <>
        <div className="document-workspace" key={activeDocument.id}>
          {activeDocument.sourceError && activeDocument.mode === 'source' && <div className="source-diagnostic" role="alert"><span>원본 문법 오류 · 마지막으로 해석된 구조는 유지됩니다. 이 텍스트는 원문 파일로 내보낼 수 있습니다.</span><small>{activeDocument.sourceError}</small></div>}
          <Suspense fallback={null}>
            {activeDocument.mode === 'view' ? <ViewerZoom>{renderActiveDocument(activeDocument)}</ViewerZoom> : renderActiveDocument(activeDocument)}
          </Suspense>
        </div>
        {activeDocument.mode === 'source' && <div className="source-statusbar"><span>원본 텍스트 · UTF-8 출력</span><span>{activeDocument.text.split(/\r\n|\r|\n/).length}줄 · {activeDocument.text.length.toLocaleString()}자</span><div className="toolbar-spacer" />{activeDocument.sourceError ? <span className="error-label">문법 오류</span> : <span className="ready-label">유효한 문서</span>}</div>}
      </> : <WelcomeScreen onOpen={() => pickFiles()} onPaste={() => { void handlePaste() }} onCommand={() => setShowCommand(true)} />}

      {activeDocument && <nav className="mobile-action-bar" aria-label="문서 동작">
        <div className="mode-switch" role="group" aria-label="문서 모드">{(['view', 'edit', 'source'] as const).map((mode) => <button key={mode} aria-pressed={activeDocument.mode === mode} className={activeDocument.mode === mode ? 'active' : ''} onClick={() => setMode(mode)}>{modeLabel[mode]}</button>)}</div>
        <button className="secondary-button mobile-history" aria-label="실행 취소" onClick={() => undo()}><Undo2 size={17} /></button>
        <button className="secondary-button mobile-history" aria-label="다시 실행" onClick={() => undo(true)}><Redo2 size={17} /></button>
        <button className="primary-button mobile-export" onClick={() => { void saveCurrent() }}><Upload size={15} /> 내보내기</button>
      </nav>}
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

function renderDocument(document: ViewerDocument, onModel: (model: DocumentModel) => void, onText: (text: string) => void, onOpenAttachment: (index: number) => void, onDownloadAttachment: (index: number) => void, onAddAttachment: () => void, onRemoveAttachment: (index: number) => void, theme: 'light' | 'dark') {
  if (document.mode === 'source') return <SourceEditor value={document.text} onChange={onText} markdownMode={document.format === 'md'} label={`${document.name} 원본 편집기`} />
  switch (document.format) {
    case 'csv': return <CsvEditor document={document} model={document.model as CsvModel} onChange={(model) => onModel(model)} theme={theme} />
    case 'md': return <MarkdownEditor document={document} text={(document.model as { text: string }).text} onChange={(text) => onModel({ text })} />
    case 'eml': return <EmailEditor document={document} model={document.model as EmailModel} onChange={(model) => onModel(model)} onOpenAttachment={onOpenAttachment} onDownloadAttachment={onDownloadAttachment} onAddAttachments={onAddAttachment} onRemoveAttachment={onRemoveAttachment} />
    case 'ics': return <CalendarEditor document={document} model={document.model as CalendarModel} onChange={(model) => onModel(model)} />
    case 'vcf': return <ContactsEditor document={document} model={document.model as ContactModel} onChange={(model) => onModel(model)} />
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

function safeFilename(value: string): string { return value.replace(/[\\/:*?"<>|\u0000-\u001f\u202a-\u202e\u2066-\u2069]/g, ' ').trim() || '이름 없음' }
