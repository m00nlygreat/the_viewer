import { useEffect, useState } from 'react'
import { Download, X } from 'lucide-react'
import { FolderResourceManager } from '../platform/folderResources'
import type { FolderSource } from '../platform/folderAccess'
import type { FolderPath } from '../domain/workspace'

interface Props { source: FolderSource; generation: number; path: FolderPath; resources: FolderResourceManager; onClose: () => void }

export function FolderAssetPreview({ source, generation, path, resources, onClose }: Props) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    let release: (() => void) | undefined
    void resources.acquire(source, generation, path, controller.signal).then((resource) => {
      if (controller.signal.aborted) { resource.release(); return }
      release = resource.release
      setUrl(resource.url)
    }).catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '이미지를 표시하지 못했습니다.') })
    return () => { controller.abort(); release?.() }
  }, [generation, path, resources, source])
  return <section className="folder-asset-preview" aria-label={`${path} 이미지 미리보기`}>
    <header><span>{path}</span><div><a className="icon-button" href={url || undefined} download={path.split('/').pop()} aria-label="이미지 다운로드" title="다운로드"><Download size={14} /></a><button className="icon-button" type="button" aria-label="미리보기 닫기" onClick={onClose}><X size={15} /></button></div></header>
    {error ? <p className="folder-asset-error" role="alert">{error}</p> : url ? <img src={url} alt={path.split('/').pop() ?? path} /> : <p role="status">이미지를 읽고 있습니다…</p>}
  </section>
}
