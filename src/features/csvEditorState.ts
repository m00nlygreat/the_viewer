import type { GridSelection } from '@glideapps/glide-data-grid'

export interface CsvEditorViewState {
  query: string
  sort: { column: number; direction: 1 | -1 } | null
  gridSelection: GridSelection
  columnWidths: number[]
  editingHeader: number | null
  headerDraft: string
}

const savedStates = new Map<string, CsvEditorViewState>()

export function readCsvEditorState(documentId: string): CsvEditorViewState | undefined { return savedStates.get(documentId) }
export function saveCsvEditorState(documentId: string, state: CsvEditorViewState): void {
  savedStates.delete(documentId)
  savedStates.set(documentId, state)
  while (savedStates.size > 32) savedStates.delete(savedStates.keys().next().value!)
}

export function disposeCsvEditorState(documentId: string): void { savedStates.delete(documentId) }
export function clearCsvEditorStates(): void { savedStates.clear() }
