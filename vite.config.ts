import { resolve } from 'node:path'
import { readFileSync, readdirSync } from 'node:fs'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const packageVersion = JSON.parse(readFileSync(resolve('package.json'), 'utf8')).version as string

function extensionAssets(): Plugin {
  return {
    name: 'viewer-extension-assets',
    apply: 'build',
    generateBundle() {
      const iconsDir = resolve('public/icons')
      this.emitFile({ type: 'asset', fileName: 'icons/viewer.svg', source: readFileSync(resolve(iconsDir, 'viewer.svg')) })
      for (const name of readdirSync(iconsDir).filter((file) => /^extension-\d+\.png$/.test(file))) {
        this.emitFile({ type: 'asset', fileName: `icons/${name.replace('extension-', '')}`, source: readFileSync(resolve(iconsDir, name)) })
      }
      const licensesDir = resolve('public/licenses')
      for (const name of readdirSync(licensesDir)) this.emitFile({ type: 'asset', fileName: `licenses/${name}`, source: readFileSync(resolve(licensesDir, name)) })
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: packageVersion, base: './' }, null, 2) })
      this.emitFile({ type: 'asset', fileName: 'manifest.json', source: JSON.stringify({
        manifest_version: 3,
        name: 'The Viewer',
        short_name: 'Viewer',
        version: packageVersion,
        description: '이메일, 표, 문서, 일정과 연락처 파일을 브라우저 안에서 편집합니다.',
        minimum_chrome_version: '128',
        action: { default_title: 'The Viewer 열기', default_icon: { 16: 'icons/16.png', 32: 'icons/32.png' } },
        background: { service_worker: 'background.js', type: 'module' },
        permissions: ['alarms', 'contextMenus', 'storage', 'declarativeNetRequestWithHostAccess'],
        host_permissions: ['https://*/*', 'http://*/*', 'file:///*'],
        externally_connectable: { matches: ['https://m00nlygreat.github.io/the_viewer/*'] },
        web_accessible_resources: [{ resources: ['extension.html'], matches: ['https://*/*', 'http://*/*', 'file:///*'] }],
        commands: { '_execute_action': { suggested_key: { default: 'Alt+Shift+V' }, description: 'The Viewer 열기' } },
        icons: { 16: 'icons/16.png', 32: 'icons/32.png', 48: 'icons/48.png', 128: 'icons/128.png' },
        content_security_policy: { extension_pages: "script-src 'self'; object-src 'self'" }
      }, null, 2) })
    }
  }
}

function verifyExtensionBundle(): Plugin {
  return {
    name: 'verify-viewer-extension-boundary',
    apply: 'build',
    generateBundle(_, bundle) {
      const moduleIds = Object.values(bundle)
        .flatMap((item) => item.type === 'chunk' ? Object.keys(item.modules) : [])
        .map((id) => id.replaceAll('\\', '/').toLowerCase())
      const forbidden = moduleIds.filter((id) => /\/src\/(app|features)\/|\/src\/domain\/(parser\.worker|formatparsing|session|workerclient)\.ts|\/node_modules\/(react|react-dom)\//.test(id))
      if (forbidden.length) throw new Error(`Chrome extension bundle includes app-only modules: ${forbidden.join(', ')}`)
    }
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const extension = mode === 'extension'
  const base = extension ? './' : (env.BASE_PATH || '/')
  const input: Record<string, string> = extension
    ? { index: resolve('extension.html'), background: resolve('src/platform/extension/background.ts') }
    : { index: resolve('index.html') }
  return {
    base,
    publicDir: extension ? false : 'public',
    plugins: [
      react(),
      ...(extension ? [extensionAssets(), verifyExtensionBundle()] : [VitePWA({
        strategies: 'injectManifest',
        srcDir: 'src/platform/pwa',
        filename: 'sw.ts',
        registerType: 'prompt',
        injectManifest: {
          globPatterns: ['**/*.{html,js,css,svg,png,woff,woff2,ttf,json}'],
          maximumFileSizeToCacheInBytes: 15 * 1024 * 1024
        },
        manifest: {
          id: base,
          name: 'The Viewer — 파일 뷰어',
          short_name: 'The Viewer',
          description: '이메일, 표, 문서, 일정과 연락처 파일을 브라우저 안에서 보고 편집합니다.',
          lang: 'ko-KR',
          start_url: base,
          scope: base,
          display: 'standalone',
          background_color: '#0B0B0C',
          theme_color: '#0B0B0C',
          icons: [
            { src: `${base}icons/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: `${base}icons/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: `${base}icons/maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' }
          ],
          file_handlers: [{ action: base, accept: {
            'message/rfc822': ['.eml'], 'text/csv': ['.csv'], 'text/markdown': ['.md'], 'text/calendar': ['.ics'], 'text/vcard': ['.vcf']
          } }],
          share_target: { action: `${base}share/`, method: 'POST', enctype: 'multipart/form-data', params: { files: [{ name: 'files', accept: ['message/rfc822', 'text/csv', 'text/markdown', 'text/calendar', 'text/vcard'] }] } }
        }
      })]),
    ],
    resolve: { alias: { '@': resolve('src') } },
    define: { __APP_BASE__: JSON.stringify(base), __APP_VERSION__: JSON.stringify(packageVersion) },
    build: {
      outDir: extension ? 'dist/chrome_extension' : 'dist/app',
      emptyOutDir: true,
      sourcemap: false,
      rollupOptions: {
        input,
        output: { entryFileNames: extension ? '[name].js' : '[name]-[hash].js', chunkFileNames: 'assets/[name]-[hash].js', assetFileNames: 'assets/[name]-[hash][extname]' }
      }
    },
    worker: { format: 'es' },
    server: { host: '0.0.0.0', allowedHosts: true },
    preview: { host: '0.0.0.0' }
  }
})
