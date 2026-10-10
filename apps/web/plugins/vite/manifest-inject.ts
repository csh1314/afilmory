import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import process from 'node:process'

import type { Plugin } from 'vite'

import { MANIFEST_PATH } from './__internal__/constants'

function resolveEmbedPreference(_command: 'serve' | 'build'): boolean {
  const flag = process.env.AFILMORY_EMBED_MANIFEST?.trim().toLowerCase()
  if (flag === 'true') {
    return true
  }
  if (flag === 'false') {
    return false
  }
  return true
}

export function manifestInjectPlugin(): Plugin {
  let embedManifest: boolean | undefined
  let base = '/'
  // build 时 manifest 外置为带 hash 的 js：每张照片的 HTML 壳都复制 index.html，内联会让总体积随照片数平方增长
  let externalAsset: { fileName: string, source: string } | null = null

  function getManifestContent(): string {
    try {
      const content = readFileSync(MANIFEST_PATH, 'utf-8')
      return content
    }
    catch (error) {
      console.warn('Failed to read manifest file:', error)
      return '{}'
    }
  }

  return {
    name: 'manifest-inject',

    configResolved(config) {
      embedManifest = resolveEmbedPreference(config.command as 'serve' | 'build')
      base = config.base
    },

    buildStart() {
      if (!embedManifest) {
        return
      }
      const source = `window.__MANIFEST__ = ${getManifestContent()};`
      const hash = createHash('sha256').update(source).digest('hex').slice(0, 10)
      externalAsset = { fileName: `assets/manifest-${hash}.js`, source }
    },

    generateBundle() {
      if (!externalAsset) {
        return
      }
      this.emitFile({ type: 'asset', ...externalAsset })
    },

    configureServer(server) {
      const shouldEmbed = embedManifest ?? resolveEmbedPreference(server.config.command as 'serve')
      if (!shouldEmbed) {
        return
      }

      // 监听 manifest 文件变化
      server.watcher.add(MANIFEST_PATH)

      server.watcher.on('change', (file) => {
        if (file === MANIFEST_PATH) {
          // eslint-disable-next-line no-console
          console.info('[manifest-inject] Manifest file changed, triggering HMR...')
          // 触发页面重新加载
          server.ws.send({
            type: 'full-reload',
          })
        }
      })
    },

    transformIndexHtml(html, ctx) {
      const command: 'serve' | 'build' = ctx?.server ? 'serve' : 'build'
      const shouldEmbed = embedManifest ?? resolveEmbedPreference(command)
      embedManifest = shouldEmbed
      if (!shouldEmbed) {
        return html
      }

      if (command === 'build' && externalAsset) {
        return html.replace(
          '<script id="manifest"></script>',
          `<script id="manifest" src="${base}${externalAsset.fileName}"></script>`,
        )
      }

      const manifestContent = getManifestContent()

      // 将 manifest 内容注入到 script#manifest 标签中
      const scriptContent = `window.__MANIFEST__ = ${manifestContent};`

      return html.replace('<script id="manifest"></script>', `<script id="manifest">${scriptContent}</script>`)
    },
  }
}
