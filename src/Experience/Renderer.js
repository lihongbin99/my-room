import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import Experience from './Experience.js'

// Bloom 只在夜里有意义（发光体：灯罩 2.6 / 月窗 1.9 / LED 2.2 / 屏幕 1.35），
// 白天保持原直渲路径：零后期开销 + 画布 MSAA 不丢
const BLOOM = { strength: 0.55, radius: 0.5, threshold: 1.15 } // 阈值在线性 HDR 域（tonemap 前）
const COMPOSER_ON = 0.02 // currentMix 超过才走后期管线；切换点 bloom 强度 ≈0，无跳变

export default class Renderer {
  constructor() {
    this.experience = new Experience()
    this.stats = this.experience.stats
    this.canvas = this.experience.canvas
    this.sizes = this.experience.sizes
    this.scene = this.experience.scene
    this.camera = this.experience.camera

    this.setInstance()
    this.setComposer()
  }

  setInstance() {
    this.instance = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
    })
    this.instance.shadowMap.enabled = true
    this.instance.shadowMap.type = THREE.PCFSoftShadowMap
    this.instance.toneMapping = THREE.ACESFilmicToneMapping
    this.instance.toneMappingExposure = 1.1
    this.instance.setClearColor('#16121f')
    this.resize()

    if (this.stats) {
      this.stats.setRenderPanel(this.instance.getContext())
    }
  }

  setComposer() {
    const w = this.sizes.width * this.sizes.pixelRatio
    const h = this.sizes.height * this.sizes.pixelRatio
    // HalfFloat：HDR 缓冲，bloom 阈值 >1 才有意义；samples 4：弥补离屏渲染丢掉的画布 MSAA
    const target = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 })
    this.composer = new EffectComposer(this.instance, target)
    this.composer.addPass(new RenderPass(this.scene, this.camera.instance))
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(this.sizes.width, this.sizes.height),
      BLOOM.strength,
      BLOOM.radius,
      BLOOM.threshold
    )
    this.composer.addPass(this.bloomPass)
    this.composer.addPass(new OutputPass()) // 末端统一 ACES + sRGB，与直渲同参
    this.composer.setPixelRatio(this.sizes.pixelRatio)
    this.composer.setSize(this.sizes.width, this.sizes.height)
  }

  resize() {
    this.instance.setSize(this.sizes.width, this.sizes.height)
    this.instance.setPixelRatio(this.sizes.pixelRatio)
    this.composer?.setPixelRatio(this.sizes.pixelRatio)
    this.composer?.setSize(this.sizes.width, this.sizes.height)
  }

  update() {
    if (this.stats) this.stats.beforeRender()
    // Renderer 构造早于 World，首帧前 world 可能还没挂上
    const mix = this.experience.world?.environment?.currentMix ?? 0
    if (mix > COMPOSER_ON) {
      this.bloomPass.strength = BLOOM.strength * mix // 泛光随夜色渐入
      this.composer.render()
    } else {
      this.instance.render(this.scene, this.camera.instance)
    }
    if (this.stats) this.stats.afterRender()
  }
}
