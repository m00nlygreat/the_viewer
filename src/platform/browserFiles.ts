import { FORMAT_EXTENSIONS, FORMAT_LABEL, FORMAT_MIME, FORMATS, type Format } from '../domain/fileFormats'
import { assertInputFileSize } from '../domain/inputPolicy'
import type { PickedFile } from './fileTypes'

export type FileSaveResult = 'saved' | 'started' | 'cancelled'

export function supportsFileHandlePicker(): boolean {
  return typeof window.showOpenFilePicker === 'function'
}

export async function pickLocalFiles(format?: Format, multiple = true): Promise<PickedFile[] | null> {
  const picker = window.showOpenFilePicker
  if (!picker) return null
  const formats = format ? [format] : FORMATS
  const handles = await picker.call(window, {
    multiple,
    types: formats.map((item) => ({
      description: `${FORMAT_LABEL[item]} (${FORMAT_EXTENSIONS[item].map((extension) => `.${extension}`).join(', ')})`,
      accept: { [FORMAT_MIME[item]]: FORMAT_EXTENSIONS[item].map((extension) => `.${extension}`) }
    }))
  })
  return readFileHandles(handles)
}

export async function pickMatchingLocalSourceFile(name: string, format: Format, originalBytes: Uint8Array): Promise<FileSystemFileHandle | null> {
  const picker = window.showOpenFilePicker
  if (!picker) return null
  const handles = await picker.call(window, {
    multiple: false,
    types: [{
      description: `${FORMAT_LABEL[format]} (${FORMAT_EXTENSIONS[format].map((extension) => `.${extension}`).join(', ')})`,
      accept: { [FORMAT_MIME[format]]: FORMAT_EXTENSIONS[format].map((extension) => `.${extension}`) }
    }]
  })
  const handle = handles[0]
  if (!handle) throw new Error('원본 파일을 선택하지 못했습니다.')
  const file = await handle.getFile()
  assertInputFileSize(file.name, file.size, navigator.userAgent)
  if (file.name !== name) throw new Error(`처음 연 파일 “${name}”을 선택하세요.`)
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (!sameBytes(bytes, originalBytes)) throw new Error('선택한 파일 내용이 처음 연 로컬 파일과 다릅니다.')
  return handle
}

export async function requestLocalFileWritePermission(handle: FileSystemFileHandle): Promise<boolean> {
  const permission = { mode: 'readwrite' as const }
  if (handle.queryPermission) {
    let state = await handle.queryPermission(permission)
    if (state !== 'granted' && handle.requestPermission) state = await handle.requestPermission(permission)
    return state === 'granted'
  } else if (handle.requestPermission && await handle.requestPermission(permission) !== 'granted') {
    return false
  }
  return true
}

export async function writeLocalFileHandle(handle: FileSystemFileHandle, bytes: Uint8Array, permissionGranted = false, expectedBytes?: Uint8Array): Promise<void> {
  if (!permissionGranted && !await requestLocalFileWritePermission(handle)) throw new Error('원본 파일 쓰기 권한을 허용해야 저장할 수 있습니다.')
  if (expectedBytes) {
    const currentFile = await handle.getFile()
    assertInputFileSize(currentFile.name, currentFile.size, navigator.userAgent)
    if (!sameBytes(new Uint8Array(await currentFile.arrayBuffer()), expectedBytes)) {
      throw new Error('원본 파일이 열린 뒤 변경되어 덮어쓰지 않았습니다. 파일을 다시 열어 최신 내용을 확인하세요.')
    }
  }
  const writable = await handle.createWritable()
  try {
    await writable.write(bytes)
    await writable.close()
  } catch (error) {
    await writable.abort(error).catch(() => undefined)
    throw error
  }
}

export async function saveLocalFile(name: string, format: Format, bytes: Uint8Array): Promise<FileSaveResult> {
  const mime = FORMAT_MIME[format]
  try {
    if (window.showSaveFilePicker) {
      const handle = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: format.toUpperCase(), accept: { [mime]: FORMAT_EXTENSIONS[format].map((extension) => `.${extension}`) } }] })
      const writable = await handle.createWritable()
      await writable.write(new Blob([bytes as unknown as BlobPart], { type: mime }))
      await writable.close()
      return 'saved'
    }
    const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: mime }))
    const anchor = Object.assign(document.createElement('a'), { href: url, download: name })
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1800)
    return 'started'
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled'
    throw error
  }
}

export async function shareLocalFile(name: string, format: Format, bytes: Uint8Array): Promise<void> {
  if (!navigator.share) throw new Error('이 브라우저에서는 시스템 공유를 사용할 수 없습니다.')
  const mime = FORMAT_MIME[format]
  const file = new File([bytes as unknown as BlobPart], name, { type: mime })
  await navigator.share({ files: [file], title: name })
}

export function downloadLocalFile(name: string, mime: string, bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: mime }))
  const anchor = Object.assign(document.createElement('a'), { href: url, download: name })
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1800)
}

export async function readClipboardText(): Promise<string> {
  if (!navigator.clipboard?.readText) throw new Error('현재 브라우저에서 클립보드 읽기를 지원하지 않습니다.')
  return navigator.clipboard.readText()
}

export async function readDroppedFiles(files: FileList | File[]): Promise<PickedFile[]> {
  return readFileInputs(files)
}

export async function readDroppedItems(items: DataTransferItemList): Promise<PickedFile[]> {
  const fileItems = Array.from(items).filter((item) => item.kind === 'file')
  // Call while the drop event's data store is still readable.
  const handlePromises = fileItems.map((item) => {
    try { return item.getAsFileSystemHandle?.() ?? Promise.resolve(null) }
    catch { return Promise.resolve(null) }
  })
  const handles = await Promise.all(handlePromises.map((promise) => promise.catch(() => null)))
  const picked: PickedFile[] = []
  for (let index = 0; index < fileItems.length; index += 1) {
    const handle = handles[index]
    if (handle?.kind === 'file') {
      picked.push(await readFileHandle(handle))
      continue
    }
    if (handle?.kind === 'directory') continue
    const file = fileItems[index]?.getAsFile()
    if (file) picked.push(await readFile(file))
  }
  return picked
}

export function receiveLaunchedFiles(onFiles: (files: PickedFile[]) => void, onError?: (message: string) => void): void {
  if (!window.launchQueue) return
  window.launchQueue.setConsumer(({ files }) => {
    void readFileHandles(files).then(onFiles).catch((error: unknown) => {
      onError?.(error instanceof Error ? error.message : '파일을 읽지 못했습니다.')
    })
  })
}

async function readFileInputs(files: FileList | File[]): Promise<PickedFile[]> {
  const inputs = Array.from(files)
  const result = new Array<PickedFile>(inputs.length)
  let nextIndex = 0
  const readNext = async () => {
    while (nextIndex < inputs.length) {
      const index = nextIndex++
      const file = inputs[index]!
      result[index] = await readFile(file)
    }
  }
  await Promise.all(Array.from({ length: Math.min(inputs.length, 2) }, readNext))
  return result
}

async function readFileHandles(handles: readonly FileSystemFileHandle[]): Promise<PickedFile[]> {
  const result = new Array<PickedFile>(handles.length)
  let nextIndex = 0
  const readNext = async () => {
    while (nextIndex < handles.length) {
      const index = nextIndex++
      result[index] = await readFileHandle(handles[index]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(handles.length, 2) }, readNext))
  return result
}

async function readFileHandle(fileHandle: FileSystemFileHandle): Promise<PickedFile> {
  return readFile(await fileHandle.getFile(), fileHandle)
}

async function readFile(file: File, fileHandle?: FileSystemFileHandle): Promise<PickedFile> {
  assertInputFileSize(file.name, file.size, navigator.userAgent)
  return { name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()), fileHandle }
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index])
}
