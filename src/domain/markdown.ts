import DOMPurify from 'dompurify'
import MarkdownIt from 'markdown-it'

const markdown = new MarkdownIt({ html: false, linkify: true, breaks: false, typographer: false })
markdown.renderer.rules.image = (tokens, index) => `<span class="blocked-image">이미지: ${markdown.utils.escapeHtml(tokens[index]!.content || '외부 이미지 차단')}</span>`
markdown.renderer.rules.link_open = (tokens, index, options, _env, self) => {
  tokens[index]!.attrSet('target', '_blank')
  tokens[index]!.attrSet('rel', 'noopener noreferrer')
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

export function renderMarkdownMarkup(source: string): string { return markdown.render(source) }

export function renderMarkdown(source: string): string {
  return DOMPurify.sanitize(renderMarkdownMarkup(source), { FORBID_TAGS: ['img', 'iframe', 'video', 'audio', 'style', 'link', 'form', 'input'], FORBID_ATTR: ['style', 'src', 'srcset'] })
}

export interface MarkdownSourceBlock { from: number; to: number; source: string; html: string; editable: boolean }

export function renderMarkdownBlocks(source: string): MarkdownSourceBlock[] {
  const lineStarts = [0]
  for (let index = 0; index < source.length; index += 1) if (source[index] === '\n') lineStarts.push(index + 1)
  const tokens = markdown.parse(source, {})
  const ranges: Array<{ fromLine: number; toLine: number }> = []
  let depth = 0
  for (const token of tokens) {
    if (depth === 0 && token.map && (token.nesting === 1 || token.nesting === 0)) {
      const last = ranges[ranges.length - 1]
      if (last && token.map[0] < last.toLine) last.toLine = Math.max(last.toLine, token.map[1])
      else ranges.push({ fromLine: token.map[0], toLine: token.map[1] })
    }
    depth = Math.max(0, depth + token.nesting)
  }
  const rawLines = source.split(/\r\n|\r|\n/)
  let frontmatterEnd = 0
  if (rawLines[0]?.trim() === '---') {
    const close = rawLines.findIndex((line, index) => index > 0 && ['---', '...'].includes(line.trim()))
    if (close > 0) frontmatterEnd = lineStarts[close + 1] ?? source.length
  }
  return ranges.map(({ fromLine, toLine }) => {
    const from = lineStarts[fromLine] ?? source.length
    const to = lineStarts[toLine] ?? source.length
    const blockSource = source.slice(from, to)
    const protectedBlock = frontmatterEnd > from && frontmatterEnd >= to
    const html = protectedBlock
      ? `<pre class="markdown-frontmatter">${markdown.utils.escapeHtml(blockSource)}</pre>`
      : renderMarkdown(blockSource)
    return { from, to, source: blockSource, html, editable: !protectedBlock }
  }).filter((block) => block.to > block.from)
}
