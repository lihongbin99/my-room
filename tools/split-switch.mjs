// 分析/拆分 switch 模型里混在一个网格里的多个部件（盒子、手柄……）
// 分析：  node tools/split-switch.mjs models-src/switch_console_roblox.glb
// 拆分：  node tools/split-switch.mjs models-src/switch_console_roblox.glb models-src/switch_split.glb
// 原理：按"顶点位置相同即相连"做并查集，把网格分成若干连通岛，每个岛输出成独立节点
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const [src, out] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
const root = doc.getRoot();

const node = root.listNodes().find((n) => n.getName() === 'Object_5');
const prim = node.getMesh().listPrimitives()[0];
const pos = prim.getAttribute('POSITION');
const idx = prim.getIndices();
const triCount = (idx ? idx.getCount() : pos.getCount()) / 3;

// 并查集，先把坐标相同的顶点合并（OBJ 转来的网格顶点常不共享）
const parent = new Array(pos.getCount()).fill(0).map((_, i) => i);
const find = (a) => (parent[a] === a ? a : (parent[a] = find(parent[a])));
const union = (a, b) => { parent[find(a)] = find(b); };

const byPos = new Map();
const v = [0, 0, 0];
for (let i = 0; i < pos.getCount(); i++) {
  pos.getElement(i, v);
  const key = v.map((x) => x.toFixed(4)).join(',');
  if (byPos.has(key)) union(i, byPos.get(key));
  else byPos.set(key, i);
}
for (let t = 0; t < triCount; t++) {
  const a = idx ? idx.getScalar(t * 3) : t * 3;
  union(a, idx ? idx.getScalar(t * 3 + 1) : t * 3 + 1);
  union(a, idx ? idx.getScalar(t * 3 + 2) : t * 3 + 2);
}

// 按岛收集三角形，统计包围盒
const islands = new Map();
for (let t = 0; t < triCount; t++) {
  const a = idx ? idx.getScalar(t * 3) : t * 3;
  const key = find(a);
  if (!islands.has(key)) islands.set(key, { tris: [], min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] });
  const isl = islands.get(key);
  isl.tris.push(t);
  for (let k = 0; k < 3; k++) {
    pos.getElement(idx ? idx.getScalar(t * 3 + k) : t * 3 + k, v);
    for (let d = 0; d < 3; d++) {
      isl.min[d] = Math.min(isl.min[d], v[d]);
      isl.max[d] = Math.max(isl.max[d], v[d]);
    }
  }
}

const sorted = [...islands.values()].sort((a, b) => b.tris.length - a.tris.length);
const fmt = (a) => a.map((x) => +x.toFixed(2)).join(',');
console.log(`Object_5：${triCount} 三角形，${sorted.length} 个连通岛`);
sorted.forEach((isl, i) => {
  const size = isl.max.map((x, d) => x - isl.min[d]);
  console.log(`  岛${i}: ${isl.tris.length} tris  size(${fmt(size)})  min(${fmt(isl.min)})  max(${fmt(isl.max)})`);
});

if (!out) process.exit(0);

// 拆分输出：按 x 位置把岛分成盒子（x < -3 簇）和手柄（x > -3 簇）两个节点
const groups = { SwitchBox: [], SwitchController: [] };
for (const isl of sorted)
  (isl.min[0] < -3 ? groups.SwitchBox : groups.SwitchController).push(isl);

for (const [name, isls] of Object.entries(groups)) {
  const indices = [];
  for (const isl of isls)
    for (const t of isl.tris)
      for (let k = 0; k < 3; k++) indices.push(idx ? idx.getScalar(t * 3 + k) : t * 3 + k);
  const acc = doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(indices));
  const newPrim = doc.createPrimitive().setIndices(acc).setMaterial(prim.getMaterial());
  for (const sem of prim.listSemantics()) newPrim.setAttribute(sem, prim.getAttribute(sem));
  const newNode = doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(newPrim));
  node.getParentNode().addChild(newNode);
  console.log(`${name}: ${indices.length / 3} 三角形（${isls.length} 岛）`);
}
node.dispose();
await io.write(out, doc);
console.log('已拆分输出:', out);
