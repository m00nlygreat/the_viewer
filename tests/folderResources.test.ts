import { afterEach, describe, expect, it, vi } from 'vitest'
import { FolderResourceManager } from '../src/platform/folderResources'
import type { FolderSource } from '../src/platform/folderAccess'

describe('folder image resources', () => {
  afterEach(() => vi.restoreAllMocks())

  it('shares a validated image URL and revokes it when the last consumer releases it', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const file = new File([bytes], 'map.png', { type: 'image/png' })
    const source: FolderSource = { kind: 'input', files: new Map([['map.png', file]]) }
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:map')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const manager = new FolderResourceManager()
    manager.setGeneration(2)

    const first = await manager.acquire(source, 2, 'map.png', new AbortController().signal)
    const second = await manager.acquire(source, 2, 'map.png', new AbortController().signal)
    expect(first.url).toBe('blob:map')
    expect(second.url).toBe('blob:map')
    expect(create).toHaveBeenCalledTimes(1)
    first.release()
    expect(revoke).not.toHaveBeenCalled()
    second.release()
    expect(revoke).toHaveBeenCalledWith('blob:map')
  })

  it('rejects stale generations and rejects extension spoofing', async () => {
    const manager = new FolderResourceManager()
    manager.setGeneration(3)
    const signal = new AbortController().signal
    const stale: FolderSource = { kind: 'input', files: new Map([['map.png', new File(['text'], 'map.png', { type: 'image/png' })]]) }
    await expect(manager.acquire(stale, 2, 'map.png', signal)).rejects.toMatchObject({ name: 'AbortError' })
    await expect(manager.acquire(stale, 3, 'map.png', signal)).rejects.toThrow('실제 파일 형식')
  })

  it('keeps a shared read alive when one of its consumers cancels', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const file = new File([bytes], 'map.png', { type: 'image/png' })
    let completeRead!: (buffer: ArrayBuffer) => void
    const read = vi.spyOn(file, 'arrayBuffer').mockImplementation(() => new Promise((resolve) => { completeRead = resolve }))
    const source: FolderSource = { kind: 'input', files: new Map([['map.png', file]]) }
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:shared-map')
    const manager = new FolderResourceManager()
    manager.setGeneration(5)
    const firstController = new AbortController()
    const secondController = new AbortController()
    const first = manager.acquire(source, 5, 'map.png', firstController.signal)
    const second = manager.acquire(source, 5, 'map.png', secondController.signal)
    firstController.abort()
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1))
    completeRead(bytes.buffer.slice(0))
    const resource = await second
    expect(resource.url).toBe('blob:shared-map')
    expect(create).toHaveBeenCalledTimes(1)
    resource.release()
  })
})
