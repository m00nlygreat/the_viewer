import { FileQuestion } from 'lucide-react'

export function UnsupportedFilePage({ name, reason }: { name: string; reason?: string }) {
  const openFailed = Boolean(reason)
  return <section className="folder-empty-state" role={openFailed ? 'alert' : 'status'} aria-label={`${name}${openFailed ? ' 파일 열기 실패' : ' 지원 불가'} 안내`}>
    <FileQuestion size={24} aria-hidden="true" />
    <strong>{openFailed ? '파일을 열 수 없습니다' : '지원하지 않는 파일 형식입니다'}</strong>
    <p>{reason ?? `${name} 파일은 텍스트로 표시할 수 없습니다.`}</p>
  </section>
}
