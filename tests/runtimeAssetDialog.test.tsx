import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { RuntimeAssetDialog } from '../src/components/RuntimeAssetDialog'

describe('runtime asset dialog', () => {
  it('shows a determinate progress bar while preparing fonts', () => {
    const html = renderToStaticMarkup(createElement(RuntimeAssetDialog, {
      progress: { group: 'fonts', status: 'loading', loadedBytes: 45, totalBytes: 100, loadedFiles: 3, totalFiles: 8 },
      onRetry: () => undefined,
      onContinue: () => undefined
    }))
    expect(html).toContain('role="dialog"')
    expect(html).toContain('글꼴 준비 중')
    expect(html).toContain('<progress')
    expect(html).toContain('value="45"')
    expect(html).toContain('45% · 3/8개')
  })

  it('offers retry and continue actions when an asset cannot be downloaded', () => {
    const html = renderToStaticMarkup(createElement(RuntimeAssetDialog, {
      progress: { group: 'monaco', status: 'error', loadedBytes: 0, totalBytes: 100, loadedFiles: 0, totalFiles: 1, error: '네트워크 연결을 확인하세요.' },
      onRetry: () => undefined,
      onContinue: () => undefined
    }))
    expect(html).toContain('파일을 준비하지 못했습니다')
    expect(html).toContain('네트워크 연결을 확인하세요.')
    expect(html).toContain('계속 열기')
    expect(html).toContain('다시 시도')
  })
})
