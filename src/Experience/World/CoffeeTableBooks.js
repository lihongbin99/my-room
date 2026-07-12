import * as THREE from 'three'
import Experience from '../Experience.js'
import BOOKS from './booksData.js'
import { assetUrl } from '../assets.js'

// 茶几上"正在读"的那本书：booksData 里 finished:false 且开始日期最新的一本
// （用户约定同时只在读一本，其余 finished:false 是搁置的"未读完"，不上桌）。
// 平放、封面朝上、书顶朝 -z（从默认相机看封面是正的）、书脊在 -x 侧。
//
// 交互与书架取书同款（动画三段照搬 Bookshelf.heldFrame）：悬停微微抬起、
// 点击取书（向上提起 → 飞到镜头前 → 拖拽翻转 → 点击/ESC 放回）。要点：
// - 几何与书架的书同构（x=宽 y=高 z=厚、封面 +z、书脊 -x），平放姿态全靠
//   homeQuat 拧出来，取书后 slerp 回单位四元数正好是"立起面向镜头"
// - 取书期间借用 Navigation.focus() 占住 savedView——相机原地不动，只为让
//   别的区按互斥约定（查 savedView）不响应点击；enabled=false 把拖拽让给
//   翻书。放回完成时 blur() 一并恢复视角/限位/enabled
// - 封面图用私有 LoadingManager 加载（不走 DefaultLoadingManager，不让 BIOS
//   日志复活），失败退回程序化封面；说明卡复用 Bookshelf 的（样式/DOM 只建一份）
// 由 TVZone 在茶几摆好后实例化（要用运行时实测的大理石桌面高度）。
const SPOT = { dx: -0.08, dz: -0.18 } // 相对茶几中心的偏移（右前是手柄、左前是水杯）
const TILT = 0.12 // 摆放的小转角，不那么刻意
const HOVER_LIFT = 0.05 // 悬停抬起量
const PULL_UP = 0.4 // 取书第一段向上提起的距离
const CLICK_SLOP = 7 // 同书架：按下/抬起累计位移小于该像素数才算点击
const CLICK_SLOP_TOUCH = 12

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const easeOut = (p) => 1 - Math.pow(1 - p, 3)
const easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2)
const IDENTITY_QUAT = new THREE.Quaternion()

export default class CoffeeTableBooks {
  constructor({ centerX, centerZ, topY }) {
    this.experience = new Experience()
    this.scene = this.experience.scene
    this.time = this.experience.time
    this.camera = this.experience.camera
    this.navigation = this.experience.navigation
    this.canvas = this.experience.canvas

    this.held = null // 取出的书：{ stage: pull/fly/idle/return, ... }
    this.wasHovering = false
    this.out = 0 // 当前抬起量
    this.outT = 0 // 目标抬起量
    this.mouse = null
    this.downId = null

    // "正在读" = finished:false 里 date 最大的那本（date 是开始阅读日期）
    this.book = BOOKS.filter((b) => !b.finished).sort((a, b) => (a.date > b.date ? -1 : 1))[0]
    if (!this.book) {
      this.ready = Promise.resolve(false)
      return
    }
    this.dims = this.bookDims(this.book)

    this.group = new THREE.Group()
    this.scene.add(this.group)
    this.buildBook(centerX, centerZ, topY)
    this.ready = this.loadCover() // TVZone 的 ready 会等它（BIOS 收口），失败也 resolve
    this.setInteraction()
  }

  // 与 Bookshelf.bookDims 同一套估算：w 封面宽、h 书高、t 厚度（世界单位）
  bookDims(b) {
    const hM = b.height / 1000
    const tM = clamp(b.pages * 0.00008, 0.012, 0.05)
    const wM = clamp(hM * 0.72, 0.12, 0.19)
    return { w: wM * 2, h: hM * 2, t: tM * 2 }
  }

  canvasTexture(w, h, draw) {
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    draw(canvas.getContext('2d'), w, h)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 8
    return texture
  }

  buildBook(centerX, centerZ, topY) {
    const { w, h, t } = this.dims
    const color = new THREE.Color(this.book.color)

    // 页缘：细密条纹的米白纸色（同 Bookshelf 的 edgeTex）
    const edgeTex = (vertical) =>
      this.canvasTexture(256, 256, (g) => {
        g.fillStyle = '#F4EDDD'
        g.fillRect(0, 0, 256, 256)
        for (let i = 0; i < 256; i += 2) {
          g.fillStyle = `rgba(96,76,50,${0.04 + Math.random() * 0.08})`
          if (vertical) g.fillRect(i, 0, 1, 256)
          else g.fillRect(0, i, 256, 1)
        }
      })

    const spineTex = this.canvasTexture(
      Math.max(64, Math.round(t * 1500)),
      Math.round(h * 1500),
      (g, sw, sh) => this.drawSpine(g, sw, sh, this.book)
    )

    // 封面先用底色顶着，loadCover() 换真实封面图（失败换程序化兜底）
    this.coverMat = new THREE.MeshStandardMaterial({
      color: color.clone().multiplyScalar(0.92),
      roughness: 0.5,
    })
    // BoxGeometry 材质序：+x 前口、-x 书脊、±y 天头地脚、+z 封面、-z 封底
    const materials = [
      new THREE.MeshStandardMaterial({ map: edgeTex(true), roughness: 0.95 }),
      new THREE.MeshStandardMaterial({ map: spineTex, roughness: 0.65 }),
      new THREE.MeshStandardMaterial({ map: edgeTex(false), roughness: 0.95 }),
      new THREE.MeshStandardMaterial({ map: edgeTex(false), roughness: 0.95 }),
      this.coverMat,
      new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.8), roughness: 0.62 }),
    ]

    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, t), materials)
    this.mesh.castShadow = true
    this.mesh.receiveShadow = true

    this.homePos = new THREE.Vector3(centerX + SPOT.dx, topY + t / 2, centerZ + SPOT.dz)
    // YXZ：先绕 X 躺平（封面 +z → 朝上、书顶 +y → -z），再绕世界 Y 拧个小角度
    this.homeQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, TILT, 0, 'YXZ'))
    this.mesh.position.copy(this.homePos)
    this.mesh.quaternion.copy(this.homeQuat)
    this.group.add(this.mesh)
  }

  // 书脊竖排书名（同 Bookshelf.drawSpine：中文一字一格，英文/数字转 90° 顺书脊走）
  drawSpine(g, w, h, b) {
    g.fillStyle = b.color
    g.fillRect(0, 0, w, h)
    const grad = g.createLinearGradient(0, 0, w, 0)
    grad.addColorStop(0, 'rgba(255,255,255,.16)')
    grad.addColorStop(0.15, 'rgba(255,255,255,0)')
    grad.addColorStop(0.8, 'rgba(0,0,0,0)')
    grad.addColorStop(1, 'rgba(0,0,0,.28)')
    g.fillStyle = grad
    g.fillRect(0, 0, w, h)

    const size = Math.min(w * 0.66, 72)
    g.font = `600 ${size}px "Microsoft YaHei", "PingFang SC", sans-serif`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.lineJoin = 'round'
    g.lineWidth = Math.max(2, size * 0.1)
    g.strokeStyle = 'rgba(25,16,8,.55)'
    g.fillStyle = 'rgba(255,255,255,.97)'
    const drawChar = (ch, x, y) => {
      g.strokeText(ch, x, y)
      g.fillText(ch, x, y)
    }
    let y = size * 1.0
    for (const ch of b.title) {
      if (y > h - size) break
      if (/[\x00-\xff]/.test(ch)) {
        g.save()
        g.translate(w / 2, y)
        g.rotate(Math.PI / 2)
        drawChar(ch, 0, 0)
        g.restore()
        y += g.measureText(ch).width + size * 0.16
      } else {
        drawChar(ch, w / 2, y)
        y += size * 1.12
      }
    }
  }

  // 程序化封面兜底（同 Bookshelf.fallbackCover 的版式）
  fallbackCover(b) {
    return this.canvasTexture(560, 812, (g, w, h) => {
      g.fillStyle = b.color
      g.fillRect(0, 0, w, h)
      g.fillStyle = 'rgba(255,255,255,.92)'
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.font = '56px Georgia, "Songti SC", SimSun, serif'
      const lines = []
      for (let i = 0; i < b.title.length; i += 7) lines.push(b.title.slice(i, i + 7))
      lines.slice(0, 4).forEach((line, i) => g.fillText(line, w / 2, h * 0.3 + i * 72))
      g.font = '26px "Microsoft YaHei", sans-serif'
      g.fillStyle = 'rgba(255,255,255,.7)'
      g.fillText((b.author || '').slice(0, 20), w / 2, h * 0.78)
    })
  }

  loadCover() {
    // 私有 manager：别混进 DefaultLoadingManager 污染 BIOS 开机日志
    const loader = new THREE.TextureLoader(new THREE.LoadingManager())
    const apply = (texture) => {
      this.coverMat.map = texture
      this.coverMat.color.set(0xffffff)
      this.coverMat.needsUpdate = true
    }
    return new Promise((resolve) => {
      loader.load(
        assetUrl('/books/' + encodeURIComponent(this.book.cover)),
        (texture) => {
          texture.colorSpace = THREE.SRGBColorSpace
          texture.anisotropy = 8
          apply(texture)
          resolve(true)
        },
        undefined,
        () => {
          apply(this.fallbackCover(this.book))
          resolve(true) // 有兜底，照样算就绪——绝不能卡死开机
        }
      )
    })
  }

  /* ---------- 交互：悬停抬起 / 点击取书 / 再点放回 ---------- */

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
      this.canvas.setPointerCapture(event.pointerId)
      if (this.held?.stage === 'idle') {
        this.held.dragging = true
        this.held.vy = 0
      }
    })

    this.canvas.addEventListener('pointermove', (event) => {
      if (event.pointerType === 'mouse') this.mouse = { x: event.clientX, y: event.clientY }
      if (this.downId !== event.pointerId) return
      const dx = event.clientX - this.pointerX
      const dy = event.clientY - this.pointerY
      this.pointerX = event.clientX
      this.pointerY = event.clientY
      this.moved += Math.abs(dx) + Math.abs(dy)
      if (this.held?.dragging && this.held.stage === 'idle') {
        this.held.ry += dx * 0.011
        this.held.vy = dx * 0.011
        this.held.rx = clamp(this.held.rx + dy * 0.006, -0.35, 0.35)
      }
    })

    const onPointerUp = (event) => {
      if (this.downId !== event.pointerId) return
      this.downId = null
      const isClick = event.type !== 'pointercancel' && this.moved < this.clickSlop
      if (this.held) {
        this.held.dragging = false
        if (isClick) this.returnBook()
        return
      }
      if (!isClick) return
      // 默认态：点到书 → 取书（导航已被别的区聚焦时不抢）
      if (!this.navigation.savedView && this.raycastBook(event.clientX, event.clientY)) {
        this.pickBook()
      }
    }
    this.canvas.addEventListener('pointerup', onPointerUp)
    this.canvas.addEventListener('pointercancel', onPointerUp)

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.held) this.returnBook()
    })
  }

  raycastBook(x, y) {
    const sizes = this.experience.sizes
    this.ndc.set((x / sizes.width) * 2 - 1, -(y / sizes.height) * 2 + 1)
    this.raycaster.setFromCamera(this.ndc, this.camera.instance)
    return this.raycaster.intersectObject(this.mesh, false).length > 0
  }

  pickBook() {
    this.out = this.outT = 0
    this.mesh.position.copy(this.homePos)
    this.canvas.style.cursor = ''
    this.wasHovering = false

    // 占住 savedView（互斥约定：别的区查到非空就不响应），相机原地不动；
    // enabled=false 把拖拽让给翻书——放回完成时 blur() 统一恢复这两样
    const view = this.navigation.view
    this.navigation.focus({
      target: view.target.value.clone(),
      radius: view.spherical.value.radius,
      phi: view.spherical.value.phi,
      theta: view.spherical.value.theta,
    })
    this.navigation.enabled = false

    this.scene.attach(this.mesh)
    const fovTan = Math.tan((this.camera.instance.fov * Math.PI) / 360)
    this.held = {
      stage: 'pull',
      t0: this.time.current,
      startPos: this.mesh.position.clone(),
      poppedPos: this.homePos.clone().add(new THREE.Vector3(0, PULL_UP, 0)),
      dist: clamp(this.dims.h / (1.16 * fovTan), 1.2, 2.6), // 让书基本占满竖向视野
      ry: 0,
      rx: 0,
      vy: 0,
      dragging: false,
      idleT: 0,
    }
  }

  returnBook() {
    if (!this.held || this.held.stage === 'return') return
    this.scene.attach(this.mesh)
    Object.assign(this.held, {
      stage: 'return',
      t0: this.time.current,
      returnPos: this.mesh.position.clone(),
      returnQuat: this.mesh.quaternion.clone(),
      endPos: this.homePos.clone(),
      endQuat: this.homeQuat.clone(),
      poppedEnd: this.homePos.clone().add(new THREE.Vector3(0, PULL_UP, 0)),
    })
    this.experience.world?.bookshelf?.caption.classList.remove('show')
  }

  // 三段动画同 Bookshelf.heldFrame，只是"抽出"方向换成向上提起
  heldFrame(now, t) {
    const h = this.held
    const mesh = this.mesh
    if (h.stage === 'pull') {
      const p = clamp((now - h.t0) / 240, 0, 1)
      mesh.position.lerpVectors(h.startPos, h.poppedPos, easeOut(p))
      if (p >= 1) {
        this.camera.instance.attach(mesh)
        h.stage = 'fly'
        h.t0 = now
        h.fromPos = mesh.position.clone()
        h.fromQuat = mesh.quaternion.clone()
        h.toPos = new THREE.Vector3(0, 0.06, -h.dist)
      }
    } else if (h.stage === 'fly') {
      const p = clamp((now - h.t0) / 620, 0, 1)
      const e = easeInOut(p)
      mesh.position.lerpVectors(h.fromPos, h.toPos, e)
      mesh.position.y += Math.sin(p * Math.PI) * 0.08
      mesh.quaternion.slerpQuaternions(h.fromQuat, IDENTITY_QUAT, e)
      if (p >= 1) {
        h.stage = 'idle'
        h.idleT = t
        this.experience.world?.bookshelf?.showCaption(this.book)
      }
    } else if (h.stage === 'idle') {
      if (!h.dragging) {
        h.ry += h.vy
        h.vy *= 0.93
        if (Math.abs(h.vy) < 0.003) {
          const snap = Math.round(h.ry / (Math.PI * 2)) * Math.PI * 2
          h.ry += (snap - h.ry) * 0.07
        }
        h.rx *= 0.92
      }
      const bt = t - h.idleT
      mesh.rotation.set(
        h.rx + Math.sin(bt * 1.3) * 0.012,
        h.ry + (h.dragging ? 0 : Math.sin(bt * 0.8) * 0.035),
        0,
        'YXZ'
      )
      mesh.position.set(0, 0.06 + Math.sin(bt * 1.1) * 0.006, -h.dist)
    } else if (h.stage === 'return') {
      const p = clamp((now - h.t0) / 560, 0, 1)
      if (p < 0.7) mesh.position.lerpVectors(h.returnPos, h.poppedEnd, easeInOut(p / 0.7))
      else mesh.position.lerpVectors(h.poppedEnd, h.endPos, easeOut((p - 0.7) / 0.3))
      mesh.quaternion.slerpQuaternions(h.returnQuat, h.endQuat, easeInOut(Math.min(p / 0.8, 1)))
      if (p >= 1) {
        this.group.add(mesh)
        mesh.position.copy(this.homePos)
        mesh.quaternion.copy(this.homeQuat)
        this.held = null
        this.navigation.blur() // 恢复视角/限位 + enabled=true
      }
    }
  }

  update() {
    if (!this.mesh) return
    const now = this.time.current
    const t = this.time.elapsed / 1000

    if (this.held) this.heldFrame(now, t)

    // 悬停检测：没在拖、没拿书、无人聚焦时才响应。cursor 写法同 MarioTV：
    // 悬停期间每帧写 pointer（书架每帧无条件清写，本模块在它之后跑才能赢），
    // 只在离开的那一帧写回空
    if (this.mouse && this.downId === null && !this.held) {
      const over = !this.navigation.savedView && this.raycastBook(this.mouse.x, this.mouse.y)
      this.outT = over ? HOVER_LIFT : 0
      if (over) this.canvas.style.cursor = 'pointer'
      else if (this.wasHovering) this.canvas.style.cursor = ''
      this.wasHovering = over
    }

    // 抬起/落下缓动
    if (!this.held && Math.abs(this.out - this.outT) > 0.0005) {
      this.out += (this.outT - this.out) * 0.18
      this.mesh.position.copy(this.homePos)
      this.mesh.position.y += this.out
    }
  }
}
