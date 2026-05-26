import { createHash } from 'node:crypto'
import { createReadStream, cpSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const require = createRequire(import.meta.url)

const EXCALIDRAW_ASSET_BASE = '/vendor/excalidraw'
const EXCALIDRAW_ASSET_REQUEST_PREFIX = `${EXCALIDRAW_ASSET_BASE}/dist`
const EXCALIDRAW_ASSET_OUTPUT_DIR = 'vendor/excalidraw/dist'

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function createIntegrity(source: string | Uint8Array): string {
  return `sha384-${createHash('sha384').update(source).digest('base64')}`
}

function sriPlugin(): Plugin {
  let outDir = 'dist'

  return {
    name: 'graphite-sri',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    writeBundle(_, bundle) {
      const integrityByAssetPath = new Map<string, string>()

      for (const [fileName, output] of Object.entries(bundle)) {
        if (!fileName.startsWith('assets/')) {
          continue
        }

        if (output.type === 'asset') {
          if (typeof output.source === 'string' || output.source instanceof Uint8Array) {
            integrityByAssetPath.set(`/${fileName}`, createIntegrity(output.source))
          }
          continue
        }

        integrityByAssetPath.set(`/${fileName}`, createIntegrity(output.code))
      }

      const indexHtmlPath = join(outDir, 'index.html')
      let html = readFileSync(indexHtmlPath, 'utf8')

      for (const [assetPath, integrity] of integrityByAssetPath.entries()) {
        const pattern = new RegExp(`(<(?:script|link)\\b[^>]*(?:src|href)=["']${escapeRegExp(assetPath)}["'][^>]*)(>)`, 'g')
        html = html.replace(pattern, (_match, startTag, endTag) => {
          if (startTag.includes('integrity=')) {
            return `${startTag}${endTag}`
          }
          return `${startTag} integrity="${integrity}"${endTag}`
        })
      }

      writeFileSync(indexHtmlPath, html)
    },
  }
}

function getExcalidrawDistPath(): string {
  return join(dirname(require.resolve('@excalidraw/excalidraw/package.json')), 'dist')
}

function getContentType(filePath: string): string {
  switch (extname(filePath)) {
    case '.js':
      return 'application/javascript; charset=utf-8'
    case '.json':
      return 'application/json; charset=utf-8'
    case '.woff2':
      return 'font/woff2'
    case '.txt':
      return 'text/plain; charset=utf-8'
    default:
      return 'application/octet-stream'
  }
}

function excalidrawAssetsPlugin(): Plugin {
  let outDir = 'dist'

  return {
    name: 'graphite-excalidraw-assets',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    configureServer(server) {
      const sourceDist = resolve(getExcalidrawDistPath())

      server.middlewares.use((req, res, next) => {
        const requestPath = req.url?.split('?', 1)[0] ?? ''
        const assetPrefix = `${EXCALIDRAW_ASSET_REQUEST_PREFIX}/`

        if (!requestPath.startsWith(assetPrefix)) {
          next()
          return
        }

        let assetPath: string
        try {
          assetPath = decodeURIComponent(requestPath.slice(assetPrefix.length))
        } catch {
          res.statusCode = 400
          res.end('Bad request')
          return
        }

        const filePath = resolve(sourceDist, assetPath)
        if (!filePath.startsWith(`${sourceDist}${sep}`)) {
          res.statusCode = 403
          res.end('Forbidden')
          return
        }

        if (!existsSync(filePath) || !statSync(filePath).isFile()) {
          next()
          return
        }

        res.setHeader('Content-Type', getContentType(filePath))
        createReadStream(filePath).pipe(res)
      })
    },
    writeBundle() {
      const sourceDir = join(getExcalidrawDistPath(), 'excalidraw-assets')
      const targetDir = join(outDir, EXCALIDRAW_ASSET_OUTPUT_DIR, 'excalidraw-assets')

      mkdirSync(targetDir, { recursive: true })
      cpSync(sourceDir, targetDir, { recursive: true })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), excalidrawAssetsPlugin(), sriPlugin()],
  optimizeDeps: {
    exclude: ['pdfjs-dist'],
  },
  build: {
    target: 'esnext',
  },
  define: {
    'process.env': {},
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
