import { describe, expect, it } from 'vitest'
import { parseDiff } from '../src/domain/diff/parse'
import { isDiffModel, matchesDiffSource } from '../src/domain/diff/validate'

describe('unified diff parsing', () => {
  it('keeps a complete source map across multiple files and hunks', () => {
    const text = 'email patch summary\n\n' +
      'diff --git a/a.txt b/a.txt\nindex 123..456 100644\n--- a/a.txt\n+++ b/a.txt\n@@ -1,2 +1,2 @@ title\n one\n-old\n+new\n@@ -4 +4 @@\n-tail\n+end\n' +
      'diff --git a/b.txt b/b.txt\nnew file mode 100644\n--- /dev/null\n+++ b/b.txt\n@@ -0,0 +1 @@\n+created'
    const model = parseDiff(text)
    expect(model.segments.map((segment) => segment.kind)).toEqual(['text', 'file', 'file'])
    const files = model.segments.filter((segment) => segment.kind === 'file')
    expect(files).toHaveLength(2)
    if (files[0]?.kind !== 'file' || files[1]?.kind !== 'file') throw new Error('file sections expected')
    expect(files[0].hunks.map((hunk) => [hunk.oldCount, hunk.newCount])).toEqual([[2, 2], [1, 1]])
    expect(files[0].hunks[0]?.rows.map((row) => row.kind)).toEqual(['context', 'deletion', 'addition'])
    expect(files[1].hunks[0]?.rows[0]?.newLine).toBe(1)
    expect(model.segments.map((segment) => segment.from).at(0)).toBe(0)
    expect(model.segments.at(-1)?.to).toBe(text.length)
    expect(isDiffModel(model)).toBe(true)
    expect(matchesDiffSource(model, text)).toBe(true)
  })

  it('does not treat --- and +++ hunk body lines as file headers and marks missing newlines', () => {
    const text = '--- a/a\n+++ b/a\n@@ -1 +1 @@\n--- old header-like content\n+++ new header-like content\n\\ No newline at end of file'
    const model = parseDiff(text)
    expect(model.segments).toHaveLength(1)
    const file = model.segments[0]
    expect(file?.kind).toBe('file')
    if (file?.kind !== 'file') return
    expect(file.hunks).toHaveLength(1)
    expect(file.hunks[0]?.rows.map((row) => row.kind)).toEqual(['deletion', 'addition', 'no-newline'])
    expect(file.hunks[0]?.rows[0]?.oldLine).toBe(1)
    expect(file.hunks[0]?.rows[1]?.newLine).toBe(1)
  })

  it('preserves unrecognized and binary input as raw text segments', () => {
    const text = 'mail header\n\nGIT binary patch\nxyz\n'
    const model = parseDiff(text)
    expect(model.segments).toEqual([{ kind: 'text', from: 0, to: text.length }])
    expect(model.sourceLength).toBe(text.length)
  })

  it('keeps a broken hunk raw and resumes parsing at the next Git file section', () => {
    const text = 'diff --git a/broken b/broken\n--- a/broken\n+++ b/broken\n@@ -1,2 +1,2 @@\n-old\n+new\n' +
      'diff --git a/next b/next\n--- a/next\n+++ b/next\n@@ -0,0 +1 @@\n+ok\n'
    const model = parseDiff(text)
    const files = model.segments.filter((segment) => segment.kind === 'file')
    expect(files).toHaveLength(2)
    expect(files[0]).toMatchObject({ parsed: false, hunks: [] })
    expect(files[1]).toMatchObject({ parsed: true, hunks: [{ rows: [{ kind: 'addition', newLine: 1 }] }] })
    if (files[0]?.kind === 'file') expect(text.slice(files[0].from, files[0].to)).toContain('+new')
  })
})
