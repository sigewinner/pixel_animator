# Pixel Animator 像素动画编辑器 — 软件架构与功能实现说明书

> 本文档面向开发者与维护者，系统分析 Pixel Animator（代码内部代号 **PixelForge**）的项目架构、目录组织，以及**每一项功能具体在哪个文件 / 哪个函数实现、其底层原理是什么**。
>
> 文档中所有源码路径均相对于项目根目录 `pixel-animator/`（即 `pixel_animator-1.8-UI-/pixel-animator/`）。行号基于撰写时的源码版本，仅供定位参考；涉及功能修订时会在第 9 节登记。

---

## 目录

1. [项目简介](#1-项目简介)
2. [技术栈与运行方式](#2-技术栈与运行方式)
3. [整体架构](#3-整体架构)
4. [目录结构](#4-目录结构)
5. [核心数据模型](#5-核心数据模型)
6. [模块逐文件地图](#6-模块逐文件地图)
7. [功能清单：位置与实现原理](#7-功能清单位置与实现原理)
8. [UI 布局与 JS 接线映射](#8-ui-布局与-js-接线映射)
9. [已知细节、注意事项与修订记录](#9-已知细节注意事项与修订记录)

---

## 1. 项目简介

Pixel Animator 是一个**网页版像素画 + 帧动画创作工具**。核心能力：

- 在画布上以像素为单位绘制（铅笔 / 橡皮 / 油漆桶 / 吸管）；
- 矢量图形工具（直线、圆、矩形、椭圆、三角、五角星、菱形、心形）；
- 多图层（可见性 / 不透明度 / 合并 / 排序 / 重命名）；
- 时间轴与帧管理（增删 / 复制 / 拖拽重排）；复制粘贴（Ctrl+C / Ctrl+V，作用于图层与帧）；
- 洋葱皮（前后帧半透明预览）、逐帧播放预览；
- 撤销 / 重做（全局快照栈，覆盖绘制、增删帧、复制粘贴、清空、翻转旋转、笔大小、图层操作等；Ctrl+Z 撤销 / Shift+Ctrl+Z 重做）；
- 缩放、视图旋转 / 平移、像素级翻转旋转、裁剪、网格；
- 照片转像素（量化 / 抖动 / 主色提取）、视频转帧；
- 导出 PNG / GIF、保存 `.pixa` 工程文件、云端作品库与画廊；
- 主题切换（深色 / 浅色 / Win7）、Web Audio 实时音效；
- 用户注册 / 登录（后端 SQLite 存储）。

---

## 2. 技术栈与运行方式

### 2.1 技术栈

| 层 | 技术 | 说明 |
|---|---|---|
| 前端 | 原生 HTML + 原生 JavaScript（ES5/ES6） | **无框架、无打包器**；模块化通过全局命名空间 `window.PA` 与 IIFE 实现 |
| 画布 | Canvas 2D API | `CanvasEngine` 中 `getContext('2d')` |
| 后端 | Node.js + Express 4 | `package.json` 依赖 `express`、`better-sqlite3` |
| 数据库 | SQLite（better-sqlite3 同步驱动） | 运行时自动创建 `data/pixel-animator.db` |
| GIF 编码 | `gif.js`（**本地内置** `public/lib/gif.js/`） | 非 CDN；通过 Web Worker + Blob 注入运行 |

> ⚠️ **对 README 的修正**：README 称 "gif.js (CDN)"，实际为本地内置文件，HTML 中无 `<script src="https://...">`。

### 2.2 运行方式

```bash
cd pixel-animator
npm install      # 仅安装后端依赖（express + better-sqlite3）
npm start        # node server/index.js，监听 :3000
```

- 编辑器：`http://localhost:3000/index.html`
- 画廊页：`http://localhost:3000/gallery.html`
- 后端用 `express.static` 直接托管 `public/` 静态资源，**前端无编译/构建步骤**，改完刷新即可。

> ⚠️ **对 README 的修正**：前端是纯静态文件，不存在 webpack/vite/babel 等构建流程。`npm install` 只是为了拿到后端依赖。

---

## 3. 整体架构

系统由**前端编辑器**与**后端 API 服务**两部分组成，通过 REST 接口通信（作品库、用户系统、云端草稿）。

### 3.1 前端架构：编排层 + 核心引擎 + 功能模块

```
index.html ──(同步 <script> 按依赖顺序加载)──►
   ├─ canvas-engine.js   类 CanvasEngine     （唯一绘制引擎，所有像素写入落点）
   ├─ animation.js       类 Animation        （帧 / 洋葱皮 / 播放）
   ├─ layer-system.js    类 LayerSystem       （多图层 × 多帧）
   ├─ color-wheel.js     类 ColorWheel        （HSV 色轮拾色器）
   ├─ app.js             编排层 window.PA      （共享状态 + 全局快照/撤销 + 初始化调度）
   ├─ js/modules/*.js    功能模块 PA.Palette / Toolbar / Frames / Playback / Export / Import / CanvasSize / Batch
   ├─ video-import.js    视频转帧
   ├─ sound.js           音效合成
   ├─ theme.js           主题
   ├─ auth.js            登录态
   └─ gallery.js         画廊页（独立页面）
```

**关键设计**：
- `app.js` 是唯一的**编排层（Orchestrator）**，持有共享状态 `PA.state`，并定义全局快照 / 撤销（`saveSnapshot / pushSnapshot / undoOperation / redoOperation`）。
- 功能模块通过 `PA.<Module>.init()` 暴露接口，模块间依赖 `PA.state` 与全局 `window.engine` / `window.anim` 通信。

### 3.2 编辑器控制流（从页面加载到可交互）

1. `index.html` 内联脚本调用 `Auth.requireAuth()`：未登录跳转 `login.html`；已登录则渲染用户菜单、像素 Logo，并把用户名填入作者框。
2. 所有 `<script>` 加载完毕后，`app.js` 在 `DOMContentLoaded` 后执行 `init()`。
3. `init()` 流程：
   - 计算初始画布尺寸（`computeDims` + `computePixelSize`）；
   - `new CanvasEngine(...)` → `new Animation(...)`；
   - 绑定 `engine.onDrawEnd` / `engine.onColorPick` 回调（绘制结束写回帧、吸管取色；**`onDrawEnd` 现已补 `renderFrameList()` 以刷新帧列表预览**）；
   - 依次调用各模块 `init()`：`PA.Palette / Toolbar / Frames / Playback / Export / Import / CanvasSize / Batch`；
   - 设置 `S.anim.onFramesChange = renderFrameList` 等回调；
   - `await loadProject()` 从云端 / 本地恢复草稿，否则建空帧；
   - 创建 `LayerSystem`，把 `anim.selectFrame`、`engine.onDrawEnd` 包装补全图层逻辑；
   - `initSoundIntegration()` 把音效织入各类操作。
4. 此后用户交互由各模块事件监听驱动（绘制事件集中在 `canvas-engine` 的 `mousedown/mousemove/mouseup`）。

### 3.3 后端架构

- `server/index.js`：Express 服务 + REST API（注册 / 登录、作品增删查、点赞、用户草稿存取）。
- `server/db.js`：SQLite 建表与预编译语句（`works` / `users` / `user_projects` 三张表）。
- 密码采用 `sha256 + salt`。
- 前端离线降级：后端不可用时，作品存入 `localStorage.pa_works`，登录降级到 `localStorage.pa_users`。

---

## 4. 目录结构

```
pixel-animator/
├── server/
│   ├── index.js          Express 服务器 + API 路由（注册/登录/作品/草稿）
│   └── db.js             SQLite 连接、建表、预编译语句
├── public/               前端静态资源
│   ├── index.html        编辑器主页面（三栏布局）
│   ├── gallery.html      作品画廊页（独立页面）
│   ├── login.html        登录页（纯前端，调 auth API）
│   ├── css/
│   │   ├── style.css     主样式
│   │   └── gallery.css   画廊页样式
│   ├── js/
│   │   ├── canvas-engine.js   画布绘制引擎（工具/缩放/旋转/裁剪/洋葱皮/图层合成钩子/撤销重做）
│   │   ├── animation.js       帧动画系统（帧增删/排序/洋葱皮/播放）
│   │   ├── layer-system.js    多图层 + 多帧系统
│   │   ├── color-wheel.js     HSV 色轮拾色器
│   │   ├── app.js             编排层（共享状态 + 全局快照/撤销 + 初始化与模块调度）
│   │   ├── gallery.js         画廊页逻辑
│   │   ├── video-import.js    视频转帧
│   │   ├── sound.js           Web Audio 实时合成 UI 音效
│   │   ├── theme.js           主题（深色/浅色/Win7）
│   │   ├── auth.js            登录态检查、用户菜单、像素 Logo
│   │   └── modules/
│   │       ├── palette.js     调色板、临时调色板、色轮绑定、自定义色增删
│   │       ├── toolbar.js     工具栏、图形子菜单、缩放、裁剪、视图旋转/翻转
│   │       ├── frames.js      帧增删/复制/排序（与 LayerSystem 同步）
│   │       ├── playback.js    播放控制、FPS、洋葱皮开关与透明度
│   │       ├── export.js      导出 GIF/PNG、上传作品库、保存/加载 .pixa 工程
│   │       ├── import.js      照片转像素（量化/抖动/主色提取）
│   │       ├── canvas-size.js 画布尺寸（分辨率×比例）设置
│   │       └── batch.js       批量导出 PNG / 批量删除帧
│   └── lib/
│       └── gif.js/          第三方 GIF 编码库（本地内置：gif.js + gif.worker.js）
├── data/               SQLite 数据文件（运行时自动创建）
├── package.json
└── README.md
```

> 注：实际文件比 README 列出的更完整（多了图层系统、色轮、音效、主题、视频导入、各功能模块等），以上为完整结构。

---

## 5. 核心数据模型

### 5.1 像素数组（最原始结构）

- **单帧** = `Array(width * height)`，元素为 `#rrggbb` 字符串或 `null`（透明）。
- 索引换算：`y * width + x`。

### 5.2 帧集合（动画）— `Animation`（`animation.js`）

- `anim.frames`：二维数组，`frames[current]` 即当前帧像素数组。
- `anim.current`（当前帧索引）、`anim.fps`、`anim.width / height`。
- 即使启用了图层，`anim.frames[i]` 仍保存每帧**合成图**（`layer-system.js`），用于渲染 / 导出 / 保存（向后兼容）。
- **空工程**：`frames` 可被删空为 `[]`，此时 `current = 0`，引擎加载空白帧以保持可绘制状态（见 9 节修订）。

### 5.3 图层数据 — `LayerSystem`（`layer-system.js`）

统一模型：
- `this.layers[]`：`{ id, name, visible, opacity, locked, pixels }`，结构在所有帧间**共享**。
- `this.framePixelData[frameIndex][layerIndex]`：每帧每层的独立像素缓冲。
- `this.layers[i].pixels`：指向 `framePixelData[currentFrame][i]` 的实时引用。
- 引擎绘制时写 `engine.activeLayer`，写完经 `_recomposite()` 调用 `compositeFn` → `getCompositePixels` 得到合成图。

### 5.4 快照（撤销/重做）— `app.js:saveSnapshot`

- 快照结构 `{ width, height, frames: 帧拷贝, current, penSize, eraserSize, layers: layerSystem.getSnapshot() }`；`penSize/eraserSize` 一并保存，使画笔大小变化也可撤销。
- **撤销语义（关键）**：各操作在「变更之后」调用 `pushSnapshot()`（把变更后状态压栈）。`undoOperation` 因此弹出栈顶（刚刚完成的操作）移入重做栈，再弹出并恢复栈中**倒数第二个状态（即操作前状态）**，从而真正回退到操作前。`init()` 末尾会种入一份初始快照作为撤销"地基"（第一次撤销可回到初始状态）。`redoOperation` 把重做栈顶状态恢复回去。上限 `MAX_HISTORY = 100`。
- 图层快照 `LayerSystem.getSnapshot`；恢复用 `restoreSnapshot`（同时还原 `penSize/eraserSize` 与对应滑块 UI）。

### 5.5 持久化格式（.pixa / 云端）

`export.js:saveToLocalFile` / `loadFromLocalFile` 与 `app.js:getCurrentProjectData` 使用：

```
{
  format: 'pixelforge-project', version, title, author,
  width, height, fps, frames: [[...]], currentFrame,
  palette, customColors, thumbnail, layerData, savedAt
}
```

后端 `works` 表额外列：`frame_count, fps, frames_json(TEXT), thumbnail`。

---

## 6. 模块逐文件地图

| 文件 | 职责 | 关键导出 / 全局 | 关键逻辑行号 |
|---|---|---|---|
| `public/js/canvas-engine.js` | 画布绘制引擎（工具、绘制、撤销重做、缩放、旋转、裁剪、洋葱皮、图层合成钩子、网格棋盘格背景） | `class CanvasEngine`（`window.CanvasEngine`） | 构造（`showGrid` 默认 `true`）；`_bindEvents`；`_drawDot`；`_eraseArea`；`_floodFill`；`_drawLinePixels`（Bresenham）；`_drawCirclePixels`（中点圆）；`_drawShapeOutline`；`render`（网格棋盘格背景 + 网格线）；`pushHistory/undo/redo`；静态 `transformFrame`；`loadFrame(null)` 安全加载空帧；`setPenSize/setEraserSize` |
| `public/index.html` | 入口 HTML：全局键盘快捷键、登录态、设置/图片弹窗、画布与面板布局 | — | 全局 `keydown`：`p/e/f/l/c/k/i` 工具键（`c`→`shape`）；Ctrl+Z 撤销、Shift+Ctrl+Z / Ctrl+Y 重做；Ctrl+C 复制、Ctrl+V 粘贴（在 `INPUT`/`TEXTAREA` 中不透传，避免误触工具键） |
| `public/js/animation.js` | 帧动画系统（帧增删/排序、洋葱皮、播放控制） | `class Animation`（`window.Animation`） | `selectFrame` `:27`；`addFrame` `:36`；`duplicateFrame` `:46`；`deleteFrame` `:56`（**已放开"至少保留一帧"限制，可删空**）；`moveFrame` `:73`；`_renderOnion` `:84`；`play` `:146`；`stop` `:158`；`getThumbnail` `:181`（空工程返回空白缩略图） |
| `public/js/layer-system.js` | 多图层 + 多帧（可见性、不透明度、合并、排序、快照） | `class LayerSystem`，`blendHex` | `_initFromAnim`；`getCompositePixels`；`addLayer`；`duplicateLayer`；`mergeDown`；`setOpacity`；`getSnapshot`；`restoreSnapshot`；`transformAllFrames`；`deleteFrameLayers`（按索引 splice，批量删除时同步调用） |
| `public/js/color-wheel.js` | HSV 色轮拾色器（色相环+饱和度轮+亮度滑块） | `ColorWheel`，`ColorWheelUtil` | `hsvToRgb`；`drawWheel`；`setColor`；`_bindEvents` |
| `public/js/app.js` | 编排层：共享状态 `PA.state`、全局快照/撤销、复制粘贴、初始化与模块调度 | `window.PA` | `PA.state` `:8`；`saveSnapshot` `:64`；`pushSnapshot` `:76`；`undoOperation` `:85`；`redoOperation` `:96`；`restoreSnapshot` `:104`（还原笔大小/滑块）；`copySelection` `:163`；`pasteSelection` `:186`；`pasteFrame` `:198`；`pasteLayer` `:224`；`renderFrameList` `:431`；`init` `:566`（末尾 `pushSnapshot()` 种入初始快照）；`initSoundIntegration` `:699` |
| `public/js/modules/palette.js` | 调色板、临时调色板、色轮绑定、自定义色增删 | `PA.Palette` | `buildPalette`；`selectColor`；`addCustomColor`；`addToTempPalette`；`bindColorWheel` |
| `public/js/modules/toolbar.js` | 工具栏、图形子菜单、缩放、裁剪、视图旋转/翻转、网格、笔大小 | `PA.Toolbar` | `bindToolbar`（`btnUndo/btnRedo`、`btnClear`、`btnGrid` 切换、笔/橡皮大小 `input` 实时更新 + `change` 时 `pushSnapshot`）；`initShapeMenu`；`bindZoom/setZoom`；`bindCrop`（含 `renderFrameList` 刷新）；`bindView`/`doTransform`（含 `renderFrameList` 刷新） |
| `public/js/modules/frames.js` | 帧增删/复制/排序（与 LayerSystem 同步） | `PA.Frames` | `bindFrames`（包装 `addFrame/duplicateFrame/deleteFrame/moveFrame`）；`btnDelFrame` 守卫已移除，直接调用 `S.anim.deleteFrame()` |
| `public/js/modules/playback.js` | 播放控制、FPS、洋葱皮开关与透明度 | `PA.Playback` | `bindPlayback` |
| `public/js/modules/export.js` | 导出 GIF/PNG、上传作品库、保存/加载 .pixa 工程 | `PA.Export` | `exportGif`；`saveWork`；`saveToLocalFile`；`loadFromLocalFile` |
| `public/js/modules/import.js` | 照片转像素（量化/抖动/主色提取） | `PA.Import` | `importImages`；`processAllImages`；`medianCut`；`quantizeFrame`；`directSample`（含 `renderFrameList` 刷新） |
| `public/js/modules/canvas-size.js` | 画布尺寸（分辨率×比例）设置 | `PA.CanvasSize` | `applyCanvasSize` |
| `public/js/modules/batch.js` | 批量导出 PNG / 批量删除帧 | `PA.Batch` | `openModal`；`exportSelected`；`deleteSelected`（**已放开"至少保留一帧"，降序 splice 实现"选中几张删几张"**） |
| `public/js/video-import.js` | 视频转帧（解码、按 FPS 采样、像素化） | `window.VideoImport` | `processVideo`；`extractFrames`；`framesToPixels`；`importToAnimation` |
| `public/js/sound.js` | Web Audio 实时合成 UI 音效 | `window.SFX` | `SFX` 对象（click/select/pick/pen/fill/…） |
| `public/js/theme.js` | 主题（深色/浅色/Win7）动态加载 CSS | `window.Theme` | `applyTheme`；`initTheme` |
| `public/js/auth.js` | 登录态检查、用户菜单、像素 Logo | `window.Auth` | `getCurrentUser`；`requireAuth`；`renderUserMenu` |
| `public/js/gallery.js` | 画廊页（列表/搜索/排序/预览播放/下载/删除） | `window.closePreview` 等 | `loadWorks`；`renderGallery`；`previewWork`；`deleteWork` |
| `server/index.js` | Express 服务 + API 路由 | — | 注册；登录；作品 CRUD；草稿 |
| `server/db.js` | SQLite 建表与预编译语句 | `stmts` | `works` 表；`users` 表；`user_projects` 表 |
| `public/lib/gif.js/gif.js` + `gif.worker.js` | 第三方 GIF 编码库（本地内置） | `GIF` 全局 | 由 `export.js` 调用 |

---

## 7. 功能清单：位置与实现原理

> 每项标注：**实现文件 + 函数 + 行号 + 工作原理**。

### 7.1 画布绘制（铅笔 / 橡皮 / 填充 / 吸管）

- **铅笔**：`canvas-engine.js` 工具 `pencil` → `_applyTool` → `_drawDot`，按 `penSize` 画圆形笔刷点；拖动用 `_drawLinePixels` 连线。
- **橡皮**：工具 `eraser` → `_eraseArea` 把目标像素置 `null`（透明）。
- **油漆桶填充**：工具 `fill` → `_floodFill`，基于栈的 4 邻域泛洪（与 `target` 颜色相同才填充），`visited` 去重。
- **吸管取色**：工具 `eyedropper` → `onDown` 读 `_getPixelColor`，回调 `engine.onColorPick` → 写入临时调色板、设置引擎颜色、选中调色板色块。
- **统一入口**：`canvas-engine.js` 的 `_bindEvents` 的 `onDown/onMove/onUp` 分发；笔触结束触发 `onDrawEnd` → `app.js` 把像素写回 `anim.frames[current]` 并 `pushSnapshot`，**并调用 `renderFrameList()` 刷新帧列表缩略图预览**。

### 7.2 矢量 / 图形工具（直线、圆、形状子菜单）

工具 `line/circle/shape` 采用**预览模式**：`onDown` 记录起点并存快照；`onMove` 用快照重绘预览；`onUp` 落笔真正写入。

- 直线 `_drawLinePixels`：Bresenham 算法。
- 圆 `_drawCirclePixels`：中点圆算法。
- 形状 `_drawShapeOutline` 按 `shapeType` 分发：`_drawRectOutline`、`_drawEllipseOutline`（Bresenham 椭圆）、`_drawTriangleOutline`、`_drawStarOutline`、`_drawDiamondOutline`、`_drawHeartOutline`（参数方程）。
- 形状选择 UI：`toolbar.js:initShapeMenu`，写入 `engine.setShapeType`。

### 7.3 网格显示

`engine.showGrid`（默认 `true`，在 `canvas-engine.js` 构造中初始化；`index.html` 的 `#btnGrid` 按钮默认带 `active` 类）。`render()` 据此绘制**背景**：**激活时**画布背景为灰白相间棋盘格（`#ffffff` 与 `#d9d9d9`），**关闭时**为纯白；同时当 `pixelSize >= 8` 时叠加浅色网格线。工具栏 `btnGrid` → `toolbar.js:bindToolbar` 切换 `showGrid` 并 `render()` 重绘。

### 7.4 缩放（Zoom）

`toolbar.js:bindZoom` + `setZoom`：以 `basePixelSize * zoomLevel` 计算新 `pixelSize`，调用 `engine.setPixelSize`。范围 0.25×–6×。

### 7.5 视图旋转 / 平移 / 像素级翻转旋转

- **视觉旋转/平移（不改像素）**：`engine.setRotation`、`setPan`、`resetView`，通过 CSS `transform` 实现；鼠标输入需逆向旋转还原坐标。UI：`toolbar.js:bindView`。
- **像素级翻转/旋转（真正改数据，作用于所有帧的所有图层）**：`toolbar.js:doTransform` → 有图层时 `LayerSystem.transformAllFrames`，否则 `CanvasEngine.transformFrame` 静态方法。`flipH/flipV/rotCW/rotCCW` 返回新数组，旋转会交换宽高；**`doTransform` 末尾调用 `PA.renderFrameList()` 刷新预览**。

### 7.6 裁剪（Crop）

工具 `crop` → `onDown` 记录起止，`render` 画暗化选区，`onUp` 触发 `onCropSelect` 回调显示确认栏。确认：`toolbar.js:btnCropConfirm` 调 `engine.applyCrop` + `anim.crop` + `layerSystem.crop` 三处同步，最近邻采样保留内容；**`bindCrop` 末尾调用 `PA.renderFrameList()` 刷新预览**。

### 7.7 颜色选择器（调色板 + 色轮 + 临时调色板）

- **默认/自定义调色板**：`palette.js:buildPalette` 渲染色块，默认 20 色 `PA.DEFAULT_PALETTE`；自定义色存 `localStorage.pa_custom_colors`。
- **HSV 色轮**：`color-wheel.js`，`btnColorWheel` 打开弹窗，`onChange` 实时写回引擎颜色，`onAddToPalette` 加入自定义色；支持 Hex 输入。
- **临时调色板**：吸管取色时 `addToTempPalette` 存入 `PA.state.tempPalette`（最多 10 色），点击即用、右键移除。
- **删除某颜色（吸管模式）**：`palette.js:startDeleteColor` 进入删除态，点击画布像素即清除当前帧该色（`app.js` 内 `onColorPick` 分支，含 `renderFrameList()` 刷新）。

### 7.8 图层系统（Layer System）

- 操作：`addLayer`、`duplicateLayer`、`deleteLayer`、`moveLayerUp/Down`、`mergeDown`（向下合并按不透明度 alpha 混合）、`toggleVisibility`、`selectLayer`、`setOpacity`、双击重命名 `renameLayer`。
- **合成**：`getCompositePixels` 自底向上叠加各可见图层，`blendHex` 做 alpha 混合；结果写入 `engine.pixels` 用于显示 / 导出。
- **每帧每图层独立缓冲**：`framePixelData[frame][layer]`，切换帧 `loadFrameLayers` / `saveCurrentFrameLayers` 同步；锁定图层阻止绘制。
- UI：`toolbar.js:btnToggleLayers` 显示/隐藏面板，`layer-system.js:_renderLayerList` 渲染可拖拽列表。

### 7.9 帧 / 时间轴（Timeline）

`animation.js` 管理 `frames` 数组。`frames.js:bindFrames` 包装 `addFrame/duplicateFrame/deleteFrame/moveFrame` 并同步 LayerSystem（`addFrameLayers` 等）与快照。时间轴 UI：`app.js:renderFrameList` 生成每帧缩略图并支持**拖拽重排**（`dragstart/drop` → `anim.moveFrame`）。右侧按钮：`btnAddFrame/btnDupFrame/btnDelFrame/btnBatchDelete`。

**删除规则（已放开"至少保留一帧"限制）**：
- 单帧删除：`animation.js` 的 `deleteFrame` 已移除 `frames.length <= 1` 的守卫，删空后加载空白帧（保持可绘制状态）；`frames.js` 的 `btnDelFrame` 守卫提示也已移除，直接调用 `S.anim.deleteFrame()`；`app.js` 音效包装层改为 `frames.length >= 1` 才执行删除。
- 批量删除：`batch.js:deleteSelected` 同样移除了"删除后至少保留一帧"的拦截；按所选索引**降序 splice** 避免错位，并同步 `layerSystem.deleteFrameLayers`，做到"**选中几张就删除几张**"，支持删到空工程。

**帧列表预览刷新（每次操作后都会刷新）**：
`renderFrameList` 在以下操作后均被调用，刷新帧列表缩略图——新增/复制/删除/拖拽重排帧、`toolbar.js` 的裁剪与像素翻转旋转、`import.js` 的照片导入、`video-import.js` 的视频导入，以及**每次绘制完成**（`app.js` 的 `onDrawEnd` 现补 `renderFrameList()`）。因此预览**不再仅在新增帧时刷新**。

### 7.10 洋葱皮（Onion skin）

`Animation.toggleOnionSkin` 开/关，`_renderOnion` 取前一帧（红 tint）与后一帧（蓝 tint）经 `engine.setOnion` 传入；渲染用 `globalAlpha = onionAlpha` 绘制前后帧轮廓。透明度滑杆：`playback.js` → `engine.setOnionAlpha`。

### 7.11 播放预览（Playback）

`Animation.play`：`setInterval(1000/fps)` 循环 `loadFrame(frames[current])` 并触发 `onFrameSelect`；`stop` 复位当前帧。FPS 滑杆：`playback.js` → `anim.setFps`（播放中重启定时器）。播放按钮文本在 `playback.js` 切换。

### 7.12 撤销 / 重做（Undo/Redo）与复制粘贴

- **全局快照（主路径）**：`app.js` 的 `pushSnapshot` / `undoOperation` / `redoOperation` / `restoreSnapshot`，快照含 `frames` 全帧拷贝、`current`、`penSize`、`eraserSize`、图层快照、`width/height`，上限 `MAX_HISTORY = 100`。
- **撤销语义**：各操作变更后调用 `pushSnapshot()`；`undoOperation` 弹出栈顶（当前操作）移入重做栈，再恢复栈中倒数第二状态（操作前）；`init()` 末尾种入初始快照作为"地基"。`redoOperation` 恢复重做栈顶。`restoreSnapshot` 末尾清空引擎局部 `history/future`。
- **覆盖范围（全局）**：绘制、增删帧、复制/粘贴帧与图层、清空、像素翻转/旋转、画笔大小（滑块 `change` 时 `pushSnapshot`）、图层增删/排序/合并/可见性/不透明度等均已接入撤销。
- **复制 / 粘贴**：`app.js` 的 `copySelection` / `pasteSelection`（快捷键 Ctrl+C / Ctrl+V）。Ctrl+C 同时复制当前帧（像素）与当前图层（含所有帧像素）到各自剪贴板；Ctrl+V 按上下文分流——图层面板打开时粘贴图层（`pasteLayer`），否则粘贴帧（`pasteFrame`，复制像素写入新帧最底层以保证合成正确）。两者均通过 `pushSnapshot` 可撤销。
- **引擎局部历史**：`canvas-engine.js:pushHistory/undo/redo` 仍保留，但全局撤销由上面主路径主导。
- UI / 快捷键：`toolbar.js` 绑定 `btnUndo/btnRedo`；快捷键 **Ctrl+Z 撤销、Shift+Ctrl+Z 或 Ctrl+Y 重做**；Ctrl+C 复制、Ctrl+V 粘贴。

### 7.13 导出 PNG

- 单帧：`export.js:exportPng`。
- 批量：底部"导出 PNG"按钮实为 `PA.Batch.openModal('export')` → `batch.js:exportSelected`，对所选帧逐张 `canvas.toDataURL` 下载 `frame_xxx.png`。

### 7.14 导出 GIF

`export.js:exportGif`：取 `getAllFrames`，每张帧缩放到 `gifScale`（1/2/4/8×，最近邻），用本地 `GIF` 库（worker 经 Blob 注入），`delay = 1000/fps`，带进度条与 15s 看门狗超时。

### 7.15 照片转像素（导入图片）

`import.js:importImages` → `processAllImages`：用 `drawToCanvas` 按 fitMode（cover/contain/stretch）绘制到 `w×h` canvas，取 `ImageData`。
- **量化**：`quantizeFrame` 用 `nearestPaletteColor` 匹配调色板，可选 Floyd–Steinberg **抖动**；不量化则 `directSample` 直接用原色。
- **主色提取**：`medianCut` 中值切分算法从采样像素抽取最多 256 色加入自定义调色板。
- 多图：第一张替换当前帧，其余 `anim.addFrame` 新建帧并同步图层缓冲；**`import.js` 末尾调用 `PA.renderFrameList()` 刷新预览**。

### 7.16 视频转帧（Video import）

`video-import.js:processVideo`：读视频 ArrayBuffer → `loadVideo` → 按所选 FPS 计算 `frameCount`（上限 120 帧、时长 ≤15s）→ `extractFrames` 用 `video.currentTime` + `seeked` 逐帧截取到离屏 canvas → `framesToPixels` 像素化 → `importToAnimation` 写入当前帧及后续帧（同步图层、更新 FPS、快照、自动保存；写入后刷新预览）。

### 7.17 作品库（上传 / 画廊 / 下载）

- 上传：`export.js:saveWork` POST `/api/works`；后端不可用时降级 `localStorage.pa_works`。
- 画廊：`gallery.js` 拉取列表，支持标签 / 搜索 / 排序；点击卡片 `previewWork` 用 `setInterval` 在 `previewCanvas` 播放帧序列，可下载 `.pixa` 或删除。

### 7.18 草稿 / 工程文件（云 + 本地）

- 云端草稿：`app.js:saveProjectToServer` POST `/api/project`（header `x-username`）。
- 本地 `.pixa`：`export.js:saveToLocalFile` 导出 JSON（format `pixelforge-project`），`loadFromLocalFile` 读取还原（含 `layerData`）。
- 自动保存：`app.js:autoSave` 1 秒防抖后调用云端保存。

### 7.19 画布尺寸设置

`canvas-size.js:applyCanvasSize`：按 `resolutionSelect × ratioSelect` 用 `computeDims` 计算 `w×h`，调 `engine.resize` / `anim.resize` / `layerSystem.resize` 三处最近邻缩放。

分辨率下拉框预设值：16/24/32/48/64/96/128/256/512/1080 px，另含「自定义」选项——选中后显示 `#customResolution` 数字输入框（范围 2–1080），由 `getResolution()` 统一读取解析。`computePixelSize` 最小像素改为 1（原 4），使 256/512/1080 等大分辨率画布不会超出显示区域。`syncSizeSelectors` 加载作品时若尺寸不匹配任何预设则自动切换到自定义模式并回填值。

### 7.20 主题切换

`theme.js:applyTheme`：dark（默认）/ light / win7，动态 `loadCSS` / `removeCSS`，偏好存 `localStorage.pa_theme`。

### 7.21 音效

`sound.js` 的 `SFX` 用 Web Audio 合成（振荡器 + 低通 master bus），涵盖 click/select/pick/pen/erase/fill/play/stop/add/delete 等；`app.js:initSoundIntegration` 把音效织入引擎与动画的原方法。开关 `btnSoundToggle`。

### 7.22 用户认证

- 注册 / 登录：`server/index.js`（密码 `sha256 + salt`）。前端 `login.html` 调 API，失败降级 `localStorage.pa_users`。
- `auth.js:requireAuth` 守卫编辑器与画廊页。

### 7.23 性能优化（大分辨率 256/512/1080 适配）

针对大分辨率下的卡顿与内存/体积膨胀，做了四项根治性优化：

- **渲染（核心实时卡顿修复）**：`canvas-engine.js:render` 废弃逐像素 `fillRect`（1080px 下 116 万次/帧），改为离屏小画布（逻辑分辨率）+ `ImageData` + `drawImage`（`imageSmoothingEnabled=false` 最近邻放大）一次性绘制；洋葱皮同样用离屏 `ImageData` 叠加；新增 `_getRGBA` 颜色解析缓存（像素画颜色种类极少）。
- **冗余历史移除**：`canvas-engine` 自带的 `history/future`（每次落笔深拷贝整帧 50 份）从未被外部撤销使用（全局快照才是真正的撤销），已移除 `_onDown`/`clear` 中的 `pushHistory()` 调用，消除 1080px 下约 1.5GB 的纯浪费。
- **撤销快照帧级 copy-on-write**：`app.js:saveSnapshot` 对 `anim.frames` 改为外层 `.slice()`（内层帧数组共享引用，因帧只整体替换、从不原地修改），`restoreSnapshot` 仍深拷贝保证恢复后独立；`MAX_HISTORY` 100→50。撤销栈内存从「100×全帧」降到约「100×单帧」。
- **存储格式 RLE 压缩**：`app.js` 新增 `rleEncode/rleDecode/encodeFrames/decodeFramesPayload` 并挂到 `PA`；`getCurrentProjectData`、`saveToLocalFile`、`saveWork` 编码，`loadProject`、`loadFromLocalFile`、gallery 预览解码。像素画透明区巨大，1080px 空白帧 JSON 约 5.5MB → RLE 约 100 字节；旧格式（原始数组）自动兼容。
- **缩略图降采样**：`animation.js:getThumbnail` 最长边封顶 256px（1:1 渲染后整体缩放），移除原 `ps=4` 在 1080px 生成的 4320×4320 PNG 体积炸弹。

---

## 8. UI 布局与 JS 接线映射

编辑器 `index.html` 为三栏布局，全部由 `window.engine` 的 `#drawCanvas` 绑定鼠标事件统一驱动：

| HTML 区域 | 关键元素 / id | 接线 JS | 说明 |
|---|---|---|---|
| 顶栏 `header.topbar` | `#userMenu`、`#brandIcon`、画廊链接 | `auth.js`、`app.js` | 用户菜单、像素 Logo、登出 |
| 左侧面板 `aside.sidebar-left` | `#palette`、`#tempPalette`、`#penSizeSlider`、`#eraserSizeSlider`、`#layerPanel` | `palette.js`、`toolbar.js`、`layer-system.js` | 调色、笔刷大小、图层面板 |
| 垂直工具栏 `nav.toolbar-vertical` | `[data-tool]`、`#btnToggleLayers`、`#btnUndo`、`#btnRedo`、`#btnClear`、`#btnGrid`、设置/导入按钮 | `toolbar.js:bindToolbar`、`initShapeMenu`、`bindView` | 工具选中 → `engine.setTool`；撤销/重做/清空/网格/笔大小；快捷键（Ctrl+Z 撤销、Shift+Ctrl+Z / Ctrl+Y 重做、Ctrl+C/V 复制粘贴、p/e/f/l/c/k/i 切换工具）在 `index.html` 全局 `keydown` 绑定 |
| 画布区 `section.canvas-area` | `#drawCanvas`、`#canvasInfo`、缩放/旋转/翻转控件、`#cropBar` | `canvas-engine.js:_bindEvents`；`toolbar.js:bindZoom/bindCrop/bindView` | 唯一绘制表面，所有像素操作落点 |
| 右侧面板 `aside.sidebar-right` | `#frameList`（时间轴/帧列表预览）、`#btnAddFrame/...`、`#btnPlay`、`#btnOnion`、`#fpsSlider` | `animation.js` + `app.js:renderFrameList` + `frames.js` + `playback.js` | 帧管理、播放、洋葱皮；`#frameList` 缩略图在每次操作后刷新 |
| 底部栏 `footer.bottombar` | `#btnPng`、`#btnGif`、`#btnSave`、`#btnSaveLocal/LoadLocal`、`#btnSaveProject`、`#btnSaveDraft` | `export.js:bindExport`、`batch.js` | 全部导出 / 保存入口 |
| 弹窗层 | 设置卡 `#settingCardOverlay`、图片导入卡 `#pictureCardOverlay`、色轮 `#cwOverlay`、批量 `#batchModal` | `canvas-size.js`、`import.js` + `video-import.js`、`palette.js:bindColorWheel`、`batch.js` | 模态交互 |
| 画廊页 `gallery.html` | `#gallery`、`#previewModal` + `#previewCanvas`、`#searchInput`、`#sortSelect` | `gallery.js` | 独立页面，拉取/播放/下载/删除作品 |

**关键耦合点**：`#drawCanvas` 是 UI 与数据之间唯一的像素写入点——所有绘制工具最终都落在 `CanvasEngine` 的方法里，`onDrawEnd` 回调把像素回流到 `Animation.frames`，再经 `LayerSystem` 合成、`render()` 重绘，并由 `pushSnapshot` 进入撤销栈；`onDrawEnd` 同时调用 `renderFrameList()` 使帧列表预览保持最新。

---

## 9. 已知细节、注意事项与修订记录

1. **gif.js 为本地内置**，并非 README 所写的 CDN 引用；HTML 中无外链 `<script src="https://...">`。
2. **前端无构建步骤**，属"静态文件 + 后端 API"架构；`npm install` 仅为后端依赖。
3. **图层系统是后期接入的**：当 `S.layerSystem` 存在时，绘制目标从 `engine.pixels` 改为 `engine.activeLayer`，而 `anim.frames` 仍保持"合成图"以实现向后兼容。
4. 存在少量全局变量耦合（如 `video-import.js` 直接用 `window.engine`），模块间主要通过 `PA.state` 与全局 `window.engine` / `window.anim` 通信。
5. 后端不可用时前端全面降级到 `localStorage`（作品 `pa_works`、用户 `pa_users`、草稿经云端接口失败时本地缓存），保证离线可用。
6. 撤销上限 `MAX_HISTORY = 100`；视频导入帧数上限 120 帧、时长 ≤15s。
7. **空工程安全**：`deleteFrame` / 批量删除可删至 `frames = []`；此时引擎 `loadFrame(null)` 加载空白帧保持可绘制，`getThumbnail` 对空工程返回空白缩略图，避免崩溃；`play()` 在帧数 < 2 时直接返回。

### 修订记录

- **2026-07-23（帧删除与预览刷新）**
  - 放开"至少保留一帧"限制：移除 `animation.js:deleteFrame` 的 `frames.length <= 1` 守卫、`frames.js:btnDelFrame` 的提示守卫、`batch.js:deleteSelected` 的"删除后至少需保留一帧"拦截；`app.js` 音效包装层由 `frames.length > 1` 改为 `>= 1`。空工程安全处理（`loadFrame(null)` / `getThumbnail` 空白）。
  - 批量删除"选中几张删几张"：`batch.js:deleteSelected` 按所选索引降序 splice（同步 `layerSystem.deleteFrameLayers`），支持删到空工程。
  - 帧列表预览每次操作后刷新：`app.js` 的 `onDrawEnd` 补 `renderFrameList()`（绘制完成即刷新缩略图）；裁剪、像素翻转旋转、照片/视频导入本就刷新。预览不再仅新增帧时刷新。
  - 受影响文件：`animation.js`、`frames.js`、`batch.js`、`app.js`。

---

*文档基于 `pixel-animator/` 源码静态分析生成；行号仅供定位参考，功能修订见第 9 节。*
