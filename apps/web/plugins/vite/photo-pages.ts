import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { PhotoManifestItem } from '@afilmory/builder'
import type { Plugin } from 'vite'

import type { SiteConfig } from '../../../../site.config'
import { MANIFEST_PATH } from './__internal__/constants'

const OG_META_PATTERN = /<meta\s+(?:property|name)=["']?(?:og|twitter):[^>]*>/gi
// id 会作为文件名，只排除路径分隔与上跳
const isSafeId = (id: string) => !!id && !/[/\\]/.test(id) && id !== '.' && id !== '..'

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/**
 * 静态部署没有 SSR，爬虫拿不到单张照片的 og meta。
 * 构建结束后为每张有 OG 图的照片复制一份 index.html 到 photos/<id>.html，只替换 title 和 og/twitter meta，
 * 服务器按 `try_files {path} {path}.html /index.html` 命中。
 */
export function createPhotoPagesPlugin(siteConfig: SiteConfig): Plugin {
  let outDir = ''

  return {
    name: 'photo-pages',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir)
    },
    async closeBundle() {
      const photos: PhotoManifestItem[] = JSON.parse(await readFile(MANIFEST_PATH, 'utf-8')).data
      const indexHtml = await readFile(path.join(outDir, 'index.html'), 'utf-8')
      const baseHtml = indexHtml.replaceAll(OG_META_PATTERN, '')
      const siteUrl = siteConfig.url.replace(/\/$/, '')
      const pagesDir = path.join(outDir, 'photos')
      await mkdir(pagesDir, { recursive: true })

      let count = 0
      for (const photo of photos) {
        if (!photo.ogImageUrl || !isSafeId(photo.id)) {
          continue
        }

        const title = escapeHtml(`${photo.title || photo.id} | ${siteConfig.title}`)
        const description = escapeHtml(photo.description || siteConfig.description)
        const image = escapeHtml(
          /^https?:\/\//.test(photo.ogImageUrl) ? photo.ogImageUrl : `${siteUrl}${encodeURI(photo.ogImageUrl)}`,
        )
        const url = escapeHtml(`${siteUrl}/photos/${encodeURIComponent(photo.id)}`)

        const meta = [
          `<meta property="og:type" content="article">`,
          `<meta property="og:site_name" content="${escapeHtml(siteConfig.name)}">`,
          `<meta property="og:url" content="${url}">`,
          `<meta property="og:title" content="${title}">`,
          `<meta property="og:description" content="${description}">`,
          `<meta property="og:image" content="${image}">`,
          `<meta property="og:image:width" content="1200">`,
          `<meta property="og:image:height" content="628">`,
          `<meta name="twitter:card" content="summary_large_image">`,
          `<meta name="twitter:title" content="${title}">`,
          `<meta name="twitter:description" content="${description}">`,
          `<meta name="twitter:image" content="${image}">`,
        ].join('')

        const html = baseHtml
          .replace(/<title>[\s\S]*?<\/title>/, `<title>${title}</title>`)
          .replace('</head>', `${meta}</head>`)
        await writeFile(path.join(pagesDir, `${photo.id}.html`), html)
        count++
      }

      // eslint-disable-next-line no-console
      console.info(`Generated ${count} photo pages`)
    },
  }
}
