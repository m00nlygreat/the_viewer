import { FileQuestion } from 'lucide-react'

export function UnsupportedFilePage({ name }: { name: string }) {
  return <section className="folder-empty-state" role="status" aria-label={`${name} 지원 불가 안내`}>
    <FileQuestion size={24} aria-hidden="true" />
    <strong>지원하지 않는 파일 형식입니다</strong>
    <p>{name} 파일은 텍스트로 표시할 수 없습니다.</p>
  </section>
}
