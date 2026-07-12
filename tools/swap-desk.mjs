// 把 computer-zone.glb 里的旧电脑桌（纯黑柜体+桌面板）换成 low_poly_computer_desk 的木桌。
//
// 用法：node tools/swap-desk.mjs <computer-zone.glb> <low_poly_computer_desk.glb> <out.glb> [木纹提亮倍数=1.6]
//   第一个参数是换桌前的 computer-zone.glb（线上已是换过的，重跑要用换桌前的版本，
//   没有就用 prune-glb 从 models-src/3d_gaming_room_with_gaming_setup.glb 重新裁）；
//   第二个是 Sketchfab 原始模型（models-src/low_poly_computer_desk.glb）。
//
// 原理：新模型整套桌椅显示器烘在一个网格里，按"顶点坐标相同即连通"拆岛后，
// 用几何特征挑出桌面大薄板 + 4 条方腿；绕 Y 转 90°（长边对齐 x 轴）再按轴非均匀
// 缩放到旧桌子的精确包围盒（顶面高度/贴墙深度/落地都不变），烘进 GLTF_SceneRootNode
// 下的新节点 LowPolyDesk——桌面上的显示器/键鼠/机箱和运行时代码（shiftDeskToCorner
// 按"非椅子"整体平移）都不用动。删掉的旧节点：两个柜体 Cube.017/Cube.001、
// 桌面板 Plane.005、整桌贴图层 Plane.004；保留 Plane.006（显示器键盘下的黑桌垫）。
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { getBounds } from '@gltf-transform/core'
import { prune } from '@gltf-transform/functions'
import sharp from 'sharp'
import { statSync } from 'node:fs'

const [zonePath, deskPath, outPath] = process.argv.slice(2)
if (!zonePath || !deskPath || !outPath) {
  console.log('用法见文件头部注释')
  process.exit(1)
}

// ---------- 小型矩阵库（列主序，同 glTF）----------
const mul4 = (a, b) => {
  const o = new Array(16)
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let s = 0
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]
      o[c * 4 + r] = s
    }
  return o
}
const inv4 = (m) => {
  // gl-matrix 标准余子式求逆
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10
  const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30
  const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06
  if (!det) throw new Error('矩阵不可逆')
  det = 1 / det
  return [
    (a11 * b11 - a12 * b10 + a13 * b09) * det, (a02 * b10 - a01 * b11 - a03 * b09) * det,
    (a31 * b05 - a32 * b04 + a33 * b03) * det, (a22 * b04 - a21 * b05 - a23 * b03) * det,
    (a12 * b08 - a10 * b11 - a13 * b07) * det, (a00 * b11 - a02 * b08 + a03 * b07) * det,
    (a32 * b02 - a30 * b05 - a33 * b01) * det, (a20 * b05 - a22 * b02 + a23 * b01) * det,
    (a10 * b10 - a11 * b08 + a13 * b06) * det, (a01 * b08 - a00 * b10 - a03 * b06) * det,
    (a30 * b04 - a31 * b02 + a33 * b00) * det, (a21 * b02 - a20 * b04 - a23 * b00) * det,
    (a11 * b07 - a10 * b09 - a12 * b06) * det, (a00 * b09 - a01 * b07 + a02 * b06) * det,
    (a31 * b01 - a30 * b03 - a32 * b00) * det, (a20 * b03 - a21 * b01 + a22 * b00) * det,
  ]
}
const xformPoint = (m, v) => {
  const [x, y, z] = v
  v[0] = m[0] * x + m[4] * y + m[8] * z + m[12]
  v[1] = m[1] * x + m[5] * y + m[9] * z + m[13]
  v[2] = m[2] * x + m[6] * y + m[10] * z + m[14]
  return v
}
// 法线用 3x3 逆转置，最后归一化
const normalMat3 = (m) => {
  const i = inv4(m)
  return [i[0], i[4], i[8], i[1], i[5], i[9], i[2], i[6], i[10]] // 转置(逆) 的 3x3
}
const xformNormal = (n3, v) => {
  const [x, y, z] = v
  v[0] = n3[0] * x + n3[3] * y + n3[6] * z
  v[1] = n3[1] * x + n3[4] * y + n3[7] * z
  v[2] = n3[2] * x + n3[5] * y + n3[8] * z
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  v[0] /= l; v[1] /= l; v[2] /= l
  return v
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)

// ---------- 1. 从新模型拆连通岛，挑出桌面板 + 4 条腿 ----------
const deskDoc = await io.read(deskPath)
const deskNode = deskDoc.getRoot().listNodes().find((n) => n.getMesh())
const prim = deskNode.getMesh().listPrimitives()[0]
const pos = prim.getAttribute('POSITION')
const idx = prim.getIndices()
const triCount = idx.getCount() / 3
const Wd = deskNode.getWorldMatrix()

const parent = new Array(pos.getCount()).fill(0).map((_, i) => i)
const find = (a) => (parent[a] === a ? a : (parent[a] = find(parent[a])))
const union = (a, b) => { parent[find(a)] = find(b) }
const byPos = new Map()
const v = [0, 0, 0]
for (let i = 0; i < pos.getCount(); i++) {
  pos.getElement(i, v)
  const key = v.map((x) => x.toFixed(6)).join(',')
  if (byPos.has(key)) union(i, byPos.get(key))
  else byPos.set(key, i)
}
for (let t = 0; t < triCount; t++) {
  const a = idx.getScalar(t * 3)
  union(a, idx.getScalar(t * 3 + 1))
  union(a, idx.getScalar(t * 3 + 2))
}
const islands = new Map()
for (let t = 0; t < triCount; t++) {
  const key = find(idx.getScalar(t * 3))
  if (!islands.has(key)) islands.set(key, { tris: [], min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] })
  const isl = islands.get(key)
  isl.tris.push(t)
  for (let k = 0; k < 3; k++) {
    pos.getElement(idx.getScalar(t * 3 + k), v)
    xformPoint(Wd, v)
    for (let d = 0; d < 3; d++) {
      isl.min[d] = Math.min(isl.min[d], v[d])
      isl.max[d] = Math.max(isl.max[d], v[d])
    }
  }
}
const size = (isl, d) => isl.max[d] - isl.min[d]
const all = [...islands.values()]
const tops = all.filter((i) => size(i, 0) > 4 && size(i, 2) > 8 && size(i, 1) < 1)
const legs = all.filter((i) => size(i, 1) > 3 && size(i, 0) < 1 && size(i, 2) < 1 && i.min[1] < 0.1)
if (tops.length !== 1 || legs.length !== 4)
  throw new Error(`桌子部件识别失败：桌面板 ${tops.length} 个（应 1）、桌腿 ${legs.length} 条（应 4）`)
const deskTris = [...tops, ...legs].flatMap((i) => i.tris)
console.log(`挑出木桌：${deskTris.length} 三角形（桌面板 + 4 腿）`)

// ---------- 2. 读目标 GLB，算旧桌子的精确包围盒 ----------
const doc = await io.read(zonePath)
const root = doc.getRoot()
const nodeByName = (name) => root.listNodes().find((n) => n.getName() === name)

const OLD_DESK = ['Cube.017_19', 'Cube.001_20', 'Plane.005_18'] // 柜体×2 + 桌面板
const REMOVE = [...OLD_DESK, 'Plane.004_28'] // 桌面板上的整桌贴图层一并删
const target = { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] }
for (const name of OLD_DESK) {
  const b = getBounds(nodeByName(name))
  for (let d = 0; d < 3; d++) {
    target.min[d] = Math.min(target.min[d], b.min[d])
    target.max[d] = Math.max(target.max[d], b.max[d])
  }
}
// 桌腿落到整个模型的地面（旧柜体底部悬 0.03，四条独立腿会看出悬空）
const sceneBounds = getBounds(doc.getRoot().listScenes()[0])
target.min[1] = sceneBounds.min[1]
console.log('旧桌包围盒 →', target.min.map((x) => +x.toFixed(3)), target.max.map((x) => +x.toFixed(3)))

// ---------- 3. 顶点变换链：桌源世界系 → 绕Y转90° → 缩放平移进旧桌盒 → 目标父节点局部系 ----------
const R90 = [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1] // rotY(+90°)：(x,y,z)→(z,y,-x)
const RW = mul4(R90, Wd)

// 转完先量包围盒，再定各轴缩放
const rotBox = { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] }
const usedVerts = new Set()
for (const t of deskTris)
  for (let k = 0; k < 3; k++) usedVerts.add(idx.getScalar(t * 3 + k))
for (const i of usedVerts) {
  pos.getElement(i, v)
  xformPoint(RW, v)
  for (let d = 0; d < 3; d++) {
    rotBox.min[d] = Math.min(rotBox.min[d], v[d])
    rotBox.max[d] = Math.max(rotBox.max[d], v[d])
  }
}
const s = [0, 1, 2].map((d) => (target.max[d] - target.min[d]) / (rotBox.max[d] - rotBox.min[d]))
const fit = [
  s[0], 0, 0, 0,
  0, s[1], 0, 0,
  0, 0, s[2], 0,
  target.min[0] - s[0] * rotBox.min[0],
  target.min[1] - s[1] * rotBox.min[1],
  target.min[2] - s[2] * rotBox.min[2], 1,
]
console.log('各轴缩放:', s.map((x) => +x.toFixed(3)))

const sceneRootNode = nodeByName('GLTF_SceneRootNode')
const M = mul4(inv4(sceneRootNode.getWorldMatrix()), mul4(fit, RW))
const N = normalMat3(M)

// ---------- 4. 重建紧凑顶点数组，建新节点 ----------
const srcNormal = prim.getAttribute('NORMAL')
const srcUV = prim.getAttribute('TEXCOORD_0')
const remap = new Map()
const outPos = []
const outNormal = []
const outUV = []
for (const i of usedVerts) {
  remap.set(i, remap.size)
  pos.getElement(i, v)
  outPos.push(...xformPoint(M, v))
  srcNormal.getElement(i, v)
  outNormal.push(...xformNormal(N, v))
  const uv = [0, 0]
  srcUV.getElement(i, uv)
  outUV.push(...uv)
}
const outIdx = []
for (const t of deskTris)
  for (let k = 0; k < 3; k++) outIdx.push(remap.get(idx.getScalar(t * 3 + k)))

// 木纹贴图：整图转 webp（金属粗糙度贴图不带，木头用常数即可）。
// 原图是深胡桃色，在房间白天光照下发黑，转档时按第 4 个参数提亮
// （默认 2.8，用户对比 1.0~3.5 后选定）；亮度乘法会去饱和，补 1.15 找回木头暖色
const brighten = Number(process.argv[5]) || 2.8
const srcTex = prim.getMaterial().getBaseColorTexture()
const webp = await sharp(srcTex.getImage())
  .modulate({ brightness: brighten, saturation: 1.15 })
  .webp({ quality: 82 })
  .toBuffer()
console.log('木纹提亮:', brighten)
const texture = doc.createTexture('desk-wood').setImage(webp).setMimeType('image/webp')
const material = doc
  .createMaterial('DeskWood')
  .setBaseColorTexture(texture)
  .setMetallicFactor(0)
  .setRoughnessFactor(0.85)

const buffer = root.listBuffers()[0]
const mkAcc = (arr, type) =>
  doc.createAccessor().setType(type).setArray(new Float32Array(arr)).setBuffer(buffer)
const newPrim = doc
  .createPrimitive()
  .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(outIdx)).setBuffer(buffer))
  .setAttribute('POSITION', mkAcc(outPos, 'VEC3'))
  .setAttribute('NORMAL', mkAcc(outNormal, 'VEC3'))
  .setAttribute('TEXCOORD_0', mkAcc(outUV, 'VEC2'))
  .setMaterial(material)
const newNode = doc.createNode('LowPolyDesk').setMesh(doc.createMesh('LowPolyDesk').addPrimitive(newPrim))
sceneRootNode.addChild(newNode)

// ---------- 5. 删旧桌节点，收尾 ----------
for (const name of REMOVE) {
  const node = nodeByName(name)
  const subtree = []
  node.traverse((n) => subtree.push(n))
  for (const n of subtree.reverse()) n.dispose()
  console.log('删除:', name)
}
await doc.transform(prune())
await io.write(outPath, doc)
console.log('输出:', outPath, (statSync(outPath).size / 1048576).toFixed(2), 'MB（原', (statSync(zonePath).size / 1048576).toFixed(2), 'MB）')
