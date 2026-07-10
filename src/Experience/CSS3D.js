import * as THREE from 'three'
import { CSS3DRenderer } from 'three/addons/renderers/CSS3DRenderer.js'
import Experience from './Experience.js'

// CSS3D 渲染层：与 WebGL 共用同一个相机，把 iframe 等真实 DOM 按 3D 变换
// 叠放在 canvas 之上（简化"浮层"方案，未做挖洞遮挡——聚焦机位正对屏幕、
// 屏幕贴墙，前方没有会挡住它的物体；日后穿帮再升级挖洞法）。
// 容器 pointer-events:none，需要交互的元素自己开 auto：iframe 之外的
// 鼠标/滚轮事件穿透到 canvas，导航的拖拽缩放、"点屏幕外退出"照常工作。
export default class CSS3D {
  constructor() {
    this.experience = new Experience()
    this.sizes = this.experience.sizes
    this.camera = this.experience.camera

    this.scene = new THREE.Scene()
    this.instance = new CSS3DRenderer()

    const el = this.instance.domElement
    el.style.position = 'fixed'
    el.style.top = '0'
    el.style.left = '0'
    el.style.pointerEvents = 'none'
    el.style.zIndex = '5' // canvas 之上、ThemePanel/caption（z=10）之下
    document.body.appendChild(el)

    this.resize()
  }

  resize() {
    this.instance.setSize(this.sizes.width, this.sizes.height)
  }

  update() {
    if (this.scene.children.length === 0) return // 默认态没有元素，跳过（零开销）
    this.instance.render(this.scene, this.camera.instance)
  }
}
