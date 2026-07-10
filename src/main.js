import Experience from './Experience/Experience.js'

// 挂到 window 便于控制台调试（调相机、灯光参数等）
window.experience = new Experience(document.querySelector('canvas.webgl'))
