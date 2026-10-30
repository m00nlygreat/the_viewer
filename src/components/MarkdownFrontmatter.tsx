import { lazy, Suspense, useSyncExternalStore } from 'react'
import { Check, Code2 } from 'lucide-react'
import type { MarkdownFrontmatterState } from './markdownFrontmatterState'
import { useOutsideClick } from './useOutsideClick'

const MarkdownCodeBlockMonacoEditor = lazy(() => import('../features/MarkdownCodeBlockMonacoEditor'))

interface Props { frontmatter: MarkdownFrontmatterState }

export function MarkdownFrontmatterBlock({ frontmatter }: Props) {
  const snapshot = useSyncExternalStore(frontmatter.subscribe, frontmatter.getSnapshot, frontmatter.getSnapshot)
  const editorRoot = useOutsideClick<HTMLElement>(snapshot.editing, () => frontmatter.setEditing(false))
  if (snapshot.editing) {
    return <section ref={editorRoot} className="cm-md-code-editor cm-md-frontmatter-editor" aria-label="YAML frontmatter 편집기">
      <div className="cm-md-code-toolbar">
        <span><Code2 size={14} />YAML frontmatter</span>
        <span className="toolbar-spacer" />
        <button type="button" className="toolbar-button" onMouseDown={(event) => event.preventDefault()} onClick={() => frontmatter.setEditing(false)}><Check size={13} /> 완료</button>
      </div>
      <Suspense fallback={<div className="cm-md-code-loading">Monaco 불러오는 중…</div>}>
        <MarkdownCodeBlockMonacoEditor
          code={snapshot.raw}
          language="yaml"
          theme={snapshot.theme}
          onChange={(content) => frontmatter.replaceRaw(content)}
          onUndo={() => frontmatter.undoDocument()}
          onRedo={() => frontmatter.redoDocument()}
        />
      </Suspense>
    </section>
  }

  return <section className="markdown-frontmatter" aria-label="YAML frontmatter">
    <div className="markdown-frontmatter-label">
      <span>YAML</span>
      <button type="button" className="toolbar-button" aria-label="YAML 편집" title="YAML 편집" onMouseDown={(event) => event.preventDefault()} onClick={() => frontmatter.setEditing(true)}>YAML 편집</button>
    </div>
    <pre><code className="language-yaml">{snapshot.content}</code></pre>
  </section>
}
