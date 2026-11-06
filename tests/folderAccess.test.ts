import { describe, expect, it, vi } from 'vitest'
import { folderFromInput, listFolderChildren, readFolderFile } from '../src/platform/folderAccess'

function inputFile(path: string): File {
  const file = new File(['body'], path.split('/').at(-1)!, { type: 'text/plain' })
  Object.defineProperty(file, 'webkitRelativePath', { value: path })
  return file
}

describe('folder access adapter', () => {
  it('removes one common root segment and creates directory entries without reading bodies', async () => {
    const files = [inputFile('Notes/a.md'), inputFile('Notes/sub/b.md')]
    for (const file of files) vi.spyOn(file, 'arrayBuffer')
    const picked = folderFromInput(files)
    expect(picked.workspace).toMatchObject({ name: 'Notes', access: 'input', expandedPaths: [''] })
    if (picked.source.kind !== 'input') throw new Error('input 폴더가 아닙니다.')
    expect([...picked.source.files.keys()]).toEqual(['a.md', 'sub/b.md'])
    expect(await listFolderChildren(picked.source, '', new AbortController().signal)).toEqual([
      { path: 'sub', name: 'sub', kind: 'directory' }, { path: 'a.md', name: 'a.md', kind: 'file' }
    ])
    for (const file of files) expect(file.arrayBuffer).not.toHaveBeenCalled()
  })

  it('reads only the requested input file and reports missing paths', async () => {
    const file = inputFile('Notes/guide.md')
    const picked = folderFromInput([file])
    await expect(readFolderFile(picked.source, 'guide.md', new AbortController().signal)).resolves.toMatchObject({ file })
    await expect(readFolderFile(picked.source, 'missing.md', new AbortController().signal)).rejects.toThrow('찾을 수 없습니다')
  })
})
