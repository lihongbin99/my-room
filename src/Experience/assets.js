// 大静态资源（GLB 模型 / 书封面 / 挂画 / ROM / 桌面截图）走 OSS，省服务器带宽、下载更快；
// JS/CSS/favicon/xp 构建产物体积小或需同源，仍走本站。
// 上传/更新资源用 tools/upload-oss.mjs（AK/SK 走环境变量，勿写进仓库）。
// bucket 已配 CORS（GET/HEAD from *）——three.js 的贴图/GLB/ROM 全是跨域请求，缺了会加载失败。
const OSS_BASE = 'https://lihongbin-my-room.oss-cn-shenzhen.aliyuncs.com'

export function assetUrl(path) {
  return OSS_BASE + path
}
