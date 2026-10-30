import { FORMAT_MIME, type Format } from '../domain/fileFormats'
import { assertInputFileSize } from '../domain/inputPolicy'
import type { PickedFile } from './fileTypes'

export type FileSaveResult = 'saved' | 'started' | 'cancelled'

export async function saveLocalFile(name: string, format: Format, bytes: Uint8Array): Promise<FileSaveResult> {
  const mime = FORMAT_MIME[format]
  try {
    if (window.showSaveFilePicker) {
      const handle = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: format.toUpperCase(), accept: { [mime]: [`.${format}`] } }] })
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

export function receiveLaunchedFiles(onFiles: (files: PickedFile[]) => void, onError?: (message: string) => void): void {
  if (!window.launchQueue) return
  window.launchQueue.setConsumer(({ files }) => {
    void Promise.all(files.map((handle) => handle.getFile())).then(readFileInputs).then(onFiles).catch((error: unknown) => {
      onError?.(error instanceof Error ? error.message : '파일을 읽지 못했습니다.')
    })
  })
}

async function readFileInputs(files: FileList | File[]): Promise<PickedFile[]> {
  const inputs = Array.from(files)
  const userAgent = navigator.userAgent
  for (const file of inputs) assertInputFileSize(file.name, file.size, userAgent)
  const result = new Array<PickedFile>(inputs.length)
  let nextIndex = 0
  const readNext = async () => {
    while (nextIndex < inputs.length) {
      const index = nextIndex++
      const file = inputs[index]!
      result[index] = { name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) }
    }
  }
  await Promise.all(Array.from({ length: Math.min(inputs.length, 2) }, readNext))
  return result
}
