const disposers = new Map<string, () => void>()

export function registerSourceEditorDisposer(documentId: string, dispose: () => void): () => void {
  disposers.set(documentId, dispose)
  return () => { if (disposers.get(documentId) === dispose) disposers.delete(documentId) }
}

export function disposeSourceEditor(documentId: string): void {
  disposers.get(documentId)?.()
  disposers.delete(documentId)
}
