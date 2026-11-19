// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDefaultColumn } from '../src/domain/csv-views/typing'
import type { CsvCell, CsvColumnDefinition } from '../src/domain/csv-views/model'
import { CsvCellDisplay } from '../src/features/csv-views/CsvCellDisplay'

const textColumn = createDefaultColumn('text', { id: 'text', sourceIndex: 0, sourceHeader: 'text', label: '텍스트', typeSource: 'user', nullMarkers: [], allowSurroundingSpace: false }, null) as CsvColumnDefinition
let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function render(cell: CsvCell, override?: { display: CsvColumnDefinition['display'] }): void {
  act(() => root.render(createElement(CsvCellDisplay, { column: textColumn, override: override ? { label: null, stateText: {}, ...override } : undefined, cell })))
}

describe('CSV cell display policy', () => {
  it('shows HTTPS image controls without creating an image request until activated and supports retry', () => {
    const source = 'https://images.example.test/cover.webp'
    render({ state: 'value', raw: source, value: source }, { display: { as: 'image' } })
    expect(host.querySelector('img')).toBeNull()
    const load = host.querySelector<HTMLButtonElement>('.csv-cell-image-load')!
    expect(load.textContent).toBe('이미지 불러오기')
    act(() => load.click())
    expect(host.querySelector('img')?.getAttribute('src')).toBe(source)
    expect(host.querySelector('img')?.getAttribute('referrerpolicy')).toBe('no-referrer')
    act(() => host.querySelector('img')!.dispatchEvent(new Event('error')))
    expect(host.textContent).toContain(source)
    const retry = host.querySelector<HTMLButtonElement>('.csv-cell-image-error button')!
    act(() => retry.click())
    expect(host.querySelector('img')?.getAttribute('src')).toBe(source)
  })

  it('renders supported image data URLs immediately and leaves unsupported schemes as text', () => {
    for (const mime of ['png', 'jpeg', 'gif', 'webp']) {
      const source = `data:image/${mime};base64,aGVsbG8=`
      render({ state: 'value', raw: source, value: source }, { display: { as: 'image' } })
      expect(host.querySelector('img')?.getAttribute('src')).toBe(source)
    }
    act(() => root.render(createElement(CsvCellDisplay, { column: textColumn, override: { label: null, display: { as: 'image' }, stateText: {} }, cell: { state: 'value', raw: 'javascript:alert(1)', value: 'javascript:alert(1)' } })))
    expect(host.querySelector('img')).toBeNull()
    expect(host.textContent).toContain('javascript:alert(1)')
  })

  it('makes valid HTTP(S) link cells keyboard focusable and opens them safely in a new tab', () => {
    const source = 'https://example.test/path?q=1'
    render({ state: 'value', raw: source, value: source }, { display: { as: 'link' } })
    const link = host.querySelector<HTMLAnchorElement>('a.csv-cell-link')!
    expect(link.href).toBe(source)
    expect(link.target).toBe('_blank')
    expect(link.rel).toContain('noopener')
    expect(link.tabIndex).toBe(0)
  })
})
