import * as THREE from 'three'
import Experience from '../Experience.js'

// 电视上方的宽幅挂画（婚纱照）：香槟金框条 + 暖白卡纸衬边 + 照片平面
// 照片纹理走 DefaultLoadingManager（BIOS 日志自然打一行），另暴露 ready 给 Loading 收口
// 夜里房间只剩灯带/落地灯照不到墙上部，照片给一点自发光渐亮免得全黑
const WALL_INNER_Z = -4 + 0.35 // 后墙内侧面
const CENTER = { x: 1.8, y: 3.6 } // 画心：电视正上方，与窗户同水平线（窗心 y=3.6；画框 2.90~4.30 与窗框 2.88~4.32 上下沿也基本对齐）
const PHOTO = { w: 2.1, h: (2.1 * 9) / 16 } // 照片 16:9（public/paintings/wedding.webp，1600×900）
const MAT_T = 0.05 // 卡纸衬边宽
const FRAME_T = 0.06 // 框条截面宽
const FRAME_D = 0.045 // 框条凸出墙面的厚度
const LIFT = 0.012 // 浮出墙面，防 z-fighting

const NIGHT_EMISSIVE = 0.3 // 夜间照片自发光上限，远低于 Bloom 阈值 1.15 不泛光

export default class WallPainting {
  constructor() {
    this.experience = new Experience()
    this.scene = this.experience.scene

    this.lastMix = -1 // 强制首帧 apply

    this.setMeshes()
    this.ready = this.loadPhoto() // 约定：加载失败也 resolve，不卡 BIOS 开机
  }

  setMeshes() {
    this.group = new THREE.Group()
    this.group.position.set(CENTER.x, CENTER.y, WALL_INNER_Z)
    this.scene.add(this.group)

    const matW = PHOTO.w + MAT_T * 2
    const matH = PHOTO.h + MAT_T * 2

    // 卡纸衬边（兼照片背板）：暖白，四周露出一圈
    const mat = new THREE.Mesh(
      new THREE.PlaneGeometry(matW, matH),
      new THREE.MeshStandardMaterial({ color: '#f4efe6', roughness: 0.95 })
    )
    mat.position.z = LIFT
    mat.receiveShadow = true
    this.group.add(mat)

    // 照片：贴图到位前 emissiveIntensity 为 0，白天全靠场景光
    this.photoMaterial = new THREE.MeshStandardMaterial({
      roughness: 0.85,
      emissive: '#ffffff', // 配 emissiveMap 用，实际亮度走 emissiveIntensity
      emissiveIntensity: 0,
    })
    const photo = new THREE.Mesh(new THREE.PlaneGeometry(PHOTO.w, PHOTO.h), this.photoMaterial)
    photo.position.z = LIFT + 0.004
    this.group.add(photo)

    // 框条：香槟金属，4 边包住卡纸
    const frameMaterial = new THREE.MeshStandardMaterial({
      color: '#b08d57',
      metalness: 0.7,
      roughness: 0.35,
    })
    const bars = [
      // [宽, 高, x, y]
      [matW + FRAME_T * 2, FRAME_T, 0, matH / 2 + FRAME_T / 2], // 上
      [matW + FRAME_T * 2, FRAME_T, 0, -matH / 2 - FRAME_T / 2], // 下
      [FRAME_T, matH, -matW / 2 - FRAME_T / 2, 0], // 左
      [FRAME_T, matH, matW / 2 + FRAME_T / 2, 0], // 右
    ]
    for (const [w, h, x, y] of bars) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(w, h, FRAME_D), frameMaterial)
      bar.position.set(x, y, LIFT + FRAME_D / 2)
      bar.receiveShadow = true
      this.group.add(bar)
    }
  }

  loadPhoto() {
    return new Promise((resolve) => {
      new THREE.TextureLoader().load(
        '/paintings/wedding.webp',
        (texture) => {
          texture.colorSpace = THREE.SRGBColorSpace
          this.photoMaterial.map = texture
          this.photoMaterial.emissiveMap = texture
          this.photoMaterial.needsUpdate = true
          resolve(true)
        },
        undefined,
        () => resolve(false)
      )
    })
  }

  update() {
    const mix = this.experience.world.environment.currentMix
    if (Math.abs(mix - this.lastMix) < 0.0005) return
    this.lastMix = mix

    this.photoMaterial.emissiveIntensity = NIGHT_EMISSIVE * mix
  }
}
