import { describe, expect, it } from 'vitest'
import { parseLocalReference, resolveFolderPath } from '../src/domain/folderPaths'

describe('folder reference paths', () => {
  const owner = 'notes/sub/a.md'

  it('resolves relative and root based paths without losing query or fragment', () => {
    expect(resolveFolderPath(owner, '../b.md#제목')).toEqual({ kind: 'local', path: 'notes/b.md', query: '', fragment: '제목' })
    expect(resolveFolderPath(owner, '/guide/시작%20안내.md')).toEqual({ kind: 'local', path: 'guide/시작 안내.md', query: '', fragment: '' })
    expect(resolveFolderPath(owner, './a%23b%3Fc.md#부분')).toEqual({ kind: 'local', path: 'notes/sub/a#b?c.md', query: '', fragment: '부분' })
  })

  it('decodes each path segment once and blocks traversal outside the root', () => {
    expect(resolveFolderPath(owner, './a%2523b.md')).toMatchObject({ kind: 'local', path: 'notes/sub/a%23b.md' })
    expect(resolveFolderPath(owner, '../../../outside.md').kind).toBe('blocked')
    expect(resolveFolderPath(owner, '%2Fetc/passwd').kind).toBe('blocked')
    expect(resolveFolderPath(owner, 'file:///C:/a.md').kind).toBe('blocked')
    expect(resolveFolderPath(owner, './bad%ZZ.md').kind).toBe('invalid')
  })

  it('classifies same-document, external and non-file schemes before local lookup', () => {
    expect(parseLocalReference('#section')).toEqual({ kind: 'same-document', fragment: 'section' })
    expect(parseLocalReference('https://example.com/a')).toEqual({ kind: 'external', href: 'https://example.com/a' })
    expect(parseLocalReference('//example.com/a')).toEqual({ kind: 'external', href: 'https://example.com/a' })
    expect(parseLocalReference('javascript:alert(1)').kind).toBe('blocked')
  })

  it('uses the document directory only for explicit Obsidian relative paths', () => {
    expect(resolveFolderPath(owner, '../near', 'obsidian')).toMatchObject({ kind: 'local', path: 'notes/near' })
    expect(resolveFolderPath(owner, 'guide/note', 'obsidian')).toMatchObject({ kind: 'local', path: 'guide/note' })
  })
})
