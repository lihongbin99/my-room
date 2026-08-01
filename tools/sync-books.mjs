// 用飞书多维表格（读书记录唯一维护处）同步 src/Experience/World/booksData.js
// 用法：node tools/sync-books.mjs
// - 书名/作者/ISBN/封面名/阅读日期/状态/评分以飞书为准；「未开始」的书不进数据
// - pages/height 本地维护：老书保留，新书写 null 并列出清单，按 docs/add-book.md 查后手工补
// - 新书封面从飞书附件下载到 public/books/（gitignore，本地只是 OSS 中转），color 用封面平均色自动算
// - 有新封面后记得跑 node tools/upload-oss.mjs（运行时封面从 OSS 加载，老书的早已在 OSS 上）
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import sharp from 'sharp'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DATA = join(ROOT, 'src/Experience/World/booksData.js')
const COVERS = join(ROOT, 'public/books')

// 凭证/表格标识直接从 book 项目的 feishu.py 读，不在两处维护
const py = readFileSync('D:/Users/HongBin/Documents/book/feishu.py', 'utf8')
const cfg = k => py.match(new RegExp(`^${k} = "(.+)"`, 'm'))[1]

const api = async (path, body, token) => {
  const r = await (await fetch('https://open.feishu.cn/open-apis' + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: 'Bearer ' + token }) },
    body: body && JSON.stringify(body),
  })).json()
  if (r.code !== 0) throw new Error(`飞书API错误: ${r.code} ${r.msg}`)
  return r
}

const token = (await api('/auth/v3/tenant_access_token/internal',
  { app_id: cfg('APP_ID'), app_secret: cfg('APP_SECRET') })).tenant_access_token

let records = [], page = ''
do {
  const d = (await api(`/bitable/v1/apps/${cfg('APP_TOKEN')}/tables/${cfg('TABLE_ID')}/records/search?page_size=500&page_token=${page}`, {}, token)).data
  records.push(...(d.items ?? []))
  page = d.has_more ? d.page_token : ''
} while (page)

const text = f => (f?.[0]?.text ?? '').trim()
const books = records.map(r => r.fields)
  .filter(f => f['阅读状态'] !== '未开始')
  .map(f => ({
    title: text(f['书名']), author: text(f['作者']), isbn: text(f['ISBN编号']),
    cover: f['封面']?.[0]?.name ?? text(f['书名']) + '.jpg',
    date: new Date(f['首次阅读日期'] + 8 * 3600e3).toISOString().slice(0, 10),
    finished: f['阅读状态'] === '已读完', rating: f['Rating'] ?? null,
    fileToken: f['封面']?.[0]?.file_token,
  }))
  .sort((a, b) => a.date.localeCompare(b.date))

// 旧数据按 isbn+date 优先、退而 isbn 配对（同一本书可能重读出现两条），回填本地维护字段
const { default: OLD } = await import(pathToFileURL(DATA).href)
const used = new Set()
const match = b => {
  let i = OLD.findIndex((o, i) => !used.has(i) && o.isbn === b.isbn && o.date === b.date)
  if (i < 0) i = OLD.findIndex((o, i) => !used.has(i) && o.isbn === b.isbn)
  if (i >= 0) used.add(i)
  return OLD[i]
}

mkdirSync(COVERS, { recursive: true })
const fresh = [], newCover = []
for (const b of books) {
  const old = match(b)
  b.pages = old?.pages ?? null
  b.height = old?.height ?? null
  b.color = old?.color ?? null
  if (!old) {
    fresh.push(b)
    const file = join(COVERS, b.cover)
    if (!existsSync(file) && b.fileToken) {
      const res = await fetch(`https://open.feishu.cn/open-apis/drive/v1/medias/${b.fileToken}/download`,
        { headers: { Authorization: 'Bearer ' + token } })
      if (res.ok) { writeFileSync(file, Buffer.from(await res.arrayBuffer())); newCover.push(b.cover) }
      else console.warn(`封面下载失败 ${b.cover}: ${res.status}`)
    }
    if (b.color == null && existsSync(file)) {
      const { r, g, b: bl } = (await sharp(file).stats()).dominant
      b.color = '#' + [r, g, bl].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase()
    }
  }
  delete b.fileToken
}

const line = b => '  { ' + Object.entries(b).map(([k, v]) => `"${k}": ${JSON.stringify(v)}`).join(', ') + ' }'
writeFileSync(DATA, `// 读书记录数据，同步自飞书多维表格：node tools/sync-books.mjs（新书流程见 docs/add-book.md）
// height 单位 mm；cover 对应 public/books/ 下的封面图
const BOOKS =
[
${books.map(line).join(',\n')}
];

export default BOOKS
`)

console.log(`已写入 ${books.length} 本（原 ${OLD.length} 本）`)
const gone = OLD.filter((_, i) => !used.has(i))
if (gone.length) console.log('飞书里已不存在（已移除）：' + gone.map(b => b.title).join('、'))
if (fresh.length) console.log('新书（pages/height 为 null，按 docs/add-book.md 查后补齐）：' + fresh.map(b => b.title).join('、'))
if (newCover.length) console.log('已从飞书下载封面，记得 node tools/upload-oss.mjs：' + newCover.join('、'))
