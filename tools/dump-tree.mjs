// 打印 GLB 完整节点树（含世界包围盒）：node tools/dump-tree.mjs <file.glb>
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(process.argv[2]);

const fmt = (v) => v.map((x) => +x.toFixed(2)).join(',');

function walk(node, depth) {
  let info = '';
  if (node.getMesh()) {
    const b = getBounds(node);
    const size = b.max.map((v, i) => v - b.min[i]);
    info = `  [mesh] size(${fmt(size)}) min(${fmt(b.min)}) max(${fmt(b.max)})`;
  }
  console.log('  '.repeat(depth) + (node.getName() || '(unnamed)') + info);
  for (const c of node.listChildren()) walk(c, depth + 1);
}
for (const scene of doc.getRoot().listScenes())
  for (const n of scene.listChildren()) walk(n, 0);
