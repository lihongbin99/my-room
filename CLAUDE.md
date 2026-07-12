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
    Renderer.js                  # WebGLRenderer：ACES 色调映射、PCFSoft 阴影；夜间切 EffectComposer+Bloom 双路径
    CSS3D.js                     # CSS3DRenderer 第二渲染层（iframe 浮层，共用相机；空场景跳过 render）
    ThemePanel.js                # 右上角 ☀️—🌙 日夜滑杆（原生 DOM）
    Loading.js                   # 仿 BIOS 开机自检加载屏（真实资源日志 + shader 预热 + 自动进场）
    World/
      World.js                   # 场景内容容器，update() 里驱动各物件动画
      Room.js                    # 房间壳：地板 + 两面墙，程序化 canvas 贴图
      Environment.js             # 灯光 + 日夜插值（DAY/NIGHT 两套参数按 nightMix 混合）
      ComputerZone.js            # 电脑区（桌椅主机显示器键鼠），加载 computer-zone.glb（旧黑桌已离线换成 teachers_desk 的白灰板式桌，见 tools/swap-desk.mjs）
      XPScreen.js                # 显示器里的浏览器版 Windows XP（两态：截图纹理 / CSS3D iframe）
      TVZone.js                  # 电视区（电视柜/电视/Switch/沙发/茶几/Switch手柄，6 个独立 GLB；手柄换深灰塑料材质平放茶几右前角）
      CoffeeTableBooks.js        # 茶几上"正在读"的那本书（finished:false 里 date 最新的一本，平放+真实封面；点击取书动效同书架；由 TVZone 在茶几摆好后实例化）
      MarioTV.js                 # 电视里可玩的 NES 马里奥（jsnes + CanvasTexture，ROM 自备放 public/roms/）
      Bookshelf.js               # 左墙书架 + 书 + 年份分隔盒 + 取书/放回动效（全程序化，无模型）
      booksData.js               # 读书记录数据，同步自 ..\book 项目的 books.js；封面图在 public/books/
      FloorLamp.js               # 沙发旁落地灯（程序化几何 + 暖点光 + 夜间投影 spot）
      WallWindow.js              # 后墙发光窗（HDR 玻璃 + RectAreaLight，白天暖阳夜里冷月；在电脑桌正上方）
      WallPainting.js            # 电视上方的宽幅挂画（婚纱照，金框+卡纸+夜间微自发光；照片源图在 Downloads，压缩产物 public/paintings/wedding.webp）
      DeskGlow.js                # 桌面夜灯（LED 呼吸灯带 + 桌角小台灯）
      DeskProps.js               # 桌面小物件：键盘左边的头戴耳机（平放）+ Java 马克杯（咖啡液面 + 官方 logo 贴纸 + 热气 shader）
    Utils/
      EventEmitter.js / Sizes.js / Time.js
tools/
  prune-glb.mjs                  # GLB 裁剪压缩工具（--keep 留顶层物件、--drop 删任意深度的具名部件，用法见文件头注释）
  crush-glb.mjs                  # 小道具激进压缩（大幅减面+meshopt 编码+迷你贴图+按名砍隐藏部件；输出的 GLB 加载时要 setMeshoptDecoder，用法见文件头注释）
  dump-tree.mjs                  # 打印 GLB 完整节点树 + 世界包围盒，分析新模型第一步
  split-switch.mjs               # 按顶点连通岛拆分"一个网格混多个部件"（写死了 switch，可参考改造）
  swap-desk.mjs                  # 把 computer-zone.glb 的旧黑桌（柜体+桌面板）换成单独下载的桌子模型（当前 teachers_desk 白灰板式桌）：非均匀缩放进旧桌精确包围盒、烘成 SwappedDesk 节点，桌面物件与运行时代码零改动；要求来源"整个文件只有桌子"，混件的先拆岛（见 git 历史 low_poly 版）（用法见文件头注释）
  upload-oss.mjs                 # 大静态资源上传到阿里云 OSS + 重放 CORS 规则（AK/SK 走环境变量，用法见文件头注释）
models-src/                      # 下载的原始模型（大文件，不进 public/ 不参与构建）
public/models/                   # 裁剪压缩后的模型（已全量上 OSS，运行时从 OSS 加载，见"静态资源走 OSS"条）
public/xp/                       # winXP 构建产物（静态文件，Vite 原样拷进 dist；产物入库）
xp/                              # fork 自 ShizukuIchi/winXP（MIT，React+CRA 子项目，见其 README 头部说明）
                                 # 改动：homepage=/xp/、BUILD_PATH=../public/xp、禁 eslint 插件
                                 # 构建：根目录 npm run build:xp（xp/ 里 npm install 要 --legacy-peer-deps）
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

- **相机手感**：`Navigation.js` 的核心是"拖动只改目标球坐标，每帧以 `0.005 × delta(ms)` 指数插值追赶"，产生缓入缓出的跟随感。事件绑定在 canvas 上（不是 window），避免挡住 HTML 面板。鼠标：左键旋转、滚轮缩放、右键/Ctrl/Shift 平移；触屏：单指旋转、双指捏合缩放 + 中点平移（OrbitControls 同款语义，捏合是比例式 `radius *= 上帧距离/当前距离`，每帧滚动基准）。输入统一走 Pointer Events，按 pointerId 自维护指针表（Pointer Events 没有 touches 列表），`pointercancel` 必须当抬起处理；**canvas 的 `touch-action:none`（index.html）不能删**——没有它浏览器把触摸判成滚动后会发 pointercancel 收走指针，触屏拖两下就断。均有范围限制。
- **房间坐标**：地板 8×8，墙高 5，厚 0.35（`Room.js` 顶部常量）。墙角在 (-4, y, -4)；后墙（z=-4，对应参考图的红墙位）、左墙（x=-4，对应白墙位）。相机限制在 +x/+z 象限，看不到墙背面。
- **地板贴图**：程序化 canvas 生成，样式对照 Room_Portfolio——板条沿 z 轴（画面右上→左下）、整间约 10 块板（`cols`）、随机错缝分段、浅沙色低饱和。接缝画成"深色凹槽+亮边"，配同构灰度 bumpMap（`bumpScale: 0.12`）模拟倒角受光。注意：分段必须从 0 开始填色，否则板头留透明区渲染成黑块（修过一次）。
- **日夜切换**：`Environment.js` 里 DAY/NIGHT 两套参数（背景色、半球光、主光颜色/强度），`setNightMix(0~1)` 设目标值，`update()` 每帧缓动，所以滑杆停在中间就是黄昏。滑杆 UI 在 `ThemePanel.js`。缓动收敛后要钉到目标值再决定 apply——低帧率（大 delta）下一步跳到目标，"差值超阈值才 apply"会跳过最后一次应用（修过一次）。**新夜灯模块不进 Environment**：各自在 `update()` 里读 `environment.currentMix` 自行插值（文件顶部自带 DAY/NIGHT 常量 + lastMix 早退），Environment 仍是唯一缓动驱动者；World.update 里必须排在 `environment.update()` 之后。
- **夜间灯光**（TODO 7，2026-07 完成）：三个实体夜灯模块 `FloorLamp`（沙发旁落地灯：暖点光从 Environment 迁来 + 夜间向下投影 spot 512 软影，白天 `spot.visible=false` 连阴影 pass 一起省）、`WallWindow`（后墙发光窗：`toneMapped:false` HDR 玻璃白天暖 `(1.6,1.15,.75)` 夜里冷蓝 `(.55,.72,1.9)` + RectAreaLight，LTC 表模块级 init 一次；白天强度压 0.5 勿提亮全屋）、`DeskGlow`（桌前沿冰蓝 LED 呼吸灯带 + 桌角小台灯；**台灯离墙近，点光强度别贪，墙面像素 >1.15 会整片泛光白爆**）。屏幕夜里渐亮：XPScreen/MarioTV 材质 color 随 mix 1.0→1.35。投影灯恒 ≤2（太阳 + 落地灯 spot）。
- **Bloom 双路径**：`Renderer.js` 里 `currentMix > 0.02` 才走 EffectComposer（RenderPass + UnrealBloom + OutputPass，HalfFloat + samples:4），白天保持直渲（零后期开销 + 画布 MSAA）。阈值 1.15（线性 HDR 域）只放行灯罩 2.6/LED 2.2/月窗 1.9/夜间屏幕 1.35；悬停描边白壳 1.0 不泛光。**⚠️ 清屏色陷阱**：背景必须走 `scene.background`（Color），不能用 `renderer.setClearColor`——后者在调用瞬间按当时绑定的渲染目标定颜色空间编码，composer 下清屏色被二次变换、夜空亮 4 倍（逐像素比对定位过）。**⚠️ GLB 失控 emissive**：Sketchfab 的 KHR_materials_emissive_strength 会带 >1 的发光强度（椅子红件 ×10 夜里炸成红光团），`ComputerZone.setModel()` 已统一钳到 1，以后引入新模型和透射材质一起查。管线切换点仅背景虚空微暗差异，房间内容两路径逐像素一致。
- **BIOS 加载屏**（TODO 8，2026-07 完成）：`Loading.js` + index.html 里的静态遮罩标记（JS 到位前就显示第一行；z-index 10010 盖住 stats.js 的 10000）。黑底绿字仿 POST 自检逐行打印真实加载日志，加载完自动淡出进场（用户明确不要 START 门）。三个机制：① **日志行**挂 `THREE.DefaultLoadingManager.onProgress`（各模块 loader 都没传自定义 manager，天然全走它；同一 GLB 触发两次——下载完+解析完——seen 集去重；GLB 内嵌贴图以 blob: URL 过 manager，合并一行批量计数）。**懒加载资源必须隔离**：Bookshelf 封面已改私有 `new THREE.LoadingManager()`，否则进场后取书会让日志"复活"，新懒加载资源照办。② **完成收口不用 manager.onLoad**（GLTF 解析间隙会误触发，且 XPScreen 截图纹理在 GLB 解析回调里才开始加载）——各模块暴露 `ready` Promise（ComputerZone 含 XPScreen、TVZone、MarioTV ROM），`Loading.start()` 依次 await；**约定：加载失败也要 resolve**（打 FAIL/NOT FOUND 行），绝不能卡死开机；新增加载类模块记得暴露 ready 并加进 start()。③ **shader 预热**：遮罩盖着时把 nightMix 拨 1 再拨回 0，让生产渲染路径自己走过 spot 灯开启（mix≈0.006）和 composer（0.02）两个阈值，三套程序变体（夜间 composer+spot 影、回程 0.006~0.02 带内直渲+spot、白天直渲）全编译掉——**首次拖日夜滑杆卡一下就是这 3.8s 主线程编译（RTX 5060 实测），已消化进 BIOS**；进场后拨夜间程序数 77→77 零新编译（Playwright 断言过）。勿换成 `compileAsync` 单点预热：盖不住 shadow pass 和 composer 变体。本地全缓存开机全程 ≈16s（隐藏编译 3.8s + 预热往返 4.5s + 日志节奏），慢服务器上下载期间日志本来就在滚，表演时间与下载重叠不白等。
- **贴图色彩**：颜色贴图要设 `colorSpace = THREE.SRGBColorSpace`，bumpMap 不设（保持线性）。
- **环境光照 IBL**：`Environment.setEnvironment()` 用 `RoomEnvironment` + PMREM 生成 `scene.environment`。没有它，GLB 里高金属度的 PBR 材质（椅子、机箱玻璃等）会渲染成死黑——"模型太黑"优先查这个。强度走 `scene.environmentIntensity`，随日夜插值（白天 0.5 / 夜晚 0.08）。**房间壳体（墙/地板）材质设了 `envMapIntensity: 0.1`**——环境反射只给家具吃，房间亮度交给半球光+太阳光，否则整屋被均匀提亮、失去自然光方向感（用户反馈过一次）。
- **椅子摇摆**：`ComputerZone.setChairSwivel()`——轮子(Object_141)和五星脚(Object_144)固定，其余座椅网格 `attach()` 进一个以五星脚包围盒中心为原点的 pivot 组，`update()` 里 `sin(elapsed × 0.0006) × 0.35` 绕 Y 摆动。**注意 Object_140 一个网格里混着座椅塑料件和轮叉/轮轴**，`splitChairBase()` 在运行时按三角形重心（低于五星脚顶、离转轴远→底座）把它切成两个网格，切出来的 `Object_140_base` 留在固定组。以后拆动画部件遇到"一个网格混两种部件"照这个套路。
- **性能**：pixelRatio 上限 1.5（`Sizes.js`）、阴影贴图 1024、renderer `powerPreference: 'high-performance'`。用户反馈过卡顿，加重型效果（Bloom、更多阴影灯）前先想想帧率。性能基准以核显为准（很多访客是轻薄本；本机可用 Playwright 有头模式加 `--use-adapter-luid=0,105591` 钉在 AMD 610M 上实测——LUID 从 chrome://gpu 提取、重启可能变化，无头模式是 SwiftShader 软渲染只能看画面不能测帧率；独显 RTX 5060 会 60 帧封顶测不出差异）。2026-07 夜灯功能实测：白天直渲 31.5 / 夜间全管线（Bloom+spot 阴影+RectArea）31.7，各单项开销均 ≈0。**A/B 开关灯时注意**：灯的 visible 切换会改变灯数量、触发全场景 shader 重编译，等编译完（几秒）再采样，否则测出假回归。
- **⚠️ 透射材质陷阱**：GLB 里 `transmission > 0` 的 MeshPhysicalMaterial（Sketchfab 玻璃件常见）会让 three 每帧把整个场景先多渲染一遍到缓冲纹理做折射背景——核显上实测占近半帧时间（23→42fps）。`ComputerZone.setModel()` 里已统一降级为普通半透明（transmission=0、opacity+0.13，保留 envMap 反射），肉眼无差。**以后引入新模型要检查透射材质**（`material.transmission > 0` 扫一遍），同样降级处理。2026-07 核显 A/B 实测的其余开销：全局关阴影 +6fps（视觉代价大，未动）、停 NES 模拟器 +6fps（自动开机是用户要求，未动；日后可考虑挪 Web Worker）、其余单项（椅子、桌面、书架合并后）均 ≤1fps。
- **静态资源走 OSS**（2026-07）：大资源（`models/`、`books/` 封面、`paintings/`、`roms/mario.nes`、`xp-desktop.webp`、`java-logo.webp`）都在阿里云 OSS（bucket `lihongbin-my-room`，公共读，oss-cn-shenzhen），代码里统一经 `src/Experience/assets.js` 的 `assetUrl(path)` 拼前缀；JS/CSS/favicon/`xp/` 构建产物仍走本站。上传/更新用 `tools/upload-oss.mjs`（AK/SK 走环境变量；每次重放 CORS 规则，幂等；本地缺的文件自动跳过，增量传新书封面直接跑）。三个跨域要点：① bucket 必须有 CORS（GET/HEAD from *），three.js 的 GLB/贴图/ROM 全是跨域 fetch；② 要画进 canvas 再上 WebGL 的 `new Image()`（如 java-logo）必须设 `crossOrigin='anonymous'`，否则画布被污染纹理上传报错（TextureLoader 自带，不用管）；③ BIOS 日志里 OSS 完整域名太长，`Loading.js` 的 onProgress/onError 已剥 origin 只留路径。
- **调试**：`window.experience` 已挂到全局，控制台可直接调相机（`experience.navigation.view.target.value.set(...)` 等）、灯光参数。
- **模型工作流**：Sketchfab 等下载的原始 GLB 放 `models-src/`（勿放 public/，44MB 的原始文件会被打进 dist）。先 `node tools/dump-tree.mjs <src>` 看完整层级 + 包围盒，再用 `node tools/prune-glb.mjs <src> <out> --keep "名1,名2"` 裁剪 + 自动压缩（减面 50%、顶点量化、贴图转 1024 WebP）输出到 `public/models/`。电脑区模型 44.66MB → 3.54MB，电视区 5 件共 5MB → 0.73MB。注意 sharp 必须用 0.33.x（0.35 在本机 win32 加载失败）。prune 工具会自动从场景根沿"独子包装链"下钻（兼容 `GLTF_SceneRootNode` 和 FBX/OBJ 转换的 `Sketchfab_model > xxx.fbx > RootNode` 两种层级），`--keep` 匹配的是下钻后那层的子节点名。
- **一个网格混多个部件的拆法**：运行时按三角形位置切（见 `ComputerZone.splitChairBase()`）；或离线按"顶点坐标相同即连通"做并查集拆成连通岛，按岛的包围盒聚类输出成命名网格（见 `tools/split-switch.mjs`，Switch 模型的盒子/手柄就是这样从 `Object_5` 里拆出来的，后来用户决定弃用只留主机）。
- **GLTFLoader 名字陷阱**：three 加载时会清洗节点名（`Plane.006_17` → `Plane006_17`，点号被去掉）。`--keep` 用 GLB 原始名，运行时 `getObjectByName` 用清洗后的名。
- **两态聚焦机制（通用）**：`Navigation.focus({ target, radius, phi, theta, limits })` 保存当前视角+限位、把目标值拨到指定机位（相机沿自带平滑飞过去、限位按传入收紧），`blur()` 一次性恢复。书架和电视共用。**互斥约定**：`navigation.savedView` 非空 = 已有区在聚焦，其他区的默认态点击/悬停必须先查它再响应（见 Bookshelf/MarioTV 的用法），否则会出现"A 区还在聚焦、B 区把视角抢走"的脏状态。不飞相机的交互也能加入互斥：CoffeeTableBooks 取书时 `focus()` 传当前视角（零位移，只为占住 savedView）+ `enabled=false` 把拖拽让给翻书，放回时 `blur()` 零跳变恢复。茶几书的几何与书架书同构（封面 +z、书脊 -x），平放姿态全在 homeQuat 里，取书后 slerp 回单位四元数正好是"立起面向镜头"，三段动画照搬 Bookshelf.heldFrame；说明卡直接复用 `world.bookshelf` 的（样式/DOM 只建一份）。
- **电视马里奥**：`MarioTV.js`——jsnes 的帧写进 ImageData，放大 blit 到屏幕画布（4:3 居中、两侧黑边、关 imageSmoothing 保像素感），再以 `CanvasTexture` 贴在电视面板前的平面上（`MeshBasicMaterial` + `toneMapped:false`，屏幕自发光不吃场景光）。**进页面就自动开机**：构造里 `initEmulator()`，默认态电视一直播着标题画面/演示（静音、无输入，像家里开着的电视，用户要求）；模拟器按 NES 实机帧率 60.0988fps 用累计 delta 步进，与显示器刷新率解耦。音频走 ScriptProcessor 环形缓冲：AudioContext 页面加载时创建（挂起态，先拿到真实采样率给 jsnes），聚焦点击这个用户手势里才 `resume()`（并丢掉积压采样防杂音），退出 `suspend()`=静音继续播。聚焦态才有键盘转发（←→↑↓、X=A、Z=B、Enter=Start）。聚焦机位 = "屏幕撑满"距离 × `FOCUS_DIST_SCALE`(2.2)，带出电视柜/墙面上下文——之前贴太近满屏游戏画面，用户反馈像被传送进另一个空间；想凑近滚轮拉。ROM 来自 gym-super-mario-bros 仓库（.gitignore 排除 `*.nes` 不入库），已上 OSS 从 `assetUrl('/roms/mario.nes')` 加载，缺失时屏幕显示 NO CARTRIDGE。
- **显示器 XP 系统**：`XPScreen.js` + `CSS3D.js`（2026-07 完成，TODO 4）。两态同 MarioTV：默认态屏幕是一块贴 `public/xp-desktop.webp` 截图的平面（零 DOM 开销），点击聚焦后才把 iframe（`/xp/index.html`）以 `CSS3DObject` 挂到 CSS3D 层、退出时卸载。**叠放用浮层方案而非原定挖洞法**：CSS3D 层 `z-index:5` 叠在 canvas 之上（ThemePanel 的 10 之下）、容器 `pointer-events:none` 只有 iframe wrapper 开 auto——iframe 外的事件穿透到 canvas，导航和"点屏幕外退出"照常；机位正对贴墙屏幕、前方无遮挡物，用不上遮挡正确性（日后穿帮再升级挖洞）。ESC 要同时挂 document 和 `iframe.contentWindow`（同源）——iframe 抢焦点后父页面收不到 keydown。屏幕定位：电脑区 GLB 网格无语义名，`Object_68` 是屏幕面板（零厚度自发光平面，Material.017）、`Object_66` 是显示器机身（命中盒/描边用）；XPScreen 必须在 `shiftDeskToCorner()` 之后构造（桌子挪完才能取世界包围盒）。悬停 cursor 注意：Bookshelf 每帧无条件写 cursor，`World.update()` 里 `xpScreen.update()` 排在它之后才不被冲掉。iframe 分辨率 1280×按屏幕比例，`scale = screenW/1280` 对齐到面板。
- **模型摆放套路**（新家具优先照 `TVZone.js`）：通用方法 `fit()`（阴影 + rotationX/Y 转向 + 按包围盒宽或高缩放到目标尺寸）和 `place()`（x/z 居中到给定值、`backZ` 把背面贴墙、`onY` 落地或上柜面），所有位置/尺寸/朝向集中在文件顶部常量，`ZONE_X` 可整区平移。**⚠️ 包围盒落地陷阱**：`Box3.setFromObject()` 默认只把局部盒 8 角过世界矩阵，模型内部带旋转（FBX 层级常见）时盒子虚胖，按盒底落地=实际几何悬空——摆放/落地计算要传 `setFromObject(obj, true)`（precise 逐顶点），DeskProps 耳机踩过（悬空 ≈0.2）。房间比例约 1 单位 = 0.5m。电脑区模型原始朝向面向 +z，背靠后墙无需旋转；`shiftDeskToCorner()` 把桌子（含桌面物件）单独推进左墙角、椅子不跟着动。

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

实施顺序（2026-07 更新）：聚焦相机已抽成通用 `Navigation.focus()/blur()`；**功能 5 已完成**（jsnes + CanvasTexture，不走 CSS3D）；**功能 4 已完成**（fork winXP + CSS3D 浮层嵌入，实现细节见"关键实现说明"的"显示器 XP 系统"条）。剩功能 6：在 xp/ 里加 ChatGPT 聊天窗口组件 + 后端代理，重新 `npm run build:xp` 即可，嵌入层不用动。**部署目标已定为自有服务器**：ChatGPT 代理写成 Node/Express 小服务即可（不需要 serverless）。

## TODO（按开发顺序）

1. [x] **电脑区**：桌、主机、显示器、键盘、鼠标、鼠标垫（桌垫）、电脑椅已完成（来自用户下载的 Sketchfab 游戏房模型，裁剪出 10 件核心）。遗留：
   - [x] 耳机 + 马克杯（2026-07 完成）：`World/DeskProps.js`，键盘左边（位置按运行时实测键盘/桌垫包围盒定，常量在文件顶部）。耳机 headphone_mesh（2026-07 从 microsoft_headphones_surface_2 换成此模型，5.4MB→164KB：`tools/crush-glb.mjs` 减面到 12%、无贴图纯几何、保法线传 dropNormal=0、meshopt 编码；换模型只需覆盖 public/models/headphones.glb + 传 OSS，摆放代码零改动。旧模型的教训仍适用：**放大简化误差换不来更少的面、只会白白变形**，减面下限时删隐藏部件才是正路）；耳机平放（rotX -90° 放平、耳罩朝下按钮面朝上，外层 Group 控朝向）；马克杯白模换陶瓷材质 + 咖啡液面圆片 + Java 官方 logo 贴纸（源图 Downloads/Java Logo.jpg，sharp 白底抠透明 → public/java-logo.webp，运行时画进 canvas 贴在杯身开口圆柱段上，弧段长宽比按图配平不变形，加载失败退回手绘兜底；**模型原点在杯身轴心，包围盒含手柄不对称，液面/贴纸定位用原点不用包围盒中心**；logo 图走 new Image() 不过 DefaultLoadingManager，不会让 BIOS 日志复活）+ 热气 shader（移植 Bruno CoffeeSteam，perlin 扰动+向上淡出，每帧绕 Y 朝相机）。BIOS 新增 USB audio device / Coffee 两行日志
   - [ ] 耳机/马克杯的 Sketchfab 署名信息（模型名 headphone_mesh / white_coffee_mug，作者链接用户下载页有），页面 credits 时一并带上
   - [ ] 桌子的 Sketchfab 署名信息（模型名 teachers_desk，2026-07 用 tools/swap-desk.mjs 换掉了原黑桌；此前短暂用过 low_poly_computer_desk 已弃用），页面 credits 时一并带上
   - [ ] Sketchfab 模型 CC 协议需要署名，页面加 credits 时记得带上（模型名 "3d gaming room with gaming setup"，作者见用户下载页）
2. [x] **电视区**：电视柜、电视、Switch 主机、沙发、茶几已完成（5 个独立 Sketchfab 模型，见 `World/TVZone.js`；Switch 模型混在一起的盒子/手柄用 `tools/split-switch.mjs` 拆出后弃用，只留主机）。遗留：
   - [ ] 这 5 个模型（coffee_table_no_textures / kitchenz_simona_tv_cabinet / psx_flat_screen_tv / sim_loveseat / switch_console_roblox）也是 Sketchfab CC 协议，页面 credits 记得一并署名
3. [x] **书架 + 书**：`World/Bookshelf.js`，全程序化。5 层木架贴左墙前段（z∈[-0.8, 4.0]，前端贴齐墙边缘，避开墙角电脑桌），只上架已读完的书（filter `finished`，约 110 本），按阅读顺序从左上往右下流式排列，每年第一本前立一个刻年份的小木盒分隔（【2018】书 书…【2019】…）。书本尺寸按页数/开本估算，书脊 canvas 贴图竖排书名，封面图懒加载（hover/取书时才请求 public/books/）。交互采用 Room_Portfolio 的两态模式：**默认态**悬停书架显示白描边（包围盒放大一圈的 BackSide 白壳，一个 draw call，以后上 EffectComposer 可换 OutlinePass）、点击书架进入**聚焦态**——保存当前视角后把 `Navigation.view` 的目标值拨到书架正前方（相机用自带平滑飞过去），同时收紧限位：phi/theta 锁死、radius 允许 2.5～取景距离（滚轮凑近看书名）、target 允许沿书架平移；点书架外任意处/ESC 退出，恢复保存的视角与限位（飞回去即"已取消"的反馈）。取书/还书只在聚焦态可用：hover 滑出、点击取书（抽出→飞到镜头前→拖拽翻转→点击/ESC 放回），拿书期间 `Navigation.enabled=false`。动效与数据移植自 `..\book` 项目（那边单位是米，这边 ×2）。这套"保存视角 + 改限位 + enabled 开关"的机制已抽成通用 `Navigation.focus()/blur()`（TODO 5 电视已复用，TODO 4 继续用）。遗留：
   - [ ] 新读完的书在 book 项目的 books.js 维护后拷到 booksData.js（封面图拷到 public/books/ 后跑 `tools/upload-oss.mjs` 传 OSS——封面运行时从 OSS 加载，只拷本地不上传是看不到的）。booksData 现在喂两处：书架只收 finished:true；茶几（CoffeeTableBooks.js）只放"正在读"的那本 = finished:false 里 date 最新的一本（用户约定同时只在读一本，其余 finished:false 是搁置的"未读完"不上桌），封面图用 new Image() 异步加载，不走 DefaultLoadingManager 不污染 BIOS 日志
   - [x] 书架 draw call 优化（2026-07 完成）：默认态书+年份盒合并成 6 个网格（所有书脊/年份盒正面共用一张 4096 宽的图集纹理、封面封底烘成顶点色），全场景 1571→155 call；聚焦书架时才惰性构建逐本独立网格（书脊也复用图集 UV 重映射，不再逐本建纹理），取书/悬停/封面懒加载不变，聚焦态约 694 call（用户认可"默认态牺牲视觉换性能、聚焦态视觉优先"）。enterFocus/exitFocus 里切换 mergedBooks/booksGroup 可见性
4. [x] **显示器装浏览器版 Windows XP**（2026-07 完成）：fork ShizukuIchi/winXP 到 `xp/` 子项目，构建产物入库在 `public/xp/`；`CSS3D.js` 第二渲染层 + `World/XPScreen.js` 两态交互（默认态截图纹理、聚焦态挂 iframe），浮层方案未用挖洞（理由与细节见"关键实现说明"）。已用 Playwright 全流程验证（悬停描边/点击聚焦/iframe 里点开始菜单/ESC 与点屏幕外退出/书架互斥/生产构建）。遗留：
   - [ ] winXP 是 MIT 协议，页面 credits 记得署名 ShizukuIchi/winXP
   - [ ] 默认态截图 `public/xp-desktop.webp` 是 Playwright 截的当前桌面，日后 XP 里加了新应用（如 ChatGPT）可重截一张
5. [x] **电视装可玩的超级马里奥**：`World/MarioTV.js`，jsnes + CanvasTexture 路线（不走 CSS3D）。进页面自动开机播标题/演示；两态交互同书架：悬停白描边、点击聚焦（机位带房间上下文）开声音和键盘、ESC/点屏幕外退出=静音继续播。已用 Playwright 全流程验证（自动开机/聚焦取景/Start 开局/键盘转发/退出静音/书架互斥）。遗留：
   - [x] ROM 部署问题已解决：已随其他大资源上 OSS（tools/upload-oss.mjs），运行时从 OSS 加载，服务器不用再放这个文件（git 也照旧不入库）
6. [ ] **XP 里加 ChatGPT 应用**（在 `xp/` 里仿照 Notepad 加聊天窗口组件 + Node/Express 后端代理，改完 `npm run build:xp` 重新构建即可，3D 侧不用动）
7. [x] **夜间灯光优化**（2026-07 完成，4 个提交对应 4 步）：落地灯（FloorLamp.js，点光落地 + 夜间 spot 软影）、发光窗（WallWindow.js，HDR 玻璃 + RectAreaLight）、实体夜灯（DeskGlow.js LED 呼吸灯带 + 台灯，屏幕夜间渐亮 1.35）、Bloom 后期（Renderer 双路径，白天直渲零开销）。实现细节与三个陷阱（scene.background、GLB 失控 emissive、A/B 测量的 shader 重编译）见"关键实现说明"。610M 实测夜间 31.7fps 与白天持平。遗留：
   - [ ] 灯具位置/颜色强度都是文件顶部常量，用户看过实际效果后可微调
8. [x] **BIOS 加载屏**（2026-07 完成）：`Loading.js` 仿开机自检——真实资源日志逐行打印、各模块 ready Promise 收口、日夜往返 shader 预热（首次拖滑杆的编译卡顿消化进 BIOS）、加载完自动淡出进场（无 START 门，用户已定）。机制与陷阱见"关键实现说明"的"BIOS 加载屏"条。遗留：
   - [ ] BIOS 文案（厂商行、Memory 数字等）纯装饰，用户可随喜好改 `Loading.js` 顶部与 pushPostLines()
9. [ ] **手机触屏适配**（2026-07 调研定案，方案依据：OrbitControls 源码语义 + 四个知名 3D 作品集源码取证；参考原版 my-room-in-3d 触屏无捏合缩放，此项是超出原版的改进）：
   - [x] 第一档·核心手势（2026-07 完成）：Navigation 重写为 Pointer Events（单指旋转/双指捏合缩放+中点平移，见"相机手感"条）；index.html 补 `touch-action:none`、viewport `user-scalable=no, viewport-fit=cover`、`overscroll-behavior:none`、`gesturestart` preventDefault（iOS 双指分落不同元素的漏网保险）；三个区 CLICK_SLOP 触屏放宽 7→12px、pointercancel 不再误判为点击。Playwright CDP 触摸模拟 8 项全过（旋转/捏合两向/平移正交性/点击聚焦与退出/鼠标滚轮回归）
   - [ ] 第二档·稳定性与性能：书架 4096 图集出 2048 移动版（**iPhone 典型 MAX_TEXTURE_SIZE=4096 压线，超限不报错直接杀 tab**）；`(pointer:coarse)` 检测 → 低档机 pixelRatio 封 1、阴影 512、夜间不进 Bloom composer（现有双路径条件多 && 一个档位判断即可）；竖屏锁水平 FOV（`vFov=2·atan(tan(hFov/2)/aspect)`，聚焦取景公式同步用 hFOV；不做"请横屏"遮罩——WCAG F100 失败项）
   - [ ] 第三档·体验补齐：移动端 XP 不挂 CSS3D iframe（WebKit transform-iframe 模糊 12 年未修 + winXP fork 零触摸支持），保持截图纹理+提示桌面体验；触屏下给三个可点区加常亮提示（替代 hover 描边，NN/g 推荐）；移动端 NES 聚焦才开机（省主线程 CPU）；canvas 自带 MSAA 在移动 tile GPU 近乎免费，**保留勿换 FXAA**
- [ ] 墙色可选改成参考图的"白 + 玫红"双色方案（用户尚未决定）
