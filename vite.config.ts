import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { readFileSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))

const pkgVersion = (
  JSON.parse(readFileSync(resolve(here, 'package.json'), 'utf-8')) as { version: string }
).version

// package.json's signalk.appIcon points at icon.svg, and SignalK reads
// it from two places: the App Store fetches it from the tarball root
// (unpkg.com/<pkg>@<version>/icon.svg) while the webapp launcher tile
// loads it from the mounted public/ dir (/signalk-hmi-designer/icon.svg).
// Keep the one tracked copy at the repo root and emit it into the
// bundle, so the two never drift apart.
function appIcon(): Plugin {
  const src = resolve(here, 'icon.svg')
  return {
    name: 'hmi-designer-app-icon',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'icon.svg',
        source: readFileSync(src)
      })
    },
    configureServer(server) {
      // `npm run dev` serves publicDir only; answer the favicon request
      // from the same root file.
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0]?.endsWith('/icon.svg')) {
          res.setHeader('content-type', 'image/svg+xml')
          res.end(readFileSync(src))
          return
        }
        next()
      })
    }
  }
}

// SignalK mounts the built webapp at /signalk-hmi-designer/. Setting
// `base` makes Vite emit asset URLs with that prefix so they resolve
// correctly behind the SK reverse proxy.
export default defineConfig({
  plugins: [react(), appIcon()],
  define: {
    __PLUGIN_VERSION__: JSON.stringify(pkgVersion)
  },
  base: '/signalk-hmi-designer/',
  root: resolve(here, 'webapp'),
  build: {
    outDir: resolve(here, 'public'),
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022'
  },
  server: {
    port: 5173,
    proxy: {
      '/plugins': process.env.SIGNALK_DEV_URL ?? 'http://127.0.0.1:3000',
      '/signalk': process.env.SIGNALK_DEV_URL ?? 'http://127.0.0.1:3000'
    }
  }
})
