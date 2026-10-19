import { copyFile, access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const output = path.resolve(root, 'public/icons')
await mkdir(output, { recursive: true })
for (const name of ['viewer.svg', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'maskable-512.png', 'extension-16.png', 'extension-32.png', 'extension-48.png', 'extension-128.png', 'extension-192.png', 'extension-512.png']) {
  await access(path.join(output, name))
}

const packageLock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'))
const licensesDir = path.join(root, 'public/licenses')
await mkdir(licensesDir, { recursive: true })
const notices = []
for (const [location, entry] of Object.entries(packageLock.packages ?? {})) {
  if (!location.startsWith('node_modules/') || !entry || typeof entry !== 'object') continue
  const packagePath = path.join(root, location)
  let metadata
  try { metadata = JSON.parse(await readFile(path.join(packagePath, 'package.json'), 'utf8')) } catch { continue }
  const packageName = metadata.name ?? location.replace(/^node_modules\//, '')
  notices.push(`${packageName}@${metadata.version ?? entry.version ?? 'unknown'} — ${typeof metadata.license === 'string' ? metadata.license : 'license metadata in package'}`)
  let files = []
  try { files = await readdir(packagePath) } catch { continue }
  const licenseFiles = files.filter((file) => /^(license|licence|copying|notice)(\.|$)/i.test(file))
  const safeName = packageName.replace(/[^a-zA-Z0-9.-]+/g, '_')
  for (const file of licenseFiles) {
    try { await copyFile(path.join(packagePath, file), path.join(licensesDir, `${safeName}-${file}`)) } catch { /* keep the package's license citation even if its file cannot be copied */ }
  }
}
notices.sort((a, b) => a.localeCompare(b))
await writeFile(path.join(licensesDir, 'THIRD_PARTY_NOTICES.md'), `# Third-party notices\n\n${notices.map((notice) => `- ${notice}`).join('\n')}\n`, 'utf8')
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
await writeFile(path.join(root, 'public/version.json'), JSON.stringify({ version, base: process.env.BASE_PATH || '/' }, null, 2) + '\n', 'utf8')
