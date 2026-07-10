# NES ROM 放置处

电视马里奥（`src/Experience/World/MarioTV.js`）会加载本目录下的 `mario.nes`。

- 文件名固定：`mario.nes`（iNES 格式，即通常的 `.nes` 文件）
- ROM 有版权，不入 git 仓库（`.gitignore` 已排除 `*.nes`），自行获取后放进来即可
- 缺失时电视屏幕会显示 "NO CARTRIDGE" 提示，其余功能不受影响
- 部署到服务器时记得把 ROM 一起拷到产物的 `roms/` 目录（`vite build` 会把本目录随 public 复制进 dist，前提是构建机器上有这个文件）

理论上任何 NES 卡带 ROM 都能跑（jsnes 支持常见 Mapper），不限于马里奥。
