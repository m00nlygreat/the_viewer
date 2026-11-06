import type { ExportSnapshot } from '../domain/session'
import { buildExportSnapshot, documentIsDirty, flushDocument } from '../domain/session'
import { FORMAT_MIME, type Format, type ViewerDocument } from '../domain/types'
import type { DocumentController } from '../domain/documentController'
import { pickMatchingLocalSourceFile, pickLocalSaveHandle, requestLocalFileWritePermission, writeLocalFileHandle, downloadLocalFile } from '../platform/browserFiles'

export interface PreparedDocumentSave {
  documentId: string
  name: string
  format: Format
  plainText?: boolean
  mimeType?: string
  snapshot: ExportSnapshot
  expectedBytes: Uint8Array
  originalBytes: Uint8Array
  sourceFileHandle?: FileSystemFileHandle
  fileSource?: 'file-url'
}

export type SaveAction = 'grant-write' | 'choose-destination' | 'link-source'
export type DocumentSaveResult =
  | { status: 'saved'; documentId: string; revision: number }
  | { status: 'download-started'; plan: PreparedDocumentSave }
  | { status: 'needs-user-action'; plan: PreparedDocumentSave; action: SaveAction }
  | { status: 'cancelled'; documentId: string }
  | { status: 'failed'; documentId: string; message: string }

export interface DocumentSaveService {
  prepareSourceSave(id: string): Promise<PreparedDocumentSave>
  saveDocumentById(id: string): Promise<DocumentSaveResult>
  continueDocumentSave(plan: PreparedDocumentSave, action: SaveAction): Promise<DocumentSaveResult>
  confirmDownload(plan: PreparedDocumentSave): Promise<DocumentSaveResult>
}

interface Dependencies {
  getDocument: (id: string) => ViewerDocument | null
  getPendingSerialization: (id: string) => Promise<unknown> | undefined
  publishDocument: (document: ViewerDocument) => void
  controller: DocumentController
}

export function createDocumentSaveService(dependencies: Dependencies): DocumentSaveService {
  const prepareSourceSave = async (id: string): Promise<PreparedDocumentSave> => {
    const document = await flushDocument(id, () => dependencies.getDocument(id), () => dependencies.getPendingSerialization(id))
    if (document.structuredDraft && document.mode !== 'source') throw new Error(`“${document.name}”에 저장할 수 없는 구조 편집 초안이 있습니다.`)
    const snapshot = buildExportSnapshot(id, document)
    return {
      documentId: id,
      name: document.name,
      format: document.format,
      ...(document.contentKind === 'plain-text' ? { plainText: true, mimeType: 'text/plain' } : {}),
      snapshot,
      expectedBytes: new Uint8Array(document.savedBytes.slice(0)),
      originalBytes: new Uint8Array((document.initialBytes ?? document.savedBytes).slice(0)),
      ...(document.sourceFileHandle ? { sourceFileHandle: document.sourceFileHandle } : {}),
      ...(document.fileSource ? { fileSource: document.fileSource } : {})
    }
  }

  const currentForPlan = (plan: PreparedDocumentSave): ViewerDocument | null => {
    const current = dependencies.getDocument(plan.documentId)
    return current && current.revision === plan.snapshot.revision ? current : null
  }

  const saveDocumentById = async (id: string): Promise<DocumentSaveResult> => {
    try {
      const plan = await prepareSourceSave(id)
      if (!plan.sourceFileHandle) return { status: 'needs-user-action', plan, action: plan.fileSource ? 'link-source' : 'choose-destination' }
      const permission = plan.sourceFileHandle.queryPermission
        ? await plan.sourceFileHandle.queryPermission({ mode: 'readwrite' })
        : 'prompt'
      if (permission !== 'granted') return { status: 'needs-user-action', plan, action: 'grant-write' }
      if (!currentForPlan(plan)) return stalePlan(plan)
      await writeLocalFileHandle(plan.sourceFileHandle, plan.snapshot.bytes, true, plan.expectedBytes)
      return publishSaved(plan)
    } catch (error) { return failure(id, error) }
  }

  const continueDocumentSave = async (plan: PreparedDocumentSave, action: SaveAction): Promise<DocumentSaveResult> => {
    const current = currentForPlan(plan)
    if (!current) {
      try {
        const refreshed = await prepareSourceSave(plan.documentId)
        return { status: 'needs-user-action', plan: refreshed, action: requiredAction(refreshed) }
      } catch (error) { return failure(plan.documentId, error) }
    }
    try {
      if (action === 'grant-write') {
        if (!plan.sourceFileHandle) return { status: 'failed', documentId: plan.documentId, message: '저장할 원본 파일이 연결되지 않았습니다.' }
        if (!await requestLocalFileWritePermission(plan.sourceFileHandle)) return { status: 'failed', documentId: plan.documentId, message: '원본 파일 쓰기 권한을 허용해야 저장할 수 있습니다.' }
        if (!currentForPlan(plan)) return stalePlan(plan)
        await writeLocalFileHandle(plan.sourceFileHandle, plan.snapshot.bytes, true, plan.expectedBytes)
        return publishSaved(plan)
      }
      if (action === 'link-source') {
        const handle = await pickMatchingLocalSourceFile(plan.name, plan.plainText ? undefined : plan.format, plan.originalBytes)
        if (!handle) return { status: 'cancelled', documentId: plan.documentId }
        if (!currentForPlan(plan)) return stalePlan(plan)
        const latest = dependencies.getDocument(plan.documentId)
        if (!latest) return { status: 'cancelled', documentId: plan.documentId }
        dependencies.publishDocument({ ...latest, sourceFileHandle: handle })
        return { status: 'needs-user-action', plan: { ...plan, sourceFileHandle: handle }, action: 'grant-write' }
      }
      const selection = pickLocalSaveHandle(plan.name, plan.plainText ? undefined : plan.format)
      if (!selection) {
        downloadLocalFile(plan.name, plan.mimeType ?? FORMAT_MIME[plan.format], plan.snapshot.bytes)
        return { status: 'download-started', plan }
      }
      const handle = await selection
      if (!currentForPlan(plan)) return stalePlan(plan)
      await writeLocalFileHandle(handle, plan.snapshot.bytes, true)
      return publishSaved(plan)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return { status: 'cancelled', documentId: plan.documentId }
      return failure(plan.documentId, error)
    }
  }

  function publishSaved(plan: PreparedDocumentSave): DocumentSaveResult {
    const current = dependencies.getDocument(plan.documentId)
    if (!current) return { status: 'failed', documentId: plan.documentId, message: '저장한 문서가 더 이상 열려 있지 않습니다.' }
    const changed = current.revision !== plan.snapshot.revision
    const saved = dependencies.controller.markSaved(current, plan.snapshot)
    dependencies.publishDocument(saved)
    if (documentIsDirty(saved)) return { status: 'failed', documentId: plan.documentId, message: changed ? '저장 중 문서가 변경되었습니다. 최신 내용을 다시 저장하세요.' : '저장되지 않은 구조 편집이 남아 있습니다.' }
    return { status: 'saved', documentId: plan.documentId, revision: plan.snapshot.revision }
  }

  async function stalePlan(plan: PreparedDocumentSave): Promise<DocumentSaveResult> {
    try { const refreshed = await prepareSourceSave(plan.documentId); return { status: 'needs-user-action', plan: refreshed, action: requiredAction(refreshed) } }
    catch (error) { return failure(plan.documentId, error) }
  }

  async function confirmDownload(plan: PreparedDocumentSave): Promise<DocumentSaveResult> {
    if (!currentForPlan(plan)) return stalePlan(plan)
    return publishSaved(plan)
  }

  return { prepareSourceSave, saveDocumentById, continueDocumentSave, confirmDownload }
}

function requiredAction(plan: PreparedDocumentSave): SaveAction {
  return plan.sourceFileHandle ? 'grant-write' : plan.fileSource ? 'link-source' : 'choose-destination'
}

function failure(documentId: string, error: unknown): DocumentSaveResult {
  return { status: 'failed', documentId, message: error instanceof Error ? error.message : '문서를 저장하지 못했습니다.' }
}
