import * as THREE from 'three'
import Experience from './Experience.js'
import BOOKS from './World/booksData.js'

// 仿 BIOS 开机自检加载屏（遮罩 DOM 在 index.html 静态标记里，JS 到位前就显示第一行）
// - 真实资源加载日志逐行打印：挂 THREE.DefaultLoadingManager（各模块 loader 都没传自定义
//   manager，天然全走它；Bookshelf 封面懒加载已隔离到私有 manager，不会让进度"复活"）
// - "加载完成"不用 manager.onLoad（GLTF 解析间隙会误触发，且 XPScreen 的截图纹理是在
//   GLB 解析回调里才开始加载的），改等各模块自己暴露的 ready Promise，确定性收口
// - 收口后趁遮罩还盖着画布做 shader 预热：把 currentMix 逐状态钉住各渲染一帧，精确盖住
//   所有"灯数×管线"组合（spot 灯/台灯开关、composer 阈值各对应一整套全场景 shader 变体），
//   否则首次拖日夜滑杆会因全场景 shader 重编译卡一下（用户反馈过；细节与教训见 prewarm）
const LINE_GAP = 90 // 相邻两行的最小间隔 ms：本地缓存秒加载时也保留"逐行自检"的仪式感
const PAD_COL = 44 // 资源行点号补齐到的列宽

export default class Loading {
  constructor() {
    this.experience = new Experience()

    this.root = document.getElementById('bios')
    this.log = document.getElementById('bios-log')
    this.cursor = document.getElementById('bios-cursor')

    this.queue = [] // 待打印项：string 或 async 函数（如内存滚动计数）
    this.pumping = false

    this.setManagerHooks()
    this.pushPostLines()
  }

  /* ---------- 打印队列 ---------- */

  push(item) {
    this.queue.push(item)
    this.pump()
  }

  async pump() {
    if (this.pumping) return
    this.pumping = true
    while (this.queue.length) {
      const item = this.queue.shift()
      if (typeof item === 'function') await item()
      else this.addLine(item)
      await this.delay(LINE_GAP)
    }
    this.pumping = false
  }

  addLine(text) {
    const el = document.createElement('div')
    el.className = 'bios-line'
    el.textContent = text
    this.log.appendChild(el)
    // 行多出屏时向上顶（真 POST 也是滚动的）；overflow:hidden 不挡程序化滚动
    this.root.scrollTop = this.root.scrollHeight
    return el
  }

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  pad(label) {
    const dots = Math.max(2, PAD_COL - label.length)
    return label + ' ' + '.'.repeat(dots) + ' '
  }

  /* ---------- 资源日志：DefaultLoadingManager ---------- */

  setManagerHooks() {
    const manager = THREE.DefaultLoadingManager
    // 同一 GLB 会触发两次 onProgress（文件下载完 + 解析完），去重只打一行；
    // 内嵌贴图（blob:/data: URL，一个 GLB 十几张）合并成一行滚动计数，不刷屏
    const seen = new Set()
    this.embedCount = 0
    this.embedEl = null
    // 大资源走 OSS 后 url 带完整域名，日志只留路径，行宽不爆
    const shortUrl = (url) => url.replace(/^https?:\/\/[^/]+/, '')
    manager.onProgress = (url) => {
      if (/^(blob|data):/.test(url)) {
        this.embedCount++
        // 批量：解码事件成串到达，队列里只挂一个待处理更新（执行时读最新计数），
        // 否则 24 张贴图 × LINE_GAP 白白拖慢开机 2 秒多
        if (!this.embedPending) {
          this.embedPending = true
          this.push(() => {
            this.embedPending = false
            this.updateEmbedLine()
          })
        }
      } else if (!seen.has(url)) {
        seen.add(url)
        this.push(this.pad(`  LOADING ${shortUrl(url)}`) + 'OK')
      }
    }
    manager.onError = (url) => {
      if (!/^(blob|data):/.test(url)) this.push(this.pad(`  LOADING ${shortUrl(url)}`) + 'FAIL')
    }
  }

  updateEmbedLine() {
    if (!this.embedEl) this.embedEl = this.addLine('')
    this.embedEl.textContent = this.pad('  DECODING embedded textures') + `${this.embedCount} OK`
  }

  /* ---------- 开机自检头部 ---------- */

  pushPostLines() {
    // 第一行已由 index.html 静态渲染（HB-BIOS 版权行）
    this.push('Boot Agent : three.js WebGL2')
    this.push(() => this.printGpuLine())
    this.push(() => this.printMemoryTest())
    this.push(() => {
      const { width, height, pixelRatio } = this.experience.sizes
      this.addLine(`Display    : ${width}x${height} @${pixelRatio}x`)
    })
    this.push('')
    this.push('Detecting room assets ...')
  }

  printGpuLine() {
    let gpu = 'Generic VGA'
    try {
      const gl = this.experience.renderer.instance.getContext()
      gpu = gl.getParameter(gl.RENDERER) || gpu
    } catch {
      /* 拿不到就用占位名，不影响开机 */
    }
    this.addLine(`Graphics   : ${gpu}`)
  }

  // 经典 BIOS 内存滚动计数
  async printMemoryTest() {
    const el = this.addLine('Memory     : 0K')
    const total = 262144
    const t0 = performance.now()
    const duration = 650
    while (true) {
      const t = Math.min(1, (performance.now() - t0) / duration)
      el.textContent = `Memory     : ${Math.round(total * t)}K` + (t >= 1 ? ' OK' : '')
      if (t >= 1) break
      await this.delay(30)
    }
  }

  /* ---------- 开机主流程（Experience 里 World 建好后调用） ---------- */

  async start() {
    const world = this.experience.world

    await world.computerZone.ready
    this.push(this.pad('Workstation') + 'READY')

    const props = await (world.deskProps?.ready ?? Promise.resolve({}))
    this.push(this.pad('USB audio device') + (props.headphones ? 'READY' : 'NOT FOUND'))
    this.push(this.pad('Coffee') + (props.mug ? 'HOT' : 'NOT FOUND')) // 经典 BIOS 玩笑：Coffee ... HOT

    await world.tvZone.ready
    this.push(this.pad('TV bench') + 'READY')

    const hasRom = await (world.tvZone.marioTV?.ready ?? Promise.resolve(false))
    this.push(this.pad('NES cartridge') + (hasRom ? 'OK' : 'NOT FOUND'))

    const hasPhoto = await (world.wallPainting?.ready ?? Promise.resolve(false))
    this.push(this.pad('Wall art') + (hasPhoto ? 'OK' : 'NOT FOUND'))

    const volumes = BOOKS.filter((b) => b.finished).length
    this.push(this.pad('Bookshelf') + `${volumes} volumes OK`)

    this.push(() => this.prewarm())
    this.push('')
    this.push('Boot complete. Entering room ...')
    this.push(async () => {
      await this.delay(500)
      this.reveal()
    })
  }

  // 逐状态钉住 currentMix 各渲染一帧，覆盖所有"灯数×管线"组合。灯的 visible 一变
  // （FloorLamp spot >0.00625、DeskGlow 台灯 >0.0385、composer >0.02）全场景就是一套新变体。
  // ⚠️ 教训：旧方案靠自然缓动往返、指望回程"在阈值带内必然多帧停留"，但缓动是
  // min(1, 0.005×delta) 的指数追赶——编译冻结帧的 delta 高达数秒，下一步直接跳到目标值，
  // 把低 mix 的阈值带整个跳过，漏掉的变体全堆到首次真实拖滑杆时爆一次大冻结（实测 3.8s）。
  // 钉步进不受冻结影响：卡多久都只是慢，不会跳步。任何 <0.08 的开关阈值都至少落一帧；
  // 以后新增夜灯若阈值 ≥0.08，在粗段补一步或调低强度阈值
  async prewarm() {
    const el = this.addLine(this.pad('Precompiling day/night pipelines'))
    const env = this.experience.world.environment
    // rAF 与 250ms 超时赛跑：后台标签页 rAF 不发火时照样走完，退化为无预热但绝不卡死开机
    const frame = () =>
      new Promise((resolve) => {
        requestAnimationFrame(resolve)
        setTimeout(resolve, 250)
      })
    // 1 → 0.08 粗步进（×0.7），0.08 → 0 细步进（0.004）
    for (let m = 1; m > 0; m = m > 0.08 ? m * 0.7 : m - 0.004) {
      env.pin(m)
      await frame()
    }
    env.pin(0)
    await frame()
    el.textContent += 'OK'
  }

  reveal() {
    this.root.classList.add('bios-hide')
    // 过渡完从 DOM 摘掉，别让全屏遮罩留着挡指针
    setTimeout(() => this.root.remove(), 800)
  }
}
