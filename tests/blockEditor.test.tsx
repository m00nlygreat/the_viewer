// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { applyBlockDrop } from '../src/domain/block-editor/commands'
import { parseEnv } from '../src/domain/env/parse'
import { envPolicy } from '../src/features/env/envPolicy'
import { EnvEditor } from '../src/features/env/EnvEditor'
import { container, scalar, slot } from '../src/domain/structured/model'
import type { ViewerDocument } from '../src/domain/types'

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })

function makeEnvDocument(text: string): Extract<ViewerDocument, { format: 'env' }> {
  const bytes = new TextEncoder().encode(text).buffer
  return {
    id: 'env-ui', name: '.env.local', format: 'env', mimeType: 'text/plain', size: bytes.byteLength,
    initialBytes: bytes.slice(0), savedBytes: bytes.slice(0), sourceText: text, text, model: parseEnv(text), mode: 'view',
    revision: 0, modelRevision: 0, textRevision: 0, parseState: 'ready', diagnostics: [], encoding: 'UTF-8', bom: false,
    savedText: text, isDirty: false, openedAt: 1, lastEditedAt: 1
  }
}

describe('shared block editor ENV adapter', () => {
  it('renders only the property and string value palette with no type inference controls', () => {
    const text = 'DATE=2026-11-07\nCOLOR=#aabbcc\n'
    const document = makeEnvDocument(text)
    const html = renderToStaticMarkup(createElement(EnvEditor, { document, model: document.model, onChange: () => {} }))

    expect(html.match(/class="sd-section-label"/gu)).toHaveLength(2)
    expect(html).toContain('프로퍼티')
    expect(html).toContain('문자열')
    expect(html).toContain('DATE')
    expect(html).toContain('COLOR')
    expect(html).toContain('sd-text')
    expect(html).not.toContain('색으로 보기')
    expect(html).not.toContain('날짜 ')
    expect(html).not.toContain('숫자로')
    expect(html).not.toContain('JSON')
    expect(html).not.toContain('TOML')
  })

  it('allows string properties and leaves the source model untouched when a forbidden drop is rejected', () => {
    const parsed = parseEnv('A=one\n')
    const model = parsed.blocks
    const root = model.root
    if (!root || root.kind !== 'object') throw new Error('ENV root expected')

    const added = applyBlockDrop(model, { type: 'palette', payload: { slot: slot('NEW_KEY', scalar('string', 'next')) } }, { type: 'insert', id: root.id, index: 1 }, envPolicy)
    expect(added?.root?.kind === 'object' && added.root.items.map((item) => [item.key, item.node?.kind === 'scalar' ? item.node.raw : null])).toEqual([
      ['A', 'one'], ['NEW_KEY', 'next']
    ])
    expect(root.items).toHaveLength(1)

    const rejected = applyBlockDrop(model, { type: 'palette', payload: { node: container('object') } }, { type: 'canvas', x: 200, y: 100 }, envPolicy)
    expect(rejected).toBeNull()
    expect(root.items).toHaveLength(1)
  })

  it('adds a string value through the palette keyboard gesture and deletes a selected row with Delete', async () => {
    const documentModel = makeEnvDocument('A=one\n')
    const onChange = vi.fn()
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => root.render(createElement(EnvEditor, { document: documentModel, model: documentModel.model, onChange })))

    const canvas = container.querySelector<HTMLElement>('.sd-canvas')
    const valueCard = container.querySelector<HTMLElement>('.sd-palette-value')
    if (!canvas || !valueCard) throw new Error('ENV editor controls expected')
    const rect = { x: 0, y: 0, left: 0, top: 0, right: 400, bottom: 300, width: 400, height: 300, toJSON: () => ({}) } as DOMRect
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(rect)
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => canvas) })
    await act(async () => valueCard.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange.mock.calls[0]?.[0].blocks.loose).toHaveLength(1)

    const firstRow = container.querySelector<HTMLElement>('[data-row]')
    if (!firstRow) throw new Error('ENV property row expected')
    await act(async () => firstRow.focus())
    await act(async () => canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true })))
    expect(onChange).toHaveBeenCalledTimes(2)
    expect(onChange.mock.calls[1]?.[0].blocks.root?.kind === 'object' && onChange.mock.calls[1]?.[0].blocks.root.items).toHaveLength(0)

    await act(async () => root.unmount())
    container.remove()
  })
})
