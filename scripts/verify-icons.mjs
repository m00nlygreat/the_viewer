import { access } from 'node:fs/promises'
import path from 'node:path'

const iconDir = path.resolve('public/icons')
const icons = [
  'viewer.svg', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'maskable-512.png',
  'extension-16.png', 'extension-32.png', 'extension-48.png', 'extension-128.png', 'extension-192.png', 'extension-512.png'
]
for (const icon of icons) await access(path.join(iconDir, icon))
process.stdout.write(`Verified ${icons.length} icon assets.\n`)
