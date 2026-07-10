// public/js/canvas-engine.js - 画布绘制引擎
// 负责：网格渲染、绘制工具（铅笔/橡皮/填充）、撤销重做

class CanvasEngine {
  /**
   * @param {HTMLCanvasElement} canvas 主画布
   * @param {number} width 画布像素宽（如 32）
   * @param {number} height 画布像素高（如 32）
   * @param {number} pixelSize 每个像素的屏幕尺寸（如 16）
   */
  constructor(canvas, width, height, pixelSize = 16) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.width = width;
    this.height = height;
    this.pixelSize = pixelSize;

    canvas.width = width * pixelSize;
    canvas.height = height * pixelSize;

    // 当前帧数据：图层格式 { layers: [...], activeLayer: 0 }
    // this.pixels 始终指向活动图层的像素数组（供绘制工具直接操作）
    this.frameData = null;
    this.pixels = this.createEmpty();

    // 图层回调（图层数量/顺序变化时触发）
    this.onLayersChange = null;

    // 画布拖动回调
    this.onPanMove = null;

    this.tool = 'pencil';
    this.color = '#000000';
    this.penSize = 1;        // 钢笔大小
    this.eraserSize = 3;     // 橡皮擦大小
    this.shapeType = 'circle'; // 当前图形类型
    this.isDrawing = false;
    this.showGrid = true;

    // 撤销重做栈
    this.history = [];
    this.future = [];
    this.maxHistory = 50;

    // 预览工具（直线/圆形）状态
    this.previewStart = null;
    this.previewSnapshot = null;

    // 裁剪选择状态
    this.cropStart = null;
    this.cropEnd = null;
    this.hasCropSelection = false;
    this.onCropSelect = null; // 选区完成时的回调

    this._bindEvents();
  }

  createEmpty() {
    return new Array(this.width * this.height).fill(null);
  }

  /** 加载一帧数据（支持图层格式或旧版扁平数组） */
  loadFrame(frameData) {
    if (LayerUtils.isLayerFrame(frameData)) {
      // 克隆帧数据，避免与 anim.frames 共享引用
      this.frameData = LayerUtils.cloneFrame(frameData);
      var active = LayerUtils.getActiveLayer(this.frameData);
      this.pixels = active ? active.pixels : this.createEmpty();
    } else {
      // 旧版扁平数组 → 包装为单图层
      this.pixels = frameData ? frameData.slice() : this.createEmpty();
      this.frameData = {
        layers: [{
          id: 1, name: 'Background', visible: true, opacity: 1,
          pixels: this.pixels
        }],
        activeLayer: 0
      };
    }
    this.history = [];
    this.future = [];
    this.render();
  }

  /** 获取活动图层的像素数据（用于保存/同步） */
  getPixels() {
    return this.pixels.slice();
  }

  /** 获取合成后的像素（所有可见图层合并，用于导出/缩略图） */
  getCompositePixels() {
    if (this.frameData) {
      return LayerUtils.getCompositePixels(this.frameData, this.width, this.height);
    }
    return this.pixels.slice();
  }

  /** 获取当前帧的完整图层数据 */
  getFrameData() {
    return this.frameData;
  }

  /** 同步活动图层像素到 frameData（在切换帧/保存前调用） */
  syncToFrameData() {
    if (this.frameData) {
      var active = LayerUtils.getActiveLayer(this.frameData);
      if (active) active.pixels = this.pixels;
    }
  }

  setTool(tool) {
    this.tool = tool;
  }

  setShapeType(type) {
    this.shapeType = type;
  }

  setColor(color) {
    this.color = color;
  }

  setBrushSize(size) {
    // 兼容旧调用：同时设置钢笔和橡皮大小
    this.penSize = Math.max(1, Math.min(10, size));
    this.eraserSize = Math.max(1, Math.min(20, size));
  }

  setPenSize(size) {
    this.penSize = Math.max(1, Math.min(10, size));
  }

  setEraserSize(size) {
    this.eraserSize = Math.max(1, Math.min(20, size));
  }

  setPixelSize(size) {
    this.pixelSize = size;
    this.canvas.width = this.width * size;
    this.canvas.height = this.height * size;
    this.render();
  }

  /**
   * 调整画布尺寸，将现有像素按最近邻缩放到新分辨率
   * @param {number} newW 新宽度（像素数）
   * @param {number} newH 新高度（像素数）
   * @param {number} newPixelSize 新的屏幕像素大小
   */
  resize(newW, newH, newPixelSize) {
    const oldW = this.width, oldH = this.height;
    const oldPixels = this.pixels;
    const newPixels = new Array(newW * newH).fill(null);

    // 最近邻采样：把旧像素映射到新画布
    for (let y = 0; y < newH; y++) {
      for (let x = 0; x < newW; x++) {
        const ox = Math.floor(x * oldW / newW);
        const oy = Math.floor(y * oldH / newH);
        newPixels[y * newW + x] = oldPixels[oy * oldW + ox];
      }
    }

    this.width = newW;
    this.height = newH;
    this.pixelSize = newPixelSize;
    this.canvas.width = newW * newPixelSize;
    this.canvas.height = newH * newPixelSize;
    this.pixels = newPixels;

    // 同步并缩放 frameData 中所有图层
    if (this.frameData) {
      this.syncToFrameData();
      LayerUtils.resizeFrame(this.frameData, oldW, oldH, newW, newH);
      var active = LayerUtils.getActiveLayer(this.frameData);
      if (active) this.pixels = active.pixels;
    }

    this.history = [];
    this.future = [];
    this.render();
  }

  /** 获取归一化的裁剪选区（x1/y1 为左上角，x2/y2 为右下角） */
  getCropRect() {
    if (!this.cropStart || !this.cropEnd) return null;
    const x1 = Math.min(this.cropStart.x, this.cropEnd.x);
    const y1 = Math.min(this.cropStart.y, this.cropEnd.y);
    const x2 = Math.max(this.cropStart.x, this.cropEnd.x);
    const y2 = Math.max(this.cropStart.y, this.cropEnd.y);
    return { x1, y1, x2, y2, w: x2 - x1 + 1, h: y2 - y1 + 1 };
  }

  /** 清除裁剪选区 */
  clearCrop() {
    this.cropStart = null;
    this.cropEnd = null;
    this.hasCropSelection = false;
    this.render();
  }

  /**
   * 执行裁剪：提取选区像素，调整画布到选区尺寸
   * @param {number} x1 选区左上 x
   * @param {number} y1 选区左上 y
   * @param {number} x2 选区右下 x
   * @param {number} y2 选区右下 y
   * @param {number} newPixelSize 裁剪后的屏幕像素大小
   */
  applyCrop(x1, y1, x2, y2, newPixelSize) {
    const newW = x2 - x1 + 1;
    const newH = y2 - y1 + 1;
    const newPixels = new Array(newW * newH).fill(null);
    for (let y = 0; y < newH; y++) {
      for (let x = 0; x < newW; x++) {
        newPixels[y * newW + x] = this.pixels[(y1 + y) * this.width + (x1 + x)];
      }
    }
    const oldW = this.width;
    this.width = newW;
    this.height = newH;
    this.pixelSize = newPixelSize || this.pixelSize;
    this.canvas.width = newW * this.pixelSize;
    this.canvas.height = newH * this.pixelSize;
    this.pixels = newPixels;

    // 裁剪 frameData 中所有图层
    if (this.frameData) {
      this.syncToFrameData();
      LayerUtils.cropFrame(this.frameData, x1, y1, x2, y2, oldW);
      var active = LayerUtils.getActiveLayer(this.frameData);
      if (active) this.pixels = active.pixels;
    }

    this.history = [];
    this.future = [];
    this.cropStart = null;
    this.cropEnd = null;
    this.hasCropSelection = false;
    this.render();
  }
  _idx(x, y) {
    return y * this.width + x;
  }

  /** 鼠标事件 → 像素坐标 */
  _getPixelCoord(e) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    const px = Math.floor((e.clientX - rect.left) * scaleX / this.pixelSize);
    const py = Math.floor((e.clientY - rect.top) * scaleY / this.pixelSize);
    return { x: Math.max(0, Math.min(this.width - 1, px)), y: Math.max(0, Math.min(this.height - 1, py)) };
  }

  _bindEvents() {
    const onDown = (e) => {
      e.preventDefault();

      // 拖动画布工具：通过回调移动画布
      if (this.tool === 'pan') {
        this.isPanning = true;
        this.panLastX = e.clientX;
        this.panLastY = e.clientY;
        this.canvas.classList.add('dragging');
        return;
      }

      const { x, y } = this._getPixelCoord(e);

      // 裁剪工具：开始选区
      if (this.tool === 'crop') {
        this.isDrawing = true;
        this.cropStart = { x, y };
        this.cropEnd = { x, y };
        this.hasCropSelection = false;
        if (this.onCropSelect) this.onCropSelect(null); // 隐藏确认栏
        this.render();
        return;
      }

      // 吸管工具：从合成画面取色（不限于活动图层）
      if (this.tool === 'eyedropper') {
        const idx = this._idx(x, y);
        var pickColor = this.pixels[idx];
        // 如果活动图层该位置为空，从合成画面取色
        if (!pickColor && this.frameData) {
          var comp = this.getCompositePixels();
          pickColor = comp[idx];
        }
        if (this.onColorPick && pickColor) this.onColorPick(pickColor);
        return;
      }

      this.isDrawing = true;
      this.pushHistory();
      if (this.tool === 'line' || this.tool === 'shape') {
        // 预览工具：记录起点和快照，拖拽时实时预览
        this.previewStart = { x, y };
        this.previewSnapshot = this.pixels.slice();
      } else {
        this._applyTool(x, y);
      }
    };
    const onMove = (e) => {
      // 拖动画布
      if (this.isPanning) {
        var dx = e.clientX - this.panLastX;
        var dy = e.clientY - this.panLastY;
        this.panLastX = e.clientX;
        this.panLastY = e.clientY;
        if (this.onPanMove) this.onPanMove(dx, dy);
        return;
      }
      if (!this.isDrawing) return;
      const { x, y } = this._getPixelCoord(e);

      // 裁剪工具：更新选区
      if (this.tool === 'crop') {
        this.cropEnd = { x, y };
        this.render();
        return;
      }

      if (this.tool === 'line') {
        this.pixels = this.previewSnapshot.slice();
        this._drawLinePixels(this.previewStart.x, this.previewStart.y, x, y, this.color);
        this.render();
      } else if (this.tool === 'shape') {
        this.pixels = this.previewSnapshot.slice();
        this._drawShape(this.shapeType, this.previewStart.x, this.previewStart.y, x, y, this.color);
        this.render();
      } else {
        this._applyTool(x, y);
      }
    };
    const onUp = () => {
      // 拖动画布结束
      if (this.isPanning) {
        this.isPanning = false;
        this.canvas.classList.remove('dragging');
        return;
      }
      // 裁剪工具：完成选区
      if (this.tool === 'crop' && this.isDrawing) {
        this.isDrawing = false;
        const rect = this.getCropRect();
        if (rect && rect.w >= 1 && rect.h >= 1) {
          this.hasCropSelection = true;
          if (this.onCropSelect) this.onCropSelect(rect);
        } else {
          this.clearCrop();
        }
        this.render();
        return;
      }

      this.isDrawing = false;
      this.previewStart = null;
      this.previewSnapshot = null;
    };

    this.canvas.addEventListener('mousedown', onDown);
    this.canvas.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);

    // 触摸支持
    this.canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.touches[0];
      onDown({ clientX: t.clientX, clientY: t.clientY, preventDefault: () => {} });
    });
    this.canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      const t = e.touches[0];
      onMove({ clientX: t.clientX, clientY: t.clientY });
    });
    this.canvas.addEventListener('touchend', onUp);
  }

  _applyTool(x, y) {
    if (this.tool === 'pencil') {
      this._stampBrush(x, y, this.color);
      if (window.SFX) { var now = Date.now(); if (!this._lastPenSfx || now - this._lastPenSfx > 60) { this._lastPenSfx = now; SFX.pen(); } }
    } else if (this.tool === 'eraser') {
      this._stampBrush(x, y, null);
      if (window.SFX) { var now2 = Date.now(); if (!this._lastEraseSfx || now2 - this._lastEraseSfx > 60) { this._lastEraseSfx = now2; SFX.erase(); } }
    } else if (this.tool === 'fill') {
      this._floodFill(x, y, this.color);
      if (window.SFX) SFX.fill();
    }
    this.render();
  }

  /** 笔刷盖章：以 (cx,cy) 为中心画 size×size 方块 */
  _stampBrush(cx, cy, color) {
    const bs = (this.tool === 'eraser') ? this.eraserSize : this.penSize;
    const half = Math.floor(bs / 2);
    const start = bs % 2 === 0 ? -half + 1 : -half;
    for (let dy = start; dy <= half; dy++) {
      for (let dx = start; dx <= half; dx++) {
        this._setPixel(cx + dx, cy + dy, color);
      }
    }
  }

  _setPixel(x, y, color) {
    // 越界像素直接丢弃，避免负 x 经 y*width+x 进位到上一行右侧（左侧图形溢出到右边缘）
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    const i = this._idx(x, y);
    if (this.pixels[i] !== color) {
      this.pixels[i] = color;
    }
  }

  /** 洪水填充 */
  _floodFill(sx, sy, newColor) {
    const target = this.pixels[this._idx(sx, sy)];
    if (target === newColor) return;
    const stack = [[sx, sy]];
    while (stack.length) {
      const [x, y] = stack.pop();
      if (x < 0 || x >= this.width || y < 0 || y >= this.height) continue;
      const i = this._idx(x, y);
      if (this.pixels[i] !== target) continue;
      this.pixels[i] = newColor;
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
  }

  /** Bresenham 画直线 */
  _drawLinePixels(x0, y0, x1, y1, color) {
    let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    let sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    while (true) {
      this._setPixel(x0, y0, color);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
    }
  }

  /** 中点画圆算法（描边） */
  _drawCirclePixels(cx, cy, r, color) {
    if (r < 0) r = 0;
    if (r === 0) { this._setPixel(cx, cy, color); return; }
    let x = r, y = 0, err = 0;
    while (x >= y) {
      this._setPixel(cx + x, cy + y, color);
      this._setPixel(cx + y, cy + x, color);
      this._setPixel(cx - y, cy + x, color);
      this._setPixel(cx - x, cy + y, color);
      this._setPixel(cx - x, cy - y, color);
      this._setPixel(cx - y, cy - x, color);
      this._setPixel(cx + y, cy - x, color);
      this._setPixel(cx + x, cy - y, color);
      y++;
      if (err <= 0) { err += 2 * y + 1; }
      if (err > 0) { x--; err -= 2 * x + 1; }
    }
  }

  /** 图形绘制分发器 */
  _drawShape(type, x0, y0, x1, y1, color) {
    switch (type) {
      case 'circle': {
        const r = Math.round(Math.hypot(x1 - x0, y1 - y0));
        this._drawCirclePixels(x0, y0, r, color);
        break;
      }
      case 'ellipse': {
        const rx = Math.abs(x1 - x0);
        const ry = Math.abs(y1 - y0);
        this._drawEllipsePixels(x0, y0, rx, ry, color);
        break;
      }
      case 'rect': {
        const minX = Math.min(x0, x1), maxX = Math.max(x0, x1);
        const minY = Math.min(y0, y1), maxY = Math.max(y0, y1);
        this._drawRectPixels(minX, minY, maxX, maxY, color);
        break;
      }
      case 'triangle': {
        const dy = y1 - y0;
        const dx = x1 - x0;
        const halfW = Math.abs(dx);
        const top = { x: x0, y: y0 };
        const bl = { x: x0 - halfW, y: y0 + dy };
        const br = { x: x0 + halfW, y: y0 + dy };
        this._drawLinePixels(top.x, top.y, bl.x, bl.y, color);
        this._drawLinePixels(bl.x, bl.y, br.x, br.y, color);
        this._drawLinePixels(br.x, br.y, top.x, top.y, color);
        break;
      }
      case 'star': {
        const r = Math.round(Math.hypot(x1 - x0, y1 - y0));
        this._drawStarPixels(x0, y0, r, color);
        break;
      }
      case 'diamond': {
        const halfW = Math.abs(x1 - x0);
        const halfH = Math.abs(y1 - y0);
        this._drawLinePixels(x0, y0 - halfH, x0 + halfW, y0, color);
        this._drawLinePixels(x0 + halfW, y0, x0, y0 + halfH, color);
        this._drawLinePixels(x0, y0 + halfH, x0 - halfW, y0, color);
        this._drawLinePixels(x0 - halfW, y0, x0, y0 - halfH, color);
        break;
      }
      case 'heart': {
        const size = Math.round(Math.hypot(x1 - x0, y1 - y0));
        this._drawHeartPixels(x0, y0, size, color);
        break;
      }
    }
  }

  /** 中点画椭圆算法（描边） */
  _drawEllipsePixels(cx, cy, rx, ry, color) {
    if (rx === 0 && ry === 0) { this._setPixel(cx, cy, color); return; }
    if (rx === 0) { this._drawLinePixels(cx, cy - ry, cx, cy + ry, color); return; }
    if (ry === 0) { this._drawLinePixels(cx - rx, cy, cx + rx, cy, color); return; }
    rx = Math.max(1, rx);
    ry = Math.max(1, ry);
    let x = 0, y = ry;
    const rx2 = rx * rx, ry2 = ry * ry;
    let dx = 2 * ry2 * x, dy = 2 * rx2 * y;
    // 区域1
    let p1 = ry2 - rx2 * ry + 0.25 * rx2;
    while (dx < dy) {
      this._setPixel(cx + x, cy + y, color);
      this._setPixel(cx - x, cy + y, color);
      this._setPixel(cx + x, cy - y, color);
      this._setPixel(cx - x, cy - y, color);
      if (p1 < 0) { x++; dx += 2 * ry2; p1 += dx + ry2; }
      else { x++; y--; dx += 2 * ry2; dy -= 2 * rx2; p1 += dx - dy + ry2; }
    }
    // 区域2
    let p2 = ry2 * (x + 0.5) * (x + 0.5) + rx2 * (y - 1) * (y - 1) - rx2 * ry2;
    while (y >= 0) {
      this._setPixel(cx + x, cy + y, color);
      this._setPixel(cx - x, cy + y, color);
      this._setPixel(cx + x, cy - y, color);
      this._setPixel(cx - x, cy - y, color);
      if (p2 > 0) { y--; dy -= 2 * rx2; p2 += rx2 - dy; }
      else { y--; x++; dx += 2 * ry2; dy -= 2 * rx2; p2 += dx - dy + rx2; }
    }
  }

  /** 矩形描边 */
  _drawRectPixels(minX, minY, maxX, maxY, color) {
    this._drawLinePixels(minX, minY, maxX, minY, color);
    this._drawLinePixels(maxX, minY, maxX, maxY, color);
    this._drawLinePixels(maxX, maxY, minX, maxY, color);
    this._drawLinePixels(minX, maxY, minX, minY, color);
  }

  /** 五角星描边 */
  _drawStarPixels(cx, cy, r, color) {
    if (r < 1) { this._setPixel(cx, cy, color); return; }
    const innerR = r * 0.4;
    const points = [];
    for (let i = 0; i < 10; i++) {
      const angle = -Math.PI / 2 + i * Math.PI / 5;
      const radius = (i % 2 === 0) ? r : innerR;
      points.push({
        x: Math.round(cx + Math.cos(angle) * radius),
        y: Math.round(cy + Math.sin(angle) * radius)
      });
    }
    for (let i = 0; i < 10; i++) {
      const next = (i + 1) % 10;
      this._drawLinePixels(points[i].x, points[i].y, points[next].x, points[next].y, color);
    }
  }

  /** 心形描边 */
  _drawHeartPixels(cx, cy, size, color) {
    if (size < 1) { this._setPixel(cx, cy, color); return; }
    const s = size / 16;
    const points = [];
    const steps = Math.max(40, size * 4);
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * 2 * Math.PI;
      const px = 16 * Math.pow(Math.sin(t), 3);
      const py = -(13 * Math.cos(t) - 5 * Math.cos(2*t) - 2 * Math.cos(3*t) - Math.cos(4*t));
      points.push({
        x: Math.round(cx + px * s),
        y: Math.round(cy + py * s)
      });
    }
    for (let i = 0; i < points.length - 1; i++) {
      this._drawLinePixels(points[i].x, points[i].y, points[i+1].x, points[i+1].y, color);
    }
  }

  /** 渲染整个画布 */
  render(onionFrame = null) {
    const ctx = this.ctx;
    const ps = this.pixelSize;

    // 棋盘格背景（表示透明）
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = '#e8e8e8';
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if ((x + y) % 2 === 0) {
          ctx.fillRect(x * ps, y * ps, ps, ps);
        }
      }
    }

    // 洋葱皮（上一帧半透明显示）
    if (onionFrame) {
      ctx.globalAlpha = 0.25;
      for (let y = 0; y < this.height; y++) {
        for (let x = 0; x < this.width; x++) {
          const c = onionFrame[y * this.width + x];
          if (c) {
            ctx.fillStyle = c;
            ctx.fillRect(x * ps, y * ps, ps, ps);
          }
        }
      }
      ctx.globalAlpha = 1;
    }

    // 当前帧像素（合成所有可见图层，活动层使用 this.pixels 实时数据）
    var composite;
    if (this.frameData && this.frameData.layers.length > 1) {
      composite = new Array(this.width * this.height).fill(null);
      var layers = this.frameData.layers;
      for (var li = 0; li < layers.length; li++) {
        var lyr = layers[li];
        if (!lyr.visible) continue;
        var lAlpha = lyr.opacity !== undefined ? lyr.opacity : 1;
        if (lAlpha <= 0) continue;
        // 活动图层使用 this.pixels（含实时绘制），其他用 layer.pixels
        var lPix = (li === this.frameData.activeLayer) ? this.pixels : lyr.pixels;
        for (var lp = 0; lp < composite.length; lp++) {
          if (lPix[lp] !== null) {
            composite[lp] = LayerUtils.blendPixel(lPix[lp], composite[lp], lAlpha);
          }
        }
      }
    } else {
      composite = this.pixels;
    }

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const c = composite[y * this.width + x];
        if (c) {
          ctx.fillStyle = c;
          ctx.fillRect(x * ps, y * ps, ps, ps);
        }
      }
    }

    // 网格线
    if (this.showGrid && ps >= 8) {
      ctx.strokeStyle = 'rgba(0,0,0,0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= this.width; x++) {
        ctx.moveTo(x * ps + 0.5, 0);
        ctx.lineTo(x * ps + 0.5, this.canvas.height);
      }
      for (let y = 0; y <= this.height; y++) {
        ctx.moveTo(0, y * ps + 0.5);
        ctx.lineTo(this.canvas.width, y * ps + 0.5);
      }
      ctx.stroke();
    }

    // 裁剪选区覆盖层
    if (this.tool === 'crop' && this.cropStart && this.cropEnd) {
      const rect = this.getCropRect();
      if (rect && rect.w >= 1 && rect.h >= 1) {
        const rx1 = rect.x1 * ps;
        const ry1 = rect.y1 * ps;
        const rx2 = (rect.x2 + 1) * ps;
        const ry2 = (rect.y2 + 1) * ps;

        // 暗化非选区（四块矩形覆盖）
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(0, 0, this.canvas.width, ry1);                         // 上
        ctx.fillRect(0, ry2, this.canvas.width, this.canvas.height - ry2);  // 下
        ctx.fillRect(0, ry1, rx1, rect.h * ps);                              // 左
        ctx.fillRect(rx2, ry1, this.canvas.width - rx2, rect.h * ps);       // 右

        // 选区蓝色边框（动画虚线效果）
        ctx.strokeStyle = '#4a7fff';
        ctx.lineWidth = 2;
        ctx.setLineDash(this.isDrawing ? [] : [6, 4]);
        ctx.strokeRect(rx1 + 1, ry1 + 1, rect.w * ps - 2, rect.h * ps - 2);
        ctx.setLineDash([]);

        // 选区四角标记
        const cornerLen = Math.min(8, ps);
        ctx.strokeStyle = '#4a7fff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        // 左上
        ctx.moveTo(rx1, ry1 + cornerLen); ctx.lineTo(rx1, ry1); ctx.lineTo(rx1 + cornerLen, ry1);
        // 右上
        ctx.moveTo(rx2 - cornerLen, ry1); ctx.lineTo(rx2, ry1); ctx.lineTo(rx2, ry1 + cornerLen);
        // 左下
        ctx.moveTo(rx1, ry2 - cornerLen); ctx.lineTo(rx1, ry2); ctx.lineTo(rx1 + cornerLen, ry2);
        // 右下
        ctx.moveTo(rx2 - cornerLen, ry2); ctx.lineTo(rx2, ry2); ctx.lineTo(rx2, ry2 - cornerLen);
        ctx.stroke();
      }
    }
  }

  // ---- 撤销 / 重做 ----
  pushHistory() {
    this.history.push(this.pixels.slice());
    if (this.history.length > this.maxHistory) this.history.shift();
    this.future = [];
  }

  undo() {
    if (this.history.length === 0) return false;
    this.future.push(this.pixels.slice());
    this.pixels = this.history.pop();
    this.render();
    return true;
  }

  redo() {
    if (this.future.length === 0) return false;
    this.history.push(this.pixels.slice());
    this.pixels = this.future.pop();
    this.render();
    return true;
  }

  clear() {
    this.pushHistory();
    this.pixels = this.createEmpty();
    // 同步到 frameData 的活动图层
    if (this.frameData) {
      var active = LayerUtils.getActiveLayer(this.frameData);
      if (active) active.pixels = this.pixels;
    }
    this.render();
  }

  // ---- 图层管理 ----

  /** 获取图层数量 */
  getLayerCount() {
    return this.frameData ? this.frameData.layers.length : 1;
  }

  /** 获取活动图层索引 */
  getActiveLayerIndex() {
    return this.frameData ? this.frameData.activeLayer : 0;
  }

  /** 获取所有图层信息（供 UI 渲染） */
  getLayers() {
    if (!this.frameData) return [];
    return this.frameData.layers.map(function (l, i) {
      return { id: l.id, name: l.name, visible: l.visible, opacity: l.opacity, index: i };
    });
  }

  /** 设置活动图层 */
  setActiveLayer(index) {
    if (!this.frameData || index < 0 || index >= this.frameData.layers.length) return;
    // 先同步当前像素到当前活动图层
    this.syncToFrameData();
    this.frameData.activeLayer = index;
    var active = LayerUtils.getActiveLayer(this.frameData);
    this.pixels = active ? active.pixels : this.createEmpty();
    this.history = [];
    this.future = [];
    this.render();
  }

  /** 添加新图层 */
  addLayer(name) {
    if (!this.frameData) return;
    this.syncToFrameData();
    var layer = LayerUtils.addLayer(this.frameData, this.width, this.height, name);
    if (layer) {
      this.pixels = layer.pixels;
      this.history = [];
      this.future = [];
      this.render();
      if (this.onLayersChange) this.onLayersChange();
    }
  }

  /** 删除活动图层 */
  deleteLayer() {
    if (!this.frameData) return;
    this.syncToFrameData();
    if (LayerUtils.deleteLayer(this.frameData)) {
      var active = LayerUtils.getActiveLayer(this.frameData);
      this.pixels = active ? active.pixels : this.createEmpty();
      this.history = [];
      this.future = [];
      this.render();
      if (this.onLayersChange) this.onLayersChange();
    }
  }

  /** 复制活动图层 */
  duplicateLayer() {
    if (!this.frameData) return;
    this.syncToFrameData();
    var layer = LayerUtils.duplicateLayer(this.frameData);
    if (layer) {
      this.pixels = layer.pixels;
      this.history = [];
      this.future = [];
      this.render();
      if (this.onLayersChange) this.onLayersChange();
    }
  }

  /** 上移活动图层 */
  moveLayerUp() {
    if (!this.frameData) return;
    this.syncToFrameData();
    if (LayerUtils.moveLayerUp(this.frameData)) {
      this.render();
      if (this.onLayersChange) this.onLayersChange();
    }
  }

  /** 下移活动图层 */
  moveLayerDown() {
    if (!this.frameData) return;
    this.syncToFrameData();
    if (LayerUtils.moveLayerDown(this.frameData)) {
      this.render();
      if (this.onLayersChange) this.onLayersChange();
    }
  }

  /** 拖拽排序 */
  moveLayerTo(fromIdx, toIdx) {
    if (!this.frameData) return;
    this.syncToFrameData();
    if (LayerUtils.moveLayerTo(this.frameData, fromIdx, toIdx)) {
      this.render();
      if (this.onLayersChange) this.onLayersChange();
    }
  }

  /** 设置图层可见性 */
  setLayerVisible(index, visible) {
    if (!this.frameData || index < 0 || index >= this.frameData.layers.length) return;
    this.frameData.layers[index].visible = visible;
    this.render();
    if (this.onLayersChange) this.onLayersChange();
  }

  /** 设置图层不透明度 */
  setLayerOpacity(index, opacity) {
    if (!this.frameData || index < 0 || index >= this.frameData.layers.length) return;
    this.frameData.layers[index].opacity = Math.max(0, Math.min(1, opacity));
    this.render();
  }

  /** 重命名图层 */
  renameLayer(index, name) {
    if (!this.frameData || index < 0 || index >= this.frameData.layers.length) return;
    this.frameData.layers[index].name = name;
    if (this.onLayersChange) this.onLayersChange();
  }

  /** 合并活动图层与下方图层 */
  mergeLayerDown() {
    if (!this.frameData) return;
    this.syncToFrameData();
    if (LayerUtils.mergeLayerDown(this.frameData, this.width, this.height)) {
      var active = LayerUtils.getActiveLayer(this.frameData);
      this.pixels = active ? active.pixels : this.createEmpty();
      this.history = [];
      this.future = [];
      this.render();
      if (this.onLayersChange) this.onLayersChange();
    }
  }
}

window.CanvasEngine = CanvasEngine;
