import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

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
      outDir = config.build.outDir
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

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), sriPlugin()],
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
