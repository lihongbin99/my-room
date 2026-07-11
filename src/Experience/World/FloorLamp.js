import * as THREE from 'three'
import Experience from '../Experience.js'

// 占位落地灯（TODO 7.1）：给原本浮空的暖色点光一个实体来源，并让夜间有真实影子
// 点光从 Environment 迁来（全屋暖泛光、不投影）；投影交给一盏向下的 spot——
// PointLight 开阴影是 6 面 cube pass，核显扛不住，spot 只要一张 512 深度图
const POS = new THREE.Vector3(0.35, 0, 3.35) // 沙发左扶手外侧，避开茶几(2.25,1.4)和左墙书架
const SHADE_Y = 1.5 // 灯罩球心离地高度
const SHADE_R = 0.22 // 灯罩球半径
const POLE_R = 0.025 // 灯杆半径
const BASE = { r: 0.18, h: 0.04 } // 底座圆盘
const LIGHT_COLOR = '#ffb46e' // 沿用原 Environment 暖灯色

// 白天点光强度 = 原 Environment 的 half(1.5, 10)，保持已锁定的白天观感不变
const DAY = { pointIntensity: 5.75, spotIntensity: 0, shadeEmissive: 0.15 }
const NIGHT = { pointIntensity: 10, spotIntensity: 8, shadeEmissive: 2.6 }

export default class FloorLamp {
  constructor() {
    this.experience = new Experience()
    this.scene = this.experience.scene

    this.lastMix = -1 // 强制首帧 apply

    this.setMeshes()
    this.setLights()
  }

  setMeshes() {
    this.group = new THREE.Group()
    this.group.position.copy(POS)
    this.scene.add(this.group)

    const metal = new THREE.MeshStandardMaterial({ color: '#3a3a3e', roughness: 0.6, metalness: 0.4 })

    const base = new THREE.Mesh(new THREE.CylinderGeometry(BASE.r, BASE.r, BASE.h, 24), metal)
    base.position.y = BASE.h / 2
    base.castShadow = true
    base.receiveShadow = true
    this.group.add(base)

    const pole = new THREE.Mesh(new THREE.CylinderGeometry(POLE_R, POLE_R, SHADE_Y, 12), metal)
    pole.position.y = SHADE_Y / 2
    pole.castShadow = true
    this.group.add(pole)

    // 灯罩：白天吃场景光呈现"关着的灯罩"，夜里 emissive 拉高（>Bloom 阈值 1.15，泛光靠它）
    // 不投影：既不挡自己的 spot，也省一个 caster
    this.shadeMaterial = new THREE.MeshStandardMaterial({
      color: '#f5e9d8',
      emissive: LIGHT_COLOR,
      emissiveIntensity: DAY.shadeEmissive,
      roughness: 1,
    })
    const shade = new THREE.Mesh(new THREE.SphereGeometry(SHADE_R, 24, 16), this.shadeMaterial)
    shade.position.y = SHADE_Y
    this.group.add(shade)
  }

  setLights() {
    // 全屋暖泛光（从 Environment 迁来），不投影
    this.point = new THREE.PointLight(LIGHT_COLOR, DAY.pointIntensity, 14, 2)
    this.point.position.set(POS.x, SHADE_Y, POS.z)
    this.scene.add(this.point)

    // 夜间地面光池 + 软影；白天 visible=false 连阴影 pass 一起省
    this.spot = new THREE.SpotLight('#ffc687', DAY.spotIntensity, 7, 1.0, 0.6, 2)
    this.spot.position.set(POS.x, SHADE_Y, POS.z)
    this.spot.target.position.set(POS.x, 0, POS.z)
    this.spot.castShadow = true
    this.spot.shadow.mapSize.set(512, 512)
    this.spot.shadow.camera.near = 0.35 // > 灯罩半径，灯罩被近裁剪面剔除、不投自己
    this.spot.shadow.camera.far = 4
    this.spot.shadow.bias = -0.002
    this.spot.shadow.radius = 4
    this.spot.visible = false
    this.scene.add(this.spot)
    this.scene.add(this.spot.target)
  }

  update() {
    const mix = this.experience.world.environment.currentMix
    if (Math.abs(mix - this.lastMix) < 0.0005) return
    this.lastMix = mix

    this.point.intensity = THREE.MathUtils.lerp(DAY.pointIntensity, NIGHT.pointIntensity, mix)
    this.spot.intensity = THREE.MathUtils.lerp(DAY.spotIntensity, NIGHT.spotIntensity, mix)
    this.spot.visible = this.spot.intensity > 0.05
    this.shadeMaterial.emissiveIntensity = THREE.MathUtils.lerp(DAY.shadeEmissive, NIGHT.shadeEmissive, mix)
  }
}
