import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const repository = process.env.GITHUB_REPOSITORY
if (!repository || !/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('GITHUB_REPOSITORY is required.')

const downloadsDir = path.resolve('dist/app/downloads')
await mkdir(downloadsDir, { recursive: true })
const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`

const releases = []
for (let page = 1; ; page += 1) {
  const response = await fetch(`https://api.github.com/repos/${repository}/releases?per_page=100&page=${page}`, { headers })
  if (!response.ok) throw new Error(`Unable to list extension releases (${response.status}).`)
  const batch = await response.json()
  releases.push(...batch.filter((release) => !release.draft))
  if (batch.length < 100) break
}

const available = []
for (const release of releases) {
  const match = /^extension-v(\d+)\.(\d+)\.(\d+)$/.exec(release.tag_name)
  if (!match) continue
  const version = match.slice(1).join('.')
  const fileName = `the-viewer-chrome-v${version}.zip`
  const asset = release.assets.find((candidate) => candidate.name === fileName)
  if (asset) available.push({ version: match.slice(1).map(Number), fileName, asset })
}

available.sort((left, right) => {
  for (let index = 0; index < 3; index += 1) {
    if (left.version[index] !== right.version[index]) return left.version[index] - right.version[index]
  }
  return 0
})

for (const { fileName, asset } of available) {
  const response = await fetch(asset.url, { headers: { ...headers, Accept: 'application/octet-stream' } })
  if (!response.ok) throw new Error(`Unable to download ${fileName} (${response.status}).`)
  await writeFile(path.join(downloadsDir, fileName), new Uint8Array(await response.arrayBuffer()))
}

if (available.length) {
  const latest = available.at(-1)
  await copyFile(path.join(downloadsDir, latest.fileName), path.join(downloadsDir, 'the-viewer-chrome-latest.zip'))
  process.stdout.write(`Restored ${available.length} versioned extension ZIPs and latest v${latest.version.join('.')} from Releases.\n`)
} else {
  process.stdout.write('No versioned extension ZIP releases were found; Downloads stays empty.\n')
}
