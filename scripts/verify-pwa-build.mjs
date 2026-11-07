import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.join(root, 'dist', 'app')
const base = process.argv[2] || process.env.BASE_PATH || '/'
assert.match(base, /^\/(?:[a-zA-Z0-9._~-]+\/)*$/u, `Invalid PWA base path: ${base}`)

for (const file of ['index.html', 'manifest.webmanifest', 'sw.js']) {
  assert.ok(existsSync(path.join(output, file)), `Missing PWA output: ${file}`)
}

const html = readFileSync(path.join(output, 'index.html'), 'utf8')
assert.ok(!html.includes('/src/main.tsx'), 'PWA HTML still references source code')
const assetReferences = [...html.matchAll(/\b(?:src|href)="([^"#]+)"/gu)].map((match) => match[1])
assert.ok(assetReferences.some((reference) => /\/index-[A-Za-z0-9_-]+\.js$/u.test(reference)), 'Versioned PWA entry script is missing')
assert.ok(assetReferences.some((reference) => reference.endsWith('/manifest.webmanifest')), 'PWA manifest link is missing')
for (const reference of assetReferences) {
  if (!reference.startsWith('/')) continue
  assert.ok(reference.startsWith(base), `PWA asset does not use base path ${base}: ${reference}`)
  const relative = reference.slice(base.length)
  assert.ok(existsSync(path.join(output, relative)), `Missing referenced PWA asset: ${reference}`)
}

const manifest = JSON.parse(readFileSync(path.join(output, 'manifest.webmanifest'), 'utf8'))
for (const key of ['id', 'start_url', 'scope']) assert.equal(manifest[key], base, `PWA manifest ${key} does not match ${base}`)
for (const icon of manifest.icons ?? []) {
  assert.ok(icon.src.startsWith(base), `PWA icon does not use base path ${base}: ${icon.src}`)
  assert.ok(existsSync(path.join(output, icon.src.slice(base.length))), `Missing PWA icon: ${icon.src}`)
}

const runtimeAssetsPath = path.join(output, 'runtime-assets.json')
assert.ok(existsSync(runtimeAssetsPath), 'Missing on-demand runtime asset manifest')
const runtimeAssets = JSON.parse(readFileSync(runtimeAssetsPath, 'utf8'))
for (const group of ['fonts', 'monaco']) {
  assert.ok(Array.isArray(runtimeAssets[group]) && runtimeAssets[group].length > 0, `Missing on-demand ${group} assets`)
  for (const asset of runtimeAssets[group]) {
    assert.ok(typeof asset.url === 'string' && Number.isSafeInteger(asset.size) && asset.size >= 0, `Invalid on-demand ${group} asset entry`)
    if (asset.url.startsWith('/')) assert.ok(asset.url.startsWith(base), `${group} asset does not use base path ${base}: ${asset.url}`)
    const relative = asset.url.startsWith(base) ? asset.url.slice(base.length) : asset.url.replace(/^\.\//u, '')
    assert.ok(existsSync(path.join(output, relative)), `Missing on-demand ${group} asset: ${asset.url}`)
  }
}

const worker = readFileSync(path.join(output, 'sw.js'), 'utf8')
assert.match(worker, /"url":"[^"]*runtime-assets\.json"/u, 'Runtime asset manifest must be available offline from the install-time precache')
const basePath = new URL(base, 'https://viewer.invalid').pathname
for (const group of ['fonts', 'monaco']) {
  for (const asset of runtimeAssets[group]) {
    const precachePath = new URL(asset.url, new URL(base, 'https://viewer.invalid')).pathname.slice(basePath.length)
    assert.ok(!worker.includes(`"url":"${precachePath}"`), `${group} asset is still in the install-time precache: ${asset.url}`)
  }
}
assert.ok(worker.includes(`\`${base}\``) && worker.includes('index.html'), 'PWA navigation fallback does not use the configured base path')
const assetBytes = (group) => runtimeAssets[group].reduce((total, asset) => total + asset.size, 0)
console.log(`Verified PWA output for base ${base}; ${runtimeAssets.fonts.length} font files (${assetBytes('fonts')} bytes), ${runtimeAssets.monaco.length} Monaco files (${assetBytes('monaco')} bytes) load on demand`)
