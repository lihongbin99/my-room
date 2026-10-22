import * as THREE from 'three'
import Experience from '../Experience.js'

// 后墙发光窗：保留暖色玻璃，房间照明交给现有主光。
const WALL_INNER_Z = -4 + 0.35 // 后墙内侧面
const CENTER = { x: -1.92, y: 3.6 } // 窗心：电脑桌正上方（桌组实测 x∈[-3.65,-0.19]；显示器顶 2.7，窗框底 2.88 留空隙）。电视上方让位给挂画 WallPainting
const PANE = { w: 1.8, h: 1.3 } // 玻璃发光面
const FRAME_T = 0.07 // 框条截面
const FRAME_D = 0.05 // 框条凸出墙面的厚度
const LIFT = 0.012 // 玻璃浮出墙面，防 z-fighting

const DAY_PANE = new THREE.Color(1.6, 1.15, 0.75) // 暖阳

export default class WallWindow {
  constructor() {
    this.experience = new Experience()
    this.scene = this.experience.scene

    this.setMeshes()
  }

  setMeshes() {
    this.group = new THREE.Group()
    this.group.position.set(CENTER.x, CENTER.y, WALL_INNER_Z)
    this.scene.add(this.group)

    // 自发光玻璃不依赖灯光。
    this.paneMaterial = new THREE.MeshBasicMaterial({ color: DAY_PANE, toneMapped: false })
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(PANE.w, PANE.h), this.paneMaterial)
    pane.position.z = LIFT
    this.group.add(pane)

    // 窗框：4 边框 + 十字棂，同墙面白色系
    const frameMaterial = new THREE.MeshStandardMaterial({ color: '#e8e4de', roughness: 0.9 })
    const bars = [
      // [宽, 高, x, y]
      [PANE.w + FRAME_T * 2, FRAME_T, 0, PANE.h / 2 + FRAME_T / 2], // 上
      [PANE.w + FRAME_T * 2, FRAME_T, 0, -PANE.h / 2 - FRAME_T / 2], // 下
      [FRAME_T, PANE.h, -PANE.w / 2 - FRAME_T / 2, 0], // 左
      [FRAME_T, PANE.h, PANE.w / 2 + FRAME_T / 2, 0], // 右
      [FRAME_T * 0.7, PANE.h, 0, 0], // 竖棂
      [PANE.w, FRAME_T * 0.7, 0, 0], // 横棂
    ]
    for (const [w, h, x, y] of bars) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(w, h, FRAME_D), frameMaterial)
      bar.position.set(x, y, LIFT + FRAME_D / 2)
      bar.receiveShadow = true
      this.group.add(bar)
    }
  }
}
