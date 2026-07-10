import EventEmitter from './EventEmitter.js'

export default class Sizes extends EventEmitter {
  constructor() {
    super()

    this.update()

    window.addEventListener('resize', () => {
      this.update()
      this.trigger('resize')
    })
  }

  update() {
    this.width = window.innerWidth
    this.height = window.innerHeight
    this.smallestSide = Math.min(this.width, this.height)
    this.pixelRatio = Math.min(window.devicePixelRatio, 1.5) // 高分屏上 2 太吃性能

  }
}
