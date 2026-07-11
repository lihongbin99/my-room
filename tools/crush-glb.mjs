// 激进压缩小道具 GLB(比 prune-glb.mjs 狠得多:大幅减面 + meshopt 编码 + 迷你贴图 + 可砍法线/隐藏部件)
// 注意:输出带 EXT_meshopt_compression,运行时 GLTFLoader 要 setMeshoptDecoder(MeshoptDecoder)
// 用法: node tools/crush-glb.mjs <src> <out> <simplifyRatio> <texSize> <dropNormal 0|1> [dropNames逗号分隔子串]
const [src, out, ratioArg, texArg, dropNormalArg, dropNamesArg] = process.argv.slice(2);
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, weld, meshopt, simplify, textureCompress } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { statSync } from 'node:fs';

const ratio = parseFloat(ratioArg ?? '0.05');
const texSize = parseInt(texArg ?? '256', 10);
const dropNormal = dropNormalArg !== '0';
const dropNames = dropNamesArg ? dropNamesArg.split(',').map((s) => s.trim().toLowerCase()) : [];

await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(src);
const root = doc.getRoot();

let tris = 0;
for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) {
  const idx = prim.getIndices();
  tris += idx ? idx.getCount() / 3 : prim.getAttribute('POSITION').getCount() / 3;
}
console.log(`原始三角形: ${Math.round(tris)}`);

if (dropNames.length) {
  const doomed = [];
  for (const node of root.listNodes()) {
    const name = node.getName().toLowerCase();
    if (dropNames.some((s) => name.includes(s))) doomed.push(node);
  }
  for (const node of doomed) {
    console.log(`删除节点: ${node.getName()}`);
    node.dispose();
  }
}

if (dropNormal) {
  for (const m of root.listMaterials()) {
    m.setNormalTexture(null);
    m.setOcclusionTexture(null);
    m.setEmissiveTexture(null);
  }
}

await doc.transform(
  dedup(),
  weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.02 }),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [texSize, texSize] }),
  prune()
);

let tris2 = 0;
for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) {
  const idx = prim.getIndices();
  tris2 += idx ? idx.getCount() / 3 : prim.getAttribute('POSITION').getCount() / 3;
}

await io.write(out, doc);
const kb = statSync(out).size / 1024;
console.log(`减面后三角形: ${Math.round(tris2)}  输出: ${kb.toFixed(0)}KB`);
