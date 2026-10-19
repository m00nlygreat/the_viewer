import { useMemo, useRef } from 'react'
import { Bold, Code2, Heading2, Italic, List, ListOrdered, Strikethrough } from 'lucide-react'
import type { ViewerDocument } from '../domain/types'
import { renderMarkdown } from '../domain/markdown'
import { CodeEditor, type CodeEditorHandle } from '../components/CodeEditor'

interface Props { document: ViewerDocument; text: string; onChange: (text: string) => void }

export function MarkdownEditor({ document, text, onChange }: Props) {
  const editorRef = useRef<CodeEditorHandle>(null)
  const rendered = useMemo(() => renderMarkdown(text), [text])
  const lines = text.split(/\r\n|\r|\n/).length
  const words = text.trim() ? text.trim().split(/\s+/u).length : 0
  const toolbar = [
    { title: '제목', icon: Heading2, before: '## ', after: '' },
    { title: '굵게', icon: Bold, before: '**', after: '**' },
    { title: '기울임', icon: Italic, before: '*', after: '*' },
    { title: '취소선', icon: Strikethrough, before: '~~', after: '~~' },
    { title: '목록', icon: List, before: '- ', after: '' },
    { title: '번호 목록', icon: ListOrdered, before: '1. ', after: '' },
    { title: '코드', icon: Code2, before: '`', after: '`' }
  ]
  const addFormat = (before: string, after: string) => editorRef.current?.wrapSelection(before, after)

  if (document.mode === 'view') return <section className="markdown-reading"><article className="markdown-prose" dangerouslySetInnerHTML={{ __html: rendered }} /><div className="document-stats">{lines}줄 · {text.length.toLocaleString()}자 · {words}단어</div></section>
  return <section className="markdown-editing">
    <div className="markdown-toolbar" role="toolbar" aria-label="Markdown 서식">
      {toolbar.map(({ title, icon: Icon, before, after }) => <button key={title} className="toolbar-button icon-only" aria-label={title} title={title} onMouseDown={(event) => event.preventDefault()} onClick={() => addFormat(before, after)}><Icon size={15} /></button>)}
      <div className="toolbar-spacer" /><span className="small-muted">Markdown</span>
    </div>
    <div className="markdown-editor-pane"><CodeEditor ref={editorRef} value={text} onChange={onChange} markdownMode label={`${document.name} 편집기`} /></div>
    <div className="document-stats">{lines}줄 · {text.length.toLocaleString()}자 · {words}단어</div>
  </section>
}
