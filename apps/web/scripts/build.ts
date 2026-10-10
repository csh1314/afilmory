import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { $ } from 'execa'

import { precheck } from './precheck'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const workdir = path.resolve(__dirname, '..')

async function main() {
  await precheck()
  // 纯静态部署没有服务端渲染 OG，构建时预生成每张照片的 OG 图
  if (process.env.BUILD_FOR_SERVER_SERVE !== '1') {
    await $({ cwd: path.resolve(workdir, '../..'), stdio: 'inherit' })`pnpm --filter @afilmory/builder og:static`
  }
  await $({ cwd: workdir, stdio: 'inherit' })`vite build`
}

main()
