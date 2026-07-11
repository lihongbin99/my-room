import * as THREE from 'three'
import Experience from '../Experience.js'

// 桌面实体夜灯（TODO 7.3）：桌前沿下的 LED 灯带（夜里冰蓝呼吸）+ 桌角小台灯（暖光）
// 位置按桌子实测包围盒定：桌面 y≈1.43、前沿 z≈-2.26、跨 x∈[-3.65, -0.19]（右端被机箱占）
const LED = { x: -1.95, y: 1.36, z: -2.28, len: 2.7, t: 0.035 } // 前沿下方一指处
const LED_DAY = new THREE.Color(0.05, 0.08, 0.15) // 白天≈熄灭的深色塑料条
const LED_NIGHT = new THREE.Color(0.3, 1.0, 2.2) // 冰蓝 HDR（>1 分量夜里被 Bloom 拾取）
const PULSE = { speed: 0.0015, amp: 0.12 } // Bruno 式呼吸：sin 调制亮度

const LAMP = { x: -3.28, z: -3.15, baseY: 1.43, poleH: 0.34, shadeR: 0.07 } // 桌面左端墙角
// 强度别贪：台灯离墙 15cm，墙面像素被点光打到 >1.15 就会整片泛光白爆（调过一次）
const LAMP_LIGHT = { color: '#ffd29b', dist: 3.5, decay: 2, nightIntensity: 1.3 }
const LAMP_DAY_EMISSIVE = 0.1
const LAMP_NIGHT_EMISSIVE = 1.45

export default class DeskGlow {
  constructor() {
    this.experience = new Experience()
    this.scene = this.experience.scene
    this.time = this.experience.time

    this.lastMix = -1 // 强制首帧 apply

    this.setLed()
    this.setLamp()
  }

  setLed() {
    this.ledMaterial = new THREE.MeshBasicMaterial({ color: LED_DAY, toneMapped: false })
    const strip = new THREE.Mesh(new THREE.BoxGeometry(LED.len, LED.t, LED.t), this.ledMaterial)
    strip.position.set(LED.x, LED.y, LED.z)
    this.scene.add(strip)
    this.ledColor = new THREE.Color() // 呼吸调制前的基色，每帧复用避免分配
  }

  setLamp() {
    const group = new THREE.Group()
    group.position.set(LAMP.x, LAMP.baseY, LAMP.z)
    this.scene.add(group)

    const metal = new THREE.MeshStandardMaterial({ color: '#3a3a3e', roughness: 0.6, metalness: 0.4 })
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.02, 16), metal)
    base.position.y = 0.01
    group.add(base)
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, LAMP.poleH, 8), metal)
    pole.position.y = LAMP.poleH / 2
    group.add(pole)

    this.shadeMaterial = new THREE.MeshStandardMaterial({
      color: '#f5e9d8',
      emissive: LAMP_LIGHT.color,
      emissiveIntensity: LAMP_DAY_EMISSIVE,
      roughness: 1,
    })
    const shade = new THREE.Mesh(new THREE.SphereGeometry(LAMP.shadeR, 16, 12), this.shadeMaterial)
    shade.position.y = LAMP.poleH
    group.add(shade)

    // 夜间才点亮的小暖光，不投影（投影灯预算给了太阳和落地灯 spot）
    this.light = new THREE.PointLight(LAMP_LIGHT.color, 0, LAMP_LIGHT.dist, LAMP_LIGHT.decay)
    this.light.position.set(LAMP.x, LAMP.baseY + LAMP.poleH, LAMP.z)
    this.light.visible = false
    this.scene.add(this.light)
  }

  update() {
    const mix = this.experience.world.environment.currentMix
    const mixChanged = Math.abs(mix - this.lastMix) >= 0.0005
    // 白天（mix≈0）无呼吸动画可做，mix 没变就整帧跳过
    if (!mixChanged && mix < 0.03) return

    if (mixChanged) {
      this.lastMix = mix
      this.light.intensity = mix * LAMP_LIGHT.nightIntensity
      this.light.visible = this.light.intensity > 0.05
      this.shadeMaterial.emissiveIntensity = THREE.MathUtils.lerp(LAMP_DAY_EMISSIVE, LAMP_NIGHT_EMISSIVE, mix)
      this.ledColor.lerpColors(LED_DAY, LED_NIGHT, mix)
    }

    // LED 呼吸：夜里明显、白天归零
    const pulse = 1 + Math.sin(this.time.elapsed * PULSE.speed) * PULSE.amp * mix
    this.ledMaterial.color.copy(this.ledColor).multiplyScalar(pulse)
  }
}
