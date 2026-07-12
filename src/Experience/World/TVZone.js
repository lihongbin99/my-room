import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import Experience from '../Experience.js'
import MarioTV from './MarioTV.js'
import CoffeeTableBooks from './CoffeeTableBooks.js'
import { assetUrl } from '../assets.js'

// 电视区：电视柜、电视、Switch、双人沙发、茶几、一对游戏手柄（6 个独立小模型，见 public/models/）
// 每件都走"转向 → 按包围盒缩放 → 对齐定位"的统一流程（fit + place）
// 尺寸按房间比例 1 单位 = 0.5m 估算，朝向常量对着画面微调
const WALL_INNER_Z = -4 + 0.35 // 后墙内侧面
const ZONE_X = 2.25 // 整区中心线：电视柜右端贴住地板 +x 边缘（3.95 - 3.4/2），各件 x 是相对它的偏移

const CABINET = { width: 3.4, x: 0 } // 电视柜：贴后墙
const TV = { width: 2.4, x: -0.45 } // 电视：柜面偏左，右边留给 Switch
const SWITCH = { width: 0.8, x: 1.2, offZ: 0.18 } // Switch 主机（平板+Joy-Con）竖在柜面右段
const SOFA = { width: 3.0, x: 0, z: 3.0 } // 沙发：面向电视（-z）
const TABLE = { height: 0.85, x: 0, z: 1.4 } // 茶几：沙发与电视之间
const GAMEPADS = { span: 0.8, dx: 0.35, dz: 0.3, rotZ: Math.PI / 4, rotY: -Math.PI / 2 - 0.1 } // 一对游戏手柄（一白一黑）：并排平放茶几右前（dx/dz 相对茶几中心，span 是两只总跨度）。模型原始姿态是斜靠 45°（宽度沿 z），rotZ 绕宽度轴滚 45° 才真躺平按键朝上——校准方法是扫翻滚角找包围盒最矮点（45° 高 0.137 / 90° 高 0.198，±90° 看着都像侧立；对面 -135° 是背面朝上），rotY≈-π/2 转成握把朝沙发、顶边对电视，-0.1 让摆放不那么刻意

export default class TVZone {
  constructor() {
    this.experience = new Experience()
    this.scene = this.experience.scene

    this.group = new THREE.Group()
    this.scene.add(this.group)

    // ready 给 Loading（BIOS 开机屏）收口用：5 个 GLB 加载装配完成
    this.ready = this.setup().catch((error) => {
      console.error('电视区模型加载失败：', error)
    })
  }

  async setup() {
    const loader = new GLTFLoader()
    loader.setMeshoptDecoder(MeshoptDecoder) // gamepads.glb 经 crush-glb.mjs 压缩，带 EXT_meshopt_compression
    const [cabinet, tv, switchGltf, sofa, table, gamepads] = await Promise.all([
      loader.loadAsync(assetUrl('/models/tv-cabinet.glb')),
      loader.loadAsync(assetUrl('/models/tv.glb')),
      loader.loadAsync(assetUrl('/models/switch.glb')),
      loader.loadAsync(assetUrl('/models/loveseat.glb')),
      loader.loadAsync(assetUrl('/models/coffee-table.glb')),
      loader.loadAsync(assetUrl('/models/gamepads.glb')),
    ])

    // 电视柜：模型自带朝向面向 +z（前面板在 z 正侧），背贴后墙
    const cabinetModel = this.fit(cabinet.scene, { width: CABINET.width })
    this.place(cabinetModel, { x: ZONE_X + CABINET.x, backZ: WALL_INNER_Z })
    const cabinetTop = new THREE.Box3().setFromObject(cabinetModel).max.y

    // 电视：摆上柜面，屏幕面向房间（+z）
    const tvModel = this.fit(tv.scene, { width: TV.width })
    this.place(tvModel, { x: ZONE_X + TV.x, backZ: WALL_INNER_Z + 0.08, onY: cabinetTop })
    tvModel.updateWorldMatrix(true, true) // MarioTV 里要按世界包围盒定屏幕位置
    this.marioTV = new MarioTV(tvModel)

    // Switch 主机（模型已裁剪到只剩平板+Joy-Con），竖在柜面上，模型原始朝向背对房间，转 180°
    const switchModel = this.fit(switchGltf.scene, { rotationY: Math.PI, width: SWITCH.width })
    this.place(switchModel, {
      x: ZONE_X + SWITCH.x,
      backZ: WALL_INNER_Z + SWITCH.offZ,
      onY: cabinetTop,
    })

    // 沙发：房间前部，转 180° 面向电视
    const sofaModel = this.fit(sofa.scene, { rotationY: Math.PI, width: SOFA.width })
    this.place(sofaModel, { x: ZONE_X + SOFA.x, z: SOFA.z })

    // 茶几：沙发前（GLB 里烘死的书已用 prune-glb --drop 删掉，水杯保留）
    const tableModel = this.fit(table.scene, { height: TABLE.height })
    this.place(tableModel, { x: ZONE_X + TABLE.x, z: TABLE.z })
    tableModel.updateWorldMatrix(true, true)
    // 桌面高度取大理石台面的世界包围盒（整模包围盒最高点是水杯，不能用）
    const tableTop = new THREE.Box3()
      .setFromObject(tableModel.getObjectByName('Cube_Marble_0'))
      .max.y

    this.setGamepads(gamepads.scene, tableTop)

    // "正在读"的书堆上茶几，等它的封面图算加载收口的一部分
    this.books = new CoffeeTableBooks({ centerX: ZONE_X + TABLE.x, centerZ: TABLE.z, topY: tableTop })
    await this.books.ready
  }

  // 一对游戏手柄平放茶几（模型 gamepads.glb 自带两只并排、各有彩色贴图，整组当一个物件摆）
  setGamepads(model, tableTop) {
    model.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true
        child.receiveShadow = true
        // 源模型 roughness 全 0（镜面塑料），钳到哑光塑料区间，免得高光刺眼
        child.material.roughness = Math.max(child.material.roughness, 0.4)
      }
    })
    model.rotation.z = GAMEPADS.rotZ // 放倒：绕宽度轴转 90° 让按键面朝上
    const wrapper = new THREE.Group()
    wrapper.name = 'gamepads' // 调试用：控制台可直接抓来转角度
    wrapper.add(model)
    wrapper.rotation.y = GAMEPADS.rotY
    const size = new THREE.Box3().setFromObject(wrapper).getSize(new THREE.Vector3())
    wrapper.scale.setScalar(GAMEPADS.span / Math.max(size.x, size.z))
    const box = new THREE.Box3().setFromObject(wrapper, true) // precise：模型内部带旋转，默认盒虚胖会悬空
    wrapper.position.x = ZONE_X + TABLE.x + GAMEPADS.dx - (box.min.x + box.max.x) / 2
    wrapper.position.y = tableTop - box.min.y
    wrapper.position.z = TABLE.z + GAMEPADS.dz - (box.min.z + box.max.z) / 2
    this.group.add(wrapper)
  }

  update() {
    this.marioTV?.update()
    this.books?.update() // 茶几书的悬停/取书动画（cursor 后写者赢，与电视区域不重叠）
  }

  // 统一预处理：阴影、朝向、按包围盒宽或高缩放到目标尺寸
  fit(model, { rotationX = 0, rotationY = 0, width, height }) {
    model.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true
        child.receiveShadow = true
      }
    })
    model.rotation.set(rotationX, rotationY, 0)
    const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3())
    model.scale.setScalar(width ? width / size.x : height / size.y)
    this.group.add(model)
    return model
  }

  // 按包围盒对齐：x/z 居中到给定值，backZ 把背面贴到给定 z，onY 落到给定高度（默认落地）
  place(model, { x = null, z = null, backZ = null, onY = 0 }) {
    const box = new THREE.Box3().setFromObject(model)
    if (x !== null) model.position.x += x - (box.min.x + box.max.x) / 2
    if (backZ !== null) model.position.z += backZ - box.min.z
    else if (z !== null) model.position.z += z - (box.min.z + box.max.z) / 2
    model.position.y += onY - box.min.y
  }
}
