// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MarkdownReference } from '../src/domain/markdownReferences'
import { LocalReferenceWidgetView } from '../src/features/markdown/LocalReferenceWidget'
import { LocalReferenceState, type MarkdownReferenceContext, type MarkdownReferenceServices } from '../src/features/markdown/localReferenceState'
import { createPreviewReferenceIndex } from '../src/features/markdown/previewReferenceIndex'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function reference(from: number, target: string, kind: MarkdownReference['kind'] = 'link'): MarkdownReference {
  return { from, to: from + 5, raw: `[x](${target})`, target, kind }
}

let host: HTMLDivElement | undefined
let root: Root | undefined

function renderReference(referenceValue: MarkdownReference, services: MarkdownReferenceServices, referenceState = new LocalReferenceState(), ancestors: MarkdownReferenceContext['ancestors'] = []): void {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const context: MarkdownReferenceContext = {
    services, referenceState, instanceId: 'root', folderId: 'folder-1', generation: 1,
    ownerPath: 'owner.md', ownerText: referenceValue.raw, ancestors, depth: 0
  }
  act(() => root!.render(createElement(LocalReferenceWidgetView, { reference: referenceValue, context })))
}

function referenceServices(resolveReference: MarkdownReferenceServices['resolveReference']): MarkdownReferenceServices {
  return {
    resolveReference, acquireImage: vi.fn(async () => ({ url: 'blob:image', release: vi.fn() })),
    openFile: vi.fn(), downloadFile: vi.fn(), subscribeDocument: vi.fn(() => () => {})
  }
}

afterEach(() => {
  if (root) act(() => root!.unmount())
  host?.remove()
  root = undefined
  host = undefined
})

describe('Markdown preview reference indexing', () => {
  it('matches token references by source range even when parsing produced a new object', () => {
    const references = [reference(0, 'notes/a.md', 'obsidian-link'), reference(10, 'notes/b.md', 'obsidian-link')]
    const index = createPreviewReferenceIndex(references)
    const tokenReference = { ...references[1]! }
    const used = new Set<number>()

    expect(index.find(tokenReference, './__token__', 'link', used)).toBe(1)
    expect(used).toEqual(new Set([1]))
  })

  it('matches repeated raw targets once each and keeps link and embed namespaces separate', () => {
    const references = [reference(0, 'notes/a.md'), reference(10, 'notes/a.md'), reference(20, 'notes/a.md', 'image')]
    const index = createPreviewReferenceIndex(references)
    const used = new Set<number>()

    expect(index.find(undefined, 'notes/a.md', 'link', used)).toBe(0)
    expect(index.find(undefined, 'notes/a.md', 'link', used)).toBe(1)
    expect(index.find(undefined, 'notes/a.md', 'link', used)).toBe(-1)
    expect(index.find(undefined, 'notes/a.md', 'embed', used)).toBe(2)
  })

  it('defers reading a collapsed Markdown embed until it expands', async () => {
    const referenceValue: MarkdownReference = { from: 0, to: 12, raw: '![[note.md]]', target: 'note.md', kind: 'obsidian-embed' }
    const referenceState = new LocalReferenceState()
    referenceState.toggle('root', referenceValue, true)
    const resolveReference = vi.fn<MarkdownReferenceServices['resolveReference']>(async () => ({ status: 'error', kind: 'missing', message: '없음' }))
    renderReference(referenceValue, referenceServices(resolveReference), referenceState)

    await act(async () => { await Promise.resolve() })
    expect(resolveReference).not.toHaveBeenCalled()

    await act(async () => {
      host!.querySelector('button')!.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(resolveReference).toHaveBeenCalledTimes(1)
  })

  it('stops a Markdown embed when its target is already in the ancestor chain', async () => {
    const referenceValue: MarkdownReference = { from: 0, to: 12, raw: '![[nested.md]]', target: 'nested.md', kind: 'obsidian-embed' }
    const referenceState = new LocalReferenceState()
    referenceState.toggle('root', referenceValue, false)
    const resolveReference = vi.fn<MarkdownReferenceServices['resolveReference']>(async () => ({
      status: 'markdown', path: 'notes/nested.md', text: '# nested', revision: 1
    }))
    renderReference(referenceValue, referenceServices(resolveReference), referenceState, [
      { folderId: 'folder-1', path: 'notes/nested.md', fragment: '' }
    ])

    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(resolveReference).toHaveBeenCalledTimes(1)
    expect(host?.textContent).toContain('순환 임베드입니다')
  })
})
