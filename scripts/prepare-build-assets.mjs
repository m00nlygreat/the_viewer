import { cp, copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const publicDir = path.resolve(root, 'public')
const outputDir = path.resolve(root, 'dist', 'build-assets')
if (outputDir !== path.resolve(root, 'dist', 'build-assets')) throw new Error('Unexpected build asset output path.')

await rm(outputDir, { recursive: true, force: true })
await mkdir(outputDir, { recursive: true })
for (const name of await readdir(publicDir)) {
  if (name === 'licenses' || name === 'version.json') continue
  await cp(path.join(publicDir, name), path.join(outputDir, name), { recursive: true })
}

const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const packageLock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'))
const packages = packageLock.packages ?? {}
const licensesDir = path.join(outputDir, 'licenses')
await mkdir(licensesDir, { recursive: true })

const includedPackages = new Set(Object.entries(packages)
  .filter(([location, entry]) => location.startsWith('node_modules/') && entry && typeof entry === 'object' && entry.dev !== true)
  .map(([location]) => location))

function resolveDependency(fromLocation, name) {
  let parent = fromLocation
  while (parent && parent !== '.') {
    const candidate = path.posix.join(parent, 'node_modules', name)
    if (packages[candidate]) return candidate
    parent = path.posix.dirname(parent)
  }
  const rootCandidate = path.posix.join('node_modules', name)
  return packages[rootCandidate] ? rootCandidate : undefined
}

const visitPackage = (location) => {
  if (includedPackages.has(location)) return
  const entry = packages[location]
  if (!entry || typeof entry !== 'object') return
  includedPackages.add(location)
  for (const name of Object.keys({ ...entry.dependencies, ...entry.optionalDependencies })) {
    const dependency = resolveDependency(location, name)
    if (dependency) visitPackage(dependency)
  }
}

// The service worker bundles Workbox at build time even though it is a dev dependency.
for (const name of ['workbox-precaching', 'workbox-routing']) {
  const location = path.posix.join('node_modules', name)
  visitPackage(location)
}

const notices = []
for (const location of [...includedPackages].sort((left, right) => left.localeCompare(right))) {
  const entry = packages[location]
  if (!entry || typeof entry !== 'object') continue
  const packageDir = path.join(root, location)
  let metadata
  try {
    metadata = JSON.parse(await readFile(path.join(packageDir, 'package.json'), 'utf8'))
  } catch {
    continue
  }

  const packageName = metadata.name ?? location.replace(/^node_modules\//, '')
  const version = metadata.version ?? entry.version ?? 'unknown'
  const license = typeof metadata.license === 'string' ? metadata.license : 'license metadata in package'
  notices.push(`${packageName}@${version} — ${license}`)

  let files = []
  try { files = await readdir(packageDir) } catch { continue }
  const licenseFiles = files.filter((file) => /^(license|licence|copying|notice)(\.|$)/i.test(file))
  const safeName = packageName.replace(/[^a-zA-Z0-9.-]+/g, '_')
  for (const file of licenseFiles) {
    try {
      await copyFile(path.join(packageDir, file), path.join(licensesDir, `${safeName}-${file}`))
    } catch {
      // Keep the package citation even when a package omits a separately copyable notice file.
    }
  }
}

notices.sort((a, b) => a.localeCompare(b))
await writeFile(path.join(licensesDir, 'THIRD_PARTY_NOTICES.md'), `# Third-party notices\n\n${notices.map((notice) => `- ${notice}`).join('\n')}\n`, 'utf8')
await writeFile(path.join(outputDir, 'version.json'), JSON.stringify({ version: packageJson.version, base: process.env.BASE_PATH || '/' }, null, 2) + '\n', 'utf8')
process.stdout.write(`Prepared ${notices.length} production package notices in dist/build-assets.\n`)
