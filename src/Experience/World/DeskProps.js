import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import Experience from '../Experience.js'
import { assetUrl } from '../assets.js'

// 桌面小物件（TODO 1 遗留）：键盘左边的头戴耳机 + Java 马克杯（咖啡液面 + 热气）
// headphones.glb 经 tools/crush-glb.mjs 压缩，带 EXT_meshopt_compression，加载要挂 MeshoptDecoder
// 位置按运行时实测：桌面 y≈1.43；键盘 Object_60 x∈[-2.55,-1.37] z∈[-3.01,-2.49]；
// 桌垫 Object_30 左缘 x=-3.01、顶面 y≈1.44；台灯占着后左角 (-3.28, -3.15)
const HEADPHONES = { x: -3.3, y: 1.43, z: -2.75, length: 0.5, rotY: 0.55 } // 桌垫左侧裸桌面，平放微转向房间
const MUG = { x: -2.78, y: 1.44, z: -2.7, height: 0.22, rotY: -0.35 } // 键盘左边桌垫上，手柄朝右前
const COFFEE_LEVEL = 0.78 // 液面高度（占杯高比例）
const COFFEE_COLOR = '#2a1a10' // 深咖啡色
const DECAL_ROT_Y = 0.6 // Java 贴纸朝向：相机限在 +x/+z 象限，法线也指向那边（与手柄朝向无关）
// 热气必须近白：ShaderMaterial 不过色调映射直出颜色，中灰在白天亮墙前会渲染成"黑烟"
const STEAM = { width: 0.14, height: 0.42, color: '#eef2f6', timeFrequency: 0.0004, uvFrequency: new THREE.Vector2(4, 5) }

// 热气 shader 移植自 reference/my-room-in-3d 的 CoffeeSteam（perlin 噪声扰动 + 边缘淡出）
const PERLIN_2D = /* glsl */ `
vec2 fade(vec2 t) {return t*t*t*(t*(t*6.0-15.0)+10.0);}
vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x, 289.0);}
float perlin2d(vec2 P){
  vec4 Pi = floor(P.xyxy) + vec4(0.0, 0.0, 1.0, 1.0);
  vec4 Pf = fract(P.xyxy) - vec4(0.0, 0.0, 1.0, 1.0);
  Pi = mod(Pi, 289.0);
  vec4 ix = Pi.xzxz;
  vec4 iy = Pi.yyww;
  vec4 fx = Pf.xzxz;
  vec4 fy = Pf.yyww;
  vec4 i = permute(permute(ix) + iy);
  vec4 gx = 2.0 * fract(i * 0.0243902439) - 1.0;
  vec4 gy = abs(gx) - 0.5;
  vec4 tx = floor(gx + 0.5);
  gx = gx - tx;
  vec2 g00 = vec2(gx.x,gy.x);
  vec2 g10 = vec2(gx.y,gy.y);
  vec2 g01 = vec2(gx.z,gy.z);
  vec2 g11 = vec2(gx.w,gy.w);
  vec4 norm = 1.79284291400159 - 0.85373472095314 *
    vec4(dot(g00, g00), dot(g01, g01), dot(g10, g10), dot(g11, g11));
  g00 *= norm.x;
  g01 *= norm.y;
  g10 *= norm.z;
  g11 *= norm.w;
  float n00 = dot(g00, vec2(fx.x, fy.x));
  float n10 = dot(g10, vec2(fx.y, fy.y));
  float n01 = dot(g01, vec2(fx.z, fy.z));
  float n11 = dot(g11, vec2(fx.w, fy.w));
  vec2 fade_xy = fade(Pf.xy);
  vec2 n_x = mix(vec2(n00, n01), vec2(n10, n11), fade_xy.x);
  float n_xy = mix(n_x.x, n_x.y, fade_xy.y);
  return 2.3 * n_xy;
}
`

const STEAM_VERTEX = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
${PERLIN_2D}
void main() {
  vec3 newPosition = position;
  vec2 displacementUv = uv * 5.0;
  displacementUv.y -= uTime * 0.0002;
  float displacementStrength = pow(uv.y * 3.0, 2.0);
  newPosition.x += perlin2d(displacementUv) * displacementStrength * 0.025;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(newPosition, 1.0);
  vUv = uv;
}
`

const STEAM_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uTimeFrequency;
uniform vec2 uUvFrequency;
uniform vec3 uColor;
varying vec2 vUv;
${PERLIN_2D}
void main() {
  vec2 uv = vUv * uUvFrequency;
  uv.y -= uTime * uTimeFrequency;
  float borderAlpha = min(vUv.x * 4.0, (1.0 - vUv.x) * 4.0);
  borderAlpha = borderAlpha * (1.0 - vUv.y) * smoothstep(0.0, 0.15, vUv.y);
  float perlin = perlin2d(uv);
  perlin *= borderAlpha;
  perlin *= 0.65;
  gl_FragColor = vec4(uColor, min(perlin, 1.0));
}
`

export default class DeskProps {
  constructor() {
    this.experience = new Experience()
    this.scene = this.experience.scene
    this.time = this.experience.time
    this.camera = this.experience.camera

    this.group = new THREE.Group()
    this.scene.add(this.group)

    const loader = new GLTFLoader()
    loader.setMeshoptDecoder(MeshoptDecoder)

    // ready 给 Loading（BIOS）收口：resolve {headphones, mug}，失败也 resolve 不卡开机
    const loadOne = (url, onLoaded) =>
      new Promise((resolve) => {
        loader.load(
          url,
          (gltf) => {
            onLoaded(gltf.scene)
            resolve(true)
          },
          undefined,
          (error) => {
            console.error(`${url} 加载失败：`, error)
            resolve(false)
          }
        )
      })

    this.ready = Promise.all([
      loadOne(assetUrl('/models/headphones.glb'), (model) => this.setHeadphones(model)),
      loadOne(assetUrl('/models/mug.glb'), (model) => this.setMug(model)),
    ]).then(async ([headphones, mug]) => {
      await (this.decalReady ?? Promise.resolve()) // Java 贴纸图也算 mug 就绪的一部分
      return { headphones, mug }
    })
  }

  // 平放在桌上：耳罩朝下、按钮面朝上（rotX 后模型 y 向变 z 向，再用外层组转朝向）
  // 现用模型 headphone_mesh（原立姿），同一套变换正好放平，换模型只覆盖 GLB 即可
  setHeadphones(model) {
    model.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true
        child.receiveShadow = true
      }
    })
    model.rotation.x = -Math.PI / 2 // 躺倒：按钮/音量面朝上，拱架指向墙、开口朝房间
    const wrapper = new THREE.Group()
    wrapper.add(model)
    wrapper.rotation.y = HEADPHONES.rotY

    // 必须 precise 逐顶点算：模型内部多层旋转，默认的"局部盒过世界矩阵"虚胖一大圈，
    // 按虚胖盒落地=实际几何悬空（headphone_mesh 换上来时踩过，悬空约 0.2）
    const size = new THREE.Box3().setFromObject(wrapper, true).getSize(new THREE.Vector3())
    wrapper.scale.setScalar(HEADPHONES.length / Math.max(size.x, size.z))

    const box = new THREE.Box3().setFromObject(wrapper, true)
    wrapper.position.x = HEADPHONES.x - (box.min.x + box.max.x) / 2
    wrapper.position.y = HEADPHONES.y - box.min.y
    wrapper.position.z = HEADPHONES.z - (box.min.z + box.max.z) / 2
    this.group.add(wrapper)
  }

  setMug(model) {
    // 白模无贴图且 metal=1（无 IBL 时死黑、有 IBL 像镀铬），换成白陶瓷
    const ceramic = new THREE.MeshStandardMaterial({ color: '#f2ede6', roughness: 0.35, metalness: 0 })
    model.traverse((child) => {
      if (child.isMesh) {
        child.material = ceramic
        child.castShadow = true
        child.receiveShadow = true
      }
    })

    // 不用 fit()：包围盒含手柄不对称，好在模型原点就在杯身轴心——
    // 把原点钉到 (x, z)，液面/贴纸/热气才能与杯身同心
    model.rotation.y = MUG.rotY
    const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3())
    model.scale.setScalar(MUG.height / size.y)
    const box = new THREE.Box3().setFromObject(model)
    model.position.set(MUG.x, MUG.y - box.min.y, MUG.z)
    this.group.add(model)

    const mugTop = MUG.y + MUG.height
    const mugHeight = MUG.height
    const bodyRadius = (box.max.z - box.min.z) / 2 // z 向手柄投影小于本体直径，即本体外径（在杯底最宽处）

    // 杯身上下不等宽（底部外扩 r≈4.7、上段收窄 r≈3.4，模型单位）：液面不能用包围盒半径，
    // 否则比液面高度处的杯壁还宽、从杯里捅出来——逐顶点实测上段杯壁内半径
    const innerRadius = this.measureUpperInnerRadius(model, MUG.y + mugHeight * 0.55)
    this.setCoffee(mugTop, mugHeight, (innerRadius ?? bodyRadius * 0.7) * 0.97)
    this.setJavaDecal(mugTop, mugHeight, bodyRadius)
    this.setSteam(mugTop)
  }

  // 上段杯壁内半径：扫全部顶点，取 y ≥ yMin 范围内到杯身轴 (MUG.x, MUG.z) 的最小水平距离——
  // 杯口段只有杯壁和手柄，手柄/外壁都比内壁远，最小值即内壁半径（量化属性 fromBufferAttribute 自带反归一化）
  measureUpperInnerRadius(model, yMin) {
    model.updateWorldMatrix(true, true)
    let r = Infinity
    const v = new THREE.Vector3()
    model.traverse((child) => {
      if (!child.isMesh) return
      const pos = child.geometry.attributes.position
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(child.matrixWorld)
        if (v.y >= yMin) r = Math.min(r, Math.hypot(v.x - MUG.x, v.z - MUG.z))
      }
    })
    return Number.isFinite(r) ? r : null
  }

  // 咖啡液面：杯口下方一点的深色圆片，高光泽
  setCoffee(mugTop, mugHeight, radius) {
    const surface = new THREE.Mesh(
      new THREE.CircleGeometry(radius, 24),
      new THREE.MeshStandardMaterial({ color: COFFEE_COLOR, roughness: 0.08, metalness: 0 })
    )
    surface.rotation.x = -Math.PI / 2
    surface.position.set(MUG.x, mugTop - mugHeight * (1 - COFFEE_LEVEL), MUG.z)
    this.group.add(surface)
  }

  // Java 图案：官方 logo（public/java-logo.webp，白底已抠透明）画到 canvas，
  // 贴在一片贴着杯身的开口圆柱段上（弧段长宽比按画布配平，图案不变形），不碰模型 UV
  setJavaDecal(mugTop, mugHeight, bodyRadius) {
    const W = 128
    const H = 232
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d')

    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 4

    this.decalReady = new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        const pad = 6
        const s = Math.min((W - pad * 2) / img.width, (H - pad * 2) / img.height)
        const w = img.width * s
        const h = img.height * s
        ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h)
        texture.needsUpdate = true
        resolve(true)
      }
      img.onerror = () => {
        console.warn('java-logo.webp 加载失败，退回手绘版')
        this.drawFallbackJava(ctx, W, H)
        texture.needsUpdate = true
        resolve(true) // 有手绘兜底，照样算就绪
      }
      img.crossOrigin = 'anonymous' // OSS 跨域图要画进 canvas 再上 WebGL，不设会污染画布
      img.src = assetUrl('/java-logo.webp')
    })

    const radius = bodyRadius * 1.012
    const arcHeight = mugHeight * 0.62
    const theta = (arcHeight * (W / H)) / radius // 弧面宽高比 = 画布宽高比
    const decal = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, arcHeight, 16, 1, true, -theta / 2, theta),
      new THREE.MeshStandardMaterial({ map: texture, transparent: true, roughness: 0.35 })
    )
    decal.position.set(MUG.x, mugTop - mugHeight * 0.46, MUG.z)
    decal.rotation.y = DECAL_ROT_Y
    this.group.add(decal)
  }

  // 兜底手绘版（logo 图缺失时用）：蓝灰蒸汽 + Java 字 + 橙色 swoosh
  drawFallbackJava(ctx, W, H) {
    ctx.scale(W / 256, H / 256) // 原图形按 256 方画布设计

    // 蒸汽双曲线（Java logo 的蓝灰色）
    ctx.strokeStyle = '#4e7896'
    ctx.lineCap = 'round'
    for (const [dx, w] of [[-20, 13], [20, 10]]) {
      ctx.lineWidth = w
      ctx.beginPath()
      ctx.moveTo(128 + dx, 108)
      ctx.bezierCurveTo(100 + dx, 80, 156 + dx, 58, 122 + dx, 22)
      ctx.stroke()
    }

    // "Java" 字标（粗斜体）+ 橙色 swoosh 从字下扫过
    ctx.fillStyle = '#3d6480'
    ctx.font = 'italic bold 84px Georgia, serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('Java', 128, 164)

    ctx.strokeStyle = '#e76f00'
    ctx.lineWidth = 14
    ctx.beginPath()
    ctx.moveTo(38, 216)
    ctx.quadraticCurveTo(128, 244, 218, 200)
    ctx.stroke()
  }

  // 热气：杯口上方一片竖直平面，顶点被 perlin 噪声左右扰动、透明度向上淡出；
  // 每帧绕 Y 朝向相机（相机限制在 +x/+z 象限，固定朝向会被看成一条线）
  setSteam(mugTop) {
    this.steamMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexShader: STEAM_VERTEX,
      fragmentShader: STEAM_FRAGMENT,
      uniforms: {
        uTime: { value: 0 },
        uTimeFrequency: { value: STEAM.timeFrequency },
        uUvFrequency: { value: STEAM.uvFrequency },
        uColor: { value: new THREE.Color(STEAM.color) },
      },
    })
    this.steam = new THREE.Mesh(new THREE.PlaneGeometry(STEAM.width, STEAM.height, 8, 24), this.steamMaterial)
    this.steam.position.set(MUG.x, mugTop + STEAM.height / 2 - 0.02, MUG.z)
    this.group.add(this.steam)
  }

  update() {
    if (!this.steam) return
    this.steamMaterial.uniforms.uTime.value = this.time.elapsed
    const cam = this.camera.instance.position
    this.steam.rotation.y = Math.atan2(cam.x - this.steam.position.x, cam.z - this.steam.position.z)
  }
}
