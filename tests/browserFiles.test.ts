import { describe, expect, it, vi } from 'vitest'
import { pickLocalSaveHandle, readPickedFileBytes } from '../src/platform/browserFiles'
import type { PickedFile } from '../src/platform/fileTypes'

describe('browser file reads', () => {
  it('materializes a Blob-backed file only when its content is requested', async () => {
    const text = 'name,value\nalpha,1'
    const file: PickedFile = { name: 'sample.csv', type: 'text/csv', file: new Blob([text]) }

    expect('bytes' in file).toBe(false)
    expect(await readPickedFileBytes(file)).toEqual(new TextEncoder().encode(text))
  })

  it('preserves exact patch and dotenv variant filenames in save picker suggestions', async () => {
    const picker = vi.fn().mockResolvedValue([])
    vi.stubGlobal('window', { showSaveFilePicker: picker })
    try {
      await pickLocalSaveHandle('change.patch', 'diff')
      expect(picker).toHaveBeenLastCalledWith({
        suggestedName: 'change.patch',
        types: [{ description: 'DIFF', accept: { 'text/x-diff': ['.diff', '.patch'] } }]
      })

      await pickLocalSaveHandle('.env.production', 'env')
      expect(picker).toHaveBeenLastCalledWith({ suggestedName: '.env.production' })

      await pickLocalSaveHandle('service.env', 'env')
      expect(picker).toHaveBeenLastCalledWith({
        suggestedName: 'service.env',
        types: [{ description: 'ENV', accept: { 'text/plain': ['.env'] } }]
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
