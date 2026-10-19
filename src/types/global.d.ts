declare const __APP_BASE__: string
declare const __APP_VERSION__: string

interface Window {
  showSaveFilePicker?: (options?: {
    suggestedName?: string
    types?: Array<{ description: string; accept: Record<string, string[]> }>
  }) => Promise<FileSystemFileHandle>
  launchQueue?: { setConsumer: (consumer: (params: { files: FileSystemFileHandle[] }) => void) => void }
}

interface FileSystemFileHandle { createWritable: () => Promise<FileSystemWritableFileStream> }
interface FileSystemWritableFileStream { write: (data: Blob | BufferSource | string) => Promise<void>; close: () => Promise<void> }

interface ImportMetaEnv { readonly MODE: string }
interface ImportMeta { readonly env: ImportMetaEnv }

declare module 'virtual:pwa-register' {
  export function registerSW(options?: { immediate?: boolean; onNeedRefresh?: () => void; onOfflineReady?: () => void }): (reloadPage?: boolean) => Promise<void>
}
