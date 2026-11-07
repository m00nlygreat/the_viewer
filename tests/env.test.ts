import { describe, expect, it } from 'vitest'
import { parseEnv, EnvParseError } from '../src/domain/env/parse'
import { compileEnv } from '../src/domain/env/sourcePatch'
import { isEnvModel } from '../src/domain/env/validate'
import { scalar } from '../src/domain/structured/model'

describe('dotenv source model', () => {
  it('keeps ordered duplicate assignments and preserves all string values and syntax', () => {
    const text = '# 설정\r\nA=0\r\nB=true\r\nC=null\r\nEMPTY=\r\nHASH="a#b=c"\r\nUNQUOTED_HASH=a#b\r\nDOUBLE="line\\nnext"\r\nSINGLE=\'line\\nnext\'\r\nTAB="tab\\tX"\r\nTICK=`abc`\r\nREF=${OTHER}\r\nA=second # keep\r\n'
    const model = parseEnv(text)
    const root = model.blocks.root
    expect(root?.kind).toBe('object')
    if (root?.kind !== 'object') return
    expect(root.items.map((item) => [item.key, item.node?.kind === 'scalar' ? item.node.raw : null])).toEqual([
      ['A', '0'], ['B', 'true'], ['C', 'null'], ['EMPTY', ''], ['HASH', 'a#b=c'], ['UNQUOTED_HASH', 'a'], ['DOUBLE', 'line\nnext'], ['SINGLE', 'line\\nnext'], ['TAB', 'tab\\tX'], ['TICK', 'abc'], ['REF', '${OTHER}'], ['A', 'second']
    ])
    expect(model.syntax?.newline).toBe('\r\n')
    expect(model.syntax?.records.map((record) => record.type)).toContain('comment')
    expect(model.syntax?.sourceLength).toBe(text.length)
    expect(isEnvModel(model)).toBe(true)
  })

  it('reports malformed declarations with exact line and column', () => {
    for (const text of ['A=1\nBAD KEY=2', 'A="open', 'BROKEN']) {
      try { parseEnv(text); throw new Error('expected parse error') }
      catch (error) { expect(error).toBeInstanceOf(EnvParseError); expect((error as EnvParseError).line).toBeGreaterThan(0) }
    }
  })

  it('rejects structured-only scalar metadata and incompatible root/syntax combinations', () => {
    const parsed = parseEnv('A=value\n')
    const foreignScalar = structuredClone(parsed)
    const root = foreignScalar.blocks.root
    if (root?.kind !== 'object' || root.items[0]?.node?.kind !== 'scalar') throw new Error('ENV scalar expected')
    root.items[0].node.sourceFormat = 'json'
    expect(isEnvModel(foreignScalar)).toBe(false)

    const missingSyntax = structuredClone(parsed)
    missingSyntax.syntax = null
    expect(isEnvModel(missingSyntax)).toBe(false)
    expect(isEnvModel({ blocks: { root: null, loose: [] }, syntax: null, detached: [] })).toBe(true)
  })

  it('patches only an edited value token and keeps comments, export, whitespace and CRLF', () => {
    const text = '# keep\r\nexport  A = "first"  # inline\r\nB=two\r\n'
    const parsed = parseEnv(text)
    const root = parsed.blocks.root
    if (root?.kind !== 'object') throw new Error('root expected')
    const changed = structuredClone(parsed)
    const changedRoot = changed.blocks.root!
    if (changedRoot.kind !== 'object' || changedRoot.items[0]?.node?.kind !== 'scalar') throw new Error('scalar expected')
    changedRoot.items[0].node.raw = 'next value'
    const compiled = compileEnv(parsed, changed.blocks, text)
    expect(compiled.kind).toBe('ready')
    if (compiled.kind !== 'ready') return
    expect(compiled.text).toBe('# keep\r\nexport  A = "next value"  # inline\r\nB=two\r\n')
    expect(compiled.model.blocks.root?.kind === 'object' && compiled.model.blocks.root.items[0]?.node?.kind === 'scalar' ? compiled.model.blocks.root.items[0].node.raw : null).toBe('next value')
  })

  it('edits only the selected duplicate, removes deleted assignments, and keeps independent comments', () => {
    const text = 'A=first\n# between\nA=second\n# end\n'
    const parsed = parseEnv(text)
    const blocks = structuredClone(parsed.blocks)
    if (blocks.root?.kind !== 'object' || blocks.root.items[1]?.node?.kind !== 'scalar') throw new Error('duplicate expected')
    blocks.root.items[1].node.raw = 'changed'
    const changed = compileEnv(parsed, blocks, text)
    expect(changed.kind).toBe('ready')
    if (changed.kind !== 'ready') return
    expect(changed.text).toBe('A=first\n# between\nA=changed\n# end\n')
    blocks.root.items.splice(0, 1)
    const removed = compileEnv(changed.model, blocks, changed.text)
    expect(removed.kind).toBe('ready')
    if (removed.kind === 'ready') expect(removed.text).toBe('# between\nA=changed\n# end\n')
  })

  it('keeps a separated property recoverable and inserts a new declaration safely', () => {
    const text = '# header'
    const parsed = parseEnv(text)
    const blocks = structuredClone(parsed.blocks)
    if (blocks.root?.kind !== 'object') throw new Error('root expected')
    blocks.root.items.push({ id: 'new-slot', key: 'NEW_KEY', node: { id: 'new-value', kind: 'scalar', dataType: 'string', raw: 'line\nnext' } })
    const inserted = compileEnv(parsed, blocks, text)
    expect(inserted.kind).toBe('ready')
    if (inserted.kind !== 'ready') return
    expect(inserted.text).toBe('# header\nNEW_KEY="line\\nnext"')
    const separated = structuredClone(inserted.model.blocks)
    if (separated.root?.kind !== 'object') throw new Error('root expected')
    const [item] = separated.root.items.splice(0, 1)
    if (item) separated.loose.push({ id: 'loose-property', x: 10, y: 20, slot: item })
    const detached = compileEnv(inserted.model, separated, inserted.text)
    expect(detached.kind).toBe('ready')
    if (detached.kind === 'ready') {
      expect(detached.text).toBe('# header\n')
      expect(detached.model.detached).toHaveLength(1)
    }

    const valueWithHash = structuredClone(parsed.blocks)
    if (valueWithHash.root?.kind !== 'object') throw new Error('ENV root expected')
    valueWithHash.root.items.push({ id: 'hash-slot', key: 'HASHED', node: scalar('string', 'a#b') })
    const quotedHash = compileEnv(parsed, valueWithHash, text)
    expect(quotedHash.kind).toBe('ready')
    if (quotedHash.kind === 'ready') expect(quotedHash.text).toBe('# header\nHASHED="a#b"')
  })

  it('moves declarations with their inline comments while leaving standalone comments in place', () => {
    const text = '# header\nexport  A = \'one\'  # inline A\n# between\nB = "two" # inline B\n# tail'
    const parsed = parseEnv(text)
    const blocks = structuredClone(parsed.blocks)
    if (blocks.root?.kind !== 'object') throw new Error('ENV root expected')
    blocks.root.items.reverse()

    const moved = compileEnv(parsed, blocks, text)
    expect(moved.kind).toBe('ready')
    if (moved.kind === 'ready') {
      expect(moved.text).toBe('# header\nB = "two" # inline B\n# between\nexport  A = \'one\'  # inline A\n# tail')
    }
  })

  it('restores a detached declaration with its original syntax and supports insertion before an existing row', () => {
    const text = 'export A=\'one\' # inline\nB=two\n# tail'
    const parsed = parseEnv(text)
    const separated = structuredClone(parsed.blocks)
    if (separated.root?.kind !== 'object') throw new Error('ENV root expected')
    const [detachedItem] = separated.root.items.splice(0, 1)
    if (!detachedItem) throw new Error('ENV property expected')
    separated.loose.push({ id: 'loose-property', x: 10, y: 20, slot: detachedItem })

    const detached = compileEnv(parsed, separated, text)
    expect(detached.kind).toBe('ready')
    if (detached.kind !== 'ready') return
    expect(detached.text).toBe('B=two\n# tail')
    expect(isEnvModel(detached.model)).toBe(true)
    const reconnected = structuredClone(detached.model.blocks)
    if (reconnected.root?.kind !== 'object') throw new Error('ENV root expected')
    const [loose] = reconnected.loose.splice(0, 1)
    if (!loose?.slot) throw new Error('Detached property expected')
    reconnected.root.items.unshift(loose.slot)
    const restored = compileEnv(detached.model, reconnected, detached.text)
    expect(restored.kind).toBe('ready')
    if (restored.kind === 'ready') expect(restored.text).toBe(text)

    const addText = 'A=one\nB=two\n'
    const base = parseEnv(addText)
    const insertedBlocks = structuredClone(base.blocks)
    if (insertedBlocks.root?.kind !== 'object') throw new Error('ENV root expected')
    insertedBlocks.root.items.splice(1, 0, { id: 'middle-slot', key: 'MIDDLE', node: scalar('string', 'value') })
    const inserted = compileEnv(base, insertedBlocks, addText)
    expect(inserted.kind).toBe('ready')
    if (inserted.kind === 'ready') expect(inserted.text).toBe('A=one\nMIDDLE=value\nB=two\n')
  })

  it('preserves the missing final newline and completes separators only when adding a row', () => {
    const text = 'A=one'
    const parsed = parseEnv(text)
    const edited = structuredClone(parsed.blocks)
    if (edited.root?.kind !== 'object' || edited.root.items[0]?.node?.kind !== 'scalar') throw new Error('ENV property expected')
    edited.root.items[0].node.raw = 'next'
    const changed = compileEnv(parsed, edited, text)
    expect(changed.kind).toBe('ready')
    if (changed.kind !== 'ready') return
    expect(changed.text).toBe('A=next')

    const appendedBlocks = structuredClone(parsed.blocks)
    if (appendedBlocks.root?.kind !== 'object') throw new Error('ENV root expected')
    appendedBlocks.root.items.push({ id: 'extra-slot', key: 'B', node: scalar('string', 'two') })
    const appended = compileEnv(parsed, appendedBlocks, text)
    expect(appended.kind).toBe('ready')
    if (appended.kind === 'ready') expect(appended.text).toBe('A=one\nB=two')
  })
})
