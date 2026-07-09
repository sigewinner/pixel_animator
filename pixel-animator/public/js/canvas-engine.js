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

    // 当前帧的像素数据：一维数组，长度 width*height，值为颜色字符串或 null
    this.pixels = this.createEmpty();

    this.tool = 'pencil';
    this.color = '#000000';
    this.brushSize = 1;       // 笔刷大小（铅笔/橡皮共用）
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

  /** 加载一帧像素数据并渲染 */
  loadFrame(pixels) {
    this.pixels = pixels ? pixels.slice() : this.createEmpty();
    this.history = [];
    this.future = [];
    this.render();
  }

  /** 获取当前像素数据（用于保存帧） */
  getPixels() {
    return this.pixels.slice();
  }

  setTool(tool) {
    this.tool = tool;
  }

  setColor(color) {
    this.color = color;
  }

  setBrushSize(size) {
    this.brushSize = Math.max(1, Math.min(8, size));
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
    this.width = newW;
    this.height = newH;
    this.pixelSize = newPixelSize || this.pixelSize;
    this.canvas.width = newW * this.pixelSize;
    this.canvas.height = newH * this.pixelSize;
    this.pixels = newPixels;
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

      // 吸管工具：取色后立即返回，不修改画布
      if (this.tool === 'eyedropper') {
        const idx = this._idx(x, y);
        const color = this.pixels[idx];
        if (this.onColorPick && color) this.onColorPick(color);
        return;
      }

      this.isDrawing = true;
      this.pushHistory();
      if (this.tool === 'line' || this.tool === 'circle') {
        // 预览工具：记录起点和快照，拖拽时实时预览
        this.previewStart = { x, y };
        this.previewSnapshot = this.pixels.slice();
      } else {
        this._applyTool(x, y);
      }
    };
    const onMove = (e) => {
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
      } else if (this.tool === 'circle') {
        this.pixels = this.previewSnapshot.slice();
        const r = Math.round(Math.hypot(x - this.previewStart.x, y - this.previewStart.y));
        this._drawCirclePixels(this.previewStart.x, this.previewStart.y, r, this.color);
        this.render();
      } else {
        this._applyTool(x, y);
      }
    };
    const onUp = () => {
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

  /** 笔刷盖章：以 (cx,cy) 为中心画 brushSize×brushSize 方块 */
  _stampBrush(cx, cy, color) {
    const bs = this.brushSize;
    const half = Math.floor(bs / 2);
    const start = bs % 2 === 0 ? -half + 1 : -half;
    for (let dy = start; dy <= half; dy++) {
      for (let dx = start; dx <= half; dx++) {
        this._setPixel(cx + dx, cy + dy, color);
      }
    }
  }

  _setPixel(x, y, color) {
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

    // 当前帧像素
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const c = this.pixels[y * this.width + x];
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
    this.render();
  }
}

window.CanvasEngine = CanvasEngine;
