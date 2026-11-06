import { useEffect, useState } from 'react'
import { Download, File, X } from 'lucide-react'
import { readFolderFile, type FolderSource } from '../platform/folderAccess'
import type { FolderPath } from '../domain/workspace'

interface FileSummary { name: string; type: string; size: number }
interface Props { source: FolderSource; generation: number; path: FolderPath; onDownload: () => void; onClose: () => void }

export function FolderFilePreview({ source, generation, path, onDownload, onClose }: Props) {
  const [file, setFile] = useState<FileSummary | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    setFile(null)
    setError('')
    void readFolderFile(source, path, controller.signal).then(({ file: item }) => {
      if (!controller.signal.aborted) setFile({ name: item.name, type: item.type, size: item.size })
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '파일 정보를 읽지 못했습니다.')
    })
    return () => controller.abort()
  }, [generation, path, source])

  return <section className="folder-file-preview" aria-label={`${path} 파일 정보`}>
    <header><span>{path}</span><button type="button" className="icon-button" aria-label="파일 정보 닫기" onClick={onClose}><X size={15} /></button></header>
    {error ? <p className="folder-asset-error" role="alert">{error}</p> : file ? <div className="folder-file-summary"><File size={24} /><div><strong>{file.name}</strong><span>{file.type || '파일'} · {file.size.toLocaleString()}바이트</span><button type="button" className="secondary-button" onClick={onDownload}><Download size={14} /> 다운로드</button></div></div> : <p role="status">파일 정보를 읽고 있습니다…</p>}
  </section>
}
