import * as THREE from 'three'
import Experience from '../Experience.js'
import BOOKS from './booksData.js'

// 书架 + 书（左墙 x=-4）：架体程序化生成，全部书按阅读顺序（date）
// 从最上层左端往右下流式排列，每年第一本书前立一个刻年份的小木盒当分隔
// （【2018】书 书 …【2019】书 …）。
// 书本构建与取书/放回动效移植自 book 项目（..\book\main.js），那边尺寸单位
// 是米，这边房间比例 1 单位 = 0.5m，长度一律 ×2 换算；贴图绘制仍按米算像素。

const WALL_INNER_X = -4 + 0.35 // 左墙内侧面
const CASE_Z = 1.6 // 架子中心 z：前端贴齐左墙的前边缘（z=+4），范围 [-0.8, 4.0]，也避开了墙角电脑桌（占到 z≈-2.3）
const CASE_W = 4.8 // 沿墙长度（z 向）
const CASE_D = 0.6 // 进深（0.3m）
const PANEL = 0.06 // 侧板厚
const BOARD = 0.05 // 隔板厚
const BASE_H = 0.12 // 底座高
const ROW_H = 0.62 // 每层净空（最高的书 0.52 + 余量）
const ROWS = 5 // 层数——架顶约 3.5 单位（1.76m），伸手可及
const CASE_H = BASE_H + ROWS * (ROW_H + BOARD) + BOARD
const USABLE = CASE_W - PANEL * 2 - 0.08 // 每层可放书的净宽
const GAP = 0.009 // 书与书的缝

const YEAR_BOX = { w: 0.3, h: 0.46, d: 0.42 } // 年份分隔盒

const HOVER_OUT = 0.16 // 悬停时书滑出的距离
const PULL_OUT = 0.5 // 取书第一段抽出的距离
const CLICK_SLOP = 7 // 按下/抬起累计位移小于该像素数才算点击（区分拖拽）
const CLICK_SLOP_TOUCH = 12 // 触屏手指抖动大，阈值放宽，否则点按易被误判成拖拽而漏点

// 聚焦机位（仿 Room_Portfolio 的两态交互：默认态悬停描边/点击聚焦，聚焦态才能取书）
const OUTLINE_PAD = 0.1 // 白色描边外壳比书架包围盒大出的量
const FOCUS_PHI = Math.PI * 0.45 // 聚焦极角（Navigation 的 phi 上限，略俯视）
const FOCUS_THETA = Math.PI * 0.5 // 聚焦方位角：正对左墙（+x 方向看过去）
const FOCUS_PAD = 0.25 // 取景时书架四周留的余量
const FOCUS_MIN_R = 2.5 // 聚焦态允许滚轮凑近到的最小距离（看清书脊名）

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const easeOut = (p) => 1 - Math.pow(1 - p, 3)
const easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2)
const IDENTITY_QUAT = new THREE.Quaternion()

export default class Bookshelf {
  constructor() {
    this.experience = new Experience()
    this.scene = this.experience.scene
    this.time = this.experience.time
    this.camera = this.experience.camera
    this.navigation = this.experience.navigation
    this.canvas = this.experience.canvas

    this.bookMeshes = []
    this.held = null // 取出的书：{ mesh, stage: pull/fly/idle/return, ... }
    this.hovered = null
    this.focused = false // 聚焦态才能取书/还书；默认态悬停/点击的对象是整个书架
    this.mouse = null
    this.downId = null
    // 私有 manager：封面是聚焦后才懒加载的，别混进 DefaultLoadingManager 污染 BIOS 开机日志
    this.textureLoader = new THREE.TextureLoader(new THREE.LoadingManager())

    this.group = new THREE.Group()
    this.group.position.set(WALL_INNER_X + CASE_D / 2, 0, CASE_Z)
    this.group.rotation.y = Math.PI / 2 // 开口面朝 +x（房间内侧）
    this.scene.add(this.group)

    this.setMaterials()
    this.setCase()
    this.setBooks()
    this.setFocusHelpers()
    this.setCaption()
    this.setInteraction()
  }

  /* ---------- 贴图工具 ---------- */

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

  grain(g, w, h, rgba, n = 26) {
    for (let i = 0; i < n; i++) {
      g.strokeStyle = `rgba(${rgba},${0.03 + Math.random() * 0.07})`
      g.lineWidth = 0.6 + Math.random() * 1.6
      const p = Math.random() * w
      const d = (Math.random() - 0.5) * 14
      g.beginPath()
      g.moveTo(p, -6)
      g.quadraticCurveTo(p + d, h / 2, p, h + 6)
      g.stroke()
    }
  }

  setMaterials() {
    // 架体木料：中调胡桃色 + 淡木纹，同房间壳体一样基本不吃环境反射
    const woodTex = this.canvasTexture(256, 256, (g, w, h) => {
      g.fillStyle = '#9C7A52'
      g.fillRect(0, 0, w, h)
      this.grain(g, w, h, '70,48,26')
    })
    this.woodMat = new THREE.MeshStandardMaterial({
      map: woodTex,
      roughness: 0.85,
      envMapIntensity: 0.1,
    })
    this.yearSideMat = new THREE.MeshStandardMaterial({
      color: '#4a3823',
      roughness: 0.8,
      envMapIntensity: 0.1,
    })

    // 书页切口：细密条纹的米白纸色（前口竖纹、天头地脚横纹）
    const edgeTex = (vertical) =>
      this.canvasTexture(256, 256, (g, w, h) => {
        g.fillStyle = '#F4EDDD'
        g.fillRect(0, 0, w, h)
        for (let i = 0; i < 256; i += 2) {
          g.fillStyle = `rgba(96,76,50,${0.04 + Math.random() * 0.08})`
          if (vertical) g.fillRect(i, 0, 1, h)
          else g.fillRect(0, i, w, 1)
        }
      })
    this.pageForeMat = new THREE.MeshStandardMaterial({ map: edgeTex(true), roughness: 0.95 })
    this.pageFlatMat = new THREE.MeshStandardMaterial({ map: edgeTex(false), roughness: 0.95 })
  }

  /* ---------- 架体 ---------- */

  shelfFloorY(level) {
    // level 0 是最下层的搁板面
    return BASE_H + BOARD + level * (ROW_H + BOARD)
  }

  setCase() {
    const addBox = (wx, wy, wz, x, y, z, material = this.woodMat) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(wx, wy, wz), material)
      mesh.position.set(x, y, z)
      mesh.castShadow = true
      mesh.receiveShadow = true
      this.group.add(mesh)
      return mesh
    }

    addBox(PANEL, CASE_H, CASE_D, -(CASE_W - PANEL) / 2, CASE_H / 2, 0)
    addBox(PANEL, CASE_H, CASE_D, (CASE_W - PANEL) / 2, CASE_H / 2, 0)
    addBox(CASE_W, BASE_H, CASE_D, 0, BASE_H / 2, 0)
    for (let s = 0; s <= ROWS; s++) {
      addBox(CASE_W - PANEL * 2 + 0.002, BOARD, CASE_D, 0, BASE_H + s * (ROW_H + BOARD) + BOARD / 2, 0)
    }

    // 内衬背板：往上渐暗 + 每层隔板下一道柔影，画出进深
    const backTex = this.canvasTexture(256, 512, (g, w, h) => {
      const lg = g.createLinearGradient(0, h, 0, 0)
      lg.addColorStop(0, '#5A4630')
      lg.addColorStop(1, '#382A1B')
      g.fillStyle = lg
      g.fillRect(0, 0, w, h)
      for (let s = 1; s <= ROWS; s++) {
        const y = h - ((BASE_H + s * (ROW_H + BOARD)) / CASE_H) * h
        const sg = g.createLinearGradient(0, y, 0, y + 40)
        sg.addColorStop(0, 'rgba(20,12,5,.5)')
        sg.addColorStop(1, 'rgba(20,12,5,0)')
        g.fillStyle = sg
        g.fillRect(0, y, w, 42)
      }
    })
    const back = new THREE.Mesh(
      new THREE.BoxGeometry(CASE_W - PANEL * 2, CASE_H - BASE_H - BOARD, 0.03),
      new THREE.MeshStandardMaterial({ map: backTex, roughness: 1, envMapIntensity: 0.05 })
    )
    back.position.set(0, (CASE_H + BASE_H + BOARD) / 2 - BOARD / 2, -CASE_D / 2 + 0.015)
    back.receiveShadow = true
    this.group.add(back)
  }

  /* ---------- 书与年份盒 ---------- */

  bookDims(b) {
    const hM = b.height / 1000 // 书脊高（米）
    const tM = clamp(b.pages * 0.00008, 0.012, 0.05) // 厚度按页数估
    const wM = clamp(hM * 0.72, 0.12, 0.19) // 封面宽
    return { w: wM * 2, h: hM * 2, t: tM * 2, wM, hM, tM }
  }

  setBooks() {
    // 只上架读完的书（finished），在读/弃读的不放
    const byDate = (a, b) => (a.date === b.date ? a._i - b._i : a.date < b.date ? -1 : 1)
    const sorted = BOOKS.map((b, i) => ({ ...b, _i: i }))
      .filter((b) => b.finished)
      .sort(byDate)

    // 排成"物件流"：每年第一本书前插一个年份盒
    const items = []
    let lastYear = ''
    for (const book of sorted) {
      const year = book.date.slice(0, 4)
      if (year !== lastYear) {
        items.push({ year })
        lastYear = year
      }
      items.push({ book })
    }

    // 从最上层往下、每层从左到右流式填充。这一步只算位置不建网格：
    // 默认态整墙书是几个合并网格（省 ~1450 个 draw call），聚焦书架时
    // 才换成逐本独立网格做取书交互（见 ensureBookMeshes，惰性构建）
    this.bookLayout = []
    this.yearLayout = []
    let row = 0
    let x = -USABLE / 2
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const width = item.year ? YEAR_BOX.w + GAP * 2 : this.bookDims(item.book).t + GAP
      // 年份盒不孤立在行尾：连同它后面第一本书一起量是否放得下
      let needed = width
      if (item.year && items[i + 1]?.book) needed += this.bookDims(items[i + 1].book).t + GAP
      if (x + needed > USABLE / 2 && x > -USABLE / 2 + 1e-6) {
        row++
        x = -USABLE / 2
      }
      if (row >= ROWS) {
        console.warn(`书架放满了，还剩 ${items.length - i} 件没上架——加大 CASE_W 或 ROWS`)
        break
      }
      const floorY = this.shelfFloorY(ROWS - 1 - row)
      if (item.year) {
        this.yearLayout.push({
          year: item.year,
          pos: new THREE.Vector3(
            x + GAP + YEAR_BOX.w / 2,
            floorY + YEAR_BOX.h / 2,
            CASE_D / 2 - 0.03 - YEAR_BOX.d / 2
          ),
        })
      } else {
        const dims = this.bookDims(item.book)
        this.bookLayout.push({
          book: item.book,
          dims,
          pos: new THREE.Vector3(
            x + dims.t / 2,
            floorY + dims.h / 2,
            CASE_D / 2 - 0.03 - dims.w / 2 - Math.random() * 0.02 // 靠前放，深浅带点随机
          ),
        })
      }
      x += width
    }

    this.buildAtlas()
    this.buildMerged()

    // 独立书网格的容器：首次聚焦时才填充
    this.booksGroup = new THREE.Group()
    this.booksGroup.visible = false
    this.group.add(this.booksGroup)
  }

  // 所有书脊 + 年份盒正面画进一张图集纹理：默认态合并网格与聚焦态独立
  // 网格共用（书脊不再逐本建 canvas 纹理），UV 重映射到各自格子
  buildAtlas() {
    const PPM = 3000 // 3000px/米：凑近看书脊文字仍清晰
    const PAD = 4 // 格子间留白，防 mipmap 缩小时相邻格互相渗色
    const ATLAS_W = 4096
    const cells = []
    for (const it of this.bookLayout) {
      cells.push({
        it,
        w: Math.max(64, Math.round(it.dims.tM * PPM)),
        h: Math.round(it.dims.hM * PPM),
        draw: (g, w, h) => this.drawSpine(g, w, h, it.book),
      })
    }
    for (const it of this.yearLayout) {
      cells.push({ it, w: 128, h: 196, draw: (g, w, h) => this.drawYearFront(g, w, h, it.year) })
    }

    // 行式打包
    let x = PAD
    let y = PAD
    let rowH = 0
    for (const c of cells) {
      if (x + c.w + PAD > ATLAS_W) {
        x = PAD
        y += rowH + PAD
        rowH = 0
      }
      c.x = x
      c.y = y
      x += c.w + PAD
      rowH = Math.max(rowH, c.h)
    }
    const ATLAS_H = y + rowH + PAD

    const canvas = document.createElement('canvas')
    canvas.width = ATLAS_W
    canvas.height = ATLAS_H
    const g = canvas.getContext('2d')
    for (const c of cells) {
      g.save()
      g.translate(c.x, c.y)
      c.draw(g, c.w, c.h)
      g.restore()
      // canvas y 朝下、uv v 朝上，这里换算好存起来
      c.it.uvRect = {
        u0: c.x / ATLAS_W,
        u1: (c.x + c.w) / ATLAS_W,
        v0: 1 - (c.y + c.h) / ATLAS_H,
        v1: 1 - c.y / ATLAS_H,
      }
    }

    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 8
    this.atlasMat = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.65 })
  }

  // 把 BoxGeometry 的若干面拷进合并缓冲；face 序号同材质序（0..5 = +x -x +y -y +z -z）
  appendFaces(dst, geometry, faces, { uvRect, color } = {}) {
    const pos = geometry.attributes.position
    const nor = geometry.attributes.normal
    const uv = geometry.attributes.uv
    const idx = geometry.index
    for (const f of faces) {
      const base = dst.positions.length / 3
      for (let v = f * 4; v < f * 4 + 4; v++) {
        dst.positions.push(pos.getX(v), pos.getY(v), pos.getZ(v))
        dst.normals.push(nor.getX(v), nor.getY(v), nor.getZ(v))
        let u = uv.getX(v)
        let w = uv.getY(v)
        if (uvRect) {
          u = uvRect.u0 + (uvRect.u1 - uvRect.u0) * u
          w = uvRect.v0 + (uvRect.v1 - uvRect.v0) * w
        }
        dst.uvs.push(u, w)
        if (color) dst.colors.push(color.r, color.g, color.b)
      }
      for (let k = f * 6; k < f * 6 + 6; k++) dst.indices.push(idx.getX(k) - f * 4 + base)
    }
  }

  mergedMesh(dst, material) {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(dst.positions, 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(dst.normals, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(dst.uvs, 2))
    if (dst.colors.length) geometry.setAttribute('color', new THREE.Float32BufferAttribute(dst.colors, 3))
    geometry.setIndex(dst.indices)
    return new THREE.Mesh(geometry, material)
  }

  // 默认态的书 + 年份盒：按材质合并成 6 个网格（书脊图集/前口/天地/封面封底
  // 顶点色 + 年份盒正面/侧面），代替逐本网格的 ~1450 个 draw call。
  // 封面封底合并后只有纯色顶点色、无独立贴图——默认视角下书在架上封面
  // 基本被相邻书挡住，视觉损失可忽略（用户认可的取舍）
  buildMerged() {
    const mk = () => ({ positions: [], normals: [], uvs: [], colors: [], indices: [] })
    const spine = mk()
    const fore = mk()
    const flat = mk()
    const cover = mk()
    const yearFront = mk()
    const yearSide = mk()

    const matrix = new THREE.Matrix4()
    for (const it of this.bookLayout) {
      const geom = new THREE.BoxGeometry(it.dims.w, it.dims.h, it.dims.t)
      geom.applyMatrix4(matrix.makeRotationY(Math.PI / 2).setPosition(it.pos)) // 同独立网格：书脊朝外
      const c = new THREE.Color(it.book.color)
      this.appendFaces(fore, geom, [0])
      this.appendFaces(spine, geom, [1], { uvRect: it.uvRect })
      this.appendFaces(flat, geom, [2, 3])
      this.appendFaces(cover, geom, [4], { color: c.clone().multiplyScalar(0.92) })
      this.appendFaces(cover, geom, [5], { color: c.clone().multiplyScalar(0.8) })
      geom.dispose()
    }
    for (const it of this.yearLayout) {
      const geom = new THREE.BoxGeometry(YEAR_BOX.w, YEAR_BOX.h, YEAR_BOX.d)
      geom.applyMatrix4(matrix.identity().setPosition(it.pos))
      this.appendFaces(yearFront, geom, [4], { uvRect: it.uvRect })
      this.appendFaces(yearSide, geom, [0, 1, 2, 3, 5])
      geom.dispose()
    }

    this.mergedBooks = new THREE.Group()
    this.mergedBooks.add(
      this.mergedMesh(spine, this.atlasMat),
      this.mergedMesh(fore, this.pageForeMat),
      this.mergedMesh(flat, this.pageFlatMat),
      this.mergedMesh(cover, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.56 }))
    )
    this.group.add(this.mergedBooks)

    // 年份盒无交互，聚焦态也一直用合并网格
    this.group.add(this.mergedMesh(yearFront, this.atlasMat), this.mergedMesh(yearSide, this.yearSideMat))
  }

  // 首次进入聚焦时才把书建成独立网格（取书/悬停滑出需要逐本命中）
  ensureBookMeshes() {
    if (this.bookMeshes.length) return
    for (const it of this.bookLayout) this.addBook(it)
  }

  addBook(it) {
    const { book: b, dims, pos, uvRect } = it
    const color = new THREE.Color(b.color)
    // BoxGeometry 材质序：+x 前口、-x 书脊、±y 天头地脚、+z 封面、-z 封底
    const materials = [
      this.pageForeMat,
      this.atlasMat, // 书脊共用图集，UV 在几何上重映射到本书的格子
      this.pageFlatMat,
      this.pageFlatMat,
      new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.92), roughness: 0.5 }),
      new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.8), roughness: 0.62 }),
    ]
    const geometry = new THREE.BoxGeometry(dims.w, dims.h, dims.t)
    const uv = geometry.attributes.uv
    for (let v = 4; v < 8; v++) {
      // -x 书脊面的 4 个顶点（面序 1 × 每面 4 顶点）
      uv.setXY(
        v,
        uvRect.u0 + (uvRect.u1 - uvRect.u0) * uv.getX(v),
        uvRect.v0 + (uvRect.v1 - uvRect.v0) * uv.getY(v)
      )
    }
    const mesh = new THREE.Mesh(geometry, materials)
    mesh.rotation.y = Math.PI / 2 // 书脊转向朝外
    mesh.position.copy(pos)
    mesh.userData = {
      book: b,
      dims,
      out: 0, // 当前滑出量
      outT: 0, // 目标滑出量
      coverTried: false,
      parent: this.booksGroup,
      homePos: mesh.position.clone(),
      homeQuat: mesh.quaternion.clone(),
      popDir: new THREE.Vector3(0, 0, 1), // 架内局部坐标的"抽出"方向
    }
    this.booksGroup.add(mesh)
    this.bookMeshes.push(mesh)
  }

  drawYearFront(g, w, h, year) {
    g.fillStyle = '#3E2F1F'
    g.fillRect(0, 0, w, h)
    g.strokeStyle = '#B08D57'
    g.lineWidth = 3
    g.strokeRect(7, 7, w - 14, h - 14)
    g.fillStyle = '#E8CE9C'
    g.font = '700 46px Georgia, serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(year.slice(0, 2), w / 2, h / 2 - 27)
    g.fillText(year.slice(2), w / 2, h / 2 + 27)
  }

  // 书脊绘制（画进图集的格子里，坐标已由调用方 translate 好）：
  // 64px 下限在图集打包时保证——薄书 44px 画布字会糊
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

    // 书名竖排：中文一字一格，英文/数字转 90° 顺着书脊走。
    // 字占书脊宽的比例往大调 + 深色描边，远看（书脊只有十几像素宽）才有辨识度
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

  // 封面图懒加载：悬停/取书时才请求，失败就用程序化封面兜底
  loadCover(mesh) {
    const ud = mesh.userData
    if (ud.coverTried) return
    ud.coverTried = true
    const apply = (texture) => {
      const material = mesh.material[4]
      material.map = texture
      material.color.set(0xffffff)
      material.needsUpdate = true
    }
    this.textureLoader.load(
      '/books/' + encodeURIComponent(ud.book.cover),
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace
        texture.anisotropy = 8
        apply(texture)
      },
      undefined,
      () => apply(this.fallbackCover(ud.book))
    )
  }

  /* ---------- 聚焦：悬停描边外壳 + 命中检测盒 ---------- */

  setFocusHelpers() {
    // 命中盒：罩住整个书架，默认态的悬停/点击都对它做射线检测（材质不可见但可被射线命中）
    this.hullMesh = new THREE.Mesh(
      new THREE.BoxGeometry(CASE_W, CASE_H, CASE_D),
      new THREE.MeshBasicMaterial({ visible: false })
    )
    this.hullMesh.position.set(0, CASE_H / 2, 0)
    this.group.add(this.hullMesh)

    // 白色描边：放大一圈的背面外壳（参考项目用的是后期 Outline，这里用一个
    // draw call 的经典背面法近似，等以后上 EffectComposer/Bloom 再换 OutlinePass）
    this.outlineMesh = new THREE.Mesh(
      new THREE.BoxGeometry(CASE_W + OUTLINE_PAD, CASE_H + OUTLINE_PAD, CASE_D + OUTLINE_PAD),
      new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide, toneMapped: false })
    )
    // 往前挪半个 pad，外壳背面不陷进墙里被墙面挡掉
    this.outlineMesh.position.set(0, CASE_H / 2, OUTLINE_PAD / 2 + 0.01)
    this.outlineMesh.visible = false
    this.group.add(this.outlineMesh)
  }

  raycastHull(x, y) {
    const sizes = this.experience.sizes
    this.ndc.set((x / sizes.width) * 2 - 1, -(y / sizes.height) * 2 + 1)
    this.raycaster.setFromCamera(this.ndc, this.camera.instance)
    return this.raycaster.intersectObject(this.hullMesh, false).length > 0
  }

  // 进入聚焦：走 Navigation.focus()——保存当前视角、把目标值拨到书架正前方，
  // 相机沿用它自己的指数平滑飞过去。仿参考项目的做法：角度锁死、距离收窄
  // 但不锁——滚轮可凑近看书脊，右键可沿书架平移，拖拽旋转无效
  enterFocus() {
    // 换成逐本独立网格（首次聚焦才构建），合并网格隐藏——取书交互要逐本命中
    this.ensureBookMeshes()
    this.mergedBooks.visible = false
    this.booksGroup.visible = true

    const center = new THREE.Vector3(this.group.position.x, CASE_H * 0.52, this.group.position.z)
    // 初始距离按视野算：横竖都要装下书架（加余量）
    const camera = this.camera.instance
    const fovTan = Math.tan((camera.fov * Math.PI) / 360)
    const fitH = (CASE_H / 2 + FOCUS_PAD) / fovTan
    const fitW = (CASE_W / 2 + FOCUS_PAD) / (fovTan * camera.aspect)
    const radius = Math.max(fitH, fitW)

    this.navigation.focus({
      target: center,
      radius,
      phi: FOCUS_PHI,
      theta: FOCUS_THETA,
      limits: {
        radius: { min: FOCUS_MIN_R, max: radius },
        phi: { min: FOCUS_PHI, max: FOCUS_PHI },
        theta: { min: FOCUS_THETA, max: FOCUS_THETA },
        x: { min: center.x, max: center.x },
        y: { min: 0.8, max: CASE_H },
        z: { min: CASE_Z - CASE_W / 2, max: CASE_Z + CASE_W / 2 },
      },
    })

    this.focused = true
    this.outlineMesh.visible = false
    this.canvas.style.cursor = ''
  }

  // 退出聚焦：Navigation.blur() 恢复进入前的视角和限位
  exitFocus() {
    this.navigation.blur()
    this.focused = false
    this.setHover(null)
    // 回默认态：换回合并网格省 draw call（拿着书时退不了聚焦，这里书都在架上）
    this.booksGroup.visible = false
    this.mergedBooks.visible = true
  }

  /* ---------- 说明卡（取书时底部弹出） ---------- */

  setCaption() {
    const style = document.createElement('style')
    style.textContent = `
      .book-caption {
        position: fixed;
        left: 50%;
        bottom: 28px;
        transform: translateX(-50%) translateY(10px);
        text-align: center;
        padding: 10px 20px;
        border-radius: 14px;
        background: rgba(20, 16, 32, 0.55);
        backdrop-filter: blur(8px);
        border: 1px solid rgba(255, 255, 255, 0.12);
        color: #fff;
        opacity: 0;
        transition: opacity .25s, transform .25s;
        pointer-events: none;
        user-select: none;
        z-index: 10;
        font-family: "Microsoft YaHei", "PingFang SC", sans-serif;
      }
      .book-caption.show { opacity: 1; transform: translateX(-50%); }
      .book-caption .title { font-size: 16px; font-weight: 700; }
      .book-caption .meta { font-size: 12px; color: rgba(255,255,255,.72); margin-top: 3px; }
      .book-caption .stars { font-size: 13px; color: #ffd88a; margin-top: 2px; letter-spacing: 2px; }
    `
    document.head.appendChild(style)

    this.caption = document.createElement('div')
    this.caption.className = 'book-caption'
    this.caption.innerHTML = '<div class="title"></div><div class="meta"></div><div class="stars"></div>'
    document.body.appendChild(this.caption)
  }

  showCaption(b) {
    const [title, meta, stars] = this.caption.children
    title.textContent = b.title
    meta.textContent = `${b.author} · ${b.date} 开始读${b.finished ? '' : ' · 在读'}`
    stars.textContent = b.rating ? '★'.repeat(b.rating) + '☆'.repeat(5 - b.rating) : ''
    this.caption.classList.add('show')
  }

  /* ---------- 交互：悬停滑出 / 点击取书 / 再点放回 ---------- */

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
      // pointercancel（触屏被系统手势/来电打断）只收尾不算点击
      const isClick = event.type !== 'pointercancel' && this.moved < this.clickSlop
      if (this.held) {
        this.held.dragging = false
        if (isClick) this.returnBook()
        return
      }
      if (!isClick) return
      if (!this.focused) {
        // 默认态：点到书架任意处 → 聚焦（导航已被别的区聚焦时不抢）
        if (!this.navigation.savedView && this.raycastHull(event.clientX, event.clientY)) {
          this.enterFocus()
        }
        return
      }
      // 聚焦态：点到书 → 取书；点到书架外 → 退出聚焦（点架体本身不动）
      const hit = this.raycastBooks(event.clientX, event.clientY)
      if (hit) this.pickBook(hit)
      else if (!this.raycastHull(event.clientX, event.clientY)) this.exitFocus()
    }
    this.canvas.addEventListener('pointerup', onPointerUp)
    this.canvas.addEventListener('pointercancel', onPointerUp)

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return
      if (this.held) this.returnBook()
      else if (this.focused) this.exitFocus()
    })
  }

  raycastBooks(x, y) {
    const sizes = this.experience.sizes
    this.ndc.set((x / sizes.width) * 2 - 1, -(y / sizes.height) * 2 + 1)
    this.raycaster.setFromCamera(this.ndc, this.camera.instance)
    const hits = this.raycaster.intersectObjects(this.bookMeshes, false)
    return hits[0] && hits[0].object !== this.held?.mesh ? hits[0].object : null
  }

  setHover(mesh) {
    if (this.hovered === mesh) return
    if (this.hovered) this.hovered.userData.outT = 0
    this.hovered = mesh
    if (mesh) {
      mesh.userData.outT = HOVER_OUT
      this.loadCover(mesh)
    }
    this.canvas.style.cursor = mesh ? 'pointer' : ''
  }

  pickBook(mesh) {
    this.setHover(null)
    const ud = mesh.userData
    ud.out = ud.outT = 0
    mesh.position.copy(ud.homePos)
    this.loadCover(mesh)
    this.navigation.enabled = false // 拿书期间连聚焦态的缩放/平移也停掉，拖拽给翻书用

    const parentQuat = new THREE.Quaternion()
    ud.parent.getWorldQuaternion(parentQuat)
    this.scene.attach(mesh)
    const start = mesh.position.clone()
    const popWorld = ud.popDir.clone().applyQuaternion(parentQuat)
    const fovTan = Math.tan((this.camera.instance.fov * Math.PI) / 360)

    this.held = {
      mesh,
      book: ud.book,
      stage: 'pull',
      t0: this.time.current,
      startPos: start,
      startQuat: mesh.quaternion.clone(),
      poppedPos: start.clone().addScaledVector(popWorld, PULL_OUT),
      dist: clamp(ud.dims.h / (1.16 * fovTan), 1.2, 2.6), // 让书基本占满竖向视野
      ry: 0,
      rx: 0,
      vy: 0,
      dragging: false,
      idleT: 0,
    }
  }

  returnBook() {
    if (!this.held || this.held.stage === 'return') return
    const mesh = this.held.mesh
    const ud = mesh.userData
    this.scene.attach(mesh)

    ud.parent.updateWorldMatrix(true, false)
    const parentQuat = new THREE.Quaternion()
    ud.parent.getWorldQuaternion(parentQuat)
    const endPos = ud.homePos.clone().applyMatrix4(ud.parent.matrixWorld)
    const popWorld = ud.popDir.clone().applyQuaternion(parentQuat)

    Object.assign(this.held, {
      stage: 'return',
      t0: this.time.current,
      returnPos: mesh.position.clone(),
      returnQuat: mesh.quaternion.clone(),
      endPos,
      endQuat: parentQuat.multiply(ud.homeQuat),
      poppedEnd: endPos.clone().addScaledVector(popWorld, PULL_OUT),
    })
    this.caption.classList.remove('show')
  }

  heldFrame(now, t) {
    const h = this.held
    const mesh = h.mesh
    if (h.stage === 'pull') {
      // 先沿架子方向抽出来
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
      // 飞到镜头正前方，带一点抛物线
      const p = clamp((now - h.t0) / 620, 0, 1)
      const e = easeInOut(p)
      mesh.position.lerpVectors(h.fromPos, h.toPos, e)
      mesh.position.y += Math.sin(p * Math.PI) * 0.08
      mesh.quaternion.slerpQuaternions(h.fromQuat, IDENTITY_QUAT, e)
      if (p >= 1) {
        h.stage = 'idle'
        h.idleT = t
        this.showCaption(h.book)
      }
    } else if (h.stage === 'idle') {
      // 悬停呼吸 + 拖拽翻转（松手后带惯性，转满一圈自动吸回正面）
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
      // 先回到架口再插进去
      const p = clamp((now - h.t0) / 560, 0, 1)
      if (p < 0.7) mesh.position.lerpVectors(h.returnPos, h.poppedEnd, easeInOut(p / 0.7))
      else mesh.position.lerpVectors(h.poppedEnd, h.endPos, easeOut((p - 0.7) / 0.3))
      mesh.quaternion.slerpQuaternions(h.returnQuat, h.endQuat, easeInOut(Math.min(p / 0.8, 1)))
      if (p >= 1) {
        const ud = mesh.userData
        ud.parent.add(mesh)
        mesh.position.copy(ud.homePos)
        mesh.quaternion.copy(ud.homeQuat)
        this.held = null
        this.navigation.enabled = true // 回到聚焦态的受限漫游（角度锁死、可缩放平移）
      }
    }
  }

  update() {
    const now = this.time.current
    const t = this.time.elapsed / 1000

    if (this.held) this.heldFrame(now, t)

    // 悬停检测：没在拖、没拿书时才做。
    // 默认态悬停对象是整个书架（白描边）；聚焦态才对单本书（滑出）
    if (this.mouse && this.downId === null && !this.held) {
      if (this.focused) {
        this.setHover(this.raycastBooks(this.mouse.x, this.mouse.y))
      } else {
        // 导航被别的区（电视等）聚焦时书架不再响应悬停
        const onShelf = !this.navigation.savedView && this.raycastHull(this.mouse.x, this.mouse.y)
        this.outlineMesh.visible = onShelf
        this.canvas.style.cursor = onShelf ? 'pointer' : ''
      }
    } else if (this.hovered && this.held) {
      this.setHover(null)
    }
    if ((this.focused || this.held) && this.outlineMesh.visible) this.outlineMesh.visible = false

    // 书的滑出/收回缓动
    for (const mesh of this.bookMeshes) {
      const ud = mesh.userData
      if (mesh === this.held?.mesh) continue
      if (Math.abs(ud.out - ud.outT) > 0.0005) {
        ud.out += (ud.outT - ud.out) * 0.18
        mesh.position.copy(ud.homePos).addScaledVector(ud.popDir, ud.out)
      }
    }
  }
}
