import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { folderFromInput, pickLocalFolder, supportsDirectoryPicker, type PickedFolder } from './folderAccess'

export interface FolderPickerHandle { open: () => void }
interface Props { onFolder: (folder: PickedFolder) => void; onCancel?: () => void; onError?: (message: string) => void }

export const FolderPicker = forwardRef<FolderPickerHandle, Props>(function FolderPicker({ onFolder, onCancel, onError }, ref) {
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { input.current?.setAttribute('webkitdirectory', '') }, [])
  useEffect(() => {
    const element = input.current
    if (!element || !onCancel) return
    const cancel = () => onCancel()
    element.addEventListener('cancel', cancel)
    return () => element.removeEventListener('cancel', cancel)
  }, [onCancel])
  useImperativeHandle(ref, () => ({ open() {
    if (!supportsDirectoryPicker()) { input.current?.click(); return }
    void pickLocalFolder().then((folder) => { if (folder) onFolder(folder) }).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === 'AbortError') { onCancel?.(); return }
      onError?.(error instanceof Error ? error.message : '폴더를 열지 못했습니다.')
    })
  } }), [onCancel, onError, onFolder])
  const receive = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? [])
    event.currentTarget.value = ''
    if (!files.length) { onCancel?.(); return }
    try { onFolder(folderFromInput(files)) }
    catch (error) { onError?.(error instanceof Error ? error.message : '선택한 폴더를 읽지 못했습니다.') }
  }
  return <input ref={input} className="visually-hidden" type="file" multiple onChange={receive} />
})
