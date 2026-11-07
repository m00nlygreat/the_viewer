import { useEffect } from 'react'
import { useFocusTrap } from './useFocusTrap'
import type { RuntimeAssetProgress } from '../platform/pwa/runtimeAssets'

interface Props {
  progress: RuntimeAssetProgress
  onRetry: () => void
  onContinue: () => void
}

export function RuntimeAssetDialog({ progress, onRetry, onContinue }: Props) {
  const dialog = useFocusTrap<HTMLElement>()
  const percent = progress.totalBytes > 0 ? Math.min(100, Math.floor(progress.loadedBytes / progress.totalBytes * 100)) : null
  const label = progress.group === 'fonts' ? '글꼴' : '편집기'
  useEffect(() => { dialog.current?.focus() }, [dialog, progress.group])

  return <div className="overlay runtime-asset-overlay">
    <section ref={dialog} className="runtime-asset-dialog" role="dialog" aria-modal="true" aria-labelledby="runtime-asset-title" aria-describedby="runtime-asset-description" tabIndex={-1}>
      <div className="runtime-asset-content" aria-busy={progress.status === 'loading'}>
        <h2 id="runtime-asset-title">{progress.status === 'loading' ? `${label} 준비 중` : '파일을 준비하지 못했습니다'}</h2>
        <p id="runtime-asset-description">
          {progress.status === 'loading'
            ? progress.group === 'fonts' ? '글꼴을 오프라인에서도 사용할 수 있도록 기기에 저장합니다.' : '편집기를 열기 위해 필요한 파일을 기기에 저장합니다.'
            : progress.error}
        </p>
        <progress className="runtime-asset-progress" max={progress.totalBytes || 1} value={progress.status === 'loading' && progress.totalBytes > 0 ? Math.min(progress.loadedBytes, progress.totalBytes) : undefined} aria-label={`${label} 다운로드 진행률`} />
        {progress.status === 'loading'
          ? <p className="runtime-asset-count" aria-live="polite">{percent === null ? '진행 중' : `${percent}%`} · {progress.loadedFiles}/{progress.totalFiles}개</p>
          : <div className="dialog-actions">
            <button type="button" className="secondary-button" onClick={onContinue}>계속 열기</button>
            <button type="button" className="primary-button" onClick={onRetry}>다시 시도</button>
          </div>}
      </div>
    </section>
  </div>
}
