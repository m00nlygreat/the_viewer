import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchAutoOpenedFile, fetchRemoteLinkFile } from '../src/platform/extension/links'

describe('extension link filename handling', () => {
  beforeEach(() => {
    vi.stubGlobal('chrome', {
      runtime: { id: 'viewer-test' },
      permissions: { contains: vi.fn(async () => true), request: vi.fn(async () => true) },
      extension: { isAllowedFileSchemeAccess: vi.fn(async () => true) }
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('keeps an encoded .patch URL basename and query out of the output filename', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new TextEncoder().encode('patch bytes'), { headers: { 'content-type': 'application/octet-stream' } })))
    const file = await fetchRemoteLinkFile('https://example.test/patches/change%20notes.patch?download=1', { requestPermission: false })
    expect(file.name).toBe('change notes.patch')
    expect(file.type).toBe('application/octet-stream')
    expect(new TextDecoder().decode(file.bytes)).toBe('patch bytes')
  })

  it('preserves a dotenv variant name from Content-Disposition', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new TextEncoder().encode('A=one\n'), { headers: {
      'content-type': 'application/octet-stream',
      'content-disposition': "attachment; filename*=UTF-8''%2Eenv.production.local"
    } })))
    const file = await fetchRemoteLinkFile('https://example.test/download?id=42', { requestPermission: false })
    expect(file.name).toBe('.env.production.local')
    expect(file.type).toBe('application/octet-stream')
  })

  it('opens local dotenv variants by decoded URL basename', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new TextEncoder().encode('A=one\n'), { headers: { 'content-type': 'text/plain' } })))
    const file = await fetchAutoOpenedFile('file:///C:/project/.env.production%20local')
    expect(file.name).toBe('.env.production local')
    expect(file.type).toBe('text/plain')
  })
})
