import { describe, expect, it } from 'vitest'
import { assertInputFileSize, maxInputFileBytes } from '../src/domain/inputPolicy'

describe('input size policy', () => {
  it('uses the same 20 MiB limit for mobile browsers and accepts iPad user agents', () => {
    expect(maxInputFileBytes('Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)')).toBe(20 * 1024 * 1024)
    expect(maxInputFileBytes('Mozilla/5.0 (X11; Linux x86_64)')).toBe(50 * 1024 * 1024)
  })

  it('rejects a file at the input boundary before reading its bytes', () => {
    const maximum = maxInputFileBytes('Android Mobile')
    expect(() => assertInputFileSize('large.csv', maximum, 'Android Mobile')).not.toThrow()
    expect(() => assertInputFileSize('large.csv', maximum + 1, 'Android Mobile')).toThrow(/20 MiB/u)
  })
})
