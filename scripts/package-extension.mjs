import { createWriteStream } from 'node:fs'
import { mkdir, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { finished } from 'node:stream/promises'
import yazl from 'yazl'

const root = process.cwd()
const source = path.join(root, 'dist/chrome_extension')
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const output = path.join(root, 'dist', `the-viewer-chrome-v${pkg.version}.zip`)
const archive = new yazl.ZipFile()

async function addDirectory(directory, relative = '') {
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name)
    const name = path.posix.join(relative, entry.name)
    if (entry.isDirectory()) await addDirectory(fullPath, name)
    else if (entry.isFile()) archive.addFile(fullPath, name)
  }
}

await addDirectory(source)
await mkdir(path.dirname(output), { recursive: true })
const writeStream = createWriteStream(output)
const completed = finished(writeStream)
archive.outputStream.pipe(writeStream)
archive.end()
await completed
process.stdout.write(`Created ${path.relative(root, output)}\n`)
