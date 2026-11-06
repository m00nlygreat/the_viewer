import { useCallback, useMemo, useRef, useState } from 'react'
import { documentIsDirty, makeFileDocumentFromBytes } from '../domain/session'
import { transitionFolderPhase, type FolderTransitionPhase } from '../domain/folderTransition'
import { getFormat } from '../domain/fileFormats'
import { parseLocalReference, resolveFolderPath, type MarkdownReferenceSyntax } from '../domain/folderPaths'
import { folderDocumentKey, type FolderEntry, type FolderPath, type FolderWorkspace } from '../domain/workspace'
import { listFolderChildren, readFolderFile, type FolderSource, type PickedFolder } from '../platform/folderAccess'
import { downloadLocalFile } from '../platform/browserFiles'
import type { ViewerDocument } from '../domain/types'
import type { DocumentSaveResult, DocumentSaveService } from './documentSave'
import type { TransitionRow } from './FolderTransitionDialog'
import { parseWithWorker } from '../domain/workerClient'
import type { MarkdownReferenceResolution } from '../features/markdown/localReferenceState'

interface Options {
  initialFolder?: FolderWorkspace | null
  initialSource?: FolderSource | null
  initialEntries?: FolderEntry[]
  getDocuments: () => readonly ViewerDocument[]
  getPendingSerializations: () => ReadonlyMap<string, Promise<void>>
  saveService: DocumentSaveService
  onCommit: (folder: FolderWorkspace | null, source: FolderSource | null, rootEntries: FolderEntry[]) => Promise<void>
  onDocumentOpen: (document: ViewerDocument) => void
  onDocumentSelect: (documentId: string) => void
  onAssetSelect: (path: FolderPath | null) => void
  onError: (message: string) => void
  onMetadataChange?: (folder: FolderWorkspace, source: FolderSource | null, generation: number) => void
  onGenerationChange?: (generation: number) => void
  onTransitionLock?: (locked: boolean) => void
  onTransitionPhase?: (phase: FolderTransitionPhase) => void
  settleExternalWork?: () => Promise<void>
}

export function useFolderWorkspace(options: Options) {
  const [folder, setFolder] = useState<FolderWorkspace | null>(options.initialFolder ?? null)
  const [entriesByPath, setEntriesByPath] = useState<Map<FolderPath, FolderEntry[]>>(() => options.initialFolder && options.initialEntries ? new Map([['', options.initialEntries]]) : new Map())
  const [loadingPaths, setLoadingPaths] = useState<Set<FolderPath>>(new Set())
  const [errorsByPath, setErrorsByPath] = useState<Map<FolderPath, string>>(new Map())
  const [activePath, setActivePath] = useState<FolderPath | null>(options.initialFolder?.activePath ?? null)
  const [activeAssetPath, setActiveAssetPath] = useState<FolderPath | null>(null)
  const [activeFilePath, setActiveFilePath] = useState<FolderPath | null>(null)
  const [phase, setPhase] = useState<FolderTransitionPhase>('idle')
  const [rows, setRows] = useState<TransitionRow[]>([])
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const [busyRowId, setBusyRowId] = useState<string>()
  const [isClosing, setIsClosing] = useState(false)
  const sourceRef = useRef<FolderSource | null>(options.initialSource ?? null)
  const folderRef = useRef(folder)
  folderRef.current = folder
  const phaseRef = useRef<FolderTransitionPhase>('idle')
  const transitionLock = useRef(false)
  const generation = useRef(0)
  const candidate = useRef<{ folder: FolderWorkspace; source: FolderSource; entries: FolderEntry[] } | null>(null)
  const candidateController = useRef<AbortController | null>(null)
  const commitCandidateRef = useRef<(() => Promise<void>) | null>(null)
  const revisions = useRef(new Map<string, number>())
  const controllers = useRef(new Map<FolderPath, AbortController>())
  const loadChildrenRef = useRef<((path: FolderPath, refresh?: boolean) => void) | null>(null)
  const openPromises = useRef(new Map<string, Promise<void>>())
  const referenceTextCache = useRef(new Map<FolderPath, { generation: number; text: string }>() )
  const nameIndex = useRef<{ generation: number; promise: Promise<Map<string, FolderPath[]>> } | null>(null)
  const reconnecting = useRef(false)

  const move = useCallback((event: Parameters<typeof transitionFolderPhase>[1]) => {
    const next = transitionFolderPhase(phaseRef.current, event)
    phaseRef.current = next
    setPhase(next)
    options.onTransitionPhase?.(next)
  }, [options])

  const updateRows = useCallback((update: (current: TransitionRow[]) => TransitionRow[]) => {
    const next = update(rowsRef.current)
    rowsRef.current = next
    setRows(next)
  }, [])

  const onGenerationChange = options.onGenerationChange
  const restoreWorkspace = useCallback((restored: FolderWorkspace | null, source: FolderSource | null, entries: FolderEntry[] = [], rootError?: string) => {
    folderRef.current = restored
    sourceRef.current = source
    generation.current += 1
    onGenerationChange?.(generation.current)
    referenceTextCache.current.clear()
    nameIndex.current = null
    setFolder(restored)
    setEntriesByPath(restored && !rootError && source ? new Map([['', entries]]) : new Map())
    setErrorsByPath(rootError ? new Map([['', rootError]]) : new Map())
    setActivePath(restored?.activePath ?? null)
    setActiveAssetPath(null)
    setActiveFilePath(null)
    for (const controller of controllers.current.values()) controller.abort()
    controllers.current.clear()
    if (restored && source && !rootError) for (const path of restored.expandedPaths) if (path) loadChildrenRef.current?.(path, true)
  }, [onGenerationChange])

  const captureDocuments = useCallback(() => {
    revisions.current = new Map(options.getDocuments().map((document) => [document.id, document.revision]))
    return options.getDocuments().filter((document) => documentIsDirty(document))
  }, [options])

  const waitForSerializations = useCallback(async () => {
    let pending: Promise<void>[] = []
    do {
      const before = options.getPendingSerializations()
      pending = [...before.values()]
      if (pending.length) await Promise.all(pending)
      const after = options.getPendingSerializations()
      if (after.size === 0 || [...after.values()].every((value) => pending.includes(value))) break
    } while (true)
  }, [options])

  const beginTransition = useCallback(async (closing: boolean) => {
    if (transitionLock.current) return
    transitionLock.current = true
    options.onTransitionLock?.(true)
    candidateController.current?.abort()
    candidateController.current = null
    candidate.current = null
    reconnecting.current = false
    setIsClosing(closing)
    setRows([])
    move({ type: 'begin' })
    try {
      await options.settleExternalWork?.()
      await waitForSerializations()
      if (!transitionLock.current || phaseRef.current !== 'settling') return
      const dirty = captureDocuments()
      if (dirty.length) {
        setRows(dirty.map((document) => ({ document })))
        move({ type: 'settled', dirtyCount: dirty.length })
      } else {
        move({ type: 'settled', dirtyCount: 0 })
        if (closing) await commitCandidateRef.current?.()
        else move({ type: 'discard' })
      }
    } catch (error) {
      options.onError(error instanceof Error ? error.message : '편집을 안정화하지 못했습니다.')
      transitionLock.current = false
      options.onTransitionLock?.(false)
      move({ type: 'fail' })
    }
  }, [captureDocuments, move, options, waitForSerializations])

  const openFolder = useCallback(() => { void beginTransition(false) }, [beginTransition])
  const closeFolder = useCallback(() => { void beginTransition(true) }, [beginTransition])

  const proceedAfterConfirmation = useCallback(async () => {
    await waitForSerializations()
    const currentDocuments = options.getDocuments()
    const dirty = currentDocuments.filter((document) => documentIsDirty(document))
    const changed = revisionsChanged(revisions.current, currentDocuments)
    if (dirty.length) {
      const unresolved = captureDocuments()
      const tracked = new Map(rowsRef.current.map((row) => [row.document.id, row]))
      updateRows(() => unresolved.map((document) => ({ ...(tracked.get(document.id) ?? {}), document, result: tracked.get(document.id)?.result })))
      move({ type: 'reconfirm' })
      return
    }
    if (changed) captureDocuments()
    if (candidate.current || isClosing) {
      move({ type: 'saved' })
      await commitCandidateRef.current?.()
    }
    else move({ type: 'saved' })
  }, [captureDocuments, isClosing, move, options, updateRows, waitForSerializations])

  const saveAll = useCallback(async () => {
    move({ type: 'save' })
    setBusyRowId(undefined)
    const currentRows = rows
    for (const row of currentRows) {
      if (row.result?.status === 'saved' || row.result?.status === 'download-started' || row.action) continue
      const current = options.getDocuments().find((item) => item.id === row.document.id)
      if (!current) continue
      if (current.revision !== revisions.current.get(current.id)) {
        updateRows((items) => items.map((item) => item.document.id === current.id ? { document: current, result: { status: 'failed', documentId: current.id, message: '저장 확인 뒤 문서가 바뀌었습니다. 다시 확인하세요.' } } : item))
        continue
      }
      if (current.structuredDraft || current.textRevision !== current.revision) {
        updateRows((items) => items.map((item) => item.document.id === current.id ? { document: current, result: { status: 'failed', documentId: current.id, message: '저장할 수 없는 구조 편집 초안이 남아 있습니다.' } } : item))
        continue
      }
      setBusyRowId(current.id)
      let result: DocumentSaveResult
      try { result = await options.saveService.saveDocumentById(current.id) }
      catch (error) { result = { status: 'failed', documentId: current.id, message: error instanceof Error ? error.message : '문서를 저장하지 못했습니다.' } }
      updateRows((items) => items.map((item) => item.document.id === current.id ? rowFromResult(item, result) : item))
      if (result.status === 'saved') revisions.current.set(current.id, result.revision)
    }
    setBusyRowId(undefined)
    await proceedAfterConfirmation()
  }, [move, options, proceedAfterConfirmation, rows, updateRows])

  const discardAndContinue = useCallback(async () => {
    await waitForSerializations()
    captureDocuments()
    move({ type: 'discard' })
    if (candidate.current || isClosing) await commitCandidateRef.current?.()
  }, [captureDocuments, isClosing, move, waitForSerializations])

  const cancelTransition = useCallback(() => {
    if (phaseRef.current === 'saving' || phaseRef.current === 'committing') return
    candidateController.current?.abort()
    candidateController.current = null
    for (const controller of controllers.current.values()) controller.abort()
    controllers.current.clear()
    candidate.current = null
    transitionLock.current = false
    options.onTransitionLock?.(false)
    setRows([])
    move({ type: 'cancel' })
  }, [move, options])

  const acceptPickedFolder = useCallback(async (picked: PickedFolder) => {
    const reconnectingFolder = folderRef.current
    if (reconnecting.current && reconnectingFolder) {
      reconnecting.current = false
      try {
        const currentSource = sourceRef.current
        if (currentSource?.kind === 'handle' && picked.source.kind === 'handle') {
          const same = currentSource.root.isSameEntry ? await currentSource.root.isSameEntry(picked.source.root) : currentSource.root.name === picked.source.root.name
          if (!same) { options.onError('현재 폴더와 다른 폴더입니다. 새 폴더를 열려면 폴더 전환을 시작하세요.'); return }
        } else if (picked.workspace.name !== reconnectingFolder.name) { options.onError('현재 폴더와 이름이 다릅니다.'); return }
        const opened = options.getDocuments().filter((item) => item.folderRef?.folderId === reconnectingFolder.id)
        const pickedSource = picked.source
        if (pickedSource.kind === 'input' && opened.some((item) => !pickedSource.files.has(item.folderRef!.path))) {
          options.onError('다시 선택한 폴더에 열린 문서의 경로가 없습니다. 기존 작업본은 유지했습니다.')
          return
        }
        if (pickedSource.kind === 'handle') {
          for (const item of opened) {
            if (item.sourceFileHandle) {
              const path = await pickedSource.root.resolve(item.sourceFileHandle)
              if (!path || path.join('/') !== item.folderRef!.path) {
                options.onError('열린 문서의 경로가 현재 폴더와 일치하지 않습니다. 기존 작업본은 유지했습니다.')
                return
              }
            }
          }
        }
        const rootEntries = await listFolderChildren(pickedSource, '', new AbortController().signal)
        for (const controller of controllers.current.values()) controller.abort()
        controllers.current.clear()
        setLoadingPaths(new Set())
        const updated = { ...reconnectingFolder, access: picked.workspace.access, expandedPaths: reconnectingFolder.expandedPaths, activePath: reconnectingFolder.activePath }
        sourceRef.current = picked.source
        folderRef.current = updated
        setFolder(updated)
        setErrorsByPath(new Map())
        setEntriesByPath(new Map([['', rootEntries]]))
        generation.current += 1
        options.onGenerationChange?.(generation.current)
        referenceTextCache.current.clear()
        nameIndex.current = null
        options.onMetadataChange?.(updated, picked.source, generation.current)
        for (const path of updated.expandedPaths) if (path) loadChildrenRef.current?.(path, true)
      } catch (error) {
        options.onError(error instanceof Error ? error.message : '폴더 접근을 복구하지 못했습니다. 기존 작업본은 유지했습니다.')
      }
      return
    }
    if (!transitionLock.current || phaseRef.current !== 'picking') return
    const token = generation.current + 1
    const controller = new AbortController()
    candidateController.current = controller
    move({ type: 'settle' })
    const isCurrentSettling = () => transitionLock.current && phaseRef.current === 'settling' && token === generation.current + 1
    try {
      await options.settleExternalWork?.()
      await waitForSerializations()
      if (controller.signal.aborted || !isCurrentSettling()) return
      const rootEntries = await listFolderChildren(picked.source, '', controller.signal)
      if (candidateController.current === controller) candidateController.current = null
      if (!isCurrentSettling()) return
      candidate.current = { folder: picked.workspace, source: picked.source, entries: rootEntries }
      const dirty = captureDocuments()
      if (dirty.length) {
        updateRows(() => dirty.map((document) => ({ document })))
        move({ type: 'settled', dirtyCount: dirty.length })
        return
      }
      move({ type: 'settled', dirtyCount: 0 })
      await commitCandidateRef.current?.()
    } catch (error) {
      if (candidateController.current === controller) candidateController.current = null
      if (controller.signal.aborted) return
      options.onError(error instanceof Error ? error.message : '선택한 폴더를 읽지 못했습니다.')
      candidate.current = null
      move({ type: 'fail' })
      transitionLock.current = false
      options.onTransitionLock?.(false)
    }
  }, [captureDocuments, move, options, updateRows, waitForSerializations])

  const commitCandidate = useCallback(async () => {
    const next = candidate.current
    const closing = isClosing
    const nextFolder = closing ? null : next?.folder ?? null
    const nextSource = closing ? null : next?.source ?? null
    const rootEntries = closing ? [] : next?.entries ?? []
    move({ type: 'commit' })
    try {
      await waitForSerializations()
      const changed = revisionsChanged(revisions.current, options.getDocuments())
      if (changed) {
        const dirty = captureDocuments()
        if (dirty.length) {
          updateRows(() => dirty.map((document) => ({ document })))
          move({ type: 'reconfirm' })
          return
        }
      }
      await options.onCommit(nextFolder, nextSource, rootEntries)
      for (const controller of controllers.current.values()) controller.abort()
      controllers.current.clear()
      generation.current += 1
      options.onGenerationChange?.(generation.current)
      referenceTextCache.current.clear()
      nameIndex.current = null
      candidate.current = null
      sourceRef.current = nextSource
      folderRef.current = nextFolder
      setFolder(nextFolder)
      setEntriesByPath(nextFolder ? new Map([['', rootEntries]]) : new Map())
      setLoadingPaths(new Set())
      setErrorsByPath(new Map())
      setActivePath(null)
      setActiveAssetPath(null)
      setActiveFilePath(null)
      options.onAssetSelect(null)
      if (nextFolder) options.onMetadataChange?.(nextFolder, nextSource, generation.current)
      transitionLock.current = false
      options.onTransitionLock?.(false)
      setRows([])
      move({ type: 'cancel' })
    } catch (error) {
      options.onError(error instanceof Error ? `작업 공간을 전환하지 못했습니다: ${error.message}` : '작업 공간을 전환하지 못했습니다.')
      move({ type: 'fail' })
      transitionLock.current = false
      options.onTransitionLock?.(false)
    }
  }, [captureDocuments, isClosing, move, options, updateRows, waitForSerializations])
  commitCandidateRef.current = commitCandidate

  const beginPicking = useCallback(() => {
    if (phaseRef.current === 'idle' && !transitionLock.current) {
      transitionLock.current = true
      options.onTransitionLock?.(true)
      candidateController.current?.abort()
      candidateController.current = null
      candidate.current = null
      reconnecting.current = false
      setIsClosing(false)
      setRows([])
      captureDocuments()
      move({ type: 'begin-pick' })
      return
    }
    if (phaseRef.current === 'ready-to-pick' && !isClosing) move({ type: 'pick' })
  }, [captureDocuments, isClosing, move, options])

  const commitClose = useCallback(() => { if (phaseRef.current === 'ready-to-pick' && isClosing) void commitCandidate() }, [commitCandidate, isClosing])

  const continueSave = useCallback(async (row: TransitionRow) => {
    if (busyRowId || !row.plan || !row.action) return
    move({ type: 'save' })
    setBusyRowId(row.document.id)
    let result: DocumentSaveResult
    try { result = await options.saveService.continueDocumentSave(row.plan, row.action) }
    catch (error) { result = { status: 'failed', documentId: row.document.id, message: error instanceof Error ? error.message : '문서를 저장하지 못했습니다.' } }
    updateRows((items) => items.map((item) => item.document.id === row.document.id ? rowFromResult(item, result) : item))
    if (result.status === 'saved') revisions.current.set(row.document.id, result.revision)
    setBusyRowId(undefined)
    await proceedAfterConfirmation()
  }, [busyRowId, move, options.saveService, proceedAfterConfirmation, updateRows])

  const confirmDownload = useCallback(async (row: TransitionRow) => {
    if (busyRowId || row.result?.status !== 'download-started') return
    move({ type: 'save' })
    setBusyRowId(row.document.id)
    let result: DocumentSaveResult
    try { result = await options.saveService.confirmDownload(row.result.plan) }
    catch (error) { result = { status: 'failed', documentId: row.document.id, message: error instanceof Error ? error.message : '다운로드를 확인하지 못했습니다.' } }
    updateRows((items) => items.map((item) => item.document.id === row.document.id ? rowFromResult(item, result) : item))
    if (result.status === 'saved') revisions.current.set(row.document.id, result.revision)
    setBusyRowId(undefined)
    await proceedAfterConfirmation()
  }, [busyRowId, move, options.saveService, proceedAfterConfirmation, updateRows])

  const loadChildren = useCallback(async (path: FolderPath, refresh = false) => {
    const source = sourceRef.current
    if (!source || (!refresh && entriesByPath.has(path)) || controllers.current.has(path)) return
    const controller = new AbortController()
    const startedGeneration = generation.current
    controllers.current.set(path, controller)
    setLoadingPaths((items) => new Set(items).add(path))
    setErrorsByPath((items) => { const next = new Map(items); next.delete(path); return next })
    try {
      const entries = await listFolderChildren(source, path, controller.signal)
      if (controller.signal.aborted || startedGeneration !== generation.current) return
      setEntriesByPath((items) => new Map(items).set(path, entries))
      setErrorsByPath((items) => { const next = new Map(items); next.delete(path); return next })
    } catch (error) {
      if (!controller.signal.aborted && startedGeneration === generation.current) setErrorsByPath((items) => new Map(items).set(path, error instanceof Error ? error.message : '폴더를 읽지 못했습니다.'))
    } finally {
      if (controllers.current.get(path) === controller) {
        controllers.current.delete(path)
        if (startedGeneration === generation.current) setLoadingPaths((items) => { const next = new Set(items); next.delete(path); return next })
      }
    }
  }, [entriesByPath])
  loadChildrenRef.current = (path, refresh) => { void loadChildren(path, refresh) }

  const toggleDirectory = useCallback((path: FolderPath, expanded: boolean) => {
    const current = folderRef.current
    if (!current || transitionLock.current) return
    const expandedPaths = expanded ? [...new Set([...current.expandedPaths, path])] : current.expandedPaths.filter((item) => item !== path)
    const updated = { ...current, expandedPaths }
    folderRef.current = updated
    setFolder(updated)
    options.onMetadataChange?.(updated, sourceRef.current, generation.current)
    if (expanded) void loadChildren(path)
  }, [loadChildren, options])

  const refreshFolder = useCallback((path: FolderPath) => {
    if (folderRef.current?.access === 'input') {
      options.onError('폴더 새로고침을 눌러 현재 폴더를 다시 선택하세요.')
      return
    }
    for (const [activePath, controller] of controllers.current) {
      if (activePath === path || (path === '' ? Boolean(activePath) : activePath.startsWith(`${path}/`))) { controller.abort(); controllers.current.delete(activePath) }
    }
    referenceTextCache.current.clear()
    nameIndex.current = null
    setEntriesByPath((items) => {
      const next = new Map(items)
      for (const entryPath of next.keys()) if (entryPath === path || (path === '' ? entryPath !== '' : entryPath.startsWith(`${path}/`))) next.delete(entryPath)
      return next
    })
    void loadChildren(path, true)
    const current = folderRef.current
    if (current) for (const expanded of current.expandedPaths) {
      if (expanded && expanded !== path && (path === '' || expanded.startsWith(`${path}/`))) void loadChildren(expanded, true)
    }
  }, [loadChildren, options])

  const reconnectInput = useCallback(() => {
    if (folderRef.current?.access !== 'input') return
    reconnecting.current = true
  }, [])

  const openPath = useCallback(async (path: FolderPath) => {
    const currentFolder = folderRef.current
    const source = sourceRef.current
    if (!currentFolder || !source || transitionLock.current) return
    const format = getFormat(path)
    if (!format && /\.(?:avif|gif|jpe?g|png|svg|webp)$/iu.test(path)) {
      setActivePath(path)
      setActiveAssetPath(path)
      setActiveFilePath(null)
      const updated = { ...currentFolder, activePath: path }
      folderRef.current = updated
      setFolder(updated)
      options.onMetadataChange?.(updated, source, generation.current)
      options.onDocumentSelect('')
      options.onAssetSelect(path)
      return
    }
    setErrorsByPath((items) => { const next = new Map(items); next.delete(path); return next })
    const key = folderDocumentKey(currentFolder.id, path)
    const existing = options.getDocuments().find((item) => item.folderRef?.folderId === currentFolder.id && item.folderRef.path === path)
    if (existing) {
      setActivePath(path)
      const updated = { ...currentFolder, activePath: path }
      folderRef.current = updated
      setFolder(updated)
      options.onMetadataChange?.(updated, source, generation.current)
      setActiveAssetPath(null)
      setActiveFilePath(null)
      options.onAssetSelect(null)
      options.onDocumentSelect(existing.id)
      return
    }
    const inFlight = openPromises.current.get(key)
    if (inFlight) { await inFlight; return }
    const startedGeneration = generation.current
    const controller = new AbortController()
    const operation = (async () => {
      const { file, fileHandle } = await readFolderFile(source, path, controller.signal)
      if (controller.signal.aborted || startedGeneration !== generation.current || transitionLock.current) return
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (controller.signal.aborted || startedGeneration !== generation.current || transitionLock.current) return
      const latest = options.getDocuments().find((item) => item.folderRef?.folderId === currentFolder.id && item.folderRef.path === path)
      if (latest) { options.onDocumentSelect(latest.id); return }
      const document = await makeFileDocumentFromBytes(file.name, file.type, bytes)
      if (controller.signal.aborted || startedGeneration !== generation.current || transitionLock.current) return
      document.folderRef = { folderId: currentFolder.id, path }
      if (fileHandle) document.sourceFileHandle = fileHandle
      options.onDocumentOpen(document)
      setActivePath(path)
      const updated = { ...currentFolder, activePath: path }
      folderRef.current = updated
      setFolder(updated)
      options.onMetadataChange?.(updated, source, generation.current)
      setActiveAssetPath(null)
      options.onAssetSelect(null)
    })().catch((error: unknown) => {
      if (!controller.signal.aborted && startedGeneration === generation.current) setErrorsByPath((items) => new Map(items).set(path, error instanceof Error ? error.message : '파일을 열지 못했습니다.'))
    }).finally(() => { if (openPromises.current.get(key) === operation) openPromises.current.delete(key) })
    openPromises.current.set(key, operation)
    await operation
  }, [options])

  const downloadPath = useCallback(async (path: FolderPath) => {
    const source = sourceRef.current
    if (!source) return
    const startedGeneration = generation.current
    const controller = new AbortController()
    try {
      const { file } = await readFolderFile(source, path, controller.signal)
      if (controller.signal.aborted || startedGeneration !== generation.current || transitionLock.current) return
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (controller.signal.aborted || startedGeneration !== generation.current || transitionLock.current) return
      downloadLocalFile(file.name, file.type || 'application/octet-stream', bytes)
    } catch (error) { if (!controller.signal.aborted && startedGeneration === generation.current) options.onError(error instanceof Error ? error.message : '파일을 내려받지 못했습니다.') }
  }, [options])

  const resolveReference = useCallback(async (
    ownerPath: FolderPath,
    ownerText: string,
    reference: string,
    syntax: MarkdownReferenceSyntax,
    requestedGeneration: number,
    signal: AbortSignal
  ): Promise<MarkdownReferenceResolution> => {
    const currentFolder = folderRef.current
    const source = sourceRef.current
    if (!currentFolder || !source) return { status: 'error', kind: 'missing', message: '폴더 새로고침으로 접근을 복구해야 로컬 참조를 열 수 있습니다.' }
    assertCurrentReference(requestedGeneration, generation.current, signal)
    const parsed = parseLocalReference(reference, syntax)
    if (parsed.kind === 'external') return { status: 'external', href: parsed.href }
    if (parsed.kind === 'blocked' || parsed.kind === 'invalid') return { status: 'error', kind: parsed.kind, message: parsed.reason }
    if (parsed.kind === 'same-document') {
      const current = options.getDocuments().find((item) => item.folderRef?.folderId === currentFolder.id && item.folderRef.path === ownerPath)
      return { status: 'markdown', path: ownerPath, text: current?.text ?? ownerText, revision: current?.revision ?? 0, ...(parsed.fragment ? { fragment: parsed.fragment } : {}) }
    }

    let path: FolderPath
    const obsidianShortName = syntax === 'obsidian' && !reference.startsWith('/') && !/^\.\.?\//u.test(reference) && !parsed.path.includes('/')
    if (obsidianShortName) {
      try {
        const index = await getNameIndex(source, requestedGeneration, signal)
        assertCurrentReference(requestedGeneration, generation.current, signal)
        const keys = parsed.path.includes('.') ? [parsed.path] : [parsed.path, `${parsed.path}.md`]
        const candidates = [...new Set(keys.flatMap((key) => index.get(key) ?? []))]
        if (!candidates.length) return { status: 'error', kind: 'missing', message: `“${parsed.path}” 참조를 찾을 수 없습니다.` }
        if (candidates.length > 1) return { status: 'error', kind: 'ambiguous', message: '같은 이름의 파일이 여러 개 있습니다. 경로를 명시하세요.', choices: candidates }
        path = candidates[0]!
      } catch (error) {
        if (signal.aborted) throw error
        return { status: 'error', kind: 'incomplete', message: error instanceof Error ? error.message : '폴더 이름을 모두 확인하지 못했습니다.' }
      }
    } else {
      const resolved = resolveFolderPath(ownerPath, reference, syntax)
      if (resolved.kind === 'external') return { status: 'external', href: resolved.href }
      if (resolved.kind === 'same-document') {
        const current = options.getDocuments().find((item) => item.folderRef?.folderId === currentFolder.id && item.folderRef.path === ownerPath)
        return { status: 'markdown', path: ownerPath, text: current?.text ?? ownerText, revision: current?.revision ?? 0, ...(resolved.fragment ? { fragment: resolved.fragment } : {}) }
      }
      if (resolved.kind === 'blocked' || resolved.kind === 'invalid') return { status: 'error', kind: resolved.kind, message: resolved.reason }
      path = resolved.path
      if (syntax === 'obsidian' && !/\.[^/]+$/u.test(path)) path += '.md'
    }
    assertCurrentReference(requestedGeneration, generation.current, signal)

    const opened = options.getDocuments().find((item) => item.folderRef?.folderId === currentFolder.id && item.folderRef.path === path)
    const targetFormat = getFormat(path)
    if (opened) {
      if (opened.format === 'md') return { status: 'markdown', path, text: opened.text, revision: opened.revision, ...(parsed.fragment ? { fragment: parsed.fragment } : {}) }
      return { status: 'file', path, name: opened.name, mimeType: opened.mimeType, size: opened.size, supported: true }
    }

    try {
      const { file } = await readFolderFile(source, path, signal)
      assertCurrentReference(requestedGeneration, generation.current, signal)
      if (/\.(?:avif|gif|jpe?g|png|svg|webp)$/iu.test(path) || file.type.toLowerCase().startsWith('image/')) {
        return { status: 'image', path, mimeType: file.type, ...(parsed.fragment ? { fragment: parsed.fragment } : {}) }
      }
      if (targetFormat === 'md') {
        const cached = referenceTextCache.current.get(path)
        let text = cached?.generation === requestedGeneration ? cached.text : ''
        if (cached?.generation !== requestedGeneration) {
          const bytes = new Uint8Array(await file.arrayBuffer())
          assertCurrentReference(requestedGeneration, generation.current, signal)
          const parsedFile = await parseWithWorker(file.name, file.type, bytes, 'md')
          assertCurrentReference(requestedGeneration, generation.current, signal)
          text = parsedFile.text
          referenceTextCache.current.set(path, { generation: requestedGeneration, text })
        }
        return { status: 'markdown', path, text, revision: 0, ...(parsed.fragment ? { fragment: parsed.fragment } : {}) }
      }
      return { status: 'file', path, name: file.name, mimeType: file.type, size: file.size, supported: Boolean(targetFormat) }
    } catch (error) {
      if (signal.aborted) throw error
      const permission = error instanceof DOMException && error.name === 'NotAllowedError' || error instanceof Error && /권한/u.test(error.message)
      const missing = error instanceof DOMException && error.name === 'NotFoundError' || error instanceof Error && /찾을 수 없습니다/u.test(error.message)
      return { status: 'error', kind: permission ? 'permission-denied' : missing ? 'missing' : 'missing', message: error instanceof Error ? error.message : '로컬 참조를 읽지 못했습니다.' }
    }
  }, [options])

  const getNameIndex = async (source: FolderSource, requestedGeneration: number, signal: AbortSignal): Promise<Map<string, FolderPath[]>> => {
    if (nameIndex.current?.generation === requestedGeneration) return nameIndex.current.promise
    const promise = (async () => {
      const index = new Map<string, FolderPath[]>()
      const pending = ['']
      while (pending.length) {
        assertCurrentReference(requestedGeneration, generation.current, signal)
        const directory = pending.pop()!
        const entries = await listFolderChildren(source, directory, signal)
        assertCurrentReference(requestedGeneration, generation.current, signal)
        for (const entry of entries) {
          if (entry.kind === 'directory') { pending.push(entry.path); continue }
          const names = new Set([entry.name, entry.name.replace(/\.[^.]+$/u, '')])
          for (const name of names) index.set(name, [...(index.get(name) ?? []), entry.path])
        }
      }
      return index
    })()
    nameIndex.current = { generation: requestedGeneration, promise }
    try { return await promise }
    catch (error) { if (nameIndex.current?.promise === promise) nameIndex.current = null; throw error }
  }

  const selectDocumentPath = useCallback((path: FolderPath | null) => {
    setActivePath(path)
    const current = folderRef.current
    if (current) {
      const updated = { ...current, activePath: path }
      folderRef.current = updated
      setFolder(updated)
      options.onMetadataChange?.(updated, sourceRef.current, generation.current)
    }
    setActiveAssetPath(null)
    setActiveFilePath(null)
    options.onAssetSelect(null)
  }, [options])

  const beginReconnect = useCallback(() => { reconnecting.current = true }, [])
  const cancelReconnect = useCallback(() => { reconnecting.current = false }, [])

  const dirtyPaths = useMemo(() => {
    if (!folder) return new Set<FolderPath>()
    return new Set(options.getDocuments().filter((item) => item.folderRef?.folderId === folder.id && item.isDirty).map((item) => item.folderRef!.path))
  }, [folder, options])

  return {
    folder, source: sourceRef.current, generation: generation.current, entriesByPath, loadingPaths, errorsByPath, activePath, activeAssetPath, activeFilePath, phase, rows, busyRowId, isClosing, dirtyPaths,
    openFolder, closeFolder, beginPicking, acceptPickedFolder, commitClose, saveAll, discardAndContinue, cancelTransition, continueSave, confirmDownload, restoreWorkspace, beginReconnect, cancelReconnect,
    toggleDirectory, openPath, downloadPath, refreshFolder, reconnectInput, selectDocumentPath, resolveReference,
    isTransitioning: transitionLock.current
  }
}

function assertCurrentReference(generation: number, currentGeneration: number, signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('참조가 취소되었습니다.', 'AbortError')
  if (generation !== currentGeneration) throw new DOMException('참조가 만료되었습니다.', 'AbortError')
}

function rowFromResult(row: TransitionRow, result: DocumentSaveResult): TransitionRow {
  if (result.status === 'needs-user-action') return { ...row, plan: result.plan, action: result.action, result }
  return { ...row, plan: undefined, action: undefined, result }
}

function revisionsChanged(snapshot: ReadonlyMap<string, number>, documents: readonly ViewerDocument[]): boolean {
  return snapshot.size !== documents.length || documents.some((document) => snapshot.get(document.id) !== document.revision)
}
