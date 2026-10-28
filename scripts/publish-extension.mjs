import { copyFile, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const source = path.join(root, 'dist', `the-viewer-chrome-v${pkg.version}.zip`)
const downloads = path.join(root, 'dist', 'app', 'downloads')
await mkdir(downloads, { recursive: true })
await copyFile(source, path.join(downloads, `the-viewer-chrome-v${pkg.version}.zip`))
await copyFile(source, path.join(downloads, 'the-viewer-chrome-latest.zip'))
process.stdout.write(`Published ZIP files for The Viewer v${pkg.version}.\n`)
