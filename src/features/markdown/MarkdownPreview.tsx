import { useEffect, useRef } from 'react'
import DOMPurify from 'dompurify'
import { renderMarkdownMarkup, markdownLinkAttributes } from '../../domain/markdown'
import { collectMarkdownReferences, prepareObsidianReferences } from '../../domain/markdownReferences'
import type { MarkdownReferenceContext } from './localReferenceState'
import { markdownReferenceKey } from './localReferenceState'
import { parseLocalReference } from '../../domain/folderPaths'
import { LocalReferenceWidgetView } from './LocalReferenceWidget'
import { createRoot, type Root } from 'react-dom/client'
import { createPreviewReferenceIndex } from './previewReferenceIndex'

interface Props { source: string; context: MarkdownReferenceContext; ancestors: MarkdownReferenceContext['ancestors']; depth: number }

export function MarkdownPreview({ source, context, ancestors, depth }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const mounted = useRef(new Map<string, { element: HTMLSpanElement; root: Root }>())
  const contextRef = useRef(context)
  contextRef.current = context
  const ancestorsRef = useRef(ancestors)
  ancestorsRef.current = ancestors
  const depthRef = useRef(depth)
  depthRef.current = depth
  const ancestorKey = ancestors.map((ancestor) => `${ancestor.folderId}\u0000${ancestor.path}\u0000${ancestor.fragment}`).join('\u0001')
  useEffect(() => {
    const element = host.current
    if (!element) return
    const currentContext = contextRef.current
    const currentAncestors = ancestorsRef.current
    const currentDepth = depthRef.current
    const references = collectMarkdownReferences(source)
    const referenceIndex = createPreviewReferenceIndex(references)
    const validKeys = new Set(references.filter(isLocalReferenceForPreview).map((reference) => markdownReferenceKey(currentContext.instanceId, reference)))
    currentContext.referenceState.retain(currentContext.instanceId, validKeys)
    const prepared = prepareObsidianReferences(source)
    const template = document.createElement('template')
    template.innerHTML = DOMPurify.sanitize(renderMarkdownMarkup(prepared.source), { FORBID_TAGS: ['img', 'iframe', 'video', 'audio', 'style', 'link', 'form', 'input'], FORBID_ATTR: ['style', 'src', 'srcset'] })
    const activeRoots = new Set<string>()
    const used = new Set<number>()
    const mountReference = (placeholder: HTMLSpanElement, reference: ReturnType<typeof collectMarkdownReferences>[number]) => {
      const key = markdownReferenceKey(currentContext.instanceId, reference)
      activeRoots.add(key)
      let entry = mounted.current.get(key)
      if (entry) placeholder.replaceWith(entry.element)
      else {
        const root = createRoot(placeholder)
        entry = { element: placeholder, root }
        mounted.current.set(key, entry)
      }
      entry.root.render(<LocalReferenceWidgetView reference={reference} context={{ ...currentContext, ancestors: currentAncestors, depth: currentDepth }} />)
    }
    for (const link of Array.from(template.content.querySelectorAll('a[href]'))) {
      const href = link.getAttribute('href') ?? ''
      const safe = markdownLinkAttributes(href)
      if (safe && /^https?:/iu.test(safe.href)) continue
      const tokenReference = prepared.byToken.get(href)
      const index = referenceIndex.find(tokenReference, href, 'link', used)
      if (index < 0) { link.replaceWith(document.createTextNode(link.textContent ?? href)); continue }
      const placeholder = document.createElement('span')
      placeholder.className = 'markdown-preview-reference'
      link.replaceWith(placeholder)
      mountReference(placeholder, references[index]!)
    }
    for (const image of Array.from(template.content.querySelectorAll('.blocked-image[data-image-target]'))) {
      const target = image.getAttribute('data-image-target') ?? ''
      const tokenReference = prepared.byToken.get(target)
      const index = referenceIndex.find(tokenReference, target, 'embed', used)
      if (index < 0) continue
      const placeholder = document.createElement('span')
      placeholder.className = 'markdown-preview-reference'
      image.replaceWith(placeholder)
      mountReference(placeholder, references[index]!)
    }
    element.replaceChildren(template.content)
    for (const [key, entry] of mounted.current) {
      if (activeRoots.has(key)) continue
      entry.root.unmount()
      mounted.current.delete(key)
    }
  }, [ancestorKey, context.folderId, context.generation, context.instanceId, context.ownerPath, context.ownerText, context.referenceState, context.services, depth, source])
  useEffect(() => () => {
    for (const entry of mounted.current.values()) entry.root.unmount()
    mounted.current.clear()
  }, [])
  return <div ref={host} className="local-markdown-preview" />
}

function isLocalReferenceForPreview(reference: ReturnType<typeof collectMarkdownReferences>[number]): boolean {
  return parseLocalReference(reference.target, reference.kind.startsWith('obsidian') ? 'obsidian' : 'markdown').kind !== 'external'
}
