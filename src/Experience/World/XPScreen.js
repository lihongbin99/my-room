import * as THREE from 'three'
import { CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js'
import Experience from '../Experience.js'

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
const FOCUS_PHI = Math.PI * 0.48 // 聚焦极角：接近平视，略俯
const FOCUS_THETA = 0 // 从 +z 正对后墙上的屏幕
const FOCUS_PAD = 0.12 // 取景时屏幕四周留的余量
const FOCUS_DIST_SCALE = 1.35 // 比"屏幕撑满"稍远：XP 要看清 UI 操作，不像电视要带大量上下文
const FOCUS_MIN_R = 0.8 // 聚焦态滚轮允许凑近到的最小距离

export default class XPScreen {
  constructor(model) {
    this.experience = new Experience()
    this.scene = this.experience.scene
    this.camera = this.experience.camera
    this.navigation = this.experience.navigation
    this.canvas = this.experience.canvas
    this.css3d = this.experience.css3d

    this.focused = false
    this.cssObject = null
    this.mouse = null
    this.downId = null
    this.wasHovering = false

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
    this.material = new THREE.MeshBasicMaterial({ map: this.makeStandbyTexture(), toneMapped: false })
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(this.screenW, this.screenH), this.material)
    mesh.position.copy(this.screenCenter)
    this.scene.add(mesh)

    new THREE.TextureLoader().load('/xp-desktop.webp', (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace
      texture.anisotropy = 4
      this.material.map = texture
      this.material.needsUpdate = true
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
      if (this.moved >= CLICK_SLOP) return
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
    this.mountIframe()
  }

  exitFocus() {
    this.navigation.blur()
    this.focused = false
    this.caption.classList.remove('show')
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
    wrapper.style.background = '#000'

    const iframe = document.createElement('iframe')
    iframe.src = '/xp/index.html'
    iframe.style.width = '100%'
    iframe.style.height = '100%'
    iframe.style.border = '0'
    iframe.style.display = 'block'
    wrapper.appendChild(iframe)

    // iframe 抢走键盘焦点后，父页面收不到 keydown——同源，把 ESC 监听挂进去
    iframe.addEventListener('load', () => {
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
  }

  /* ---------- 逐帧 ---------- */

  update() {
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
