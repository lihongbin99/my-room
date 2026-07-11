import * as THREE from 'three'
import Experience from './Experience.js'

/**
 * 参考 brunosimon/my-room-in-3d 的 Navigation.js：
 * 拖动/滚轮只修改目标值（value），相机每帧以 smoothing * delta 的比例
 * 向目标值做指数插值（smoothed），从而产生由慢到快再到慢的跟随感。
 */
export default class Navigation {
  constructor() {
    this.experience = new Experience()
    this.canvas = this.experience.canvas
    this.camera = this.experience.camera
    this.sizes = this.experience.sizes
    this.time = this.experience.time

    this.setView()
  }

  setView() {
    this.enabled = true // 取书聚焦等场合置 false：忽略新的拖拽/缩放输入
    this.savedView = null // focus() 保存的聚焦前视角与限位，blur() 恢复

    this.view = {}

    this.view.spherical = {}
    this.view.spherical.value = new THREE.Spherical(20, Math.PI * 0.35, Math.PI * 0.25)
    this.view.spherical.smoothed = this.view.spherical.value.clone()
    this.view.spherical.smoothing = 0.005
    this.view.spherical.limits = {
      radius: { min: 6, max: 22 },
      phi: { min: 0.1, max: Math.PI * 0.45 },
      theta: { min: 0, max: Math.PI * 0.5 },
    }

    this.view.target = {}
    this.view.target.value = new THREE.Vector3(0, 1.6, 0)
    this.view.target.smoothed = this.view.target.value.clone()
    this.view.target.smoothing = 0.005
    this.view.target.limits = {
      x: { min: -3, max: 3 },
      y: { min: 0.5, max: 4 },
      z: { min: -3, max: 3 },
    }

    this.view.drag = {
      delta: { x: 0, y: 0 },
      previous: { x: 0, y: 0 },
      sensitivity: 1.2,
      alternative: false, // 右键/双指：平移视点而非旋转
    }

    this.view.zoom = {
      sensitivity: 0.01,
      delta: 0,
    }

    this.view.down = (x, y) => {
      this.view.drag.previous.x = x
      this.view.drag.previous.y = y
    }

    this.view.move = (x, y) => {
      this.view.drag.delta.x += x - this.view.drag.previous.x
      this.view.drag.delta.y += y - this.view.drag.previous.y
      this.view.drag.previous.x = x
      this.view.drag.previous.y = y
    }

    // 鼠标
    this.onMouseDown = (event) => {
      event.preventDefault()
      if (!this.enabled) return
      this.view.drag.alternative =
        event.button === 2 || event.button === 1 || event.ctrlKey || event.shiftKey
      this.view.down(event.clientX, event.clientY)
      window.addEventListener('mousemove', this.onMouseMove)
      window.addEventListener('mouseup', this.onMouseUp)
    }
    this.onMouseMove = (event) => {
      this.view.move(event.clientX, event.clientY)
    }
    this.onMouseUp = () => {
      window.removeEventListener('mousemove', this.onMouseMove)
      window.removeEventListener('mouseup', this.onMouseUp)
    }
    this.canvas.addEventListener('mousedown', this.onMouseDown)

    // 触摸
    this.onTouchStart = (event) => {
      event.preventDefault()
      if (!this.enabled) return
      this.view.drag.alternative = event.touches.length > 1
      this.view.down(event.touches[0].clientX, event.touches[0].clientY)
      window.addEventListener('touchmove', this.onTouchMove, { passive: false })
      window.addEventListener('touchend', this.onTouchEnd)
    }
    this.onTouchMove = (event) => {
      event.preventDefault()
      this.view.move(event.touches[0].clientX, event.touches[0].clientY)
    }
    this.onTouchEnd = () => {
      window.removeEventListener('touchmove', this.onTouchMove)
      window.removeEventListener('touchend', this.onTouchEnd)
    }
    this.canvas.addEventListener('touchstart', this.onTouchStart, { passive: false })

    // 滚轮缩放
    this.onWheel = (event) => {
      event.preventDefault()
      if (!this.enabled) return
      const pixelY = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY
      this.view.zoom.delta += pixelY
    }
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false })

    this.canvas.addEventListener('contextmenu', (event) => event.preventDefault())
  }

  // 通用聚焦（书架/屏幕等"两态交互"共用）：保存当前视角与限位，把目标值拨到
  // 指定机位（相机沿自带的指数平滑飞过去），同时收紧限位（锁角度、收距离等）。
  // 已处于聚焦时再次 focus 不覆盖最初保存的视角——blur() 一次性回到聚焦前的状态。
  focus({ target, radius, phi, theta, limits = {} }) {
    const view = this.view
    if (!this.savedView) {
      this.savedView = {
        spherical: view.spherical.value.clone(),
        target: view.target.value.clone(),
        sphericalLimits: JSON.parse(JSON.stringify(view.spherical.limits)),
        targetLimits: JSON.parse(JSON.stringify(view.target.limits)),
      }
    }
    for (const key of ['radius', 'phi', 'theta']) {
      if (limits[key]) view.spherical.limits[key] = limits[key]
    }
    for (const key of ['x', 'y', 'z']) {
      if (limits[key]) view.target.limits[key] = limits[key]
    }
    view.target.value.copy(target)
    view.spherical.value.set(radius, phi, theta)
  }

  // 退出聚焦：恢复聚焦前的视角和限位（飞回去本身就是"已退出"的反馈）
  blur() {
    if (!this.savedView) return
    const view = this.view
    view.spherical.value.copy(this.savedView.spherical)
    view.target.value.copy(this.savedView.target)
    view.spherical.limits = this.savedView.sphericalLimits
    view.target.limits = this.savedView.targetLimits
    this.savedView = null
    this.enabled = true
  }

  update() {
    const view = this.view

    // 缩放
    view.spherical.value.radius += view.zoom.delta * view.zoom.sensitivity
    view.spherical.value.radius = THREE.MathUtils.clamp(
      view.spherical.value.radius,
      view.spherical.limits.radius.min,
      view.spherical.limits.radius.max
    )

    // 拖动
    if (view.drag.alternative) {
      const up = new THREE.Vector3(0, 1, 0)
      const right = new THREE.Vector3(-1, 0, 0)
      up.applyQuaternion(this.camera.instance.quaternion)
      right.applyQuaternion(this.camera.instance.quaternion)
      up.multiplyScalar(view.drag.delta.y * 0.01)
      right.multiplyScalar(view.drag.delta.x * 0.01)
      view.target.value.add(up)
      view.target.value.add(right)

      view.target.value.x = THREE.MathUtils.clamp(view.target.value.x, view.target.limits.x.min, view.target.limits.x.max)
      view.target.value.y = THREE.MathUtils.clamp(view.target.value.y, view.target.limits.y.min, view.target.limits.y.max)
      view.target.value.z = THREE.MathUtils.clamp(view.target.value.z, view.target.limits.z.min, view.target.limits.z.max)
    } else {
      view.spherical.value.theta -= (view.drag.delta.x * view.drag.sensitivity) / this.sizes.smallestSide
      view.spherical.value.phi -= (view.drag.delta.y * view.drag.sensitivity) / this.sizes.smallestSide

      view.spherical.value.theta = THREE.MathUtils.clamp(view.spherical.value.theta, view.spherical.limits.theta.min, view.spherical.limits.theta.max)
      view.spherical.value.phi = THREE.MathUtils.clamp(view.spherical.value.phi, view.spherical.limits.phi.min, view.spherical.limits.phi.max)
    }

    view.drag.delta.x = 0
    view.drag.delta.y = 0
    view.zoom.delta = 0

    // 指数平滑：产生缓入缓出的跟随手感
    const factor = Math.min(1, view.spherical.smoothing * this.time.delta)
    view.spherical.smoothed.radius += (view.spherical.value.radius - view.spherical.smoothed.radius) * factor
    view.spherical.smoothed.phi += (view.spherical.value.phi - view.spherical.smoothed.phi) * factor
    view.spherical.smoothed.theta += (view.spherical.value.theta - view.spherical.smoothed.theta) * factor
    view.target.smoothed.lerp(view.target.value, Math.min(1, view.target.smoothing * this.time.delta))

    const viewPosition = new THREE.Vector3()
      .setFromSpherical(view.spherical.smoothed)
      .add(view.target.smoothed)

    this.camera.instance.position.copy(viewPosition)
    this.camera.instance.lookAt(view.target.smoothed)
  }
}
