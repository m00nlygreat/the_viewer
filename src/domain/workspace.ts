export type FolderPath = string

export interface FolderEntry {
  path: FolderPath
  name: string
  kind: 'directory' | 'file'
}

export interface FolderWorkspace {
  id: string
  name: string
  access: 'handle' | 'input'
  expandedPaths: FolderPath[]
  activePath: FolderPath | null
}

export interface FolderDocumentRef {
  folderId: string
  path: FolderPath
}

export function folderDocumentKey(folderId: string, path: FolderPath): string {
  return JSON.stringify([folderId, path])
}

export function isFolderPath(path: unknown, allowRoot = true): path is FolderPath {
  if (typeof path !== 'string' || (!allowRoot && path.length === 0)) return false
  if (path.startsWith('/') || path.endsWith('/') || path.includes('\\') || path.includes('\0')) return false
  if (path === '') return allowRoot
  return path.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
}

export function joinFolderPath(parent: FolderPath, name: string): FolderPath {
  if (!isFolderPath(parent) || !name || name.includes('/') || name.includes('\\') || name === '.' || name === '..') {
    throw new Error('폴더 경로가 올바르지 않습니다.')
  }
  return parent ? `${parent}/${name}` : name
}
