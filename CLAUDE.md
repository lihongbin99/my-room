# My Room — 3D 房间作品集

仿照 brunosimon/my-room-in-3d 与 AT010303/Room_Portfolio 风格的个人 3D 房间页面。
用户不使用 3D 建模软件：房间壳体由代码程序化生成，家具装饰计划从网上下载现成 GLB 模型（推荐 Poly Pizza / Sketchfab CC 协议）后由代码组装。

## 常用命令

```bash
npm run dev      # 开发服务器（Vite，默认 5173，被占用时自动换端口）
npm run build    # 构建到 dist/
```

技术栈：原生 Three.js + Vite，无框架、无 TypeScript。

## 目录结构与架构

采用 Bruno Simon 的 Experience 单例架构（构造函数返回同一实例，各模块内部 `new Experience()` 取引用）：

```
src/
  main.js                        # 入口：new Experience(canvas)
  Experience/
    Experience.js                # 单例，组装 Sizes/Time/Camera/Navigation/Renderer/World/ThemePanel
    Camera.js                    # 透视相机（无控制逻辑，移动全在 Navigation）
    Navigation.js                # 相机拖拽/缩放/平移，移植自 my-room-in-3d；含通用聚焦 focus()/blur()
    Renderer.js                  # WebGLRenderer：ACES 色调映射、PCFSoft 阴影
    ThemePanel.js                # 右上角 ☀️—🌙 日夜滑杆（原生 DOM）
    World/
      World.js                   # 场景内容容器，update() 里驱动各物件动画
      Room.js                    # 房间壳：地板 + 两面墙，程序化 canvas 贴图
      Environment.js             # 灯光 + 日夜插值（DAY/NIGHT 两套参数按 nightMix 混合）
      ComputerZone.js            # 电脑区（桌椅主机显示器键鼠），加载 computer-zone.glb
      TVZone.js                  # 电视区（电视柜/电视/Switch/沙发/茶几，5 个独立 GLB）
      MarioTV.js                 # 电视里可玩的 NES 马里奥（jsnes + CanvasTexture，ROM 自备放 public/roms/）
      Bookshelf.js               # 左墙书架 + 书 + 年份分隔盒 + 取书/放回动效（全程序化，无模型）
      booksData.js               # 读书记录数据，同步自 ..\book 项目的 books.js；封面图在 public/books/
    Utils/
      EventEmitter.js / Sizes.js / Time.js
tools/
  prune-glb.mjs                  # GLB 裁剪压缩工具（用法见文件头注释）
  dump-tree.mjs                  # 打印 GLB 完整节点树 + 世界包围盒，分析新模型第一步
  split-switch.mjs               # 按顶点连通岛拆分"一个网格混多个部件"（写死了 switch，可参考改造）
models-src/                      # 下载的原始模型（大文件，不进 public/ 不参与构建）
public/models/                   # 裁剪压缩后的模型，运行时加载
reference/
  my-room-in-3d/                 # 已克隆的参考仓库，分析实现方式用，勿修改
  Room_Portfolio/
```

## 房间布局规划（用户已定）

默认相机视角下：左墙（x=-4）在画面左侧，后墙（z=-4）在画面右侧。

- **后墙左段**（z=-4，电视左侧）：电脑区 ✅
- **左墙**（x=-4）：书架 + 书（前段 z∈[-0.8, 4.0]，后段被墙角电脑桌占用）✅
- **后墙右段**（贴 +x 边缘，ZONE_X=2.25）：电视柜 + 电视 + Switch ✅
- **房间前部**（z≈+3）：沙发面向电视，前面茶几 ✅

新增场景物件的方式：在 `World/` 下建类（构造里 `new Experience()` 拿 scene），在 `World.js` 实例化；需要逐帧动画的在 `World.update()` 里调用。

## 关键实现说明

- **相机手感**：`Navigation.js` 的核心是"拖动只改目标球坐标，每帧以 `0.005 × delta(ms)` 指数插值追赶"，产生缓入缓出的跟随感。事件绑定在 canvas 上（不是 window），避免挡住 HTML 面板。左键旋转、滚轮缩放、右键/Ctrl/Shift/双指平移，均有范围限制。
- **房间坐标**：地板 8×8，墙高 5，厚 0.35（`Room.js` 顶部常量）。墙角在 (-4, y, -4)；后墙（z=-4，对应参考图的红墙位）、左墙（x=-4，对应白墙位）。相机限制在 +x/+z 象限，看不到墙背面。
- **地板贴图**：程序化 canvas 生成，样式对照 Room_Portfolio——板条沿 z 轴（画面右上→左下）、整间约 10 块板（`cols`）、随机错缝分段、浅沙色低饱和。接缝画成"深色凹槽+亮边"，配同构灰度 bumpMap（`bumpScale: 0.12`）模拟倒角受光。注意：分段必须从 0 开始填色，否则板头留透明区渲染成黑块（修过一次）。
- **日夜切换**：`Environment.js` 里 DAY/NIGHT 两套参数（背景色、半球光、主光颜色/强度、角落暖灯强度），`setNightMix(0~1)` 设目标值，`update()` 每帧缓动，所以滑杆停在中间就是黄昏。滑杆 UI 在 `ThemePanel.js`。
- **贴图色彩**：颜色贴图要设 `colorSpace = THREE.SRGBColorSpace`，bumpMap 不设（保持线性）。
- **环境光照 IBL**：`Environment.setEnvironment()` 用 `RoomEnvironment` + PMREM 生成 `scene.environment`。没有它，GLB 里高金属度的 PBR 材质（椅子、机箱玻璃等）会渲染成死黑——"模型太黑"优先查这个。强度走 `scene.environmentIntensity`，随日夜插值（白天 0.5 / 夜晚 0.08）。**房间壳体（墙/地板）材质设了 `envMapIntensity: 0.1`**——环境反射只给家具吃，房间亮度交给半球光+太阳光，否则整屋被均匀提亮、失去自然光方向感（用户反馈过一次）。
- **椅子摇摆**：`ComputerZone.setChairSwivel()`——轮子(Object_141)和五星脚(Object_144)固定，其余座椅网格 `attach()` 进一个以五星脚包围盒中心为原点的 pivot 组，`update()` 里 `sin(elapsed × 0.0006) × 0.35` 绕 Y 摆动。**注意 Object_140 一个网格里混着座椅塑料件和轮叉/轮轴**，`splitChairBase()` 在运行时按三角形重心（低于五星脚顶、离转轴远→底座）把它切成两个网格，切出来的 `Object_140_base` 留在固定组。以后拆动画部件遇到"一个网格混两种部件"照这个套路。
- **性能**：pixelRatio 上限 1.5（`Sizes.js`）、阴影贴图 1024、renderer `powerPreference: 'high-performance'`。用户反馈过卡顿，加重型效果（Bloom、更多阴影灯）前先想想帧率。性能基准以核显为准（很多访客是轻薄本；本机可用 Playwright 加 `--use-adapter-luid` 钉在 AMD 610M 上实测，独显 RTX 5060 会 60 帧封顶测不出差异）。
- **⚠️ 透射材质陷阱**：GLB 里 `transmission > 0` 的 MeshPhysicalMaterial（Sketchfab 玻璃件常见）会让 three 每帧把整个场景先多渲染一遍到缓冲纹理做折射背景——核显上实测占近半帧时间（23→42fps）。`ComputerZone.setModel()` 里已统一降级为普通半透明（transmission=0、opacity+0.13，保留 envMap 反射），肉眼无差。**以后引入新模型要检查透射材质**（`material.transmission > 0` 扫一遍），同样降级处理。2026-07 核显 A/B 实测的其余开销：全局关阴影 +6fps（视觉代价大，未动）、停 NES 模拟器 +6fps（自动开机是用户要求，未动；日后可考虑挪 Web Worker）、其余单项（椅子、桌面、书架合并后）均 ≤1fps。
- **调试**：`window.experience` 已挂到全局，控制台可直接调相机（`experience.navigation.view.target.value.set(...)` 等）、灯光参数。
- **模型工作流**：Sketchfab 等下载的原始 GLB 放 `models-src/`（勿放 public/，44MB 的原始文件会被打进 dist）。先 `node tools/dump-tree.mjs <src>` 看完整层级 + 包围盒，再用 `node tools/prune-glb.mjs <src> <out> --keep "名1,名2"` 裁剪 + 自动压缩（减面 50%、顶点量化、贴图转 1024 WebP）输出到 `public/models/`。电脑区模型 44.66MB → 3.54MB，电视区 5 件共 5MB → 0.73MB。注意 sharp 必须用 0.33.x（0.35 在本机 win32 加载失败）。prune 工具会自动从场景根沿"独子包装链"下钻（兼容 `GLTF_SceneRootNode` 和 FBX/OBJ 转换的 `Sketchfab_model > xxx.fbx > RootNode` 两种层级），`--keep` 匹配的是下钻后那层的子节点名。
- **一个网格混多个部件的拆法**：运行时按三角形位置切（见 `ComputerZone.splitChairBase()`）；或离线按"顶点坐标相同即连通"做并查集拆成连通岛，按岛的包围盒聚类输出成命名网格（见 `tools/split-switch.mjs`，Switch 模型的盒子/手柄就是这样从 `Object_5` 里拆出来的，后来用户决定弃用只留主机）。
- **GLTFLoader 名字陷阱**：three 加载时会清洗节点名（`Plane.006_17` → `Plane006_17`，点号被去掉）。`--keep` 用 GLB 原始名，运行时 `getObjectByName` 用清洗后的名。
- **两态聚焦机制（通用）**：`Navigation.focus({ target, radius, phi, theta, limits })` 保存当前视角+限位、把目标值拨到指定机位（相机沿自带平滑飞过去、限位按传入收紧），`blur()` 一次性恢复。书架和电视共用。**互斥约定**：`navigation.savedView` 非空 = 已有区在聚焦，其他区的默认态点击/悬停必须先查它再响应（见 Bookshelf/MarioTV 的用法），否则会出现"A 区还在聚焦、B 区把视角抢走"的脏状态。
- **电视马里奥**：`MarioTV.js`——jsnes 的帧写进 ImageData，放大 blit 到屏幕画布（4:3 居中、两侧黑边、关 imageSmoothing 保像素感），再以 `CanvasTexture` 贴在电视面板前的平面上（`MeshBasicMaterial` + `toneMapped:false`，屏幕自发光不吃场景光）。**进页面就自动开机**：构造里 `initEmulator()`，默认态电视一直播着标题画面/演示（静音、无输入，像家里开着的电视，用户要求）；模拟器按 NES 实机帧率 60.0988fps 用累计 delta 步进，与显示器刷新率解耦。音频走 ScriptProcessor 环形缓冲：AudioContext 页面加载时创建（挂起态，先拿到真实采样率给 jsnes），聚焦点击这个用户手势里才 `resume()`（并丢掉积压采样防杂音），退出 `suspend()`=静音继续播。聚焦态才有键盘转发（←→↑↓、X=A、Z=B、Enter=Start）。聚焦机位 = "屏幕撑满"距离 × `FOCUS_DIST_SCALE`(2.2)，带出电视柜/墙面上下文——之前贴太近满屏游戏画面，用户反馈像被传送进另一个空间；想凑近滚轮拉。ROM 在 `public/roms/mario.nes`（本机已就位，来自 gym-super-mario-bros 仓库；.gitignore 排除 `*.nes` 不入库，**部署时记得一并上传**），缺失时屏幕显示 NO CARTRIDGE。
- **模型摆放套路**（新家具优先照 `TVZone.js`）：通用方法 `fit()`（阴影 + rotationX/Y 转向 + 按包围盒宽或高缩放到目标尺寸）和 `place()`（x/z 居中到给定值、`backZ` 把背面贴墙、`onY` 落地或上柜面），所有位置/尺寸/朝向集中在文件顶部常量，`ZONE_X` 可整区平移。房间比例约 1 单位 = 0.5m。电脑区模型原始朝向面向 +z，背靠后墙无需旋转；`shiftDeskToCorner()` 把桌子（含桌面物件）单独推进左墙角、椅子不跟着动。

## 参考仓库对照

- 拖拽算法 → `reference/my-room-in-3d/src/Experience/Navigation.js`
- 日夜烘焙混合（NightMix shader）→ `reference/Room_Portfolio/src/RoomModel/roomModel.jsx` 及 `shaders/`
- 地板/整体观感 → `reference/Room_Portfolio/public/roomfinalss1.png`（成品截图）
- 两个参考项目的整体光照都是 Blender 烘焙贴图，本项目用实时光照近似，无法完全复刻烘焙质感
- 屏幕交互（点击电脑/电视）→ 见下节"屏幕交互功能方案"

## 屏幕交互功能方案（XP 系统 / 马里奥 / ChatGPT，2026-07 调研定案）

三个功能均可实现。核心模式照搬 Room_Portfolio 的两态设计：

**两态模式**：屏幕平时只是贴视频/图片纹理的 mesh（廉价、无 DOM）；点击后相机聚焦到屏幕正前方并锁死视角，此时才挂载真实可交互的 iframe 层，退出时卸载。Room_Portfolio 用 zustand `cameraState`（default/desktop/tv/…）+ drei `<Html transform occlude="blending">` 实现；本项目无 React，等价替代是 **three.js 自带的 `CSS3DRenderer`**（`three/addons/renderers/CSS3DRenderer.js`），Henry Heffernan 的作品集（henryheffernan.com，源码 github.com/henryjeff/portfolio-website）就是原生 three.js + CSS3D + iframe 的成熟先例。

Room_Portfolio 关键实现文件（照抄交互流程用）：
- `src/RoomModel/DispFrame.jsx` — 屏幕 mesh：`useVideoTexture` 贴图 + onClick 切 cameraState + hover 描边
- `src/CameraManager/CameraManager.jsx` — 聚焦：`CameraControls.setLookAt(from, to, true)` 并锁死方位角/距离
- `src/RoomModel/iframes/desktopiFrame.jsx` — 聚焦态才渲染 `<Html transform>` + `<iframe>`
- `src/RoomModel/iframes/tvEmulator.jsx` — 电视：`react-emulatorjs` 跑 GBA ROM（`SuperMarioAdvance4.gba`）

本项目（原生 three.js）集成要点：
- `CSS3DRenderer` 输出一个独立 DOM 层，与 WebGL canvas 叠放、共用相机矩阵；WebGL 侧在屏幕位置放一个 `colorWrite:false` 或 NoBlending 黑色 mesh"挖洞"，让 iframe 透出来且能被前景遮挡
- 点击检测用 `Raycaster`（Navigation 事件绑在 canvas 上，需区分"拖拽"与"点击"：按下/抬起位移小于阈值才算点击）
- `Navigation.js` 需加"聚焦态"：聚焦时禁用拖拽/缩放，CSS3D 层 `pointer-events:auto`；默认态反之，避免 iframe 挡住场景拖拽；提供 ESC/点击屏幕外退出
- iframe 只在聚焦态挂载（性能 + 防误触），平时屏幕显示截图/录屏纹理

**功能 4 — 浏览器版 Windows XP**：fork [ShizukuIchi/winXP](https://github.com/ShizukuIchi/winXP)（MIT 协议，React + Hooks，内置扫雷/IE/记事本/Winamp/画图）。作为独立子项目单独构建，产物放 `public/xp/`，显示器 iframe 指向 `/xp/index.html`。主项目保持无 React，React 只存在于这个 fork 里。

**功能 5 — 电视玩马里奥**：两条路线：
1. 与参考项目相同：[EmulatorJS](https://emulatorjs.org)（原生 JS，不需要 react 包装）+ ROM 文件，iframe/CSS3D 嵌入。⚠️ 任天堂 ROM 有版权，参考项目直接带了 `SuperMarioAdvance4.gba`，个人作品集属灰色地带，风险自担
2. 无版权风险替代：开源 JS 马里奥类克隆（如 GitHub 上的 super-mario-bros JS 重制、reruns/mario），或 jsnes + 自制/homebrew ROM
补充：jsnes 输出到 canvas，可用 `THREE.CanvasTexture` 直接贴到电视 mesh 上（不走 CSS3D，画面受场景光照/泛光影响，更有"真电视"感），键盘输入在聚焦态转发即可。

**功能 6 — XP 里的 ChatGPT 应用**：在 winXP fork 里新增一个 React 聊天窗口应用（winXP 的应用就是普通 React 组件，仿照其 Notepad 加一个即可），UI 用 XP 经典窗口风格，`fetch` 调用后端接口流式输出。**API key 必须放后端**：需要一个小型代理服务（Node/Express 或 serverless 函数），前端只调自己的 `/api/chat`。开发期可用 Vite `server.proxy` 转发。

实施顺序（2026-07 调整并部分完成）：聚焦相机已抽成通用 `Navigation.focus()/blur()`；**功能 5 已完成**——按 jsnes + CanvasTexture 路线（不走 CSS3D），CSS3D 基础设施只剩功能 4 一个用户。功能 4+6 建议作为一条线：先 fork winXP 在它自己的 dev server 里独立开发（含 ChatGPT 窗口 + 后端代理），构建产物放 public/xp/，最后才做 CSS3D 嵌入显示器。**部署目标已定为自有服务器**：ChatGPT 代理写成 Node/Express 小服务即可（不需要 serverless）。

## TODO（按开发顺序）

1. [x] **电脑区**：桌、主机、显示器、键盘、鼠标、鼠标垫（桌垫）、电脑椅已完成（来自用户下载的 Sketchfab 游戏房模型，裁剪出 10 件核心）。遗留：
   - [ ] 耳机：模型里没有，待用户从 Poly Pizza 补一个 GLB
   - [ ] 马克杯 + 热气：用户说可有可无；做的话用代码程序化生成（杯体旋转几何 + shader/精灵热气）
   - [ ] Sketchfab 模型 CC 协议需要署名，页面加 credits 时记得带上（模型名 "3d gaming room with gaming setup"，作者见用户下载页）
2. [x] **电视区**：电视柜、电视、Switch 主机、沙发、茶几已完成（5 个独立 Sketchfab 模型，见 `World/TVZone.js`；Switch 模型混在一起的盒子/手柄用 `tools/split-switch.mjs` 拆出后弃用，只留主机）。遗留：
   - [ ] 这 5 个模型（coffee_table_no_textures / kitchenz_simona_tv_cabinet / psx_flat_screen_tv / sim_loveseat / switch_console_roblox）也是 Sketchfab CC 协议，页面 credits 记得一并署名
3. [x] **书架 + 书**：`World/Bookshelf.js`，全程序化。5 层木架贴左墙前段（z∈[-0.8, 4.0]，前端贴齐墙边缘，避开墙角电脑桌），只上架已读完的书（filter `finished`，约 110 本），按阅读顺序从左上往右下流式排列，每年第一本前立一个刻年份的小木盒分隔（【2018】书 书…【2019】…）。书本尺寸按页数/开本估算，书脊 canvas 贴图竖排书名，封面图懒加载（hover/取书时才请求 public/books/）。交互采用 Room_Portfolio 的两态模式：**默认态**悬停书架显示白描边（包围盒放大一圈的 BackSide 白壳，一个 draw call，以后上 EffectComposer 可换 OutlinePass）、点击书架进入**聚焦态**——保存当前视角后把 `Navigation.view` 的目标值拨到书架正前方（相机用自带平滑飞过去），同时收紧限位：phi/theta 锁死、radius 允许 2.5～取景距离（滚轮凑近看书名）、target 允许沿书架平移；点书架外任意处/ESC 退出，恢复保存的视角与限位（飞回去即"已取消"的反馈）。取书/还书只在聚焦态可用：hover 滑出、点击取书（抽出→飞到镜头前→拖拽翻转→点击/ESC 放回），拿书期间 `Navigation.enabled=false`。动效与数据移植自 `..\book` 项目（那边单位是米，这边 ×2）。这套"保存视角 + 改限位 + enabled 开关"的机制已抽成通用 `Navigation.focus()/blur()`（TODO 5 电视已复用，TODO 4 继续用）。遗留：
   - [ ] 新读完的书在 book 项目的 books.js 维护后拷到 booksData.js（封面图拷到 public/books/）
   - [x] 书架 draw call 优化（2026-07 完成）：默认态书+年份盒合并成 6 个网格（所有书脊/年份盒正面共用一张 4096 宽的图集纹理、封面封底烘成顶点色），全场景 1571→155 call；聚焦书架时才惰性构建逐本独立网格（书脊也复用图集 UV 重映射，不再逐本建纹理），取书/悬停/封面懒加载不变，聚焦态约 694 call（用户认可"默认态牺牲视觉换性能、聚焦态视觉优先"）。enterFocus/exitFocus 里切换 mergedBooks/booksGroup 可见性
4. [ ] **显示器装浏览器版 Windows XP**（方案见"屏幕交互功能方案"节；聚焦相机已就绪，只差 CSS3D + 挖洞 mesh；建议与 6 作为一条线：先在 winXP fork 里把应用做完再嵌入）
5. [x] **电视装可玩的超级马里奥**：`World/MarioTV.js`，jsnes + CanvasTexture 路线（不走 CSS3D）。进页面自动开机播标题/演示；两态交互同书架：悬停白描边、点击聚焦（机位带房间上下文）开声音和键盘、ESC/点屏幕外退出=静音继续播。已用 Playwright 全流程验证（自动开机/聚焦取景/Start 开局/键盘转发/退出静音/书架互斥）。遗留：
   - [ ] ROM 已在本机 `public/roms/mario.nes`，但 git 忽略不入库（用户已表示不管版权，若想随仓库走，删掉 .gitignore 里 `public/roms/*.nes` 那行即可）；**部署时记得把它一并上传**
6. [ ] **XP 里加 ChatGPT 应用**（winXP fork 里加聊天窗口组件 + 后端代理接口）
7. [ ] **夜间灯光优化**（已讨论定案，留到最后做，分三步）：
   1. 占位落地灯：灯杆 + 自发光灯罩球，把 `Environment.js` 里浮空的暖色点光（现在在 (-2, 3.2, -2)）移到灯罩位置（离地约 1.5），并开小尺寸阴影贴图——解决"光没有来源、夜间无影子"的问题
   2. 发光窗户：后墙加自发光面板 + RectAreaLight 面光源（白天当窗、夜里当柔和环境光；面光源不投影，需与 1 搭配）
   3. 家具进场后：夜间光挂到实体上——显示器 emissive、桌底 LED 灯带、台灯小点光，配后期 Bloom 泛光（参考项目夜景氛围的做法）
- [ ] 墙色可选改成参考图的"白 + 玫红"双色方案（用户尚未决定）
