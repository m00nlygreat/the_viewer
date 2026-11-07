declare const __APP_BASE__: string
declare const __APP_VERSION__: string

interface Window {
  showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>
  showOpenFilePicker?: (options?: {
    multiple?: boolean
    types?: Array<{ description: string; accept: Record<string, string[]> }>
  }) => Promise<FileSystemFileHandle[]>
  showSaveFilePicker?: (options?: {
    suggestedName?: string
    types?: Array<{ description: string; accept: Record<string, string[]> }>
  }) => Promise<FileSystemFileHandle>
  launchQueue?: { setConsumer: (consumer: (params: { files: FileSystemFileHandle[] }) => void) => void }
}

interface FileSystemDirectoryHandle {
  entries: () => AsyncIterableIterator<[string, FileSystemHandle]>
  resolve: (possibleDescendant: FileSystemHandle) => Promise<string[] | null>
  getDirectoryHandle: (name: string, options?: { create?: boolean }) => Promise<FileSystemDirectoryHandle>
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<FileSystemFileHandle>
}

interface DataTransferItem {
  getAsFileSystemHandle?: () => Promise<FileSystemFileHandle | FileSystemDirectoryHandle | null>
}

interface FileSystemHandle {
  queryPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>
  requestPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>
}

interface FileSystemFileHandle { createWritable: () => Promise<FileSystemWritableFileStream> }
interface FileSystemWritableFileStream { write: (data: Blob | BufferSource | string) => Promise<void>; close: () => Promise<void> }

interface ImportMetaEnv { readonly MODE: string; readonly DEV: boolean }
interface ImportMeta { readonly env: ImportMetaEnv }

declare module 'virtual:pwa-register' {
  export function registerSW(options?: { immediate?: boolean; onNeedRefresh?: () => void; onOfflineReady?: () => void }): (reloadPage?: boolean) => Promise<void>
}
