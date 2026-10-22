import { gzipSync, brotliCompressSync } from 'node:zlib'

export default {
  plugins: [{
    name: 'precompress',
    apply: 'build',
    generateBundle: {
      order: 'post', // 等 Vite 完成动态 import 改写，再压缩最终内容。
      handler(_, bundle) {
        for (const file of Object.values(bundle)) {
          if (!/\.(js|css)$/.test(file.fileName)) continue
          const source = file.type === 'chunk' ? file.code : file.source
          for (const [suffix, compress] of [['gz', gzipSync], ['br', brotliCompressSync]]) {
            this.emitFile({ type: 'asset', fileName: `${file.fileName}.${suffix}`, source: compress(source) })
          }
        }
      },
    },
  }],
}
