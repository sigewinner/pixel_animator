# 更新日志 (Changelog)

本文件记录 Pixel Animator 各版本的更新内容。

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
  - 修复：改为 `display: none !important`，最小化后窗口完全消失，仅保留任务栏按钮以便恢复；通过任务栏按钮可正常打开。
- **修复：最大化按钮无法切换回还原状态**
  - 原因：点击最大化按钮始终调用 `maximizeWindow()`，没有处理已最大化的情况。
  - 修复：在 `maximizeWindow()` 中判断：若已最大化则调用 `restoreWindow()` 返回原尺寸；同时切换图标为 `❑`（还原），恢复时切回 `■`（最大化）。

### 🔧 其他
- 任务栏「新建画布」按钮固定到最左侧，并随横向滚动保持钉住（`position: sticky`）。
- 服务器端口改为读取环境变量（`process.env.PORT || 3000`），避免与本地其他服务冲突。
- 移除调试用的 `window.__PA` 钩子。

---

## 历史版本
- 早期版本（GitHub `main`，2026-07-09 之前）：基础单画布编辑器，含绘制、图层、时间轴、洋葱皮、GIF 导出、作品库画廊。
