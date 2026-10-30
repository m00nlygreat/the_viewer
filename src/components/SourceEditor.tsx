import { lazy, Suspense, useEffect, useState } from 'react'
import type { ParseDiagnostic } from '../domain/types'
import type { Format } from '../domain/fileFormats'

interface Props {
  documentId: string
  format: Format
  csvDelimiter?: string
  value: string
  diagnostics: ParseDiagnostic[]
  theme: 'light' | 'dark'
  onChange: (value: string) => void
  onUndo: () => void
  onRedo: () => void
  label: string
}

const DesktopEditor = lazy(() => import('./MonacoSourceEditor'))
const MobileEditor = lazy(() => import('./MobileSourceEditor'))

export default function SourceEditor(props: Props) {
  const [mobile, setMobile] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(max-width: 767px)').matches)

  useEffect(() => {
    const query = matchMedia('(max-width: 767px)')
    const update = (event: MediaQueryListEvent) => setMobile(event.matches)
    setMobile(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  return <Suspense fallback={<div className="source-editor-host" aria-label={`${props.label} 준비 중`} />}>
    {mobile ? <MobileEditor {...props} /> : <DesktopEditor {...props} />}
  </Suspense>
}
