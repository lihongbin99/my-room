# 静态站部署

先提交并推送 GitHub，再执行：

```bash
ssh lizeyin /root/update_room.sh
```

脚本在 `/usr/local/nginx/html/my-room` 执行 `git pull`、`pnpm install`、`pnpm run build`。
随后把服务器保留的 `mario.nes` 复制到 `dist/roms/`。
主站 JS/CSS 构建时附带 `.gz`、`.br`。

模型不入 Git。修改模型时先运行处理脚本，再定向上传 OSS，最后部署引用它的新代码：

```bash
node tools/optimize-computer.mjs
node tools/upload-oss.mjs models/computer-zone-v2.glb models/computer-zone-mobile-v2.glb
```

站点配置：`/etc/nginx/conf.d/lihongbin.conf` 中的 `lihongbin.com www.lihongbin.com`。
以下配置放在该 `server` 内。修改前备份原文件，本地构建不会启用线上压缩。

```nginx
gzip on;
gzip_static on;
gzip_vary on;
gzip_min_length 1024;
gzip_comp_level 5;
gzip_types application/javascript text/css application/json image/svg+xml;
```

服务器 nginx 已有 gzip_static 模块，优先使用 `.gz`，其他资源回退到运行时 gzip。
`.br` 暂不启用，需安装 Brotli 模块。保留现有站点路由。

验证配置后重载：`sudo nginx -t && sudo systemctl reload nginx`。
用浏览器 Network 确认主 JS 的 `Content-Encoding` 为 `gzip` 或 `br`。
