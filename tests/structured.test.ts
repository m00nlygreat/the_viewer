import { describe, expect, it } from 'vitest'
import { FORMAT_MIME, getFormat } from '../src/domain/fileFormats'
import { applyViewCommand, buildExportSnapshot, canPersistRecovery, historyEntry, undoDocument } from '../src/domain/session'
import type { ViewerDocument } from '../src/domain/types'
import { normalizeStoredDocument, serializeStoredDocument } from '../src/platform/storage'
import { container, scalar, slot, type StructuredContainer, type StructuredFormat, type StructuredModel, type StructuredScalar } from '../src/domain/structured/model'
import { parseStructured } from '../src/domain/structured/parse'
import { inferSchemas, outputStructured, serializeStructured } from '../src/domain/structured/output'
import { applyDrop } from '../src/domain/structured/operations'

function asContainer(value: unknown): StructuredContainer { return value as StructuredContainer }
function makeDocument(format: StructuredFormat, text: string): ViewerDocument {
  const bytes = new TextEncoder().encode(text).buffer as ArrayBuffer
  return { id: 'source-test', name: `source.${format}`, format, mimeType: FORMAT_MIME[format], size: bytes.byteLength, savedBytes: bytes, sourceText: text, text, model: parseStructured(text, format), mode: 'view', revision: 0, modelRevision: 0, textRevision: 0, parseState: 'ready', diagnostics: [], encoding: 'UTF-8', bom: false, savedText: text, isDirty: false, openedAt: 1, lastEditedAt: 1 }
}

describe('structured formats', () => {
  it('retains duplicate JSON keys, exact numeric tokens and validates syntax', () => {
    const model = parseStructured('{"a":9007199254740993,"a":-0,"exp":1.2e-7}', 'json')
    const root = asContainer(model.root)
    expect(root.items.map((item) => item.key)).toEqual(['a', 'a', 'exp'])
    expect(root.items.map((item) => item.node?.kind === 'scalar' && item.node.raw)).toEqual(['9007199254740993', '-0', '1.2e-7'])
    expect(serializeStructured(model, 'json')).toContain('9007199254740993')
    expect(outputStructured(model, 'yaml').text).toBeNull()
    expect(() => parseStructured('{"a":1,}', 'json')).toThrow()
    expect(() => parseStructured('{/* comment */"a":1}', 'json')).toThrow()
  })
  it('reads YAML syntax without rounding and protects aliases from lossy edits', () => {
    const model = parseStructured('title: "false"\nitems: [9007199254740993, true, null]\nbody: |\n  첫 줄\n  둘째 줄\n', 'yaml')
    const text = serializeStructured(model, 'yaml')
    expect(text).toContain('9007199254740993')
    expect(asContainer(model.root).items[0].node).toMatchObject({ dataType: 'string', raw: 'false' })
    expect(parseStructured(text, 'yaml').root).toBeTruthy()
    const decimals = parseStructured('small: .5\nwhole: 1.\n', 'yaml')
    expect(JSON.parse(serializeStructured(decimals, 'json'))).toEqual({ small: 0.5, whole: 1 })
    const referenced = parseStructured('base: &base {name: one}\ncopy: *base\n', 'yaml')
    expect(referenced.unsupported).toMatch(/앵커|참조/)
    expect(() => serializeStructured(referenced, 'yaml')).toThrow()
    expect(() => parseStructured('copy: *missing\n', 'yaml')).toThrow(/참조/)
    expect(() => parseStructured('loop: &self [*self]\n', 'yaml')).toThrow(/순환/)
    expect(parseStructured(`${'['.repeat(220)}0${']'.repeat(220)}`, 'yaml').root).toBeTruthy()
  })
  it('reads TOML tables, arrays of tables, date kinds and exact integers', () => {
    const model = parseStructured('title = "2026-10-27"\ncount = 9007199254740993\nwhen = 2026-10-27T09:12:44+09:00\n[[people]]\nname = "A"\n[[people]]\nname = "B"\n', 'toml')
    const root = asContainer(model.root)
    expect(root.items.find((item) => item.key === 'when')?.node).toMatchObject({ dataType: 'native-date-time', dateKind: 'offset-date-time', raw: '2026-10-27T09:12:44+09:00' })
    expect(asContainer(root.items.find((item) => item.key === 'people')?.node).items).toHaveLength(2)
    const output = serializeStructured(model, 'toml')
    expect(output).toContain('title = "2026-10-27"')
    expect(output).toContain('9007199254740993')
    expect(output).toContain('2026-10-27T09:12:44+09:00')
    expect(parseStructured(output, 'toml').root).toBeTruthy()
    expect(getFormat('settings.yml')).toBe('yaml')
  })
  it('writes TOML control characters safely and blocks unrepresentable Unicode', () => {
    const model = parseStructured(JSON.stringify({ 'key\u007f': 'A\u007fB' }), 'json')
    const output = serializeStructured(model, 'toml')
    expect(output).toContain('\\u007F')
    const reopened = asContainer(parseStructured(output, 'toml').root)
    expect(reopened.items[0].key).toBe('key\u007f')
    expect(reopened.items[0].node).toMatchObject({ dataType: 'string', raw: 'A\u007fB' })
    const invalidValue = parseStructured('{"x":"\\ud800"}', 'json')
    const invalidKey = parseStructured('{"\\ud800":1}', 'json')
    expect(outputStructured(invalidValue, 'toml').text).toBeNull()
    expect(outputStructured(invalidKey, 'toml').text).toBeNull()
    expect(serializeStructured(invalidValue, 'json')).toContain('\\ud800')
    expect(outputStructured(parseStructured('{"n":1e309}', 'json'), 'toml').text).toBeNull()
    expect(outputStructured(parseStructured('{"n":1e-400}', 'json'), 'toml').text).toBeNull()
    expect(outputStructured(parseStructured('{"n":9223372036854775807}', 'json'), 'toml').text).not.toBeNull()
    expect(outputStructured(parseStructured('{"n":9223372036854775808}', 'json'), 'toml').text).toBeNull()
    expect(outputStructured(parseStructured('{"n":-9223372036854775808}', 'json'), 'toml').text).not.toBeNull()
    expect(outputStructured(parseStructured('{"n":-9223372036854775809}', 'json'), 'toml').text).toBeNull()
  })
  it('moves values into sockets or onto the canvas without changing their source until commit', () => {
    const root = container('object'), child = container('object'), value = scalar('string', 'hello')
    const first = slot('first', value), empty = slot('second', null), nested = slot('nested', child)
    root.items = [first, empty, nested]
    const model = { root, loose: [] }
    const moved = applyDrop(model, { type: 'node', id: value.id }, { type: 'socket', id: empty.id })!
    expect(first.node).toBe(value)
    expect(asContainer(moved.root).items[0].node).toBeNull()
    expect(asContainer(moved.root).items[1].node).toMatchObject({ raw: 'hello' })
    const loose = applyDrop(moved, { type: 'slot', id: nested.id }, { type: 'canvas', x: 25, y: 30 })!
    expect(loose.loose[0]).toMatchObject({ x: 25, y: 30, slot: { key: 'nested' } })
    expect(applyDrop(model, { type: 'slot', id: nested.id }, { type: 'insert', id: child.id, index: 0 })).toBeNull()
    expect(applyDrop(model, { type: 'slot', id: first.id }, { type: 'insert', id: root.id, index: 1 })).toBeNull()
  })
  it('infers representative schema fields, types and optional fields from key sets', () => {
    const model = parseStructured('{"customer":{"name":"A","tier":"gold","score":3},"recipient":{"name":"B","score":4}}', 'json')
    expect(inferSchemas(model)).toMatchObject([{ name: 'customer', count: 2, fields: [
      { key: 'name', optional: false, icon: 'text' },
      { key: 'tier', optional: true, icon: 'text' },
      { key: 'score', optional: false, icon: 'number' }
    ] }])
  })
  it('keeps invalid block drafts in history but blocks exporting the old source from view', async () => {
    const text = '{"a":1}', bytes = new TextEncoder().encode(text).buffer
    const model = parseStructured(text, 'json')
    const document: ViewerDocument = { id: '1', name: 'a.json', format: 'json', mimeType: 'application/json', size: bytes.byteLength, savedBytes: bytes, sourceText: text, text, model, mode: 'view', revision: 0, modelRevision: 0, textRevision: 0, parseState: 'ready', diagnostics: [], encoding: 'UTF-8', bom: false, savedText: text, isDirty: false, openedAt: 1, lastEditedAt: 1 }
    const draft = structuredClone(model); asContainer(draft.root).items[0].node = null
    const next = await applyViewCommand(document.id, 0, draft, document)
    expect(next.structuredDraft).toBe(true)
    expect(next.text).toBe(text)
    expect(canPersistRecovery(next)).toBe(true)
    const recovered = normalizeStoredDocument(serializeStoredDocument(next))
    expect(recovered.model).toEqual(draft)
    expect(recovered.text).toBe(text)
    expect(recovered.structuredDraft).toBe(true)
    expect(canPersistRecovery({ ...next, modelRevision: next.modelRevision - 1 })).toBe(false)
    expect(() => buildExportSnapshot(next.id, next)).toThrow()
    expect(undoDocument(next.id, next, historyEntry(document)).text).toBe(text)
    expect(buildExportSnapshot(next.id, { ...next, mode: 'source' }).text).toBe(text)
  })
  it('keeps the original bytes when only disconnected blocks move', async () => {
    const text = '{ "a" : 1 }\r\n', bytes = new TextEncoder().encode(text).buffer
    const model = parseStructured(text, 'json')
    const document: ViewerDocument = { id: '2', name: 'a.json', format: 'json', mimeType: 'application/json', size: bytes.byteLength, savedBytes: bytes, sourceText: text, text, model, mode: 'view', revision: 0, modelRevision: 0, textRevision: 0, parseState: 'ready', diagnostics: [], encoding: 'UTF-8', bom: false, savedText: text, isDirty: false, openedAt: 1, lastEditedAt: 1 }
    const draft = structuredClone(model); draft.loose.push({ id: 'loose', x: 10, y: 20, node: scalar('string', 'abc') })
    const next = await applyViewCommand(document.id, 0, draft, document)
    expect(next.isDirty).toBe(true)
    expect(next.text).toBe(text)
    expect(buildExportSnapshot(next.id, next).bytes).toEqual(new Uint8Array(bytes))
  })
  it.each([
    { format: 'json' as const, text: '{\n  "name": "old", "count": 10, "count": 11\n}\n', first: '"name": "old"', firstEdit: '"name": "새 값"', second: '"count": 10', secondEdit: '"count": 2000' },
    { format: 'yaml' as const, text: '# heading\r\nname: old # note\r\ncount: 10 # keep\r\n', first: 'name: old', firstEdit: 'name: "새 값"', second: 'count: 10', secondEdit: 'count: 2000' },
    { format: 'toml' as const, text: '# heading\ntitle = \'old\' # note\ncount = 10 # keep\n', first: "title = 'old'", firstEdit: 'title = "새 값"', second: 'count = 10', secondEdit: 'count = 2000' }
  ])('patches consecutive $format values without rewriting surrounding source', async ({ format, text, first, firstEdit, second, secondEdit }) => {
    const original = makeDocument(format, text)
    const firstModel = structuredClone(original.model) as StructuredModel
    const firstValue = asContainer(firstModel.root).items[0].node as StructuredScalar
    expect(firstValue.sourceRange?.format).toBe(format)
    firstValue.raw = '새 값'
    const firstResult = await applyViewCommand(original.id, original.revision, firstModel, original)
    expect(firstResult.text).toBe(text.replace(first, firstEdit))
    const secondModel = structuredClone(firstResult.model) as StructuredModel
    ;(asContainer(secondModel.root).items[1].node as StructuredScalar).raw = '2000'
    const secondResult = await applyViewCommand(original.id, firstResult.revision, secondModel, firstResult)
    expect(secondResult.text).toBe(text.replace(first, firstEdit).replace(second, secondEdit))
    expect(parseStructured(secondResult.text, format).root).toBeTruthy()
  })
  it('keeps a YAML block-scalar header comment when changing its value', async () => {
    const text = 'body: | # explanation\n  first\n  second\nnext: 2 # keep\n'
    const document = makeDocument('yaml', text)
    const model = structuredClone(document.model) as StructuredModel
    ;(asContainer(model.root).items[0].node as StructuredScalar).raw = 'changed\nlines\n'
    const result = await applyViewCommand(document.id, document.revision, model, document)
    expect(result.text).toBe('body: "changed\\nlines\\n" # explanation\nnext: 2 # keep\n')
    expect((asContainer(parseStructured(result.text, 'yaml').root).items[0].node as StructuredScalar).raw).toBe('changed\nlines\n')
  })
})
