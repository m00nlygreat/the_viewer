import { markdownLanguage } from '@codemirror/lang-markdown'
import { detectMarkdownFrontmatter } from './formats/markdownFrontmatter'

export type MarkdownReferenceKind = 'link' | 'image' | 'obsidian-link' | 'obsidian-embed'

export interface MarkdownReference {
  from: number
  to: number
  raw: string
  target: string
  kind: MarkdownReferenceKind
  label?: string
  width?: number
  height?: number
  fragment?: string
}

export interface ObsidianReference {
  target: string
  label?: string
  fragment?: string
  width?: number
  height?: number
  embed: boolean
}

export interface MarkdownFragmentSelection { from: number; to: number; kind: 'heading' | 'block' }

export interface PreparedObsidianReferences {
  source: string
  byToken: ReadonlyMap<string, MarkdownReference>
}

export function collectMarkdownReferences(source: string): MarkdownReference[] {
  const tree = markdownLanguage.parser.parse(source)
  const codeRanges: Array<{ from: number; to: number }> = []
  const markdownNodes: Array<{ name: string; from: number; to: number }> = []
  tree.iterate({ enter(node) {
    if (['FencedCode', 'CodeBlock', 'InlineCode'].includes(node.name)) codeRanges.push({ from: node.from, to: node.to })
    if (['Link', 'Image', 'LinkReference', 'ImageReference'].includes(node.name)) markdownNodes.push({ name: node.name, from: node.from, to: node.to })
  } })
  const frontmatter = detectMarkdownFrontmatter(source)
  const outsideCode = (from: number, to: number) => !codeRanges.some((range) => from < range.to && to > range.from) && !(frontmatter && from < frontmatter.to && to > frontmatter.from)
  const definitions = collectDefinitions(source)
  const references: MarkdownReference[] = []

  for (const node of markdownNodes.sort((left, right) => left.from - right.from || right.to - left.to)) {
    if (!outsideCode(node.from, node.to)) continue
    const raw = source.slice(node.from, node.to)
    const parsed = parseMarkdownNode(node.name, raw, definitions)
    if (!parsed) continue
    references.push({ from: node.from, to: node.to, raw, ...parsed })
  }

  const obsidianPattern = /!?\[\[([^\]\r\n]+)\]\]/gu
  let match: RegExpExecArray | null
  while ((match = obsidianPattern.exec(source))) {
    const from = match.index
    const to = from + match[0].length
    if (!outsideCode(from, to) || isEscaped(source, from)) continue
    if (references.some((item) => item.from < to && item.to > from)) continue
    const parsed = parseObsidianReference(match[0])
    references.push({
      from, to, raw: match[0], target: parsed.target,
      kind: parsed.embed ? 'obsidian-embed' : 'obsidian-link',
      ...(parsed.label ? { label: parsed.label } : {}),
      ...(parsed.width ? { width: parsed.width } : {}),
      ...(parsed.height ? { height: parsed.height } : {}),
      ...(parsed.fragment ? { fragment: parsed.fragment } : {})
    })
  }
  const ordered = references.sort((left, right) => left.from - right.from || right.to - left.to)
  const result: MarkdownReference[] = []
  for (const reference of ordered) {
    if (result.some((item) => item.from < reference.to && item.to > reference.from)) continue
    result.push(reference)
  }
  return result.sort((left, right) => left.from - right.from || left.to - right.to)
}

export function prepareObsidianReferences(source: string): PreparedObsidianReferences {
  const references = collectMarkdownReferences(source).filter((item) => item.kind.startsWith('obsidian'))
  const byToken = new Map<string, MarkdownReference>()
  let prepared = source
  for (const [index, reference] of [...references].reverse().entries()) {
    let token = `./__the_viewer_local_ref_${index}__`
    while (source.includes(token)) token = `_${token}`
    const display = (reference.label || reference.target.split('/').pop() || reference.target).replace(/[\\[\]]/gu, '\\$&')
    const image = reference.kind === 'obsidian-embed'
    prepared = `${prepared.slice(0, reference.from)}${image ? '!' : ''}[${display}](${token})${prepared.slice(reference.to)}`
    byToken.set(token, reference)
  }
  return { source: prepared, byToken }
}

export function parseObsidianReference(raw: string): ObsidianReference {
  const embed = raw.startsWith('![[')
  const content = raw.replace(/^!?\[\[/u, '').replace(/\]\]$/u, '')
  const separator = content.indexOf('|')
  let target = separator < 0 ? content : content.slice(0, separator)
  const suffix = separator < 0 ? '' : content.slice(separator + 1)
  let fragment: string | undefined
  const fragmentAt = target.lastIndexOf('#')
  if (fragmentAt >= 0) { fragment = safeDecode(target.slice(fragmentAt + 1)); target = target.slice(0, fragmentAt) }
  if (embed && suffix) {
    const dimensions = suffix.trim().match(/^(\d+)(?:\s*x\s*(\d+))?$/iu)
    if (dimensions) {
      const width = Number(dimensions[1])
      const height = dimensions[2] ? Number(dimensions[2]) : undefined
      return { target, embed, ...(fragment ? { fragment } : {}), ...(Number.isSafeInteger(width) && width > 0 ? { width } : {}), ...(height && Number.isSafeInteger(height) && height > 0 ? { height } : {}) }
    }
  }
  return { target, embed, ...(suffix ? { label: suffix } : {}), ...(fragment ? { fragment } : {}) }
}

export function selectMarkdownFragment(source: string, fragment: string): MarkdownFragmentSelection | null {
  const wanted = safeDecode(fragment).trim()
  if (!wanted) return null
  if (wanted.startsWith('^')) {
    const blockId = wanted.slice(1)
    if (!blockId) return null
    const tree = markdownLanguage.parser.parse(source)
    const codeRanges: Array<{ from: number; to: number }> = []
    const blocks: Array<{ name: string; from: number; to: number }> = []
    tree.iterate({ enter(node) {
      if (['FencedCode', 'CodeBlock', 'InlineCode'].includes(node.name)) codeRanges.push({ from: node.from, to: node.to })
      if (['Paragraph', 'ListItem', 'Blockquote', 'Table'].includes(node.name)) blocks.push({ name: node.name, from: node.from, to: node.to })
    } })
    const lines = source.split(/\r\n|\r|\n/u)
    let offset = 0
    for (const line of lines) {
      const marker = line.match(/(?:^|\s)\^([\w-]+)\s*$/u)
      if (marker?.[1] === blockId) {
        const markerFrom = offset
        if (codeRanges.some((range) => markerFrom >= range.from && markerFrom < range.to)) return null
        const previous = source.slice(0, markerFrom).replace(/\s+$/u, '').length
        const owner = blocks.filter((block) => block.from <= previous && block.to >= previous).sort((a, b) => (a.to - a.from) - (b.to - b.from))[0]
        if (owner) return { from: owner.from, to: owner.to, kind: 'block' }
        return { from: markerFrom, to: markerFrom + line.length, kind: 'block' }
      }
      offset += line.length + (source.startsWith('\r\n', offset) ? 2 : source[offset] === '\r' || source[offset] === '\n' ? 1 : 0)
    }
    return null
  }

  const tree = markdownLanguage.parser.parse(source)
  const headings: Array<{ from: number; to: number; level: number; text: string; slug: string }> = []
  tree.iterate({ enter(node) {
    const match = node.name.match(/^(?:ATXHeading|SetextHeading)([1-6])$/u)
    if (!match) return
    const raw = source.slice(node.from, node.to)
    const text = raw.replace(/^\s{0,3}#{1,6}\s*/u, '').replace(/\s*#{1,6}\s*$/u, '').replace(/\s*=+\s*$/u, '').replace(/\s*-+\s*$/u, '').replace(/[`*_~]/gu, '').trim()
    headings.push({ from: node.from, to: node.to, level: Number(match[1]), text, slug: '' })
  } })
  const duplicateCount = new Map<string, number>()
  for (const heading of headings) {
    const base = markdownHeadingAnchor(heading.text)
    const count = duplicateCount.get(base) ?? 0
    heading.slug = count ? `${base}-${count}` : base
    duplicateCount.set(base, count + 1)
  }
  const selected = headings.find((heading) => heading.slug === wanted || heading.text.toLocaleLowerCase() === wanted.toLocaleLowerCase())
  if (!selected) return null
  const next = headings.find((heading) => heading.from > selected.from && heading.level <= selected.level)
  return { from: selected.from, to: next?.from ?? source.length, kind: 'heading' }
}

export function markdownHeadingAnchor(text: string): string {
  return text.trim().toLocaleLowerCase().replace(/\s+/gu, '-')
}

function parseMarkdownNode(name: string, raw: string, definitions: ReadonlyMap<string, string>): Omit<MarkdownReference, 'from' | 'to' | 'raw'> | null {
  const image = name === 'Image' || name === 'ImageReference' || raw.startsWith('![')
  const inline = raw.match(/^!?\[([\s\S]*?)\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+(["'][\s\S]*?["']))?\s*\)$/u)
  if (inline) return { target: inline[2] ?? inline[3] ?? '', kind: image ? 'image' : 'link', ...(inline[1] ? { label: inline[1] } : {}) }
  const reference = raw.match(/^!?\[([\s\S]*?)\](?:\[([\s\S]*?)\])?$/u)
  if (!reference) return null
  const key = normalizeReferenceName(reference[2] || reference[1] || '')
  const target = definitions.get(key)
  return target ? { target, kind: image ? 'image' : 'link', ...(reference[1] ? { label: reference[1] } : {}) } : null
}

function collectDefinitions(source: string): Map<string, string> {
  const result = new Map<string, string>()
  const frontmatter = detectMarkdownFrontmatter(source)
  const body = frontmatter ? source.slice(frontmatter.to) : source
  const pattern = /^ {0,3}\[([^\]]+)\]:\s*(?:<([^>]+)>|(\S+))/gmu
  let match: RegExpExecArray | null
  while ((match = pattern.exec(body))) result.set(normalizeReferenceName(match[1]!), match[2] ?? match[3]!)
  return result
}

function normalizeReferenceName(value: string): string { return value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase() }
function safeDecode(value: string): string { try { return decodeURIComponent(value.replace(/\+/gu, '%2B')) } catch { return value } }
function isEscaped(source: string, position: number): boolean {
  let slashes = 0
  for (let index = position - 1; index >= 0 && source[index] === '\\'; index -= 1) slashes += 1
  return slashes % 2 === 1
}
