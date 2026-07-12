// 把大静态资源（models/books/paintings/roms + 两张散图）上传到阿里云 OSS，并确保 CORS 就位。
// three.js 的 GLB/贴图/ROM 全是跨域请求，bucket 没有 CORS 规则会加载失败，脚本每次都重放规则（幂等）。
//
// 用法（AK/SK 走环境变量，勿写进仓库）：
//   npm install ali-oss --no-save        # 仅上传时临时装，不进 package.json
//   OSS_AK=xxx OSS_SK=yyy node tools/upload-oss.mjs          (Git Bash)
//   $env:OSS_AK='xxx'; $env:OSS_SK='yyy'; node tools/upload-oss.mjs   (PowerShell)
//
// 重复跑会整体覆盖（新增/更新书封面后直接重跑即可）。代码侧引用见 src/Experience/assets.js。
import OSS from 'ali-oss'
import { readdirSync, statSync, existsSync } from 'node:fs'
import { join, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const BUCKET = 'lihongbin-my-room'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../public')

if (!process.env.OSS_AK || !process.env.OSS_SK) {
  console.error('缺少 OSS_AK / OSS_SK 环境变量')
  process.exit(1)
}

const client = new OSS({
  region: 'oss-cn-shenzhen',
  accessKeyId: process.env.OSS_AK,
  accessKeySecret: process.env.OSS_SK,
  bucket: BUCKET,
  timeout: 120000,
})

const MIME = {
  '.glb': 'model/gltf-binary',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.nes': 'application/octet-stream',
}

// 三个目录整传 + 两个散文件（favicon 和 xp/ 构建产物走本站，不上 OSS）。
// 本地不存在的直接跳过——全量上完后 public/ 里的大文件会删掉，之后只放增量文件（如新书封面）再跑即可。
const targets = []
for (const dir of ['models', 'books', 'paintings']) {
  if (!existsSync(join(ROOT, dir))) continue
  for (const f of readdirSync(join(ROOT, dir))) {
    const full = join(ROOT, dir, f)
    if (statSync(full).isFile()) targets.push([`${dir}/${f}`, full])
  }
}
for (const f of ['roms/mario.nes', 'xp-desktop.webp', 'java-logo.webp']) {
  if (existsSync(join(ROOT, f))) targets.push([f, join(ROOT, f)])
}
if (!targets.length) {
  console.log('public/ 下没有可上传的资源，跳过')
  process.exit(0)
}

await client.putBucketCORS(BUCKET, [
  {
    allowedOrigin: '*',
    allowedMethod: ['GET', 'HEAD'],
    allowedHeader: '*',
    exposeHeader: ['ETag', 'Content-Length'],
    maxAgeSeconds: 86400,
  },
])
console.log('CORS rule set: GET/HEAD from * allowed')

let done = 0, bytes = 0
for (const [key, full] of targets) {
  const size = statSync(full).size
  await client.put(key, full, {
    headers: {
      'Content-Type': MIME[extname(full).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'public, max-age=2592000', // 30 天，文件按名寻址、改内容记得换名或接受缓存期
    },
  })
  done++; bytes += size
  console.log(`[${String(done).padStart(3)}/${targets.length}] ${(size / 1024).toFixed(0).padStart(5)} KB  ${key}`)
}
console.log(`\nDone: ${done} files, ${(bytes / 1024 / 1024).toFixed(1)} MB total`)
