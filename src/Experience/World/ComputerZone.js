import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import Experience from '../Experience.js'
import XPScreen from './XPScreen.js'

// 电脑区：桌、椅、主机、显示器、键鼠等，来自清理后的 computer-zone.glb
// （原始下载文件在 models-src/，用 scratchpad 的 gltf-transform 脚本裁剪压缩而来）
const TARGET_HEIGHT = 2.7 // 整组（含显示器）缩放到的高度，房间比例约 1 单位 = 0.5m
const WALL_INNER_Z = -4 + 0.35 // 后墙内侧面
const CENTER_X = -1.5 // 沿后墙的位置：电视柜左侧，整面左墙留给书架

// 椅子摇摆：座椅组件绕气杆轴左右缓摆（五星脚和轮子不动）
const SWIVEL_AMPLITUDE = 0.3 // 摆幅（弧度，约 ±17°，再大扶手会蹭到桌沿）
const SWIVEL_SPEED = 0.0006 // 角频率（毫秒制）

export default class ComputerZone {
  constructor() {
    this.experience = new Experience()
    this.scene = this.experience.scene
    this.time = this.experience.time

    this.group = new THREE.Group()
    this.scene.add(this.group)

    new GLTFLoader().load('/models/computer-zone.glb', (gltf) => {
      this.setModel(gltf.scene)
      this.setChairSwivel(gltf.scene)
      this.shiftDeskToCorner(gltf.scene)
      this.nudgeChair(gltf.scene)
      this.xpScreen = new XPScreen(gltf.scene) // 定位屏幕要在桌子推进墙角之后
    })
  }

  setModel(model) {
    model.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true
        child.receiveShadow = true
        // 透射（transmission）材质会让 three 每帧先把整个场景多渲染一遍
        // 到缓冲纹理做折射背景——核显上实测占掉近半帧时间（23→41fps）。
        // 机箱玻璃降级为普通半透明（保留 envMap 反射，只丢折射），肉眼无差
        if (child.material?.transmission > 0) {
          child.material.transmission = 0
          child.material.opacity = Math.min(child.material.opacity + 0.13, 1) // 补回透射丢失的透亮感
          child.material.needsUpdate = true
        }
      }
    })

    // 模型原始朝向面向 +z，正好背靠后墙、显示器面向房间，无需旋转

    // 统一缩放，再把包围盒贴到后墙、坐到地板上
    const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3())
    const scale = TARGET_HEIGHT / size.y
    model.scale.setScalar(scale)

    const box = new THREE.Box3().setFromObject(model)
    model.position.x += CENTER_X - (box.min.x + box.max.x) / 2
    model.position.y += -box.min.y
    model.position.z += WALL_INNER_Z - box.min.z

    this.group.add(model)
  }

  // 把座椅组件（坐垫/靠背/扶手/抱枕/气杆）挂到以五星脚中心为轴的空组上，
  // 轮子(Object_141)、五星脚(Object_144)和轮叉轮轴留在原地不转
  setChairSwivel(model) {
    const chair = model.getObjectByName('Object_34_69')
    const starBase = model.getObjectByName('Object_144')
    const plastic = model.getObjectByName('Object_140')
    if (!chair || !starBase) return

    model.updateMatrixWorld(true)
    const starBox = new THREE.Box3().setFromObject(starBase)
    const pivotCenter = starBox.getCenter(new THREE.Vector3())

    // Object_140 一个网格里混着座椅塑料件和轮叉/轮轴，先按位置切开
    if (plastic) this.splitChairBase(plastic, pivotCenter, starBox)

    const pivotLocal = chair.worldToLocal(pivotCenter.clone())
    this.chairPivot = new THREE.Group()
    this.chairPivot.position.copy(pivotLocal)
    chair.add(this.chairPivot)

    const fixed = new Set(['Object_141', 'Object_144', 'Object_140_base'])
    for (const child of [...chair.children]) {
      if (child === this.chairPivot || fixed.has(child.name)) continue
      this.chairPivot.attach(child) // attach 保持世界位置不变
    }
  }

  // 按三角形重心把网格切成"座椅部分"和"底座部分"：
  // 低于五星脚顶部一段、且离转轴较远的三角形（轮叉/轮轴）归底座；
  // 气杆虽然低但贴着转轴（半径小），保留在座椅组里转（圆柱体转起来看不出）
  splitChairBase(mesh, axis, starBox) {
    const yTop = starBox.max.y + (starBox.max.y - starBox.min.y) * 0.3
    const rMin = (starBox.max.x - starBox.min.x) * 0.15

    const geometry = mesh.geometry
    const position = geometry.attributes.position
    const index = geometry.index
    mesh.updateWorldMatrix(true, false)
    const toWorld = mesh.matrixWorld
    const v = new THREE.Vector3()

    const baseIndices = []
    const seatIndices = []
    const count = index ? index.count : position.count
    for (let t = 0; t < count; t += 3) {
      let cx = 0
      let cy = 0
      let cz = 0
      for (let k = 0; k < 3; k++) {
        const i = index ? index.getX(t + k) : t + k
        v.fromBufferAttribute(position, i).applyMatrix4(toWorld)
        cx += v.x / 3
        cy += v.y / 3
        cz += v.z / 3
      }
      const radial = Math.hypot(cx - axis.x, cz - axis.z)
      const target = cy < yTop && radial > rMin ? baseIndices : seatIndices
      for (let k = 0; k < 3; k++) target.push(index ? index.getX(t + k) : t + k)
    }
    if (!baseIndices.length || !seatIndices.length) return

    const makeGeometry = (indices) => {
      const g = new THREE.BufferGeometry()
      for (const name of Object.keys(geometry.attributes)) {
        g.setAttribute(name, geometry.attributes[name])
      }
      g.setIndex(indices)
      return g
    }

    const baseMesh = new THREE.Mesh(makeGeometry(baseIndices), mesh.material)
    baseMesh.name = 'Object_140_base'
    baseMesh.castShadow = true
    baseMesh.receiveShadow = true
    baseMesh.position.copy(mesh.position)
    baseMesh.quaternion.copy(mesh.quaternion)
    baseMesh.scale.copy(mesh.scale)
    mesh.parent.add(baseMesh)

    mesh.geometry = makeGeometry(seatIndices)
  }

  // 桌子及桌面物件沿后墙推进左墙角（贴左墙内侧 x=-3.65），椅子不动
  shiftDeskToCorner(model) {
    const WALL_INNER_X = -4 + 0.35
    const sceneRoot = model.getObjectByName('GLTF_SceneRootNode') || model
    const deskNodes = sceneRoot.children.filter((c) => c.name !== 'Object_34_69')

    const box = new THREE.Box3()
    for (const node of deskNodes) box.expandByObject(node)
    const delta = new THREE.Vector3(WALL_INNER_X - box.min.x, 0, 0)

    // 各节点的父级带旋转，世界位移要换算回各自父空间再写入 position
    for (const node of deskNodes) {
      const target = node.getWorldPosition(new THREE.Vector3()).add(delta)
      node.position.copy(node.parent.worldToLocal(target))
    }
  }

  // 椅子往房间里（+z）、沿墙侧向（+x）各挪一点：摆动时扶手不再转进桌柜里
  // （偏移值与老的左墙朝向等价：随模型转到后墙后一起旋转了 -90°）
  nudgeChair(model) {
    const CHAIR_OFFSET = new THREE.Vector3(0.35, 0, 0.38)
    const chair = model.getObjectByName('Object_34_69')
    if (!chair) return
    const target = chair.getWorldPosition(new THREE.Vector3()).add(CHAIR_OFFSET)
    chair.position.copy(chair.parent.worldToLocal(target))
  }

  update() {
    if (!this.chairPivot) return
    this.chairPivot.rotation.y = Math.sin(this.time.elapsed * SWIVEL_SPEED) * SWIVEL_AMPLITUDE
  }
}
