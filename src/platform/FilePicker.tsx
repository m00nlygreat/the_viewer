import { forwardRef, useImperativeHandle, useRef } from 'react'
import type { Format } from '../domain/types'

export interface PickedFile { name: string; type: string; bytes: Uint8Array }
export interface FilePickerHandle { open: (format?: Format, accept?: string) => void }
interface Props { multiple?: boolean; onFiles: (files: PickedFile[], format?: Format) => void; onError?: (message: string) => void }

export const FilePicker = forwardRef<FilePickerHandle, Props>(function FilePicker({ multiple = true, onFiles, onError }, ref) {
  const input = useRef<HTMLInputElement>(null)
  const pendingFormat = useRef<Format | undefined>(undefined)
  const pendingAccept = useRef('')
  useImperativeHandle(ref, () => ({
    open(format, accept) {
      pendingFormat.current = format
      pendingAccept.current = accept ?? [".eml", ".csv", ".md", ".ics", ".vcf"].join(',')
      if (input.current) { input.current.accept = pendingAccept.current; input.current.click() }
    }
  }), [])
  const receive = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? [])
    event.currentTarget.value = ''
    if (!files.length) { pendingFormat.current = undefined; return }
    try {
      const result = await Promise.all(files.map(async (file) => ({ name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) })))
      onFiles(result, pendingFormat.current)
    } catch { onError?.('선택한 파일을 읽지 못했습니다.') }
    finally { pendingFormat.current = undefined }
  }
  return <input ref={input} className="visually-hidden" type="file" multiple={multiple} accept=".eml,.csv,.md,.ics,.vcf" onChange={(event) => { void receive(event) }} />
})
