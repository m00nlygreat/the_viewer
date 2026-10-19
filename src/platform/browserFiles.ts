import type { Format } from '../domain/types'
import type { PickedFile } from './FilePicker'

export type FileSaveResult = 'saved' | 'started' | 'cancelled'

export async function saveLocalFile(name: string, format: Format, bytes: Uint8Array): Promise<FileSaveResult> {
  const mime = ({ eml: 'message/rfc822', csv: 'text/csv', md: 'text/markdown', ics: 'text/calendar', vcf: 'text/vcard' } satisfies Record<Format, string>)[format]
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
  const mime = ({ eml: 'message/rfc822', csv: 'text/csv', md: 'text/markdown', ics: 'text/calendar', vcf: 'text/vcard' } satisfies Record<Format, string>)[format]
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
  return Promise.all(Array.from(files).map(async (file) => ({ name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) })))
}

export function receiveLaunchedFiles(onFiles: (files: PickedFile[]) => void): void {
  if (!window.launchQueue) return
  window.launchQueue.setConsumer(({ files }) => {
    void Promise.all(files.map(async (handle) => {
      const file = await handle.getFile()
      return { name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) }
    })).then(onFiles)
  })
}
