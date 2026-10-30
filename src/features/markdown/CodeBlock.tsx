import { lazy, Suspense, useSyncExternalStore } from 'react'
import DOMPurify from 'dompurify'
import { Check, Code2 } from 'lucide-react'
import { highlightMarkdownCode } from './codeHighlight'
import type { MarkdownCodeBlockState } from './codeBlockState'
import { useOutsideClick } from '../../components/useOutsideClick'

const MarkdownCodeBlockMonacoEditor = lazy(() => import('./CodeBlockEditor'))

interface Props { block: MarkdownCodeBlockState }

export function MarkdownCodeBlock({ block }: Props) {
  const snapshot = useSyncExternalStore(block.subscribe, block.getSnapshot, block.getSnapshot)
  const editorRoot = useOutsideClick<HTMLElement>(snapshot.editing, () => block.setEditing(false))
  if (snapshot.editing) {
    return <section ref={editorRoot} className="cm-md-code-editor" aria-label="Markdown 코드 블록 편집기">
      <div className="cm-md-code-toolbar">
        <span><Code2 size={14} />{snapshot.languageLabel}</span>
        <span className="toolbar-spacer" />
        <button type="button" className="toolbar-button" onMouseDown={(event) => event.preventDefault()} onClick={() => block.setEditing(false)}><Check size={13} /> 완료</button>
      </div>
      <Suspense fallback={<div className="cm-md-code-loading">Monaco 불러오는 중…</div>}>
        <MarkdownCodeBlockMonacoEditor
          code={snapshot.code}
          language={snapshot.language?.monaco ?? 'plaintext'}
          theme={snapshot.theme}
          onChange={(code) => block.replaceCode(code)}
          onUndo={() => block.undoDocument()}
          onRedo={() => block.redoDocument()}
        />
      </Suspense>
    </section>
  }

  const highlighted = highlightMarkdownCode(snapshot.code, snapshot.language?.highlight ?? null)
  const safeHighlighted = DOMPurify.sanitize(highlighted, { ALLOWED_TAGS: ['span'], ALLOWED_ATTR: ['class'] })
  return <section className="cm-md-code-preview" onDoubleClick={() => block.setEditing(true)}>
    <div className="cm-md-code-toolbar">
      <span><Code2 size={14} />{snapshot.languageLabel}</span>
      <span className="toolbar-spacer" />
      <button type="button" className="toolbar-button" aria-label="코드 편집" title="코드 편집" onMouseDown={(event) => event.preventDefault()} onClick={() => block.setEditing(true)}>코드 편집</button>
    </div>
    <pre><code className={snapshot.language ? `hljs language-${snapshot.language.highlight}` : 'hljs'} dangerouslySetInnerHTML={{ __html: safeHighlighted }} /></pre>
  </section>
}
