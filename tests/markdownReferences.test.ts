import { describe, expect, it } from 'vitest'
import { collectMarkdownReferences, markdownHeadingAnchor, parseObsidianReference, prepareObsidianReferences, selectMarkdownFragment } from '../src/domain/markdownReferences'

describe('Markdown local references', () => {
  it('collects inline and reference links while ignoring code and frontmatter', () => {
    const source = `---\nimage: ![ignored](front.png)\n---\n[normal](./note.md) ![map](../map.png)\n[ref][guide]\n\`[code](hidden.md)\`\n\n[guide]: docs/guide.md\n`
    const references = collectMarkdownReferences(source)
    expect(references.map((item) => [item.kind, item.target])).toEqual([
      ['link', './note.md'], ['image', '../map.png'], ['link', 'docs/guide.md']
    ])
  })

  it('parses Obsidian labels, fragments and bounded embed dimensions', () => {
    expect(parseObsidianReference('[[guide/start#Intro|시작]]')).toEqual({ target: 'guide/start', embed: false, fragment: 'Intro', label: '시작' })
    expect(parseObsidianReference('![[images/map.png|300x180]]')).toEqual({ target: 'images/map.png', embed: true, width: 300, height: 180 })
    expect(parseObsidianReference('![[images/map.png|0]]')).toEqual({ target: 'images/map.png', embed: true })
  })

  it('rewrites Obsidian syntax to opaque local tokens without changing code spans', () => {
    const source = '[[note]] and ![[map.png|240]] and `[[code]]`'
    const prepared = prepareObsidianReferences(source)
    expect(prepared.source).not.toContain('[[note]]')
    expect(prepared.source).not.toContain('![[map.png|240]]')
    expect(prepared.source).toContain('`[[code]]`')
    expect(prepared.byToken.size).toBe(2)
  })

  it('selects heading sections and block ranges without rewriting source', () => {
    const source = '# Intro\nfirst\n\n## Inner\nchild\n\n# Intro\nsecond\n'
    expect(markdownHeadingAnchor('  Two Words  ')).toBe('two-words')
    expect(selectMarkdownFragment(source, 'intro')).toEqual({ from: 0, to: source.lastIndexOf('# Intro'), kind: 'heading' })
    expect(selectMarkdownFragment(source, 'intro-1')?.from).toBe(source.lastIndexOf('# Intro'))
    const blockSource = 'A paragraph ^block-1\n\n```md\nnot ^code\n```\n'
    expect(selectMarkdownFragment(blockSource, '^block-1')?.kind).toBe('block')
    expect(selectMarkdownFragment(blockSource, '^missing')).toBeNull()
  })
})
