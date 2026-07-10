// GLB 裁剪压缩工具：从下载的模型里挑出需要的物件并瘦身
//
// 列出顶层节点：  node tools/prune-glb.mjs models-src/xxx.glb --list
// 裁剪并压缩：    node tools/prune-glb.mjs models-src/xxx.glb public/models/out.glb --keep "NodeA,NodeB"
// 只压缩不裁剪：  node tools/prune-glb.mjs models-src/xxx.glb public/models/out.glb
//
// 注意：--keep 用的是 GLB 里的原始节点名（可含点号）；
// three.js 的 GLTFLoader 加载后会把名字里的点号等去掉（Plane.006_17 → Plane006_17）。
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, weld, quantize, simplify, textureCompress } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { statSync } from 'node:fs';

const args = process.argv.slice(2);
const src = args[0];
const list = args.includes('--list');
const out = list ? null : args[1];
const keepArg = args.includes('--keep') ? args[args.indexOf('--keep') + 1] : null;

if (!src || (!list && !out)) {
  console.log('用法见文件头部注释');
  process.exit(1);
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
const root = doc.getRoot();

// Sketchfab 导出的层级是 ... > GLTF_SceneRootNode > 各物件；
// FBX/OBJ 转换的则是 Sketchfab_model > xxx.fbx > RootNode > 各物件。
// 统一处理：从场景根沿"独子且无网格"的包装链一路下钻，停在第一个有多个子物件（或带网格）的节点。
let sceneRoot =
  root.listNodes().find((n) => n.getName() === 'GLTF_SceneRootNode') ??
  root.listScenes()[0];
while (sceneRoot.listChildren().length === 1 && !sceneRoot.listChildren()[0].getMesh())
  sceneRoot = sceneRoot.listChildren()[0];

if (list) {
  for (const n of sceneRoot.listChildren()) console.log(n.getName());
  process.exit(0);
}

if (keepArg) {
  const keep = new Set(keepArg.split(',').map((s) => s.trim()));
  for (const child of [...sceneRoot.listChildren()]) {
    if (keep.has(child.getName())) continue;
    const subtree = [];
    child.traverse((n) => subtree.push(n));
    for (const n of subtree.reverse()) n.dispose();
  }
  console.log('保留:', sceneRoot.listChildren().map((n) => n.getName()).join(', '));
}

await doc.transform(
  prune(),
  dedup(),
  weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio: 0.5, error: 0.001 }),
  quantize(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024] }),
  prune()
);

await io.write(out, doc);
console.log(
  '输出:', out,
  (statSync(out).size / 1048576).toFixed(2), 'MB（原',
  (statSync(src).size / 1048576).toFixed(2), 'MB）'
);
