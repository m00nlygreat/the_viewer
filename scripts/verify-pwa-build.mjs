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

const worker = readFileSync(path.join(output, 'sw.js'), 'utf8')
assert.ok(worker.includes('SourceEditor-'), 'Monaco source editor chunk is not precached')
assert.ok(worker.includes('editor.worker-'), 'Monaco worker chunk is not precached')
assert.ok(worker.includes(`\`${base}\``) && worker.includes('index.html'), 'PWA navigation fallback does not use the configured base path')
console.log(`Verified PWA output for base ${base}`)
