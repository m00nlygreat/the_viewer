declare const __APP_BASE__: string
declare const __APP_VERSION__: string

interface Window {
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

interface DataTransferItem {
  getAsFileSystemHandle?: () => Promise<FileSystemFileHandle | FileSystemDirectoryHandle | null>
}

interface FileSystemHandle {
  queryPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>
  requestPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>
}

interface FileSystemFileHandle { createWritable: () => Promise<FileSystemWritableFileStream> }
interface FileSystemWritableFileStream { write: (data: Blob | BufferSource | string) => Promise<void>; close: () => Promise<void> }

interface ImportMetaEnv { readonly MODE: string }
interface ImportMeta { readonly env: ImportMetaEnv }

declare module 'virtual:pwa-register' {
  export function registerSW(options?: { immediate?: boolean; onNeedRefresh?: () => void; onOfflineReady?: () => void }): (reloadPage?: boolean) => Promise<void>
}
