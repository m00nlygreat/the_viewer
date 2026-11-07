import { describe, expect, it } from 'vitest'
import { getFormat, getFormatByName, matchesFormatName } from '../src/domain/fileFormats'

describe('format names', () => {
  it('recognizes diff and patch aliases case-insensitively', () => {
    expect(getFormatByName('change.diff')).toBe('diff')
    expect(getFormatByName('C:\\patches\\CHANGE.PATCH')).toBe('diff')
    expect(matchesFormatName('change.patch', 'diff')).toBe(true)
  })

  it('recognizes dotenv basenames without treating suffixes as global extensions', () => {
    for (const name of ['.env', 'service.env', '.env.local', '.env.production.local', '.env.example']) expect(getFormatByName(name)).toBe('env')
    for (const name of ['.env.', '.environment', 'config.local', 'config.env.local']) expect(getFormatByName(name)).toBeNull()
    expect(matchesFormatName('service.env.production', 'env')).toBe(false)
  })

  it('keeps a specific MIME type ahead of the filename and does not infer env from plain text', () => {
    expect(getFormat('change.patch', 'application/json')).toBe('json')
    expect(getFormat('plain.txt', 'text/plain')).toBeNull()
    expect(getFormat('settings.env', 'text/plain')).toBe('env')
    expect(getFormat('change.patch', 'text/x-patch')).toBe('diff')
  })
})
