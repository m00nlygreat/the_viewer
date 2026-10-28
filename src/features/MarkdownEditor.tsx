import { useRef } from 'react'
import { Bold, CheckSquare, Code2, Heading2, Italic, Link2, List, ListOrdered, Quote, Strikethrough } from 'lucide-react'
import type { ViewerDocument } from '../domain/types'
import { CodeEditor, type CodeEditorHandle } from '../components/CodeEditor'

interface Props {
  document: ViewerDocument
  text: string
  onChange: (text: string, group?: 'typing' | 'command') => void
  onUndo: () => void
  onRedo: () => void
}

export function MarkdownEditor({ document, text, onChange, onUndo, onRedo }: Props) {
  const editorRef = useRef<CodeEditorHandle>(null)
  const lines = text.split(/\r\n|\r|\n/u).length
  const words = text.trim() ? text.trim().split(/\s+/u).length : 0
  const toolbar = [
    { title: '제목', icon: Heading2, action: () => editorRef.current?.prefixLines('## ') },
    { title: '굵게', icon: Bold, action: () => editorRef.current?.wrapSelection('**') },
    { title: '기울임', icon: Italic, action: () => editorRef.current?.wrapSelection('*') },
    { title: '취소선', icon: Strikethrough, action: () => editorRef.current?.wrapSelection('~~') },
    { title: '코드', icon: Code2, action: () => editorRef.current?.wrapSelection('`') },
    { title: '링크', icon: Link2, action: () => editorRef.current?.wrapSelection('[', '](https://example.com)') },
    { title: '목록', icon: List, action: () => editorRef.current?.prefixLines('- ') },
    { title: '번호 목록', icon: ListOrdered, action: () => editorRef.current?.prefixLines('1. ') },
    { title: '인용', icon: Quote, action: () => editorRef.current?.prefixLines('> ') },
    { title: '체크리스트', icon: CheckSquare, action: () => editorRef.current?.toggleChecklist() }
  ]

  return <section className="markdown-live-layout" aria-label="Markdown 문서 편집">
    <div className="markdown-toolbar" role="toolbar" aria-label="Markdown 서식">
      <span className="small-muted">선택 범위 서식</span>
      {toolbar.map(({ title, icon: Icon, action }) => <button
        key={title}
        type="button"
        className="toolbar-button icon-only"
        aria-label={title}
        title={title}
        onMouseDown={(event) => event.preventDefault()}
        onClick={action}
      ><Icon size={15} /></button>)}
    </div>
    <div className="markdown-live-editor">
      <CodeEditor
        ref={editorRef}
        value={text}
        onChange={onChange}
        markdownMode
        livePreview
        stateKey={`markdown-view:${document.id}`}
        label={`${document.name} Markdown 편집기`}
        onUndo={onUndo}
        onRedo={onRedo}
      />
    </div>
    <div className="document-stats">{lines}줄 · {text.length.toLocaleString()}자 · {words}단어</div>
  </section>
}
