# 更新日志 (Changelog)

本文件记录 Pixel Animator 各版本的更新内容。

## v32.4 — 最小化/最大化过渡动画 + 音效丢失修复（2026-07-10）

### 🎬 最小化 / 最大化 / 还原 过渡动画
- **修复：最小化/最大化没有过渡，窗口「啪」地一下出现/消失，观感生硬**
  - 原因：旧实现中最小化用 `display: none !important` 直接让元素瞬间消失，CSS 动画根本来不及播放；最大化只对 `scale` 做了 keyframes，而 `top/left/width/height` 等几何尺寸是瞬变的，也没有真正的平滑放大效果。
  - 修复（CSS）：
    - `.canvas-window` 基础 `transition` 增加 `opacity 0.22s` 与 `transform 0.22s`。
    - `.minimized` 不再用 `display:none`，改为 `opacity: 0` + `transform: scale(0.08) translateY(220px)`（淡出并缩向任务栏方向），并 `pointer-events: none`；窗口仍保留在 DOM 中，因此既有平滑淡出动画，点击任务栏按钮也能正常恢复。
    - 新增 `.animating-geometry` 类，仅在该类存在时对 `left/top/width/height` 做 `0.2s ease` 平滑过渡（动画结束后移除），避免拖拽 / 缩放窗口时跟手「粘滞」。
    - 删除旧版无效的 `@keyframes`（winMinimize / winRestore / winMaximize）及其 `animating-*` 钩子。
  - 修复（JS，`window-manager.js`）：`minimizeWindow` / `maximizeWindow` / `restoreWindow` 统一改用 `animating-geometry` 触发几何过渡，移除此前残留的 `animating-*` 的 `setTimeout` 逻辑。
  - 验证（puppeteer + Edge 实机）：最小化时窗口 `opacity` 由 1 → 0.2（过渡中）→ 0 平滑淡出并缩向任务栏；最大化时窗口几何尺寸由 280px 平滑过渡到整块桌面宽度（738px）并铺满桌面区；点击任务栏按钮 / 再次点击最大化按钮均可平滑还原。

### 🔊 修复「偶尔音效丢失」
- **修复：部分点击 / 操作的提示音偶尔不响**
  - 原因：`getCtx()` 里 `audioCtx.resume()` 是异步方法却未 `await`，当 `AudioContext` 处于 `suspended` 状态（页面刚加载、切回标签页、首次用户手势之前）时，直接在其上调度 `oscillator` 会被浏览器丢弃，表现为「偶尔没声音」。
  - 修复（`sound.js`）：
    - 新增 `ensureRunning()`：在 `suspended` 时调用 `resume()` 并缓存其 Promise（避免并发重复 resume），返回是否已进入 `running`。
    - 新增 `withRunningCtx(cb)`：上下文非 `running` 时先 `await ensureRunning()` 再调度，确保 `oscillator` 只在可发声状态下被创建。
    - 所有发声函数（`tone` / `sweep` / `sequence`）统一经 `withRunningCtx` 调度；两个音的叠加改为相对 `when`（秒）偏移，而非 `getCtx().currentTime + 延迟`。
    - 首次用户手势（`pointerdown` / `keydown` / `touchstart`）注册一次性监听，自动 `resume()` 解锁音频上下文，保证最开始的提示音不会因自动播放策略被吞掉。
  - 验证（puppeteer + Edge）：交互后 `SFX.click / toggle / pick / error` 均可无异常调用；在浏览器中验证 `AudioContext` 的 `resume` 模式有效（suspended → running），消除冷启动 / 切标签页后的声音丢失。

## v32.3 — 修复左侧图形溢出到右边缘（2026-07-10）

- **修复：在画布左侧绘制圆形 / 椭圆 / 星形等图形时，溢出到右侧边缘**
  - 原因：`CanvasEngine._setPixel(x, y, color)` 直接以 `y * width + x` 计算下标且未做越界检查。当图形画到左边缘之外时 `x` 变为负数，`y*width + (负数)` 会进位到**上一行的右侧**，于是左侧图形的一部分「绕」到右边显示；同理画到右下角之外时会进位到下一行左侧。
  - 修复：在 `_setPixel` 入口增加越界判断 `if (x < 0 || x >= width || y < 0 || y >= height) return;`，越界像素直接丢弃（像素画的标准裁剪行为）。该写入点是铅笔、橡皮、直线、矩形、圆形、椭圆、星形、心形、菱形、三角形的唯一落点，因此一次性修复了所有图形工具的越界溢出。
  - 验证（puppeteer + Edge，直接读取 `engine.pixels`）：在 128×128 画布左侧（中心逻辑 x=2）画半径约 22 的圆，修复后 `maxX=23`、`minX=0`、右边缘 8 列内 0 个像素；回退修复后同一操作会溢出至 `maxX=127`、右边缘出现 16 个像素，证实该测试能稳定复现并验证修复。

## v32.2 — 裁剪后状态持久化 + 防缓存（2026-07-10）

- **裁剪结果即时写回画布标签**：在裁剪确认后立刻调用 `saveCurrentTabState()`，把裁剪后的帧数据与画布尺寸（`canvasW/canvasH/basePixelSize`）写回当前画布标签。此前裁剪结果只存在于 `anim.frames`（克隆副本），虽在下次切换画布时由 `switchTab` 触发 `saveCurrentTabState` 写回，但即时写回可避免任何异常路径下「裁剪后切回画布画面丢失」的隐患，也使自动保存 / 窗口预览立刻正确。
- **静态资源禁用缓存**：`server/index.js` 的 `express.static` 增加 `Cache-Control: no-cache, no-store, must-revalidate`，避免浏览器沿用旧的 `app.js` / `canvas-engine.js`，导致「代码已修但页面仍显示旧 bug」。
- **验证（puppeteer + Edge 实机，直接读取 `engine.pixels`）**：绘制→裁剪（尺寸 128→52，内容保留）→切到 2 号画布→切回 1 号，1 号画布裁剪后的内容完好（像素计数保留）、且仍可继续绘制（像素计数继续增长）。裁剪后立即在同画布绘制同样有效。

## v32.1 — 画布挂载回归修复（2026-07-10）

- **修复：选中画布即丢失画面、无法绘图（回归）**
  - 背景：本应已修复的画布挂载问题在一次目录内容覆盖操作中被旧版本代码回退——`app.js` 重新出现了 `wrapTemplate.removeChild(canvasWrap)` 以及 `init()` 收尾处错误的 `frames.length === 0` 判断，导致 `drawCanvas` 再次被从文档摘除、初始帧数据未加载。
  - 修复：重新移除 `removeChild(canvasWrap)`（改由 `moveCanvasToActiveWindow` 通过 `appendChild` 把 `canvasWrap` 从隐藏模板移入活动窗口）；并将 `loadTabState` 的触发条件改回「引擎尚未加载过帧数据（`!engine.getFrameData()`）」。
  - 验证：puppeteer + Edge 实机测试确认——首屏 `drawCanvas` 即挂在活动窗口且可见；在 1 号画布绘制后切到 2 号再切回，1 号画布内容（红色像素）完好保留且仍可继续绘制；无 JS 报错。

## v32 — 多画布系统 + 关键 Bug 修复（2026-07-09）

### ✨ 新增功能
- **Win98 风格多画布浮动窗口系统**：支持同时打开多块画布，每块画布以独立、可拖拽、可缩放的浮动窗口呈现。
  - 多画布标签管理（新建 / 切换 / 关闭画布）
  - 非活动画布显示合成预览缩略图，活动画布显示可编辑画布
  - 窗口支持四角等比例缩放、拖拽移动、任务栏最小化
  - 选中窗口时自动缩放画布以适配窗口尺寸

### 🐛 关键 Bug 修复
- **修复：初始画布无法挂载进活动窗口（画面空白 / 无法绘图）**
  - 原因：`init()` 中 `wrapTemplate.removeChild(canvasWrap)` 把 `#drawCanvas` 从文档中摘除，导致 `moveCanvasToActiveWindow` 用 `getElementById` 永远找不到它，窗口里只剩空的预览画布。
  - 修复：移除 `removeChild`，仅隐藏模板容器，并通过缓存引用移动 `canvasWrap` / `cropBar`。
- **修复：切换 / 选中画布时画面丢失、内容无法保留**
  - 原因：`init()` 收尾处的判断 `frames.length === 0` 永远为假（`createCanvasTab` 已预置了长度为 1 的 `frames`），导致全新项目时 `loadTabState(0)` 从未被调用，`engine.frameData` 始终为 `null`；绘制只写入 `engine.pixels` 而未进入 `frameData`，`syncCurrentFrame` 克隆出 `null` 写回 `tab.frames`，一切换画布当前内容即被清空。
  - 修复：将判断改为「只要引擎尚未加载过帧数据就加载」（`!engine.getFrameData()`），确保初始画布正确建立帧数据并持久化。
- **修复：撤销（Ctrl+Z / 撤回按钮）有时无法撤销**
  - 原因：引擎的 `onDrawEnd` 回调（负责把绘制结果压入撤销栈）从未被触发，导致铅笔/橡皮/填充等自由绘制笔画根本没进入撤销历史；同时 `saveSnapshot()` 一直快照滞后的 `anim.frames`，多笔画无法逐步回退。
  - 修复：落笔时（`onDown`）触发 `onDrawStart` 压入「操作前」快照，抬笔时（`onUp`）同步实时像素回 `frameData` 并触发 `onDrawEnd` 把结果写回 `anim.frames`，使每笔都能逐步撤销 / 重做。

### 🐛 最小化 / 最大化修复
- **修复：最小化后仍留在画面上方一条栏**
  - 原因：`.canvas-window.minimized` 仅将高度缩为 32px 标题栏，没有真正隐藏。
  - 修复：改为淡出并缩向任务栏（详见 v32.4 的过渡动画——现以 `opacity:0 + transform` 平滑收起，仍保留在 DOM 中以支持动画与点击任务栏恢复）。
- **修复：最大化按钮无法切换回还原状态**
  - 原因：点击最大化按钮始终调用 `maximizeWindow()`，没有处理已最大化的情况。
  - 修复：在 `maximizeWindow()` 中判断：若已最大化则调用 `restoreWindow()` 返回原尺寸；同时切换图标为 `❑`（还原），恢复时切回 `■`（最大化）。

### 🔧 其他
- 任务栏「新建画布」按钮固定到最左侧，并随横向滚动保持钉住（`position: sticky`）。
- 服务器端口改为读取环境变量（`process.env.PORT || 3000`），避免与本地其他服务冲突。
- 移除调试用的 `window.__PA` 钩子。

---

## v32.5 — 渲染性能优化（2026-07-10）

### ⚡ 渲染管线重写（核心卡顿修复）
- **问题：画图 / 拖拽时明显卡顿**
  - 原因：`CanvasEngine.render()` 每次都用 `ctx.fillRect` 逐像素绘制整张画布（棋盘格背景 + 每个像素 + 网格线）。128×128 画布单次 `render()` 约 **4.8ms**，而画笔 / 橡皮拖拽的每次 `mousemove` 都会触发整屏重绘；连续拖动时成百上千次 `render()` 堆积，主线程被填满，画面掉帧、操作粘滞。
  - 修复（`canvas-engine.js`）：
    1. **离屏小画布 + `putImageData` + 最近邻放大**：新增离屏画布（逻辑分辨率 `W×H`），把每个逻辑像素写入 `ImageData` 后 `putImageData` 一次性上传，再用 `drawImage` 以 `imageSmoothingEnabled=false` 放大到主画布。把「成千上万次 `fillRect`」降为「1 次 `putImageData` + 1 次 `drawImage`」。
    2. **棋盘格缓存**：棋盘格背景预渲染到缓存 canvas，每帧一次 `drawImage` 贴图，不再逐像素 `fillRect`。
    3. **颜色解析缓存**：`hex → [r,g,b]` 解析结果按颜色缓存，避免渲染时重复 `parseInt`（洋葱皮与多图层合成均受益）。
    4. **`requestAnimationFrame` 节流**：新增 `_scheduleRender()`，把拖拽绘制高频路径（铅笔 / 橡皮 / 直线 / 图形预览 / 裁剪预览）的多次 `render()` 合并到同一帧只渲染一次，彻底消除拖动时的重绘堆积。
- **量化收益（puppeteer + Edge 实测，headless 环境）**
  - 32×32 画布 `render()`：0.348ms → **0.027ms**（≈13×）
  - 128×128 画布 `render()`：4.793ms → **0.772ms**（≈6×）
  - 模拟连续拖拽 300 次绘制操作：调度总耗时仅 0.3ms（每次 0.001ms），实际渲染只在 `requestAnimationFrame` 时发生 1 次（优化前 300 次会同步渲染、累计 690ms+ 卡死）。

### 🎨 图层合成加速
- **修复：`blendPixel` 逐像素重复解析 hex 颜色**
  - 原因：`LayerUtils.blendPixel()` 每次调用都 `parseInt` 解析 `top` / `bottom` 两个颜色字符串，多图层合成时是主要开销。
  - 修复（`layers.js`）：模块内增加颜色解析缓存 `_parseHex()`，`blendPixel` 命中缓存后仅做数组索引与一次混合计算。

### 🔧 其他
- 端到端验证（真实浏览器）：拖拽绘制画面正确保留、多图层合成（顶层覆盖底层）正确、洋葱皮渲染无报错、最小化 / 最大化 / 还原过渡动画未回归。

---

## v32.6 — 任务栏打开 / 最大化返回动画强化（2026-07-10）

### 🎬 从底端任务栏打开画布的动画
- **修复：从任务栏点击恢复最小化窗口时缺少明确的「展开」动画**
  - 原因：`restoreWindow` 在 `win.state==='minimized'` 时仅加了 `animating-geometry`（几何不变，无实际效果），展开仅依赖基类 `transition: opacity/transform` 的淡入，无「从任务栏弹出」的观感。
  - 修复（`window-manager.js` + `win98-windows.css`）：新增 `animating-open` + keyframe `winOpenFromTaskbar`，窗口从「任务栏底部缩放回弹」展开（`opacity 0→1`、`transform scale(0.08)→1` + `translateY(220px)→0`），动画结束自动清理 class。

### ↩️ 再次点击最大化后的返回动画
- **修复：最大化后再次点击最大化按钮「还原」时窗口瞬间跳变，没有过渡**
  - 原因：① `restoreWindow` 从 `maximized` 恢复时根本没加 `animating-geometry`，因此无过渡；② `.maximized` 用 `width:100% !important`，与 `prevBounds` 的像素值是「`%` ↔ `px`」——CSS 无法在两种单位间插值，导致还原瞬间跳变。
  - 修复：
    - `window-manager.js`：最大化时改为用像素**内联**设置几何（`left/top/0`，宽高 = `desktop-area` 的 `clientWidth/clientHeight`），`restoreWindow` 从 `maximized` 恢复时补加 `animating-geometry`。
    - `win98-windows.css`：`.maximized` 去掉 `top/left/width/height` 的 `% !important`（仅保留圆角/边框/阴影标记），几何全部交由 JS 以像素驱动；`.canvas-window` 基类 `transition` 移除 `opacity/transform`（改由 keyframe 显式驱动，避免与展开动画冲突）。

### ✅ 验证（puppeteer + Edge 实机）
- 从任务栏打开：`animating-open` 播放中 `opacity` 0 → 0.79 → 1，动画结束 class 自动清除、`minimized` 移除。
- 最大化：几何宽度动画中采样 `701px`（介于 586 ↔ 738），平滑放大。
- 再次点击最大化返回：几何宽度动画中采样 `616px`（介于 738 ↔ 586），**平滑过渡、无跳变**。

---

## 历史版本
- 早期版本（GitHub `main`，2026-07-09 之前）：基础单画布编辑器，含绘制、图层、时间轴、洋葱皮、GIF 导出、作品库画廊。
