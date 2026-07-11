import * as THREE from 'three'
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js'
import Experience from '../Experience.js'

// 后墙发光窗（TODO 7.2）：自发光玻璃 + RectAreaLight 面光
// 白天透暖阳、夜里冷蓝月光（配色照 Room_Portfolio 的窗户 HDR 色收敛而来）
// 面光源不投影（three 不支持），影子由落地灯 spot 负责——两步捆绑的原因
const WALL_INNER_Z = -4 + 0.35 // 后墙内侧面
const CENTER = { x: -1.92, y: 3.6 } // 窗心：电脑桌正上方（桌组实测 x∈[-3.65,-0.19]；显示器顶 2.7，窗框底 2.88 留空隙）。电视上方让位给挂画 WallPainting
const PANE = { w: 1.8, h: 1.3 } // 玻璃发光面
const FRAME_T = 0.07 // 框条截面
const FRAME_D = 0.05 // 框条凸出墙面的厚度
const LIFT = 0.012 // 玻璃浮出墙面，防 z-fighting

// 玻璃 HDR 色（toneMapped:false，>1 的分量夜里会被 Bloom 拾取）
const DAY_PANE = new THREE.Color(1.6, 1.15, 0.75) // 暖阳
const NIGHT_PANE = new THREE.Color(0.55, 0.72, 1.9) // 冷月
// 白天强度压得很低：白天观感已锁定（勿提亮全屋），窗只需一点贴墙暖意
const DAY_LIGHT = { color: new THREE.Color('#ffd9a8'), intensity: 0.5 }
const NIGHT_LIGHT = { color: new THREE.Color('#8fa8ff'), intensity: 1.2 }

let ltcReady = false // RectAreaLight 的 LTC 查找表全局只需 init 一次

export default class WallWindow {
  constructor() {
    this.experience = new Experience()
    this.scene = this.experience.scene

    this.lastMix = -1 // 强制首帧 apply

    if (!ltcReady) {
      RectAreaLightUniformsLib.init()
      ltcReady = true
    }

    this.setMeshes()
    this.setLight()
  }

  setMeshes() {
    this.group = new THREE.Group()
    this.group.position.set(CENTER.x, CENTER.y, WALL_INNER_Z)
    this.scene.add(this.group)

    // 玻璃：自发光平面，颜色随昼夜插值
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

  setLight() {
    this.light = new THREE.RectAreaLight(DAY_LIGHT.color, DAY_LIGHT.intensity, PANE.w, PANE.h)
    this.light.position.set(CENTER.x, CENTER.y, WALL_INNER_Z + LIFT)
    this.light.lookAt(CENTER.x, CENTER.y, WALL_INNER_Z + 1) // 面向房间内(+z)
    this.scene.add(this.light)
  }

  update() {
    const mix = this.experience.world.environment.currentMix
    if (Math.abs(mix - this.lastMix) < 0.0005) return
    this.lastMix = mix

    this.paneMaterial.color.lerpColors(DAY_PANE, NIGHT_PANE, mix)
    this.light.color.lerpColors(DAY_LIGHT.color, NIGHT_LIGHT.color, mix)
    this.light.intensity = THREE.MathUtils.lerp(DAY_LIGHT.intensity, NIGHT_LIGHT.intensity, mix)
  }
}
