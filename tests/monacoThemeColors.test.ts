import { describe, expect, it } from 'vitest'
import { normalizeMonacoThemeColor } from '../src/components/monacoThemeColors'

describe('Monaco theme color normalization', () => {
  it('expands short RGB colors to Monaco-safe six-digit hex values', () => {
    expect(normalizeMonacoThemeColor('#fff', '#000000')).toBe('#FFFFFF')
    expect(normalizeMonacoThemeColor('abc', '#000000')).toBe('#AABBCC')
  })

  it('expands short RGBA and keeps supported full-length hex colors', () => {
    expect(normalizeMonacoThemeColor('#abcd', '#000000')).toBe('#AABBCCDD')
    expect(normalizeMonacoThemeColor('#12aBcD', '#000000')).toBe('#12ABCD')
    expect(normalizeMonacoThemeColor('#12345678', '#000000')).toBe('#12345678')
  })

  it('uses a safe fallback for CSS color functions and malformed values', () => {
    expect(normalizeMonacoThemeColor('rgb(255, 255, 255)', '#353859')).toBe('#353859')
    expect(normalizeMonacoThemeColor('#xyz', 'fff')).toBe('#FFFFFF')
    expect(normalizeMonacoThemeColor('invalid', 'invalid')).toBe('#000000')
  })
})
