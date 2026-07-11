import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import Experience from '../Experience.js'
import MarioTV from './MarioTV.js'
import CoffeeTableBooks from './CoffeeTableBooks.js'

// 电视区：电视柜、电视、Switch、双人沙发、茶几、Switch 手柄（6 个独立小模型，见 public/models/）
// 每件都走"转向 → 按包围盒缩放 → 对齐定位"的统一流程（fit + place）
// 尺寸按房间比例 1 单位 = 0.5m 估算，朝向常量对着画面微调
const WALL_INNER_Z = -4 + 0.35 // 后墙内侧面
const ZONE_X = 2.25 // 整区中心线：电视柜右端贴住地板 +x 边缘（3.95 - 3.4/2），各件 x 是相对它的偏移

const CABINET = { width: 3.4, x: 0 } // 电视柜：贴后墙
const TV = { width: 2.4, x: -0.45 } // 电视：柜面偏左，右边留给 Switch
const SWITCH = { width: 0.8, x: 1.2, offZ: 0.18 } // Switch 主机（平板+Joy-Con）竖在柜面右段
const SOFA = { width: 3.0, x: 0, z: 3.0 } // 沙发：面向电视（-z）
const TABLE = { height: 0.85, x: 0, z: 1.4 } // 茶几：沙发与电视之间
const CONTROLLER = { width: 0.42, dx: 0.42, dz: 0.3, rotY: Math.PI - 0.1 } // Switch 手柄：平放茶几右前角（dx/dz 相对茶几中心）；rotY≈π 时握把朝沙发、顶边正对电视（模型握把原始朝 -z），-0.1 让摆放不那么刻意

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
    const [cabinet, tv, switchGltf, sofa, table, controller] = await Promise.all([
      loader.loadAsync('/models/tv-cabinet.glb'),
      loader.loadAsync('/models/tv.glb'),
      loader.loadAsync('/models/switch.glb'),
      loader.loadAsync('/models/loveseat.glb'),
      loader.loadAsync('/models/coffee-table.glb'),
      loader.loadAsync('/models/switch-controller.glb'),
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

    this.setController(controller.scene, tableTop)

    // "正在读"的书堆上茶几，等它的封面图算加载收口的一部分
    this.books = new CoffeeTableBooks({ centerX: ZONE_X + TABLE.x, centerZ: TABLE.z, topY: tableTop })
    await this.books.ready
  }

  // Switch 手柄平放茶几（同 DeskProps 耳机的套路：rotX 躺倒、外层组转朝向）
  setController(model, tableTop) {
    // 模型里手柄挂的是 Dock 的材质：纯黑 + 粗糙度 1，渲出来是一团死黑剪影，
    // 换成深灰塑料让高光能起来（同 DeskProps 给白模马克杯换陶瓷的思路）
    const plastic = new THREE.MeshStandardMaterial({ color: '#36363c', roughness: 0.45, metalness: 0 })
    model.traverse((child) => {
      if (child.isMesh) {
        child.material = plastic
        child.castShadow = true
        child.receiveShadow = true
      }
    })
    model.rotation.x = Math.PI / 2 // 躺倒：转完指示灯/按键面朝上（rot-0/π/±π/2 四角度截图对比确认过）
    const wrapper = new THREE.Group()
    wrapper.name = 'switch-controller' // 调试用：控制台可直接抓来转角度
    wrapper.add(model)
    wrapper.rotation.y = CONTROLLER.rotY
    const size = new THREE.Box3().setFromObject(wrapper).getSize(new THREE.Vector3())
    wrapper.scale.setScalar(CONTROLLER.width / Math.max(size.x, size.z))
    const box = new THREE.Box3().setFromObject(wrapper)
    wrapper.position.x = ZONE_X + TABLE.x + CONTROLLER.dx - (box.min.x + box.max.x) / 2
    wrapper.position.y = tableTop - box.min.y
    wrapper.position.z = TABLE.z + CONTROLLER.dz - (box.min.z + box.max.z) / 2
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
