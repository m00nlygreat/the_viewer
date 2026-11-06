import { assertInputFileSize } from '../domain/inputPolicy'
import { isFolderPath, joinFolderPath, type FolderEntry, type FolderPath, type FolderWorkspace } from '../domain/workspace'

export type FolderSource =
  | { kind: 'handle'; root: FileSystemDirectoryHandle }
  | { kind: 'input'; files: ReadonlyMap<FolderPath, File> }

export interface PickedFolder { workspace: FolderWorkspace; source: FolderSource }

export function supportsDirectoryPicker(): boolean { return typeof window.showDirectoryPicker === 'function' }
export function supportsFolderInput(): boolean { return typeof document !== 'undefined' && 'webkitdirectory' in document.createElement('input') }

export function folderFromHandle(root: FileSystemDirectoryHandle): PickedFolder {
  return { workspace: { id: crypto.randomUUID(), name: root.name, access: 'handle', expandedPaths: [''], activePath: null }, source: { kind: 'handle', root } }
}

export async function pickLocalFolder(): Promise<PickedFolder | null> {
  const picker = window.showDirectoryPicker
  if (!picker) return null
  const selection = picker.call(window, { mode: 'read' })
  const root = await selection
  return folderFromHandle(root)
}

export function folderFromInput(files: readonly File[]): PickedFolder {
  const roots = new Set<string>()
  const mapped = new Map<FolderPath, File>()
  for (const file of files) {
    const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? ''
    const parts = relative.split('/').filter(Boolean)
    if (parts.length < 2) continue
    roots.add(parts[0]!)
    const path = parts.slice(1).join('/')
    if (isFolderPath(path, false)) mapped.set(path, file)
  }
  if (roots.size !== 1 || !mapped.size) throw new Error('선택한 폴더에서 파일을 가져오지 못했습니다.')
  const name = [...roots][0]!
  return { workspace: { id: crypto.randomUUID(), name, access: 'input', expandedPaths: [''], activePath: null }, source: { kind: 'input', files: mapped } }
}

export async function listFolderChildren(source: FolderSource, path: FolderPath, signal: AbortSignal): Promise<FolderEntry[]> {
  assertPath(path)
  throwIfAborted(signal)
  const entries: FolderEntry[] = []
  if (source.kind === 'input') {
    const seen = new Map<FolderPath, FolderEntry>()
    for (const filePath of source.files.keys()) {
      throwIfAborted(signal)
      const relative = path ? filePath.slice(path.length + 1) : filePath
      if (path && !filePath.startsWith(`${path}/`)) continue
      if (!relative) continue
      const [name, ...rest] = relative.split('/')
      if (!name) continue
      const childPath = joinFolderPath(path, name)
      seen.set(childPath, { path: childPath, name, kind: rest.length ? 'directory' : 'file' })
    }
    entries.push(...seen.values())
  } else {
    const directory = await getDirectory(source.root, path, signal)
    try {
      for await (const [name, handle] of directory.entries()) {
        throwIfAborted(signal)
        entries.push({ path: joinFolderPath(path, name), name, kind: handle.kind === 'directory' ? 'directory' : 'file' })
      }
    } catch (error) { throw normalizeFolderError(error, path) }
  }
  throwIfAborted(signal)
  const collator = new Intl.Collator('ko', { numeric: true })
  return entries.sort((left, right) => Number(right.kind === 'directory') - Number(left.kind === 'directory') || collator.compare(left.name, right.name) || (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
}

export async function readFolderFile(source: FolderSource, path: FolderPath, signal: AbortSignal): Promise<{ file: File; fileHandle?: FileSystemFileHandle }> {
  assertPath(path, false)
  throwIfAborted(signal)
  if (source.kind === 'input') {
    const file = source.files.get(path)
    if (!file) throw new Error(`“${path}” 파일을 찾을 수 없습니다. 폴더를 새로고침하세요.`)
    assertInputFileSize(file.name, file.size, navigator.userAgent)
    throwIfAborted(signal)
    return { file }
  }
  const parts = path.split('/')
  const filename = parts.pop()!
  const parent = await getDirectory(source.root, parts.join('/'), signal)
  throwIfAborted(signal)
  try {
    const handle = await parent.getFileHandle(filename)
    throwIfAborted(signal)
    const file = await handle.getFile()
    assertInputFileSize(file.name, file.size, navigator.userAgent)
    throwIfAborted(signal)
    return { file, fileHandle: handle }
  } catch (error) { throw normalizeFolderError(error, path) }
}

export async function resolveFolderMembership(source: FolderSource, handle: FileSystemFileHandle): Promise<FolderPath | null> {
  if (source.kind !== 'handle') return null
  const path = await source.root.resolve(handle)
  return path?.join('/') ?? null
}

async function getDirectory(root: FileSystemDirectoryHandle, path: FolderPath, signal: AbortSignal): Promise<FileSystemDirectoryHandle> {
  let current = root
  for (const segment of path ? path.split('/') : []) {
    throwIfAborted(signal)
    try { current = await current.getDirectoryHandle(segment) }
    catch (error) { throw normalizeFolderError(error, path) }
    throwIfAborted(signal)
  }
  return current
}

function assertPath(path: FolderPath, allowRoot = true): void { if (!isFolderPath(path, allowRoot)) throw new Error('폴더 경로가 올바르지 않습니다.') }
function throwIfAborted(signal: AbortSignal): void { if (signal.aborted) throw new DOMException('폴더 작업이 취소되었습니다.', 'AbortError') }
function normalizeFolderError(error: unknown, path: string): Error {
  if (error instanceof DOMException && error.name === 'AbortError') return error
  if (error instanceof DOMException && error.name === 'NotAllowedError') return new Error('폴더 읽기 권한이 없습니다. 폴더를 새로고침해 권한을 다시 확인하세요.')
  if (error instanceof DOMException && (error.name === 'NotFoundError' || error.name === 'TypeMismatchError')) return new Error(`“${path || '폴더'}” 항목을 찾을 수 없습니다.`)
  return error instanceof Error ? error : new Error(`“${path || '폴더'}” 항목을 읽지 못했습니다.`)
}
