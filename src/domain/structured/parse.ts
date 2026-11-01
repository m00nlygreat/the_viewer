import { parseTree, printParseErrorCode, type Node as JsonNode, type ParseError } from 'jsonc-parser'
import { isAlias, isMap, isScalar, isSeq, parseAllDocuments, type Node as YamlNode } from 'yaml'
import { parseTOML, type AST } from 'toml-eslint-parser'
import { container, scalar, slot, sourceFingerprint, type StructuredContainer, type StructuredFormat, type StructuredModel, type StructuredNode, type StructuredScalar } from './model'

function withRange(node: StructuredScalar, text: string, format: StructuredFormat, from: number, to: number): StructuredScalar {
  return { ...node, sourceRange: { from, to, format, fingerprint: sourceFingerprint(text, from, to) } }
}

function fromJson(node: JsonNode, text: string): StructuredNode {
  if (node.type === 'object') {
    const result = container('object')
    for (const property of node.children ?? []) {
      const [key, value] = property.children ?? []
      if (key && value) result.items.push(slot(String(key.value), fromJson(value, text)))
    }
    return result
  }
  if (node.type === 'array') {
    const result = container('array')
    result.items = (node.children ?? []).map((child) => slot(null, fromJson(child, text)))
    return result
  }
  const from = node.offset, to = node.offset + node.length
  if (node.type === 'string') return withRange(scalar('string', String(node.value)), text, 'json', from, to)
  if (node.type === 'number') return withRange({ ...scalar('number', text.slice(from, to)), sourceFormat: 'json' }, text, 'json', from, to)
  if (node.type === 'boolean') return withRange(scalar('boolean', String(node.value)), text, 'json', from, to)
  return withRange(scalar('null', ''), text, 'json', from, to)
}

function jsonModel(text: string): StructuredModel {
  const errors: ParseError[] = []
  const tree = parseTree(text, errors, { disallowComments: true, allowTrailingComma: false })
  if (errors.length || !tree) {
    const error = errors[0]
    throw new Error(error ? `JSON 문법 오류 (${error.offset + 1}번째 문자): ${printParseErrorCode(error.error)}` : 'JSON 값이 없습니다.')
  }
  return { root: fromJson(tree, text), loose: [] }
}

function yamlModel(text: string): StructuredModel {
  const documents = parseAllDocuments(text, { version: '1.2', intAsBigInt: true, uniqueKeys: false, keepSourceTokens: true })
  if (!documents.length) throw new Error('YAML 문서가 없습니다.')
  const failed = documents.flatMap((document) => document.errors)
  if (failed.length) throw new Error(`YAML 문법 오류: ${failed[0].message}`)
  const document = documents[0]
  let unsupported = documents.length > 1 ? '여러 YAML 문서가 포함되어 있어 구조 편집을 사용할 수 없습니다.' : ''
  const supportedTags = new Set(['tag:yaml.org,2002:str', 'tag:yaml.org,2002:int', 'tag:yaml.org,2002:float', 'tag:yaml.org,2002:bool', 'tag:yaml.org,2002:null', 'tag:yaml.org,2002:map', 'tag:yaml.org,2002:seq'])
  const active = new Set<YamlNode>()
  const visit = (node: YamlNode | null | undefined): StructuredNode => {
    if (!node) return scalar('null', '')
    if (active.has(node)) throw new Error('순환하는 YAML 참조는 블록으로 표시할 수 없습니다.')
    active.add(node)
    try {
      if (isAlias(node)) {
        unsupported ||= 'YAML 참조와 앵커가 포함되어 있어 원본을 보존하려면 원본에서 편집해야 합니다.'
        const resolved = node.resolve(document)
        if (!resolved) throw new Error('정의되지 않은 YAML 참조가 있습니다.')
        return visit(resolved)
      }
      if ('anchor' in node && node.anchor) unsupported ||= 'YAML 앵커가 포함되어 있어 원본에서 편집해야 합니다.'
      if (node.tag && !supportedTags.has(node.tag)) unsupported ||= '블록으로 표현할 수 없는 YAML 태그는 원본에서 편집해야 합니다.'
      if (isMap(node)) {
        const result = container('object')
        for (const pair of node.items) {
          if (!isScalar(pair.key) || typeof pair.key.value !== 'string') unsupported ||= '문자열이 아닌 YAML 키는 원본에서 편집해야 합니다.'
          const key = isScalar(pair.key) ? String(pair.key.value ?? '') : String(pair.key ?? '')
          result.items.push(slot(key, visit(pair.value as YamlNode | null)))
        }
        return result
      }
      if (isSeq(node)) {
        const result = container('array')
        result.items = node.items.map((item) => slot(null, visit(item as YamlNode | null)))
        return result
      }
      if (isScalar(node)) {
        const value = node.value
        const result = value === null ? scalar('null', '') : typeof value === 'boolean' ? scalar('boolean', String(value)) :
          typeof value === 'number' || typeof value === 'bigint' ? { ...scalar('number', node.source ?? String(value)), sourceFormat: 'yaml' as const } : scalar('string', String(value))
        return node.range && !node.tag ? withRange(result, text, 'yaml', node.range[0], node.range[1]) : result
      }
      throw new Error('지원하지 않는 YAML 노드입니다.')
    } finally { active.delete(node) }
  }
  return { root: visit(document.contents), loose: [], ...(unsupported ? { unsupported } : {}) }
}

function tomlModel(text: string): StructuredModel {
  const program = parseTOML(text, { tomlVersion: '1.0.0' })
  const root = container('object')
  const getAt = (base: StructuredContainer, path: (string | number)[]): StructuredContainer => {
    let current = base
    for (let index = 0; index < path.length; index++) {
      const part = path[index]
      const nextKind = typeof path[index + 1] === 'number' ? 'array' : 'object'
      if (typeof part === 'number') {
        while (current.items.length <= part) current.items.push(slot(null, container('object')))
        const child = current.items[part].node
        if (!child || child.kind === 'scalar') throw new Error('TOML 테이블 경로가 올바르지 않습니다.')
        current = child
      } else {
        let item = current.items.find((entry) => entry.key === part)
        if (!item) { item = slot(part, container(nextKind)); current.items.push(item) }
        if (!item.node || item.node.kind === 'scalar') throw new Error('TOML 테이블 경로가 올바르지 않습니다.')
        current = item.node
      }
    }
    return current
  }
  const fromValue = (node: AST.TOMLContentNode): StructuredNode => {
    if (node.type === 'TOMLArray') {
      const result = container('array')
      result.items = node.elements.map((element) => slot(null, fromValue(element)))
      return result
    }
    if (node.type === 'TOMLInlineTable') {
      const result = container('object')
      for (const pair of node.body) insert(result, pair)
      return result
    }
    const result = node.kind === 'string' ? { ...scalar('string', node.value), sourceFormat: 'toml' as const } :
      node.kind === 'boolean' ? scalar('boolean', String(node.value)) :
        node.kind === 'integer' || node.kind === 'float' ? { ...scalar('number', text.slice(...node.range)), sourceFormat: 'toml' as const } :
          { ...scalar('native-date-time', node.datetime), dateKind: node.kind }
    return withRange(result, text, 'toml', node.range[0], node.range[1])
  }
  const insert = (base: StructuredContainer, pair: AST.TOMLKeyValue) => {
    const keys = pair.key.keys.map((key) => key.type === 'TOMLBare' ? key.name : key.value)
    const last = keys.pop()
    if (last === undefined) throw new Error('TOML 키가 없습니다.')
    getAt(base, keys).items.push(slot(last, fromValue(pair.value)))
  }
  for (const entry of program.body[0].body) {
    if (entry.type === 'TOMLKeyValue') insert(root, entry)
    else {
      const target = getAt(root, entry.resolvedKey)
      for (const pair of entry.body) insert(target, pair)
    }
  }
  return { root, loose: [] }
}

export function parseStructured(text: string, format: StructuredFormat): StructuredModel {
  if (format === 'json') return jsonModel(text)
  if (format === 'yaml') return yamlModel(text)
  return tomlModel(text)
}
