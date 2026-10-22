import * as THREE from 'three'
import Experience from './Experience.js'
import BOOKS from './World/booksData.js'

// 保留 BIOS 外观，日志随真实加载进度输出；主体就绪立即进场。
export default class Loading {
  constructor() {
    this.experience = new Experience()
    this.root = document.getElementById('bios')
    this.log = document.getElementById('bios-log')
    this.revealed = new Promise((resolve) => { this.resolveRevealed = resolve })
    this.setManagerHooks()

    const { width, height, pixelRatio } = this.experience.sizes
    const gl = this.experience.renderer.instance.getContext()
    this.addLine('Boot Agent : three.js WebGL2')
    this.addLine(`Graphics   : ${gl.getParameter(gl.RENDERER) || 'Generic VGA'}`)
    this.addLine(`Display    : ${width}x${height} @${pixelRatio}x`)
    this.addLine('Detecting room assets ...')
  }

  addLine(text) {
    if (this.done) return
    const el = document.createElement('div')
    el.className = 'bios-line'
    el.textContent = text
    this.log.appendChild(el)
    this.root.scrollTop = this.root.scrollHeight
    return el
  }

  pad(label) {
    return label + ' ' + '.'.repeat(Math.max(2, 44 - label.length)) + ' '
  }

  setManagerHooks() {
    const seen = new Set()
    let embedded = 0
    const shortUrl = (url) => url.replace(/^https?:\/\/[^/]+/, '')
    THREE.DefaultLoadingManager.onProgress = (url) => {
      if (this.done) return
      if (/^(blob|data):/.test(url)) {
        this.embedEl ??= this.addLine('')
        this.embedEl.textContent = this.pad('  DECODING embedded textures') + `${++embedded} OK`
      } else if (!seen.has(url)) {
        seen.add(url)
        this.addLine(this.pad(`  LOADING ${shortUrl(url)}`) + 'OK')
      }
    }
    THREE.DefaultLoadingManager.onError = (url) => {
      if (!/^(blob|data):/.test(url)) this.addLine(this.pad(`  LOADING ${shortUrl(url)}`) + 'FAIL')
    }
  }

  async start() {
    const world = this.experience.world
    // 贴纸、书封面、挂画和桌面小物件可稍后补齐，电视入场后自动开机。
    await Promise.all([world.computerZone.ready, world.tvZone.ready])
    this.addLine(this.pad('Bookshelf') + `${BOOKS.filter((b) => b.finished).length} volumes OK`)
    this.prewarm()
    this.addLine('Boot complete. Entering room ...')
    this.reveal()
  }

  prewarm() {
    this.experience.world.update()
    this.experience.renderer.update()
  }

  reveal() {
    this.done = true
    this.root.classList.add('bios-hide')
    this.resolveRevealed()
    setTimeout(() => this.root.remove(), 250)
  }
}
