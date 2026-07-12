// 把 computer-zone.glb 里的旧电脑桌（纯黑柜体+桌面板）换成单独下载的桌子模型。
//
// 用法：node tools/swap-desk.mjs <computer-zone.glb> <desk.glb> <out.glb>
//   第一个参数是【换桌前】的 computer-zone.glb（线上已是换过的，重跑要用换桌前的版本，
//   没有就用 prune-glb 从 models-src/3d_gaming_room_with_gaming_setup.glb 重新裁）；
//   第二个是桌子模型（当前是 models-src/teachers_desk.glb，要求"整个文件只有桌子"，
//   宽沿 x、挡板朝 -z；若来源混着别的物件要先拆岛挑桌子，参考 git 历史里的
//   low_poly_computer_desk 版本或 tools/split-switch.mjs）。
//
// 原理：桌子按轴非均匀缩放到旧桌子的精确包围盒（顶面高度/贴墙深度/左右跨度不变、
// 腿落到地面），烘进 GLTF_SceneRootNode 下的新节点 SwappedDesk——桌面上的显示器/
// 键鼠/机箱和运行时代码（shiftDeskToCorner 按"非椅子"整体平移）都不用动。
// 删掉的旧节点：两个柜体 Cube.017/Cube.001、桌面板 Plane.005、整桌贴图层 Plane.004；
// 保留 Plane.006（显示器键盘下的黑桌垫）。
import { NodeIO, getBounds } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { prune } from '@gltf-transform/functions'
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
  return [i[0], i[4], i[8], i[1], i[5], i[9], i[2], i[6], i[10]]
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

// ---------- 1. 读桌子模型（整个文件只有桌子，取第一个带网格的节点） ----------
const deskDoc = await io.read(deskPath)
const deskNode = deskDoc.getRoot().listNodes().find((n) => n.getMesh())
const prim = deskNode.getMesh().listPrimitives()[0]
const pos = prim.getAttribute('POSITION')
const idx = prim.getIndices()
const Wd = deskNode.getWorldMatrix()
console.log(`桌子来源：${deskNode.getName()}，${idx.getCount() / 3} 三角形`)

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
// 桌腿落到整个模型的地面（旧柜体底部悬 0.03，独立腿/侧板会看出悬空）
const sceneBounds = getBounds(doc.getRoot().listScenes()[0])
target.min[1] = sceneBounds.min[1]
console.log('旧桌包围盒 →', target.min.map((x) => +x.toFixed(3)), target.max.map((x) => +x.toFixed(3)))

// ---------- 3. 顶点变换链：桌源世界系 → 缩放平移进旧桌盒 → 目标父节点局部系 ----------
const srcBox = { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] }
const v = [0, 0, 0]
for (let i = 0; i < pos.getCount(); i++) {
  pos.getElement(i, v)
  xformPoint(Wd, v)
  for (let d = 0; d < 3; d++) {
    srcBox.min[d] = Math.min(srcBox.min[d], v[d])
    srcBox.max[d] = Math.max(srcBox.max[d], v[d])
  }
}
const s = [0, 1, 2].map((d) => (target.max[d] - target.min[d]) / (srcBox.max[d] - srcBox.min[d]))
const fit = [
  s[0], 0, 0, 0,
  0, s[1], 0, 0,
  0, 0, s[2], 0,
  target.min[0] - s[0] * srcBox.min[0],
  target.min[1] - s[1] * srcBox.min[1],
  target.min[2] - s[2] * srcBox.min[2], 1,
]
console.log('各轴缩放:', s.map((x) => +x.toFixed(3)))

const sceneRootNode = nodeByName('GLTF_SceneRootNode')
const M = mul4(inv4(sceneRootNode.getWorldMatrix()), mul4(fit, Wd))
const N = normalMat3(M)

// ---------- 4. 重建顶点数组，建新节点 ----------
const srcNormal = prim.getAttribute('NORMAL')
const outPos = []
const outNormal = []
for (let i = 0; i < pos.getCount(); i++) {
  pos.getElement(i, v)
  outPos.push(...xformPoint(M, v))
  srcNormal.getElement(i, v)
  outNormal.push(...xformNormal(N, v))
}
const outIdx = []
for (let k = 0; k < idx.getCount(); k++) outIdx.push(idx.getScalar(k))

// 材质：teachers_desk 是无贴图纯色（lambert 灰 0.5），照抄底色/粗糙度即可
const srcMat = prim.getMaterial()
const material = doc
  .createMaterial('DeskPlain')
  .setBaseColorFactor(srcMat.getBaseColorFactor())
  .setMetallicFactor(0)
  .setRoughnessFactor(srcMat.getRoughnessFactor())

const buffer = root.listBuffers()[0]
const mkAcc = (arr, type) =>
  doc.createAccessor().setType(type).setArray(new Float32Array(arr)).setBuffer(buffer)
const newPrim = doc
  .createPrimitive()
  .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(outIdx)).setBuffer(buffer))
  .setAttribute('POSITION', mkAcc(outPos, 'VEC3'))
  .setAttribute('NORMAL', mkAcc(outNormal, 'VEC3'))
  .setMaterial(material)
const newNode = doc.createNode('SwappedDesk').setMesh(doc.createMesh('SwappedDesk').addPrimitive(newPrim))
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
