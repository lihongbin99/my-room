import * as THREE from 'three'
import Sizes from './Utils/Sizes.js'
import Time from './Utils/Time.js'
import Camera from './Camera.js'
import Navigation from './Navigation.js'
import Renderer from './Renderer.js'
import World from './World/World.js'
import ThemePanel from './ThemePanel.js'

let instance = null

export default class Experience {
  constructor(canvas) {
    if (instance) return instance
    instance = this

    this.canvas = canvas
    this.sizes = new Sizes()
    this.time = new Time()
    this.scene = new THREE.Scene()
    this.camera = new Camera()
    this.navigation = new Navigation()
    this.renderer = new Renderer()
    this.world = new World()
    this.themePanel = new ThemePanel()

    this.sizes.on('resize', () => {
      this.camera.resize()
      this.renderer.resize()
    })

    this.time.on('tick', () => {
      this.navigation.update()
      this.world.update()
      this.renderer.update()
    })
  }
}
