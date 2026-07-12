import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import Experience from '../Experience.js'

// 白天 / 夜晚 两套光照参数，由 nightMix (0~1) 插值
// 最初的白天基准（BRIGHT_DAY）用户嫌太亮，选定了"拖到滑杆一半"的观感当白天，
// 所以 DAY 定义为 BRIGHT_DAY 与 NIGHT 各混 50%（2026-07 定案，勿直接调回）
const BRIGHT_DAY = {
  background: new THREE.Color('#221c30'),
  hemiIntensity: 0.55,
  hemiSky: new THREE.Color('#b9c5ff'),
  sunColor: new THREE.Color('#ffe3c0'),
  sunIntensity: 2.4,
  envIntensity: 0.5,
}

const NIGHT = {
  background: new THREE.Color('#0c0a14'),
  hemiIntensity: 0.12,
  hemiSky: new THREE.Color('#4a5488'),
  sunColor: new THREE.Color('#7a86c9'), // 夜晚主光变成冷色月光
  sunIntensity: 0.35,
  envIntensity: 0.08,
}

const half = (a, b) => THREE.MathUtils.lerp(a, b, 0.5)
const DAY = {
  background: new THREE.Color().lerpColors(BRIGHT_DAY.background, NIGHT.background, 0.5),
  hemiIntensity: half(BRIGHT_DAY.hemiIntensity, NIGHT.hemiIntensity),
  hemiSky: new THREE.Color().lerpColors(BRIGHT_DAY.hemiSky, NIGHT.hemiSky, 0.5),
  sunColor: new THREE.Color().lerpColors(BRIGHT_DAY.sunColor, NIGHT.sunColor, 0.5),
  sunIntensity: half(BRIGHT_DAY.sunIntensity, NIGHT.sunIntensity),
  envIntensity: half(BRIGHT_DAY.envIntensity, NIGHT.envIntensity),
}

export default class Environment {
  constructor() {
    this.experience = new Experience()
    this.scene = this.experience.scene
    this.renderer = this.experience.renderer

    this.nightMix = 0 // 目标值，由面板控制
    this.currentMix = 0 // 每帧向目标值缓动

    // 背景色走 scene.background 而非 renderer.setClearColor：
    // setClearColor 在调用瞬间按"当时绑定的渲染目标"决定颜色空间编码，
    // World.update 时目标是屏幕(sRGB)，下一刻 composer 却把它清进线性 HDR 缓冲，
    // OutputPass 再变换一遍 → 夜空背景被抬亮 4 倍；scene.background 是渲染时按当前目标换算，两条路径都对
    this.bgColor = new THREE.Color()
    this.scene.background = this.bgColor

    this.setEnvironment()
    this.setLights()
    this.apply(0)
  }

  // 环境贴图 IBL：没有它，GLB 模型里高金属度的 PBR 材质（椅子、机箱等）会发黑
  setEnvironment() {
    const pmrem = new THREE.PMREMGenerator(this.renderer.instance)
    this.scene.environment = pmrem.fromScene(new RoomEnvironment()).texture
    pmrem.dispose()
  }

  setLights() {
    this.hemi = new THREE.HemisphereLight(DAY.hemiSky, '#8a6a52', DAY.hemiIntensity)
    this.scene.add(this.hemi)

    // 主光：白天是暖阳，夜晚渐变为冷色月光
    this.sun = new THREE.DirectionalLight(DAY.sunColor, DAY.sunIntensity)
    this.sun.position.set(7, 10, 5)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(1024, 1024)
    this.sun.shadow.camera.near = 1
    this.sun.shadow.camera.far = 30
    this.sun.shadow.camera.left = -8
    this.sun.shadow.camera.right = 8
    this.sun.shadow.camera.top = 8
    this.sun.shadow.camera.bottom = -8
    this.sun.shadow.bias = -0.001
    this.sun.shadow.radius = 6
    this.scene.add(this.sun)
    // 暖色点光已迁到 FloorLamp.js（落地灯灯罩位置），不再由 Environment 管
  }

  setNightMix(value) {
    this.nightMix = THREE.MathUtils.clamp(value, 0, 1)
  }

  // 预热专用:绕过缓动把 currentMix 直接钉在指定值并立即应用。
  // 各夜灯模块在下一帧的 update() 里按 currentMix 自行跟进,渲染即呈现该状态
  pin(value) {
    this.nightMix = this.currentMix = THREE.MathUtils.clamp(value, 0, 1)
    this.apply(this.currentMix)
  }

  apply(mix) {
    this.hemi.intensity = THREE.MathUtils.lerp(DAY.hemiIntensity, NIGHT.hemiIntensity, mix)
    this.hemi.color.lerpColors(DAY.hemiSky, NIGHT.hemiSky, mix)
    this.sun.intensity = THREE.MathUtils.lerp(DAY.sunIntensity, NIGHT.sunIntensity, mix)
    this.sun.color.lerpColors(DAY.sunColor, NIGHT.sunColor, mix)
    this.scene.environmentIntensity = THREE.MathUtils.lerp(DAY.envIntensity, NIGHT.envIntensity, mix)

    this.bgColor.lerpColors(DAY.background, NIGHT.background, mix)
  }

  update() {
    // 缓动到目标值，让拖动滑杆时光照平滑过渡
    // 收敛后钉到目标再按"值有变化"决定 apply——低帧率下(大 delta)缓动会一步跳到目标值，
    // 旧写法(diff > 阈值才 apply)会跳过最后一次应用，夜色停在半路（无头截图时踩过）
    const delta = this.experience.time.delta
    const prev = this.currentMix
    this.currentMix += (this.nightMix - this.currentMix) * Math.min(1, 0.005 * delta)
    if (Math.abs(this.nightMix - this.currentMix) <= 0.0005) this.currentMix = this.nightMix
    if (this.currentMix !== prev) {
      this.apply(this.currentMix)
    }
  }
}
