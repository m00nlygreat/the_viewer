import { useMemo, useRef, useState } from 'react'
import { Bold, Check, Code2, Heading2, Italic, List, ListOrdered, Pencil, Strikethrough, X } from 'lucide-react'
import type { ViewerDocument } from '../domain/types'
import { renderMarkdownBlocks, type MarkdownSourceBlock } from '../domain/markdown'
import { CodeEditor, type CodeEditorHandle } from '../components/CodeEditor'

interface Props { document: ViewerDocument; text: string; onChange: (text: string, group?: 'typing' | 'command') => void; onUndo: () => void; onRedo: () => void }
interface ActiveBlock extends MarkdownSourceBlock { baseText: string }

export function MarkdownEditor({ document, text, onChange, onUndo, onRedo }: Props) {
  const editorRef = useRef<CodeEditorHandle>(null)
  const formatting = useRef(false)
  const [activeBlock, setActiveBlock] = useState<ActiveBlock | null>(null)
  const [draft, setDraft] = useState('')
  const blocks = useMemo(() => renderMarkdownBlocks(text), [text])
  const lines = text.split(/\r\n|\r|\n/).length
  const words = text.trim() ? text.trim().split(/\s+/u).length : 0
  const canOpenEditor = document.parseState === 'ready' && document.modelRevision === document.revision
  const toolbar = [
    { title: '제목', icon: Heading2, before: '## ', after: '' },
    { title: '굵게', icon: Bold, before: '**', after: '**' },
    { title: '기울임', icon: Italic, before: '*', after: '*' },
    { title: '취소선', icon: Strikethrough, before: '~~', after: '~~' },
    { title: '목록', icon: List, before: '- ', after: '' },
    { title: '번호 목록', icon: ListOrdered, before: '1. ', after: '' },
    { title: '코드', icon: Code2, before: '`', after: '`' }
  ]

  const openBlock = (block: MarkdownSourceBlock) => {
    if (!block.editable || !canOpenEditor) return
    setActiveBlock({ ...block, baseText: text })
    setDraft(text.slice(block.from, block.to))
  }
  const updateDraft = (nextDraft: string) => {
    if (!activeBlock) return
    setDraft(nextDraft)
    onChange(`${activeBlock.baseText.slice(0, activeBlock.from)}${nextDraft}${activeBlock.baseText.slice(activeBlock.to)}`, formatting.current ? 'command' : 'typing')
  }
  const toggleTask = (offset: number, checked: boolean) => {
    if (!canOpenEditor) return
    const marker = checked ? ' ' : 'x'
    onChange(`${text.slice(0, offset)}${marker}${text.slice(offset + 1)}`, 'command')
  }
  const taskMarkers = (block: MarkdownSourceBlock) => [...block.source.matchAll(/^[ \t]*(?:[-*+]\s+|\d+[.)]\s+)\[([ xX])\]/gm)].map((match) => {
    const markerIndex = (match.index ?? 0) + match[0].lastIndexOf('[') + 1
    return { checked: match[1]?.toLowerCase() === 'x', offset: block.from + markerIndex }
  })

  return <section className="markdown-view-layout">
    <article className="markdown-prose markdown-block-list" aria-label="Markdown 문서">
      {blocks.map((block) => <section className={`markdown-source-block${activeBlock?.from === block.from ? ' selected' : ''}${block.editable ? '' : ' protected'}`} key={`${block.from}-${block.to}`}>
        <div className="markdown-block-actions">
          {block.editable && <button className="subtle-button" disabled={!canOpenEditor} onClick={() => openBlock(block)}><Pencil size={13} /> 이 블록 편집</button>}
          {!block.editable && <span>frontmatter · 원본 탭에서 편집</span>}
        </div>
        <div dangerouslySetInnerHTML={{ __html: block.html }} />
        {taskMarkers(block).map(({ checked, offset }, index) => <button key={`${offset}-${index}`} className="markdown-task-toggle" disabled={!canOpenEditor} aria-label={`작업 항목 ${checked ? '완료 취소' : '완료'}`} aria-pressed={checked} onClick={() => toggleTask(offset, checked)}><Check size={13} />{checked ? '완료' : '완료 표시'}</button>)}
      </section>)}
      {!blocks.length && <div className="markdown-empty"><span>문서가 비어 있습니다.</span>{canOpenEditor && <button className="subtle-button" onClick={() => openBlock({ from: 0, to: 0, source: '', html: '', editable: true })}><Pencil size={13} /> 첫 블록 작성</button>}</div>}
    </article>
    {activeBlock && <section className="markdown-inline-editor" aria-label="Markdown 블록 편집">
      <div className="markdown-toolbar" role="toolbar" aria-label="Markdown 서식">
        <span className="small-muted">선택한 원문 블록</span>
        {toolbar.map(({ title, icon: Icon, before, after }) => <button key={title} className="toolbar-button icon-only" aria-label={title} title={title} onMouseDown={(event) => event.preventDefault()} onClick={() => { formatting.current = true; try { editorRef.current?.wrapSelection(before, after) } finally { formatting.current = false } }}><Icon size={15} /></button>)}
        <div className="toolbar-spacer" /><button className="icon-button" aria-label="블록 편집 닫기" onClick={() => setActiveBlock(null)}><X size={15} /></button>
      </div>
      <div className="markdown-editor-pane"><CodeEditor ref={editorRef} value={draft} onChange={updateDraft} markdownMode label={`${document.name} 선택 블록 편집기`} onUndo={onUndo} onRedo={onRedo} /></div>
    </section>}
    <div className="document-stats">{lines}줄 · {text.length.toLocaleString()}자 · {words}단어</div>
  </section>
}
