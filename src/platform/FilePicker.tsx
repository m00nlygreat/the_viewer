import { forwardRef, useImperativeHandle, useRef } from 'react'
import { FORMATS } from '../domain/fileFormats'
import { readDroppedFiles } from './browserFiles'
import type { Format, PickedFile } from './fileTypes'

export type { PickedFile } from './fileTypes'
export interface FilePickerHandle { open: (format?: Format, accept?: string) => void }
interface Props { multiple?: boolean; onFiles: (files: PickedFile[], format?: Format) => void; onError?: (message: string) => void }

export const FilePicker = forwardRef<FilePickerHandle, Props>(function FilePicker({ multiple = true, onFiles, onError }, ref) {
  const input = useRef<HTMLInputElement>(null)
  const pendingFormat = useRef<Format | undefined>(undefined)
  const pendingAccept = useRef('')
  useImperativeHandle(ref, () => ({
    open(format, accept) {
      pendingFormat.current = format
      pendingAccept.current = accept ?? FORMATS.map((format) => `.${format}`).join(',')
      if (input.current) { input.current.accept = pendingAccept.current; input.current.click() }
    }
  }), [])
  const receive = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? [])
    event.currentTarget.value = ''
    if (!files.length) { pendingFormat.current = undefined; return }
    try {
      const result = await readDroppedFiles(files)
      onFiles(result, pendingFormat.current)
    } catch (error) { onError?.(error instanceof Error ? error.message : '선택한 파일을 읽지 못했습니다.') }
    finally { pendingFormat.current = undefined }
  }
  return <input ref={input} className="visually-hidden" type="file" multiple={multiple} accept={FORMATS.map((format) => `.${format}`).join(',')} onChange={(event) => { void receive(event) }} />
})
