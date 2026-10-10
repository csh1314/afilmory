import type { Buffer } from 'node:buffer'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { ExifInfo } from '@afilmory/og-renderer'
import type { PhotoManifestItem } from '@afilmory/typing'
import type { SatoriOptions } from 'satori'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const repoRoot = path.resolve(__dirname, '../../../../..')
const ogAssetsDir = path.join(repoRoot, 'be/apps/core/src/modules/content/og/assets')

async function loadFontFile(fileName: string): Promise<Buffer | null> {
  const candidates = [
    path.join(ogAssetsDir, fileName),
    path.join(repoRoot, 'apps/core/src/modules/content/og/assets', fileName),
    path.join(repoRoot, 'core/src/modules/content/og/assets', fileName),
  ]

  for (const candidate of candidates) {
    const stats = await stat(candidate).catch(() => null)
    if (stats?.isFile()) {
      return await readFile(candidate)
    }
  }

  return null
}

/**
 * Load required fonts for Satori/resvg. Returns null when any font is missing.
 */
export async function loadOgFonts(): Promise<SatoriOptions['fonts'] | null> {
  const geist = await loadFontFile('Geist-Medium.ttf')
  const harmony = await loadFontFile('HarmonyOS_Sans_SC_Medium.ttf')

  if (!geist || !harmony) {
    return null
  }

  return [
    {
      name: 'Geist',
      data: geist,
      style: 'normal',
      weight: 400,
    },
    {
      name: 'HarmonyOS Sans SC',
      data: harmony,
      style: 'normal',
      weight: 400,
    },
  ]
}

export function formatDate(input?: string | null): string | undefined {
  if (!input) {
    return undefined
  }

  const timestamp = Date.parse(input)
  if (Number.isNaN(timestamp)) {
    return undefined
  }

  return new Date(timestamp).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

/**
 * Build a lightweight EXIF summary for display; returns null when nothing meaningful is present.
 */
export function buildExifInfo(photo: PhotoManifestItem): ExifInfo | null {
  const { exif } = photo
  if (!exif) {
    return null
  }

  const focalLength = exif.FocalLengthIn35mmFormat || exif.FocalLength
  const aperture = exif.FNumber ? `f/${exif.FNumber}` : null
  const iso = exif.ISO ?? null
  const shutterSpeed = exif.ExposureTime ? `${exif.ExposureTime}s` : null
  const camera
    = exif.Make && exif.Model ? `${exif.Make.trim()} ${exif.Model.trim()}`.trim() : (exif.Model ?? exif.Make ?? null)

  if (!focalLength && !aperture && !iso && !shutterSpeed && !camera) {
    return null
  }

  return {
    focalLength: focalLength ?? null,
    aperture,
    iso,
    shutterSpeed,
    camera,
  }
}

export function getPhotoDimensions(photo: PhotoManifestItem) {
  return {
    width: photo.width || 1,
    height: photo.height || 1,
  }
}
