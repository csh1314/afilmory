import os from 'node:os'
import process from 'node:process'

import { defineBuilderConfig, githubRepoSyncPlugin } from '@afilmory/builder'

import { env } from './env.js'

export default defineBuilderConfig(() => ({
  storage: {
    // 照片来自私有仓库 csh1314/afilmory-photos，构建前复制到 apps/web/public/photos（见 scripts/sync-photos.sh）
    provider: 'local',
    basePath: './apps/web/public/photos',
    baseUrl: '/photos',
  },
  system: {
    processing: {
      defaultConcurrency: 10,
      enableLivePhotoDetection: true,
      digestSuffixLength: 8,
      xmp: {
        keywords: true,
        regions: true,
      },
    },
    observability: {
      showProgress: true,
      showDetailedStats: true,
      logging: {
        verbose: false,
        level: 'info',
        outputToFile: false,
      },
      performance: {
        worker: {
          workerCount: os.cpus().length * 2,
          timeout: 30_000,
          useClusterMode: true,
          workerConcurrency: 2,
        },
      },
    },
  },
  // plugins: [thumbnailStoragePlugin()],
  plugins: [
    githubRepoSyncPlugin({
      repo: {
        enable: false,
        url: process.env.BUILDER_REPO_URL ?? '',
        token: env.GIT_TOKEN,
        branch: process.env.BUILDER_REPO_BRANCH ?? 'main',
      },
    }),
  ],
}))
