import * as THREE from 'three'
import Sizes from './Utils/Sizes.js'
import Time from './Utils/Time.js'
import Stats from './Utils/Stats.js'
import Camera from './Camera.js'
import Navigation from './Navigation.js'
import Renderer from './Renderer.js'
import CSS3D from './CSS3D.js'
import World from './World/World.js'
import ThemePanel from './ThemePanel.js'
import Loading from './Loading.js'

let instance = null

export default class Experience {
  constructor(canvas) {
    if (instance) return instance
    instance = this

    this.canvas = canvas
    this.sizes = new Sizes()
    this.time = new Time()
    this.stats = new Stats(this.sizes.width > 420)
    this.scene = new THREE.Scene()
    this.camera = new Camera()
    this.navigation = new Navigation()
    this.renderer = new Renderer()
    this.css3d = new CSS3D()
    this.loading = new Loading() // 必须先于 World：DefaultLoadingManager 钩子要赶在各模块开始加载前挂上
    this.world = new World()
    this.themePanel = new ThemePanel()
    this.loading.start()

    this.sizes.on('resize', () => {
      this.camera.resize()
      this.renderer.resize()
      this.css3d.resize()
    })

    this.time.on('tick', () => {
      this.stats.update()
      this.navigation.update()
      this.world.update()
      this.renderer.update()
      this.css3d.update()
    })
  }
}
