import { describe, expect, it, vi } from 'vitest'
import { createAutoOpenRules } from '../src/platform/extension/autoOpen'

describe('extension automatic open rules', () => {
  it('matches diff aliases and dotenv basename variants without consuming URL queries', () => {
    vi.stubGlobal('chrome', { runtime: { id: 'viewer-test' } })
    const rules = createAutoOpenRules('test-token')
    const pathRule = rules.find((rule) => rule.id === 73104)
    const fileRule = rules.find((rule) => rule.id === 73103)
    const dispositionRule = rules.find((rule) => rule.id === 73105)
    if (!pathRule?.condition.regexFilter || !fileRule?.condition.regexFilter || !dispositionRule) throw new Error('Expected extension rules')
    const remote = new RegExp(pathRule.condition.regexFilter)
    const local = new RegExp(fileRule.condition.regexFilter)
    expect(remote.test('https://example.test/patches/change.patch?raw=1')).toBe(true)
    expect(remote.test('https://example.test/project/.env.production.local?download=1')).toBe(true)
    expect(remote.test('https://example.test/project/.environment?download=1')).toBe(false)
    expect(local.test('file:///C:/project/.env.production.local')).toBe(true)
    expect(local.test('file:///C:/project/.env.')).toBe(false)
    expect(dispositionRule.condition.responseHeaders?.[0]?.values).toContain('*filename*=UTF-8\'\'*.env.*')
  })
})
