import { access, readFile } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const required = [
  'dist/app/index.html',
  'dist/app/manifest.webmanifest',
  'dist/app/sw.js',
  'dist/chrome_extension/manifest.json',
  'dist/chrome_extension/extension.html',
  'dist/chrome_extension/background.js',
  `dist/the-viewer-chrome-v${pkg.version}.zip`
]
for (const file of required) await access(path.join(root, file))

const manifest = JSON.parse(await readFile(path.join(root, 'dist/chrome_extension/manifest.json'), 'utf8'))
if (manifest.version !== pkg.version) throw new Error('Extension manifest version does not match package.json.')
if (!manifest.permissions.includes('alarms')) throw new Error('Extension manifest is missing the alarms permission.')
if (JSON.stringify(manifest.externally_connectable?.matches) !== JSON.stringify(['https://m00nlygreat.github.io/the_viewer/*'])) {
  throw new Error('Extension manifest has an unexpected externally_connectable rule.')
}
process.stdout.write(`Verified PWA, extension relay, manifest v${pkg.version}, and ZIP.\n`)
