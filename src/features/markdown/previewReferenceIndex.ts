import type { MarkdownReference } from '../../domain/markdownReferences'

type ReferenceGroup = 'link' | 'embed'

export function createPreviewReferenceIndex(references: readonly MarkdownReference[]) {
  const byRange = new Map<string, number>()
  const linksByTarget = new Map<string, number[]>()
  const embedsByTarget = new Map<string, number[]>()
  references.forEach((reference, index) => {
    byRange.set(referenceKey(reference), index)
    const targetIndex = reference.kind === 'link' || reference.kind === 'obsidian-link'
      ? linksByTarget
      : reference.kind === 'image' || reference.kind === 'obsidian-embed' ? embedsByTarget : null
    if (!targetIndex) return
    const matches = targetIndex.get(reference.target)
    if (matches) matches.push(index)
    else targetIndex.set(reference.target, [index])
  })

  const cursorByTarget = new Map<string, number>()
  return {
    find(tokenReference: MarkdownReference | undefined, target: string, group: ReferenceGroup, used: Set<number>): number {
      if (tokenReference) {
        const exact = byRange.get(referenceKey(tokenReference))
        if (exact !== undefined) { used.add(exact); return exact }
      }
      const cursorKey = `${group}\u0000${target}`
      const candidates = (group === 'link' ? linksByTarget : embedsByTarget).get(target) ?? []
      let cursor = cursorByTarget.get(cursorKey) ?? 0
      while (cursor < candidates.length && used.has(candidates[cursor]!)) cursor++
      const index = candidates[cursor]
      if (index === undefined) return -1
      cursorByTarget.set(cursorKey, cursor + 1)
      used.add(index)
      return index
    }
  }
}

function referenceKey(reference: Pick<MarkdownReference, 'from' | 'to' | 'kind'>): string {
  return `${reference.from}:${reference.to}:${reference.kind}`
}
