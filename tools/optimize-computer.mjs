// 电脑区 v2：仅椅子/键盘减面，保留节点、法线和材质名；两版共用几何，贴图上限 1024 / 512。
// node tools/optimize-computer.mjs [原 computer-zone.glb 路径]
// 输出 public/models/computer-zone[-mobile]-v2.glb；运行时须配置 MeshoptDecoder。
import { NodeIO, PropertyType, getBounds } from '@gltf-transform/core'
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions'
import { cloneDocument, compressTexture, prune, reorder, simplifyPrimitive, weldPrimitive } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import sharp from 'sharp'

const source = process.argv[2] ?? 'https://lihongbin-my-room.oss-cn-shenzhen.aliyuncs.com/models/computer-zone.glb'
const bytes = source.startsWith('https:')
  ? await fetch(source).then((r) => {
    if (!r.ok) throw new Error(`下载失败：${r.status}`)
    return r.arrayBuffer()
  })
  : await readFile(source)
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready])
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder,
})
const doc = await io.readBinary(new Uint8Array(bytes))
const nodes = (d) => d.getRoot().listNodes()
const structure = (d) => nodes(d).map((n) => [n.getName(), n.listChildren().map((c) => c.getName()), n.getMatrix()])
const materials = (d) => d.getRoot().listMaterials().map((m) => m.getName())
const originalStructure = structure(doc)
const originalMaterials = materials(doc)
assert.equal(new Set(originalMaterials).size, originalMaterials.length, '材质名必须唯一，供手机高清贴图替换')
const originalBounds = new Map(nodes(doc).filter((n) => n.getMesh()).map((n) => [n.getName(), getBounds(n)]))
const triangles = (d) => d.getRoot().listMeshes().reduce((sum, m) => sum + m.listPrimitives()
  .reduce((count, p) => count + p.getIndices().getCount() / 3, 0), 0)
const originalTriangles = triangles(doc)

for (const name of ['Object_34_69', 'Object_60']) {
  const part = nodes(doc).find((n) => n.getName() === name)
  assert.ok(part, `缺少减面节点 ${name}`)
  part.traverse((n) => n.getMesh()?.listPrimitives().forEach((p) => {
    weldPrimitive(p)
    simplifyPrimitive(p, { simplifier: MeshoptSimplifier, ratio: 0.6, error: 0.001, lockBorder: true })
  }))
}
// 只重排并编码，不再量化坐标；仅清理失效 accessor，避免改变节点或材质。
await doc.transform(
  reorder({ encoder: MeshoptEncoder, target: 'size', cleanup: false }),
  prune({ propertyTypes: [PropertyType.ACCESSOR], keepAttributes: true }),
)
doc.createExtension(EXTMeshoptCompression).setRequired(true)
  .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE })
await mkdir('public/models', { recursive: true })

for (const [suffix, limit] of [['', 1024], ['-mobile', 512]]) {
  const variant = cloneDocument(doc)
  for (const texture of variant.getRoot().listTextures()) {
    if (Math.max(...texture.getSize()) > limit) {
      await compressTexture(texture, { encoder: sharp, targetFormat: 'webp', resize: [limit, limit], quality: 85 })
    }
  }
  const output = await io.writeBinary(variant)
  const decoded = await io.readBinary(output)
  assert.deepEqual(structure(decoded), originalStructure, '节点/层级/变换变化')
  assert.deepEqual(materials(decoded), originalMaterials, '材质名变化')
  let boundsDelta = 0
  for (const node of nodes(decoded).filter((n) => n.getMesh())) {
    const before = originalBounds.get(node.getName())
    const after = getBounds(node)
    for (const side of ['min', 'max']) for (let i = 0; i < 3; i++) {
      boundsDelta = Math.max(boundsDelta, Math.abs(after[side][i] - before[side][i]))
    }
  }
  assert.ok(boundsDelta < 0.005, `包围盒漂移过大：${boundsDelta}`)
  const textures = decoded.getRoot().listTextures()
  assert.ok(textures.every((t) => Math.max(...t.getSize()) <= limit), '贴图超出尺寸限制')
  const textureMiB = textures.reduce((n, t) => n + t.getSize()[0] * t.getSize()[1] * 4, 0) / 1048576
  const path = `public/models/computer-zone${suffix}-v2.glb`
  await writeFile(path, output)
  console.log(JSON.stringify({ path, bytes: output.byteLength, originalBytes: bytes.byteLength,
    triangles: triangles(decoded), originalTriangles, materials: originalMaterials.length,
    textureMiB, textureWithMipMiB: +(textureMiB * 4 / 3).toFixed(2), boundsDelta }))
}
