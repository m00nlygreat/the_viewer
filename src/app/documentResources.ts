import { clearCodeEditorStates, disposeCodeEditorState } from '../components/codeEditorState'
import { disposeSourceEditor } from '../components/sourceEditorRegistry'
import { clearCsvEditorStates, disposeCsvEditorState } from '../features/csvEditorState'
import { cancelDocumentParse } from '../domain/workerClient'

export function disposeDocumentResources(documentId: string): void {
  cancelDocumentParse(documentId)
  disposeSourceEditor(documentId)
  disposeCodeEditorState(`source:${documentId}`)
  disposeCodeEditorState(`markdown-view:${documentId}`)
  disposeCsvEditorState(documentId)
}

export function clearDocumentResources(documentIds: readonly string[]): void {
  for (const id of documentIds) cancelDocumentParse(id)
  for (const id of documentIds) disposeSourceEditor(id)
  clearCodeEditorStates()
  clearCsvEditorStates()
}
