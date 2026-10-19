import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import Experience from '../Experience.js'

// 保留原先选定的白天亮度和颜色。
const blend = (a, b) => new THREE.Color(a).lerp(new THREE.Color(b), 0.5)
const DAY = {
  background: blend('#221c30', '#0c0a14'),
  hemiIntensity: 0.335,
  hemiSky: blend('#b9c5ff', '#4a5488'),
  sunColor: blend('#ffe3c0', '#7a86c9'),
  sunIntensity: 1.375,
  envIntensity: 0.29,
}

export default class Environment {
  constructor() {
    this.experience = new Experience()
    this.scene = this.experience.scene
    this.renderer = this.experience.renderer

    this.currentMix = 0 // 灯具和屏幕统一使用固定白天状态
    this.scene.background = DAY.background
    this.scene.environmentIntensity = DAY.envIntensity

    this.setEnvironment()
    this.setLights()
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

    // 白天主光
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

}
