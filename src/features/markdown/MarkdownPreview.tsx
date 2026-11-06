import { useEffect, useRef } from 'react'
import DOMPurify from 'dompurify'
import { renderMarkdownMarkup, markdownLinkAttributes } from '../../domain/markdown'
import { collectMarkdownReferences, prepareObsidianReferences } from '../../domain/markdownReferences'
import type { MarkdownReferenceContext } from './localReferenceState'
import { markdownReferenceKey } from './localReferenceState'
import { parseLocalReference } from '../../domain/folderPaths'
import { LocalReferenceWidgetView } from './LocalReferenceWidget'
import { createRoot, type Root } from 'react-dom/client'

interface Props { source: string; context: MarkdownReferenceContext; ancestors: MarkdownReferenceContext['ancestors']; depth: number }

export function MarkdownPreview({ source, context, ancestors, depth }: Props) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = host.current
    if (!element) return
    const references = collectMarkdownReferences(source)
    const validKeys = new Set(references.filter(isLocalReferenceForPreview).map((reference) => markdownReferenceKey(context.instanceId, reference)))
    context.referenceState.retain(context.instanceId, validKeys)
    const prepared = prepareObsidianReferences(source)
    const template = document.createElement('template')
    template.innerHTML = DOMPurify.sanitize(renderMarkdownMarkup(prepared.source), { FORBID_TAGS: ['img', 'iframe', 'video', 'audio', 'style', 'link', 'form', 'input'], FORBID_ATTR: ['style', 'src', 'srcset'] })
    const mounted: Root[] = []
    const used = new Set<number>()
    for (const link of Array.from(template.content.querySelectorAll('a[href]'))) {
      const href = link.getAttribute('href') ?? ''
      const safe = markdownLinkAttributes(href)
      if (safe && /^https?:/iu.test(safe.href)) continue
      const tokenReference = prepared.byToken.get(href)
      const index = tokenReference ? references.indexOf(tokenReference) : references.findIndex((reference, candidate) => !used.has(candidate) && reference.target === href && (reference.kind === 'link' || reference.kind === 'obsidian-link'))
      if (index < 0) { link.replaceWith(document.createTextNode(link.textContent ?? href)); continue }
      used.add(index)
      const placeholder = document.createElement('span')
      placeholder.className = 'markdown-preview-reference'
      link.replaceWith(placeholder)
      mounted.push(createRoot(placeholder))
      mounted[mounted.length - 1]!.render(<LocalReferenceWidgetView reference={references[index]!} context={{ ...context, ancestors, depth }} />)
    }
    for (const image of Array.from(template.content.querySelectorAll('.blocked-image[data-image-target]'))) {
      const target = image.getAttribute('data-image-target') ?? ''
      const tokenReference = prepared.byToken.get(target)
      const index = tokenReference ? references.indexOf(tokenReference) : references.findIndex((reference, candidate) => !used.has(candidate) && reference.target === target && (reference.kind === 'image' || reference.kind === 'obsidian-embed'))
      if (index < 0) continue
      used.add(index)
      const placeholder = document.createElement('span')
      placeholder.className = 'markdown-preview-reference'
      image.replaceWith(placeholder)
      mounted.push(createRoot(placeholder))
      mounted[mounted.length - 1]!.render(<LocalReferenceWidgetView reference={references[index]!} context={{ ...context, ancestors, depth }} />)
    }
    element.replaceChildren(template.content)
    return () => { for (const root of mounted) root.unmount() }
  }, [ancestors, context, depth, source])
  return <div ref={host} className="local-markdown-preview" />
}

function isLocalReferenceForPreview(reference: ReturnType<typeof collectMarkdownReferences>[number]): boolean {
  return parseLocalReference(reference.target, reference.kind.startsWith('obsidian') ? 'obsidian' : 'markdown').kind !== 'external'
}
