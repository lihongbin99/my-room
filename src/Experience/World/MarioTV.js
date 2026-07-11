import * as THREE from 'three'
import Experience from '../Experience.js'

// 电视里可玩的 NES 马里奥：jsnes 模拟器输出到离屏 canvas，再以 CanvasTexture
// 贴到电视屏幕位置的平面上——不走 CSS3D，画面就是场景里的一块 mesh，有"真电视"感。
// 进页面就自动启动模拟器：电视默认播着标题画面/演示（静音、无输入，像家里开着的电视）；
// 两态交互仿 Bookshelf：默认态悬停白描边、点击聚焦到屏幕正前方，此时才开声音 +
// 键盘转发给 NES（←→ 移动、X 跳、Z 跑/火球、Enter 开始），点屏幕外/ESC 退出（静音继续播）。
// ROM 不进仓库（.gitignore 排除，部署记得带上）：public/roms/mario.nes，缺失时屏幕给提示。

const ROM_URL = '/roms/mario.nes'
const NES_W = 256
const NES_H = 240
const NES_FRAME_MS = 1000 / 60.0988 // NES 实机帧率，模拟器按累计时间步进（高刷屏不加速）
const MAX_CATCHUP_MS = 100 // 卡顿后最多补这么多帧的量，防"死亡螺旋"

const SCREEN_INSET = { x: 0.045, top: 0.055, bottom: 0.075 } // 屏幕相对面板包围盒的内缩（边框占比）
const SCREEN_LIFT = 0.006 // 屏幕面浮出面板前表面，防 z-fighting
const CANVAS_H = 480 // 屏幕画布高度（宽按屏幕比例算），NES 画面 4:3 居中、两侧黑边

const OUTLINE_PAD = 0.08 // 悬停描边外壳比电视包围盒大出的量
const CLICK_SLOP = 7 // 按下/抬起累计位移小于该像素数才算点击（区分拖拽）
const CLICK_SLOP_TOUCH = 12 // 触屏手指抖动大，阈值放宽，否则点按易被误判成拖拽而漏点
const FOCUS_PHI = Math.PI * 0.47 // 聚焦极角：比屏幕中心略高一点俯视，过渡不那么陡
const FOCUS_THETA = 0 // 聚焦方位角：从 +z 正对后墙上的屏幕
const FOCUS_PAD = 0.15 // 取景时屏幕四周留的余量
const FOCUS_DIST_SCALE = 2.2 // 机位比"屏幕撑满"远这么多倍——带出电视柜/墙面等上下文，
// 不然满屏全是游戏画面像被传送进另一个空间（用户反馈过）；想凑近滚轮拉
const FOCUS_MIN_R = 1.2 // 聚焦态滚轮允许凑近到的最小距离

// 键位 → jsnes Controller 按钮名（Controller 常量要等动态 import 后才拿得到）
const KEY_BUTTONS = {
  ArrowUp: 'BUTTON_UP',
  ArrowDown: 'BUTTON_DOWN',
  ArrowLeft: 'BUTTON_LEFT',
  ArrowRight: 'BUTTON_RIGHT',
  KeyX: 'BUTTON_A',
  KeyK: 'BUTTON_A',
  KeyZ: 'BUTTON_B',
  KeyJ: 'BUTTON_B',
  Enter: 'BUTTON_START',
  ShiftLeft: 'BUTTON_SELECT',
  ShiftRight: 'BUTTON_SELECT',
}

export default class MarioTV {
  constructor(tvModel) {
    this.experience = new Experience()
    this.scene = this.experience.scene
    this.time = this.experience.time
    this.camera = this.experience.camera
    this.navigation = this.experience.navigation
    this.canvas = this.experience.canvas

    this.focused = false
    this.running = false // 聚焦且模拟器该走帧
    this.nes = null
    this.jsnes = null
    this.loading = false
    this.frameAcc = 0
    this.frameDirty = false
    this.pressed = new Set() // 记录按下的键，退出聚焦时统一松开
    this.mouse = null
    this.downId = null
    this.wasHovering = false

    this.setScreen(tvModel)
    this.setFocusHelpers(tvModel)
    this.setCaption()
    this.setInteraction()
    // ready 给 Loading（BIOS 开机屏）收口用：resolve(true)=ROM 就绪，false=NO CARTRIDGE
    this.ready = new Promise((resolve) => {
      this.bootResolve = resolve
    })
    this.initEmulator() // 进页面就开机：默认态电视播标题画面/演示
  }

  /* ---------- 屏幕平面 + 各状态画面 ---------- */

  setScreen(tvModel) {
    // 屏幕范围按电视面板（TVFlatScreen）的世界包围盒内缩出来
    const panel = tvModel.getObjectByName('TVFlatScreen') || tvModel
    const box = new THREE.Box3().setFromObject(panel)
    const size = box.getSize(new THREE.Vector3())

    this.screenW = size.x * (1 - SCREEN_INSET.x * 2)
    this.screenH = size.y * (1 - SCREEN_INSET.top - SCREEN_INSET.bottom)
    this.screenCenter = new THREE.Vector3(
      (box.min.x + box.max.x) / 2,
      box.min.y + size.y * SCREEN_INSET.bottom + this.screenH / 2,
      box.max.z + SCREEN_LIFT
    )

    // 屏幕画布：比例同屏幕平面，NES 画面按 4:3 居中绘制
    this.screenCanvas = document.createElement('canvas')
    this.screenCanvas.height = CANVAS_H
    this.screenCanvas.width = Math.round((CANVAS_H * this.screenW) / this.screenH)
    this.screenCtx = this.screenCanvas.getContext('2d')
    this.screenCtx.imageSmoothingEnabled = false // NES 像素放大保持锐利
    this.drawStandby()

    this.texture = new THREE.CanvasTexture(this.screenCanvas)
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.texture.anisotropy = 4

    // 屏幕自己发光（不吃场景光照），toneMapped 关掉保持画面原色
    this.screenMaterial = new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false })
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(this.screenW, this.screenH), this.screenMaterial)
    mesh.position.copy(this.screenCenter)
    this.scene.add(mesh)

    // NES 原始帧的中转画布：onFrame 的像素先写进 ImageData，再放大画到屏幕画布
    this.nesCanvas = document.createElement('canvas')
    this.nesCanvas.width = NES_W
    this.nesCanvas.height = NES_H
    this.nesCtx = this.nesCanvas.getContext('2d')
    this.nesImage = this.nesCtx.createImageData(NES_W, NES_H)
    const buf = new ArrayBuffer(this.nesImage.data.length)
    this.nesBuf8 = new Uint8ClampedArray(buf)
    this.nesBuf32 = new Uint32Array(buf)
  }

  // 开机画面：暗屏 + 文案（ROM 加载的瞬间可见，加载完就被游戏画面覆盖）
  drawStandby() {
    const g = this.screenCtx
    const { width: w, height: h } = this.screenCanvas
    const grad = g.createRadialGradient(w / 2, h / 2, h * 0.1, w / 2, h / 2, h * 0.9)
    grad.addColorStop(0, '#1a2030')
    grad.addColorStop(1, '#05070d')
    g.fillStyle = grad
    g.fillRect(0, 0, w, h)
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillStyle = '#e8e2d0'
    g.font = `700 ${Math.round(h * 0.1)}px "Courier New", monospace`
    g.fillText('NOW LOADING…', w / 2, h * 0.44)
    g.fillStyle = 'rgba(232,226,208,.45)'
    g.font = `${Math.round(h * 0.06)}px "Microsoft YaHei", sans-serif`
    g.fillText('SUPER MARIO · NES', w / 2, h * 0.6)
  }

  // ROM 缺失/加载失败：复古蓝屏提示
  drawMissingRom() {
    const g = this.screenCtx
    const { width: w, height: h } = this.screenCanvas
    g.fillStyle = '#1533ad'
    g.fillRect(0, 0, w, h)
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillStyle = '#fff'
    g.font = `700 ${Math.round(h * 0.09)}px "Courier New", monospace`
    g.fillText('NO CARTRIDGE', w / 2, h * 0.38)
    g.font = `${Math.round(h * 0.055)}px "Microsoft YaHei", sans-serif`
    g.fillText('把 mario.nes 放入 public/roms/ 后刷新', w / 2, h * 0.56)
    this.texture.needsUpdate = true
  }

  /* ---------- 悬停描边 + 命中检测（对整台电视） ---------- */

  setFocusHelpers(tvModel) {
    const box = new THREE.Box3().setFromObject(tvModel)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())

    // 命中盒：默认态悬停/点击、聚焦态"点没点在电视上"都对它做射线检测
    this.hullMesh = new THREE.Mesh(
      new THREE.BoxGeometry(size.x, size.y, size.z),
      new THREE.MeshBasicMaterial({ visible: false })
    )
    this.hullMesh.position.copy(center)
    this.scene.add(this.hullMesh)

    // 白描边外壳（同 Bookshelf 的背面法），往前上各挪半个 pad，不陷进墙和柜面
    this.outlineMesh = new THREE.Mesh(
      new THREE.BoxGeometry(size.x + OUTLINE_PAD, size.y + OUTLINE_PAD, size.z + OUTLINE_PAD),
      new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide, toneMapped: false })
    )
    this.outlineMesh.position.copy(center)
    this.outlineMesh.position.y += OUTLINE_PAD / 2
    this.outlineMesh.position.z += OUTLINE_PAD / 2 + 0.01
    this.outlineMesh.visible = false
    this.scene.add(this.outlineMesh)
  }

  raycastHull(x, y) {
    const sizes = this.experience.sizes
    this.ndc.set((x / sizes.width) * 2 - 1, -(y / sizes.height) * 2 + 1)
    this.raycaster.setFromCamera(this.ndc, this.camera.instance)
    return this.raycaster.intersectObject(this.hullMesh, false).length > 0
  }

  /* ---------- 操作提示（聚焦时底部弹出，样式随 Bookshelf 的说明卡） ---------- */

  setCaption() {
    const style = document.createElement('style')
    style.textContent = `
      .tv-caption {
        position: fixed;
        left: 50%;
        bottom: 28px;
        transform: translateX(-50%) translateY(10px);
        padding: 10px 20px;
        border-radius: 14px;
        background: rgba(20, 16, 32, 0.55);
        backdrop-filter: blur(8px);
        border: 1px solid rgba(255, 255, 255, 0.12);
        color: rgba(255,255,255,.85);
        font-size: 13px;
        opacity: 0;
        transition: opacity .25s, transform .25s;
        pointer-events: none;
        user-select: none;
        z-index: 10;
        font-family: "Microsoft YaHei", "PingFang SC", sans-serif;
      }
      .tv-caption.show { opacity: 1; transform: translateX(-50%); }
    `
    document.head.appendChild(style)

    this.caption = document.createElement('div')
    this.caption.className = 'tv-caption'
    this.caption.textContent = '← → 移动 · X 跳 · Z 跑/火球 · Enter 开始 · ESC 离开'
    document.body.appendChild(this.caption)
  }

  /* ---------- 交互：点击聚焦 / 键盘转发 / 退出 ---------- */

  setInteraction() {
    this.raycaster = new THREE.Raycaster()
    this.ndc = new THREE.Vector2()

    this.canvas.addEventListener('pointerdown', (event) => {
      if (this.downId !== null) return
      this.downId = event.pointerId
      this.moved = 0
      this.clickSlop = event.pointerType === 'mouse' ? CLICK_SLOP : CLICK_SLOP_TOUCH
      this.pointerX = event.clientX
      this.pointerY = event.clientY
    })

    this.canvas.addEventListener('pointermove', (event) => {
      if (event.pointerType === 'mouse') this.mouse = { x: event.clientX, y: event.clientY }
      if (this.downId !== event.pointerId) return
      this.moved += Math.abs(event.clientX - this.pointerX) + Math.abs(event.clientY - this.pointerY)
      this.pointerX = event.clientX
      this.pointerY = event.clientY
    })

    const onPointerUp = (event) => {
      if (this.downId !== event.pointerId) return
      this.downId = null
      // pointercancel（触屏被系统手势/来电打断）只收尾不算点击
      if (event.type === 'pointercancel' || this.moved >= this.clickSlop) return
      if (!this.focused) {
        // 默认态：点到电视 → 聚焦（导航已被别的区聚焦时不抢）
        if (!this.navigation.savedView && this.raycastHull(event.clientX, event.clientY)) {
          this.enterFocus()
        }
      } else if (!this.raycastHull(event.clientX, event.clientY)) {
        // 聚焦态：点到电视外 → 退出
        this.exitFocus()
      }
    }
    this.canvas.addEventListener('pointerup', onPointerUp)
    this.canvas.addEventListener('pointercancel', onPointerUp)

    document.addEventListener('keydown', (event) => {
      if (!this.focused) return
      if (event.key === 'Escape') {
        this.exitFocus()
        return
      }
      this.forwardKey(event, true)
    })
    document.addEventListener('keyup', (event) => {
      if (this.focused) this.forwardKey(event, false)
    })
  }

  forwardKey(event, down) {
    const name = KEY_BUTTONS[event.code]
    if (!name || !this.nes) return
    event.preventDefault() // 方向键别滚动页面
    if (event.repeat) return
    const button = this.jsnes.Controller[name]
    if (down) {
      this.nes.buttonDown(1, button)
      this.pressed.add(name)
    } else {
      this.nes.buttonUp(1, button)
      this.pressed.delete(name)
    }
  }

  releaseButtons() {
    if (this.nes) {
      for (const name of this.pressed) this.nes.buttonUp(1, this.jsnes.Controller[name])
    }
    this.pressed.clear()
  }

  /* ---------- 聚焦 ---------- */

  enterFocus() {
    // 取景距离：先算"屏幕撑满"的距离，再拉远留出房间上下文；滚轮可再凑近
    const camera = this.camera.instance
    const fovTan = Math.tan((camera.fov * Math.PI) / 360)
    const fitH = (this.screenH / 2 + FOCUS_PAD) / fovTan
    const fitW = (this.screenW / 2 + FOCUS_PAD) / (fovTan * camera.aspect)
    const radius = Math.max(fitH, fitW) * FOCUS_DIST_SCALE
    const c = this.screenCenter

    this.navigation.focus({
      target: c,
      radius,
      phi: FOCUS_PHI,
      theta: FOCUS_THETA,
      limits: {
        radius: { min: FOCUS_MIN_R, max: radius }, // 滚轮可凑近
        phi: { min: FOCUS_PHI, max: FOCUS_PHI },
        theta: { min: FOCUS_THETA, max: FOCUS_THETA },
        x: { min: c.x, max: c.x },
        y: { min: c.y, max: c.y },
        z: { min: c.z, max: c.z },
      },
    })

    this.focused = true
    this.outlineMesh.visible = false
    this.canvas.style.cursor = ''
    this.caption.classList.add('show')
    this.initEmulator() // 之前加载失败（比如后放的 ROM）就再试一次
    if (this.audioCtx) {
      this.audioRead = this.audioWrite // 丢掉挂起期间积压的旧采样，避免开声一瞬的杂音
      this.audioCtx.resume() // 点击是用户手势，这里 resume 合法
    }
  }

  exitFocus() {
    this.navigation.blur()
    this.focused = false
    this.releaseButtons()
    this.caption.classList.remove('show')
    if (this.audioCtx) this.audioCtx.suspend() // 退出只静音，游戏继续播（真电视感）
  }

  /* ---------- 模拟器 ---------- */

  async initEmulator() {
    if (this.nes || this.loading) return

    this.loading = true
    try {
      const [module, rom] = await Promise.all([
        import('jsnes'),
        fetch(ROM_URL).then((res) => {
          if (!res.ok) throw new Error(`ROM ${res.status}`)
          return res.arrayBuffer()
        }),
      ])
      this.jsnes = module.default ?? module
      this.setAudio() // 页面加载时创建的 AudioContext 是挂起态（无手势不出声），但能先拿到真实采样率
      this.nes = new this.jsnes.NES({
        onFrame: (frameBuffer) => {
          // frameBuffer 是 256×240 的 0xBBGGRR 整数；补上 alpha 写进小端 ABGR 视图
          for (let i = 0; i < frameBuffer.length; i++) {
            this.nesBuf32[i] = 0xff000000 | frameBuffer[i]
          }
          this.frameDirty = true
        },
        onAudioSample: (left, right) => this.pushAudio(left, right),
        sampleRate: this.audioCtx ? this.audioCtx.sampleRate : 44100,
      })

      // jsnes 要二进制字符串
      const bytes = new Uint8Array(rom)
      let bin = ''
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
      this.nes.loadROM(bin)
      this.running = true // 常开：不聚焦也一直播（静音）
      this.frameAcc = 0
      this.bootResolve?.(true)
    } catch (error) {
      console.warn('NES 启动失败：', error)
      this.nes = null
      this.running = false
      this.drawMissingRom()
      this.bootResolve?.(false)
    } finally {
      this.loading = false
      this.bootResolve = null // 聚焦时可能重试 initEmulator，只对首次结果收口
    }
  }

  // 音频：环形缓冲对接 ScriptProcessor（够用且简单；饿了补静音、满了丢样本）
  setAudio() {
    if (this.audioCtx) return
    try {
      this.audioCtx = new AudioContext()
      const N = 8192
      this.audioL = new Float32Array(N)
      this.audioR = new Float32Array(N)
      this.audioWrite = 0
      this.audioRead = 0
      this.scriptNode = this.audioCtx.createScriptProcessor(1024, 0, 2)
      this.scriptNode.onaudioprocess = (e) => {
        const l = e.outputBuffer.getChannelData(0)
        const r = e.outputBuffer.getChannelData(1)
        for (let i = 0; i < l.length; i++) {
          if (this.audioRead === this.audioWrite) {
            l[i] = 0
            r[i] = 0
            continue
          }
          l[i] = this.audioL[this.audioRead]
          r[i] = this.audioR[this.audioRead]
          this.audioRead = (this.audioRead + 1) % N
        }
      }
      this.scriptNode.connect(this.audioCtx.destination)
    } catch {
      this.audioCtx = null // 没声也能玩
    }
  }

  pushAudio(left, right) {
    if (!this.audioCtx || !this.running) return
    const N = this.audioL.length
    const next = (this.audioWrite + 1) % N
    if (next === this.audioRead) return
    this.audioL[this.audioWrite] = left
    this.audioR[this.audioWrite] = right
    this.audioWrite = next
  }

  // 把最新 NES 帧画到屏幕画布：4:3 居中，两侧黑边
  blitFrame() {
    this.nesImage.data.set(this.nesBuf8)
    this.nesCtx.putImageData(this.nesImage, 0, 0)
    const { width: w, height: h } = this.screenCanvas
    const destH = h
    const destW = Math.min(w, Math.round((h * 4) / 3))
    const g = this.screenCtx
    g.fillStyle = '#000'
    g.fillRect(0, 0, w, h)
    g.drawImage(this.nesCanvas, Math.round((w - destW) / 2), 0, destW, destH)
    this.texture.needsUpdate = true
    this.frameDirty = false
  }

  /* ---------- 逐帧 ---------- */

  update() {
    // 夜里屏幕渐亮到 1.35（>Bloom 阈值 1.15，微微泛光——"暗房里电视在发光"）
    const mix = this.experience.world?.environment?.currentMix ?? 0
    this.screenMaterial.color.setScalar(THREE.MathUtils.lerp(1.0, 1.35, mix))

    // 默认态悬停描边（导航被任何区聚焦时都不响应）
    if (this.mouse && this.downId === null && !this.focused) {
      const hovering = !this.navigation.savedView && this.raycastHull(this.mouse.x, this.mouse.y)
      this.outlineMesh.visible = hovering
      if (hovering) this.canvas.style.cursor = 'pointer'
      else if (this.wasHovering) this.canvas.style.cursor = ''
      this.wasHovering = hovering
    }

    // 模拟器按 NES 实机帧率步进（与显示器刷新率解耦）
    if (this.running && this.nes) {
      this.frameAcc = Math.min(this.frameAcc + this.time.delta, MAX_CATCHUP_MS)
      while (this.frameAcc >= NES_FRAME_MS) {
        this.nes.frame()
        this.frameAcc -= NES_FRAME_MS
      }
      if (this.frameDirty) this.blitFrame()
    }
  }
}
