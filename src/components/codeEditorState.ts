export interface SavedCodeEditorState {
  text: string
  ranges: Array<{ anchor: number; head: number }>
  mainIndex: number
  scrollTop: number
  scrollLeft: number
}

const savedEditorStates = new Map<string, SavedCodeEditorState>()

export function readCodeEditorState(key: string): SavedCodeEditorState | undefined {
  return savedEditorStates.get(key)
}

export function saveCodeEditorState(key: string, state: SavedCodeEditorState): void {
  savedEditorStates.set(key, state)
}

export function disposeCodeEditorState(key: string): void {
  savedEditorStates.delete(key)
}

export function clearCodeEditorStates(): void { savedEditorStates.clear() }
