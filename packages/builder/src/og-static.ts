/**
 * 静态部署用：为 manifest 里每张照片渲染 OG 图到 apps/web/public/og/<id>.jpg，
 * 并把 ogImageUrl 写回 manifest。
 *
 * - 单进程串行渲染，字体只加载一次，内存峰值可控（不走 builder 的 cluster worker）
 * - 按模板输入 + 缩略图内容算 hash，命中 og/.index.json 则跳过；manifest 已移除的照片删掉对应图片
 */
import type { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import type { OgTemplateProps } from '@afilmory/og-renderer'
import { renderOgImage } from '@afilmory/og-renderer'
import type { AfilmoryManifest, PhotoManifestItem } from '@afilmory/typing'
import sharp from 'sharp'

import { workdir } from './path.js'
import {
  buildExifInfo,
  formatDate,
  getPhotoDimensions,
  loadOgFonts,
  repoRoot,
} from './plugins/og-image-storage/shared.js'

// 模板或渲染参数变化时递增，触发全量重渲染
const RENDER_VERSION = 1
const JPEG_QUALITY = 82
const OG_URL_PREFIX = '/og'

const manifestPath = path.join(workdir, 'src/data/photos-manifest.json')
const outputDir = path.join(workdir, 'public/og')
const indexPath = path.join(outputDir, '.index.json')

type RenderIndex = Record<string, string>

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, 'utf-8')) as T
  }
  catch {
    return fallback
  }
}

async function loadSiteMeta() {
  const config = await readJson<{ name?: string, title?: string, accentColor?: string }>(
    path.join(repoRoot, 'config.json'),
    {},
  )
  return {
    siteName: config.name?.trim() || config.title?.trim() || 'Photo Gallery',
    accentColor: config.accentColor?.trim() || '#007bff',
  }
}

async function readThumbnail(item: PhotoManifestItem): Promise<Buffer | null> {
  if (!item.thumbnailUrl || /^https?:\/\//i.test(item.thumbnailUrl)) {
    return null
  }
  return readFile(path.join(workdir, 'public', item.thumbnailUrl.replace(/^\/+/, ''))).catch(() => null)
}

function hashOf(template: Omit<OgTemplateProps, 'thumbnailSrc'>, thumbnail: Buffer | null): string {
  return createHash('sha1')
    .update(String(RENDER_VERSION))
    .update(JSON.stringify(template))
    .update(thumbnail ?? '')
    .digest('hex')
}

async function main() {
  const manifest = await readJson<AfilmoryManifest | null>(manifestPath, null)
  if (!manifest) {
    console.warn(`[og-static] manifest not found: ${manifestPath}, skip.`)
    return
  }

  const fonts = await loadOgFonts()
  if (!fonts) {
    throw new Error('[og-static] OG fonts not found under be/apps/core/src/modules/content/og/assets')
  }

  await mkdir(outputDir, { recursive: true })
  const previous = await readJson<RenderIndex>(indexPath, {})
  const next: RenderIndex = {}
  const siteMeta = await loadSiteMeta()
  const startedAt = Date.now()
  let rendered = 0

  for (const item of manifest.data) {
    const thumbnail = await readThumbnail(item)
    const template = {
      photoTitle: item.title || item.id || 'Untitled Photo',
      siteName: siteMeta.siteName,
      tags: (item.tags ?? []).slice(0, 3),
      formattedDate: formatDate(item.exif?.DateTimeOriginal ?? item.lastModified),
      exifInfo: buildExifInfo(item),
      photoDimensions: getPhotoDimensions(item),
      accentColor: siteMeta.accentColor,
    }
    const hash = hashOf(template, thumbnail)
    const fileName = `${item.id}.jpg`
    const filePath = path.join(outputDir, fileName)

    const cached
      = previous[item.id] === hash
        && (await readFile(filePath).then(
          () => true,
          () => false,
        ))
    if (!cached) {
      const png = await renderOgImage({
        template: {
          ...template,
          thumbnailSrc: thumbnail ? `data:image/jpeg;base64,${thumbnail.toString('base64')}` : null,
        },
        fonts,
      })
      const jpeg = await sharp(png)
        .flatten({ background: '#000' })
        .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
        .toBuffer()
      await writeFile(filePath, jpeg)
      rendered++
    }

    next[item.id] = hash
    item.ogImageUrl = `${OG_URL_PREFIX}/${fileName}`
  }

  // 删除 manifest 中已不存在的照片的 OG 图
  const keep = new Set(Object.keys(next).map(id => `${id}.jpg`))
  let removed = 0
  for (const file of await readdir(outputDir)) {
    if (file.endsWith('.jpg') && !keep.has(file)) {
      await rm(path.join(outputDir, file))
      removed++
    }
  }

  await writeFile(indexPath, JSON.stringify(next, null, 2))
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2))

  // eslint-disable-next-line no-console
  console.info(
    `[og-static] ${manifest.data.length} photos, rendered ${rendered}, removed ${removed}, ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
