import EventEmitter from './EventEmitter.js'

export default class Time extends EventEmitter {
  constructor() {
    super()

    this.start = performance.now()
    this.current = this.start
    this.elapsed = 0
    this.delta = 16

    window.requestAnimationFrame(() => this.tick())
  }

  tick() {
    const now = performance.now()
    this.delta = now - this.current
    this.current = now
    this.elapsed = this.current - this.start

    this.trigger('tick')

    window.requestAnimationFrame(() => this.tick())
  }
}
