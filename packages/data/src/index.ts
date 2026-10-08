import type { CameraInfo, LensInfo, PhotoManifestItem } from '@afilmory/builder'

declare const APP_BASE_PATH: string

// manifest 里本地资源是根相对路径（/thumbnails/...、/photos/...），部署到子路径时补上前缀
const withBasePath = <T extends string | null | undefined>(url: T): T => {
  if (!url || APP_BASE_PATH === '/' || !url.startsWith('/') || url.startsWith('//')) {
    return url
  }
  return `${APP_BASE_PATH.replace(/\/$/, '')}${url}` as T
}

const resolvePhotoUrls = (photo: PhotoManifestItem): PhotoManifestItem => ({
  ...photo,
  originalUrl: withBasePath(photo.originalUrl),
  thumbnailUrl: withBasePath(photo.thumbnailUrl),
  ogImageUrl: withBasePath(photo.ogImageUrl),
  video:
    photo.video?.type === 'live-photo' ? { ...photo.video, videoUrl: withBasePath(photo.video.videoUrl) } : photo.video,
})

class PhotoLoader {
  private photos: PhotoManifestItem[] = []
  private photoMap: Record<string, PhotoManifestItem> = {}
  private cameras: CameraInfo[] = []
  private lenses: LensInfo[] = []

  constructor() {
    this.getAllTags = this.getAllTags.bind(this)
    this.getAllCameras = this.getAllCameras.bind(this)
    this.getAllLenses = this.getAllLenses.bind(this)
    this.getPhotos = this.getPhotos.bind(this)
    this.getPhoto = this.getPhoto.bind(this)

    this.photos = (__MANIFEST__.data as unknown as PhotoManifestItem[]).map(resolvePhotoUrls)
    this.cameras = __MANIFEST__.cameras as unknown as CameraInfo[]
    this.lenses = __MANIFEST__.lenses as unknown as LensInfo[]

    this.photos.forEach((photo) => {
      this.photoMap[photo.id] = photo
    })
  }

  getPhotos() {
    return this.photos
  }

  getPhoto(id: string) {
    return this.photoMap[id]
  }

  getAllTags() {
    const tagSet = new Set<string>()
    this.photos.forEach((photo) => {
      photo.tags.forEach(tag => tagSet.add(tag))
    })
    return Array.from(tagSet).sort()
  }

  getAllCameras() {
    return this.cameras
  }

  getAllLenses() {
    return this.lenses
  }
}
export const photoLoader = new PhotoLoader()
