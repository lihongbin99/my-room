import * as THREE from 'three'
import { CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js'
import Experience from '../Experience.js'
import { assetUrl } from '../assets.js'

// 显示器里的浏览器版 Windows XP（fork 自 ShizukuIchi/winXP，构建产物在 public/xp/）。
// 两态交互同 MarioTV：默认态屏幕只是一块贴截图纹理的平面（零 DOM 开销），
// 悬停整台显示器出白描边；点击聚焦到屏幕正前方，此时才把 iframe 以 CSS3DObject
// 挂到 CSS3D 层（浮层方案：叠在 canvas 之上，机位正对屏幕、前方无遮挡物，
// 不需要挖洞遮挡），ESC/点屏幕外退出时卸载 iframe、恢复截图。
// 电脑区 GLB 网格无语义名：Object_68 是屏幕面板（零厚度自发光平面），
// Object_66 是显示器机身（描边/命中盒用它）。

const SCREEN_NODE = 'Object_68' // 屏幕面板（Material.017 自发光贴图）
const MONITOR_NODE = 'Object_66' // 显示器机身（含支架）
const SCREEN_LIFT = 0.006 // 截图平面浮出面板，防 z-fighting
const IFRAME_LIFT = 0.004 // iframe 再比截图平面靠前一点
const IFRAME_PX_W = 1280 // iframe 像素宽（高按屏幕比例算），winXP 桌面自适应

const OUTLINE_PAD = 0.06 // 悬停描边外壳比机身包围盒大出的量
const CLICK_SLOP = 7 // 按下/抬起累计位移小于该像素数才算点击（区分拖拽）
const CLICK_SLOP_TOUCH = 12 // 触屏手指抖动大，阈值放宽，否则点按易被误判成拖拽而漏点
const FOCUS_PHI = Math.PI * 0.48 // 聚焦极角：接近平视，略俯
const FOCUS_THETA = 0 // 从 +z 正对后墙上的屏幕
const FOCUS_PAD = 0.12 // 取景时屏幕四周留的余量
const FOCUS_DIST_SCALE = 1.35 // 比"屏幕撑满"稍远：XP 要看清 UI 操作，不像电视要带大量上下文
const FOCUS_MIN_R = 0.8 // 聚焦态滚轮允许凑近到的最小距离

// 开机动画（画在 WebGL 屏幕平面上，相机还在飞就开始播，iframe 加载藏在动画背后）
const BOOT_BLACK_MS = 200 // 点击瞬间先黑一拍——显示器"断电重启"的感觉
const BOOT_MIN_MS = 2400 // 启动画面最短时长：iframe 加载再快，进度条也至少滚满几个来回
const BOOT_HANDOFF_MS = 300 // 进度条结束到桌面亮起之间的黑屏过场
const WAKE_FALLBACK_MS = 900 // 二次进入走"唤醒"（只闪黑），黑屏拖过该时长还没加载完就退回启动画面兜底
const BOOT_MAX_WAIT_MS = 12000 // iframe 迟迟不 load（网络异常）也强制交接，不让进度条滚到天荒地老
const BAR_PERIOD_MS = 1600 // 三格蓝块滚过凹槽一个来回的周期

export default class XPScreen {
  constructor(model) {
    this.experience = new Experience()
    this.scene = this.experience.scene
    this.camera = this.experience.camera
    this.navigation = this.experience.navigation
    this.canvas = this.experience.canvas
    this.css3d = this.experience.css3d
    this.time = this.experience.time

    this.focused = false
    this.cssObject = null
    this.mouse = null
    this.downId = null
    this.wasHovering = false
    this.boot = null // 开机动画状态机（null = 不在开机）
    this.hasBooted = false // 首次全量开机，之后只"唤醒"
    this.iframeLoaded = false

    this.setScreen(model)
    this.setFocusHelpers(model)
    this.setCaption()
    this.setInteraction()
  }

  /* ---------- 默认态屏幕平面（截图纹理） ---------- */

  setScreen(model) {
    const panel = model.getObjectByName(SCREEN_NODE)
    model.updateWorldMatrix(true, true)
    const box = new THREE.Box3().setFromObject(panel)
    const size = box.getSize(new THREE.Vector3())

    this.screenW = size.x
    this.screenH = size.y
    this.screenCenter = box.getCenter(new THREE.Vector3())
    this.screenCenter.z = box.max.z + SCREEN_LIFT

    // 先画一张待机图顶着（XP 开机蓝），public/xp-desktop.webp 加载完再换成真截图
    this.standbyTexture = this.makeStandbyTexture()
    this.material = new THREE.MeshBasicMaterial({ map: this.standbyTexture, toneMapped: false })
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(this.screenW, this.screenH), this.material)
    mesh.position.copy(this.screenCenter)
    this.scene.add(mesh)

    // ready 给 Loading（BIOS 开机屏）收口用；失败留待机图即可，不卡开机
    this.ready = new Promise((resolve) => {
      new THREE.TextureLoader().load(
        assetUrl('/xp-desktop.webp'),
        (texture) => {
          texture.colorSpace = THREE.SRGBColorSpace
          texture.anisotropy = 4
          this.desktopTexture = texture
          if (!this.boot) {
            this.material.map = texture
            this.material.needsUpdate = true
          }
          resolve()
        },
        undefined,
        () => resolve()
      )
    })
  }

  makeStandbyTexture() {
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = Math.round((512 * this.screenH) / this.screenW)
    const g = canvas.getContext('2d')
    const { width: w, height: h } = canvas
    const grad = g.createLinearGradient(0, 0, 0, h)
    grad.addColorStop(0, '#245edb')
    grad.addColorStop(1, '#0c327c')
    g.fillStyle = grad
    g.fillRect(0, 0, w, h)
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillStyle = '#fff'
    g.font = `italic 700 ${Math.round(h * 0.14)}px Georgia, serif`
    g.fillText('Windows XP', w / 2, h * 0.46)
    g.fillStyle = 'rgba(255,255,255,.6)'
    g.font = `${Math.round(h * 0.06)}px "Microsoft YaHei", sans-serif`
    g.fillText('点击开机', w / 2, h * 0.62)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    return texture
  }

  /* ---------- 悬停描边 + 命中检测（对整台显示器） ---------- */

  setFocusHelpers(model) {
    const body = model.getObjectByName(MONITOR_NODE)
    const box = new THREE.Box3().setFromObject(body)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())

    this.hullMesh = new THREE.Mesh(
      new THREE.BoxGeometry(size.x, size.y, size.z),
      new THREE.MeshBasicMaterial({ visible: false })
    )
    this.hullMesh.position.copy(center)
    this.scene.add(this.hullMesh)

    // 白描边外壳（背面法），往前挪半个 pad 不陷进墙
    this.outlineMesh = new THREE.Mesh(
      new THREE.BoxGeometry(size.x + OUTLINE_PAD, size.y + OUTLINE_PAD, size.z + OUTLINE_PAD),
      new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide, toneMapped: false })
    )
    this.outlineMesh.position.copy(center)
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

  /* ---------- 操作提示 ---------- */

  setCaption() {
    const style = document.createElement('style')
    style.textContent = `
      .xp-caption {
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
      .xp-caption.show { opacity: 1; transform: translateX(-50%); }
    `
    document.head.appendChild(style)

    this.caption = document.createElement('div')
    this.caption.className = 'xp-caption'
    this.caption.textContent = '在屏幕里用鼠标操作 · ESC 或点击屏幕外离开'
    document.body.appendChild(this.caption)
  }

  /* ---------- 交互 ---------- */

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
        // 默认态：点到显示器 → 聚焦（导航已被别的区聚焦时不抢）
        if (!this.navigation.savedView && this.raycastHull(event.clientX, event.clientY)) {
          this.enterFocus()
        }
      } else if (!this.raycastHull(event.clientX, event.clientY)) {
        // 聚焦态：点到显示器外 → 退出（点在 iframe 里的事件到不了 canvas，不会误触）
        this.exitFocus()
      }
    }
    this.canvas.addEventListener('pointerup', onPointerUp)
    this.canvas.addEventListener('pointercancel', onPointerUp)

    this.onEscape = (event) => {
      if (this.focused && event.key === 'Escape') this.exitFocus()
    }
    document.addEventListener('keydown', this.onEscape)
  }

  /* ---------- 聚焦：挂 iframe / 退出：卸载 ---------- */

  enterFocus() {
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
    this.mountIframe() // 立即开始后台加载，藏在开机动画背后
    this.startBoot()
  }

  exitFocus() {
    this.navigation.blur()
    this.focused = false
    this.caption.classList.remove('show')
    this.stopBoot() // 开机演到一半退出也直接回截图——出场必须瞬时，不演关机
    this.unmountIframe()
  }

  mountIframe() {
    if (this.cssObject) return
    const pxW = IFRAME_PX_W
    const pxH = Math.round((pxW * this.screenH) / this.screenW)

    const wrapper = document.createElement('div')
    wrapper.style.width = `${pxW}px`
    wrapper.style.height = `${pxH}px`
    wrapper.style.pointerEvents = 'auto' // CSS3D 容器是 none，只有 iframe 区域接事件
    wrapper.style.background = 'linear-gradient(#245edb, #0c327c)' // reveal 时 iframe 万一还没画出来，透出 XP 蓝而不是黑
    wrapper.style.visibility = 'hidden' // 开机动画期间藏着，revealIframe() 才亮

    const iframe = document.createElement('iframe')
    iframe.src = '/xp/index.html'
    iframe.style.width = '100%'
    iframe.style.height = '100%'
    iframe.style.border = '0'
    iframe.style.display = 'block'
    wrapper.appendChild(iframe)

    // iframe 抢走键盘焦点后，父页面收不到 keydown——同源，把 ESC 监听挂进去
    this.iframeLoaded = false
    iframe.addEventListener('load', () => {
      this.iframeLoaded = true // 开机动画的交接门闩
      try {
        iframe.contentWindow.addEventListener('keydown', this.onEscape)
      } catch {
        /* 跨源时静默放弃，仍可点屏幕外退出 */
      }
    })

    this.cssObject = new CSS3DObject(wrapper)
    this.cssObject.position.copy(this.screenCenter)
    this.cssObject.position.z += IFRAME_LIFT
    this.cssObject.scale.setScalar(this.screenW / pxW)
    this.css3d.scene.add(this.cssObject)
  }

  unmountIframe() {
    if (!this.cssObject) return
    this.css3d.scene.remove(this.cssObject)
    this.cssObject.element.remove() // CSS3DRenderer 不会自己清 DOM
    this.cssObject = null
    this.iframeLoaded = false
  }

  /* ---------- 开机动画（CanvasTexture 画在屏幕平面上） ---------- */

  // 时序：black（黑一拍）→ bar（XP 标志 + 三格蓝块滚动，等 iframe load 且滚够 BOOT_MIN_MS）
  // → handoff（黑屏过场）→ revealIframe。二次进入只走 black"唤醒"，拖太久退回 bar 兜底。
  startBoot() {
    if (!this.bootTexture) this.makeBootAssets()
    this.boot = { phase: 'black', t0: this.time.elapsed, full: !this.hasBooted }
    this.material.map = this.bootTexture
    this.material.needsUpdate = true
  }

  stopBoot() {
    if (!this.boot) return
    this.boot = null
    this.material.map = this.desktopTexture ?? this.standbyTexture
    this.material.needsUpdate = true
  }

  revealIframe() {
    this.boot = null
    this.hasBooted = true
    // 平面回到桌面截图：iframe 盖着看不见，但退出聚焦那一刻露出的就是桌面，不闪回启动画面
    this.material.map = this.desktopTexture ?? this.standbyTexture
    this.material.needsUpdate = true
    if (this.cssObject) this.cssObject.element.style.visibility = ''
  }

  setBootPhase(phase) {
    this.boot.phase = phase
    this.boot.t0 = this.time.elapsed
  }

  updateBoot() {
    const boot = this.boot
    const t = this.time.elapsed - boot.t0
    if (boot.phase === 'black') {
      if (boot.full) {
        if (t >= BOOT_BLACK_MS) this.setBootPhase('bar')
      } else if (this.iframeLoaded && t >= BOOT_BLACK_MS) {
        this.revealIframe() // 唤醒：闪一下黑就亮桌面
        return
      } else if (t >= WAKE_FALLBACK_MS) {
        this.setBootPhase('bar') // 唤醒等太久，退回启动画面，绝不停在死黑屏
      }
    } else if (boot.phase === 'bar') {
      if ((this.iframeLoaded && t >= BOOT_MIN_MS) || t >= BOOT_MAX_WAIT_MS) this.setBootPhase('handoff')
    } else if (boot.phase === 'handoff') {
      if (t >= BOOT_HANDOFF_MS) {
        this.revealIframe()
        return
      }
    }
    this.drawBootFrame()
    this.bootTexture.needsUpdate = true
  }

  makeBootAssets() {
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = Math.round((512 * this.screenH) / this.screenW)
    this.bootCanvas = canvas
    this.bootCtx = canvas.getContext('2d')
    this.bootTexture = new THREE.CanvasTexture(canvas)
    this.bootTexture.colorSpace = THREE.SRGBColorSpace
    this.bootLogo = this.makeBootLogo(canvas.height)
  }

  // 标志是静态的，离线画一张，每帧只 blit——逐帧重排文字纯浪费
  makeBootLogo(screenH) {
    const canvas = document.createElement('canvas')
    const g = canvas.getContext('2d')

    const winFont = `italic 700 ${Math.round(screenH * 0.15)}px Tahoma, Verdana, sans-serif`
    const xpFont = `italic 700 ${Math.round(screenH * 0.1)}px Tahoma, Verdana, sans-serif`
    const msFont = `${Math.round(screenH * 0.05)}px Tahoma, Verdana, sans-serif`
    g.font = winFont
    const winW = g.measureText('Windows').width
    g.font = xpFont
    const xpW = g.measureText('xp').width

    const s = Math.round(screenH * 0.09) // 旗子单格边长
    const gap = Math.round(s * 0.14)
    const flagW = s * 2 + gap
    const pad = Math.round(s * 0.5)
    canvas.width = Math.ceil(flagW + pad + winW + xpW * 1.15)
    canvas.height = Math.ceil(screenH * 0.3)

    const midY = canvas.height * 0.58
    const flagY = midY - flagW / 2
    for (const [i, color] of ['#f25022', '#7fba00', '#00a4ef', '#ffb900'].entries()) {
      g.fillStyle = color
      g.beginPath()
      g.roundRect((i % 2) * (s + gap), flagY + Math.floor(i / 2) * (s + gap), s, s, s * 0.18)
      g.fill()
    }

    const textX = flagW + pad
    g.textBaseline = 'alphabetic'
    g.fillStyle = '#fff'
    g.font = msFont
    g.fillText('Microsoft', textX + s * 0.1, flagY + s * 0.55)
    g.font = winFont
    g.fillText('Windows', textX, midY + flagW / 2)
    g.fillStyle = '#ff8c00'
    g.font = xpFont
    g.fillText('xp', textX + winW + xpW * 0.12, midY + flagW / 2 - screenH * 0.075)
    return canvas
  }

  drawBootFrame() {
    const g = this.bootCtx
    const { width: w, height: h } = this.bootCanvas
    g.fillStyle = '#000'
    g.fillRect(0, 0, w, h)
    if (this.boot.phase !== 'bar') return // black/handoff 阶段就是纯黑

    g.drawImage(this.bootLogo, Math.round((w - this.bootLogo.width) / 2), Math.round(h * 0.3))

    // 进度凹槽 + 三格蓝块循环（块队列从槽左端外滑进、右端滑出，裁剪在槽内）
    const slotW = Math.round(w * 0.3)
    const slotH = Math.round(h * 0.05)
    const slotX = Math.round((w - slotW) / 2)
    const slotY = Math.round(h * 0.7)
    g.strokeStyle = '#7f7f7f'
    g.lineWidth = 2
    g.beginPath()
    g.roundRect(slotX, slotY, slotW, slotH, slotH * 0.4)
    g.stroke()

    const bw = slotH * 0.85
    const bGap = bw * 0.25
    const trainW = bw * 3 + bGap * 2
    const p = ((this.time.elapsed - this.boot.t0) % BAR_PERIOD_MS) / BAR_PERIOD_MS
    const trainX = slotX - trainW + p * (slotW + trainW)
    g.save()
    g.beginPath()
    g.roundRect(slotX + 2, slotY + 2, slotW - 4, slotH - 4, slotH * 0.3)
    g.clip()
    const grad = g.createLinearGradient(0, slotY, 0, slotY + slotH)
    grad.addColorStop(0, '#8fb3f5')
    grad.addColorStop(0.5, '#2b53ce')
    grad.addColorStop(1, '#1b3a99')
    g.fillStyle = grad
    for (let i = 0; i < 3; i++) {
      g.beginPath()
      g.roundRect(trainX + i * (bw + bGap), slotY + 3, bw, slotH - 6, 2)
      g.fill()
    }
    g.restore()

    g.fillStyle = '#7f7f7f'
    g.font = `${Math.round(h * 0.035)}px Tahoma, Verdana, sans-serif`
    g.textBaseline = 'alphabetic'
    g.fillText('Copyright © Microsoft Corporation', w * 0.04, h * 0.95)
    const msW = g.measureText('Microsoft').width
    g.fillText('Microsoft', w * 0.96 - msW, h * 0.95)
  }

  /* ---------- 逐帧 ---------- */

  update() {
    if (this.boot) this.updateBoot()

    // 夜里屏幕渐亮到 1.35（>Bloom 阈值 1.15，微微泛光——"暗房里屏幕在发光"）
    const mix = this.experience.world?.environment?.currentMix ?? 0
    this.material.color.setScalar(THREE.MathUtils.lerp(1.0, 1.35, mix))

    // 默认态悬停描边（导航被任何区聚焦时都不响应）
    if (this.mouse && this.downId === null && !this.focused) {
      const hovering = !this.navigation.savedView && this.raycastHull(this.mouse.x, this.mouse.y)
      this.outlineMesh.visible = hovering
      if (hovering) this.canvas.style.cursor = 'pointer'
      else if (this.wasHovering) this.canvas.style.cursor = ''
      this.wasHovering = hovering
    }
  }
}
