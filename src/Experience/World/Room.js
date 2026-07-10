import * as THREE from 'three'
import Experience from '../Experience.js'

const ROOM_SIZE = 8
const WALL_HEIGHT = 5
const THICKNESS = 0.35

export default class Room {
  constructor() {
    this.experience = new Experience()
    this.scene = this.experience.scene

    this.group = new THREE.Group()
    this.scene.add(this.group)

    this.setFloor()
    this.setWalls()
  }

  setFloor() {
    const { map, bumpMap } = this.createWoodTexture()

    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(ROOM_SIZE, THICKNESS, ROOM_SIZE),
      new THREE.MeshStandardMaterial({
        map,
        bumpMap,
        bumpScale: 0.12, // 让板缝呈现倒角凹槽的受光效果
        roughness: 0.9,
        envMapIntensity: 0.1, // 房间壳体基本不吃环境反射，保持太阳光的方向感
      })
    )
    floor.position.y = -THICKNESS / 2
    floor.receiveShadow = true
    this.group.add(floor)
  }

  setWalls() {
    const wallMaterial = new THREE.MeshStandardMaterial({
      color: '#f1eeea',
      roughness: 1,
      envMapIntensity: 0.1, // 同地板：墙面亮度交给半球光+太阳光
    })
    const half = ROOM_SIZE / 2

    const backWall = new THREE.Mesh(
      new THREE.BoxGeometry(ROOM_SIZE, WALL_HEIGHT, THICKNESS),
      wallMaterial
    )
    backWall.position.set(0, WALL_HEIGHT / 2, -half + THICKNESS / 2)

    const leftWall = new THREE.Mesh(
      new THREE.BoxGeometry(THICKNESS, WALL_HEIGHT, ROOM_SIZE - THICKNESS),
      wallMaterial
    )
    leftWall.position.set(-half + THICKNESS / 2, WALL_HEIGHT / 2, THICKNESS / 2)

    for (const wall of [backWall, leftWall]) {
      wall.castShadow = true
      wall.receiveShadow = true
      this.group.add(wall)
    }
  }

  /**
   * 程序化生成木地板贴图，样式对照 Room_Portfolio 的地板：
   * - 板条走向沿 z 轴（画面上从右上铺向左下），即贴图里的竖向条
   * - 每条板被随机横缝切成若干段，相邻板断缝错开（砖砌式错缝）
   * - 接缝画成"凹槽 + 亮边"，再配合同构的 bumpMap 模拟倒角受光
   * - 整体浅沙色，段与段之间只有细微色差
   */
  createWoodTexture() {
    const size = 1024
    const colorCanvas = document.createElement('canvas')
    colorCanvas.width = colorCanvas.height = size
    const color = colorCanvas.getContext('2d')

    const bumpCanvas = document.createElement('canvas')
    bumpCanvas.width = bumpCanvas.height = size
    const bump = bumpCanvas.getContext('2d')

    const cols = 10 // 房间横向约 10 块板
    const plankWidth = size / cols

    bump.fillStyle = 'rgb(128, 128, 128)'
    bump.fillRect(0, 0, size, size)

    const seam = (x, y, w, h) => {
      // 凹槽：深色缝 + 一侧亮边（颜色和凹凸两张图同时画）
      color.fillStyle = 'rgba(115, 78, 42, 0.6)'
      color.fillRect(x, y, w, h)
      bump.fillStyle = 'rgb(55, 55, 55)'
      bump.fillRect(x, y, w, h)

      const highlight = 'rgba(255, 238, 205, 0.35)'
      color.fillStyle = highlight
      bump.fillStyle = 'rgb(200, 200, 200)'
      if (w > h) {
        color.fillRect(x, y + h, w, 2)
        bump.fillRect(x, y + h, w, 2)
      } else {
        color.fillRect(x + w, y, 2, h)
        bump.fillRect(x + w, y, 2, h)
      }
    }

    for (let col = 0; col < cols; col++) {
      const x = col * plankWidth

      // 沿板长方向切成随机的 2~4 段，形成错缝
      // 必须从 0 开始，否则板头留下未填色的透明区（渲染成黑块）
      const breaks = [0]
      let y = (0.15 + Math.random() * 0.45) * size
      while (y < size - 40) {
        breaks.push(y)
        y += (0.28 + Math.random() * 0.3) * size
      }
      breaks.push(size)

      for (let s = 0; s < breaks.length - 1; s++) {
        const segY = breaks[s]
        const segH = breaks[s + 1] - segY

        // 段与段之间细微的色差
        const hue = 34 + Math.random() * 4
        const sat = 42 + Math.random() * 6
        const light = 61 + Math.random() * 6
        color.fillStyle = `hsl(${hue}, ${sat}%, ${light}%)`
        color.fillRect(x, segY, plankWidth, segH)

        // 很淡的顺纹木纹（沿板长方向的竖线）
        for (let i = 0; i < 4; i++) {
          color.fillStyle = `rgba(120, 85, 45, ${0.03 + Math.random() * 0.03})`
          color.fillRect(x + Math.random() * plankWidth, segY, 1.5, segH)
        }

        // 段间横缝（跳过贴图边缘）
        if (segY > 0) seam(x, segY, plankWidth, 4)
      }

      // 板间竖缝
      if (col > 0) seam(x, 0, 4, size)
    }

    const map = new THREE.CanvasTexture(colorCanvas)
    map.colorSpace = THREE.SRGBColorSpace
    map.anisotropy = 8

    const bumpMap = new THREE.CanvasTexture(bumpCanvas)
    bumpMap.anisotropy = 8

    return { map, bumpMap }
  }
}
