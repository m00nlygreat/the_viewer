import DOMPurify from 'dompurify'
import MarkdownIt from 'markdown-it'
import { detectMarkdownFrontmatter } from './formats/markdownFrontmatter'

const markdown = new MarkdownIt({ html: false, linkify: true, breaks: false, typographer: false })
const safeLinkTarget = '_blank'
const safeLinkRel = 'noopener noreferrer'
markdown.renderer.rules.image = (tokens, index) => `<span class="blocked-image">이미지: ${markdown.utils.escapeHtml(tokens[index]!.content || '외부 이미지 차단')}</span>`
markdown.renderer.rules.link_open = (tokens, index, options, _env, self) => {
  tokens[index]!.attrSet('target', safeLinkTarget)
  tokens[index]!.attrSet('rel', safeLinkRel)
  return self.renderToken(tokens, index, options)
}
markdown.core.ruler.after('inline', 'gfm-task-markers', (state) => {
  for (let index = 0; index < state.tokens.length; index += 1) {
    const item = state.tokens[index]
    if (item?.type !== 'list_item_open') continue
    const inline = state.tokens.slice(index + 1).find((token) => token.type === 'inline' || token.type === 'list_item_close')
    if (inline?.type !== 'inline') continue
    const firstText = inline.children?.find((token) => token.type === 'text')
    const marker = firstText?.content.match(/^\[([ xX])\]\s+/)
    if (!firstText || !marker) continue
    const checked = marker[1]?.toLowerCase() === 'x'
    firstText.content = `${checked ? '☑' : '☐'} ${firstText.content.slice(marker[0].length)}`
    item.attrJoin('class', 'task-list-item')
    item.attrSet('data-checked', String(checked))
  }
})

function renderMarkdownFrontmatter(content: string): string {
  return `<section class="markdown-frontmatter" aria-label="YAML frontmatter"><div class="markdown-frontmatter-label">YAML</div><pre><code class="language-yaml">${markdown.utils.escapeHtml(content)}</code></pre></section>`
}

export function renderMarkdownMarkup(source: string): string {
  const frontmatter = detectMarkdownFrontmatter(source)
  if (!frontmatter) return markdown.render(source)
  return `${renderMarkdownFrontmatter(frontmatter.content)}${markdown.render(source.slice(frontmatter.to))}`
}

export function markdownLinkAttributes(url: string): { href: string; target: string; rel: string } | null {
  try {
    const href = markdown.normalizeLink(url)
    return markdown.validateLink(href) ? { href, target: safeLinkTarget, rel: safeLinkRel } : null
  } catch {
    return null
  }
}

export function renderMarkdown(source: string): string {
  return DOMPurify.sanitize(renderMarkdownMarkup(source), { FORBID_TAGS: ['img', 'iframe', 'video', 'audio', 'style', 'link', 'form', 'input'], FORBID_ATTR: ['style', 'src', 'srcset'] })
}
