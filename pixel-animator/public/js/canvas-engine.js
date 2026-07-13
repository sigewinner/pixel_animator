// public/js/canvas-engine.js - 画布绘制引擎
class CanvasEngine {
  constructor(canvas, width, height, pixelSize = 16) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.width = width;
    this.height = height;
    this.pixelSize = pixelSize;

    canvas.width = width * pixelSize;
    canvas.height = height * pixelSize;

    this.pixels = this.createEmpty();

    this.tool = 'pencil';
    this.color = '#000000';
    this.isDrawing = false;
    this.showGrid = true;
    this.eraserSize = 3;
    this.penSize = 1;

    this.history = [];
    this.future = [];
    this.maxHistory = 50;

    this.previewStart = null;
    this.previewSnapshot = null;

    this.cropStart = null;
    this.cropEnd = null;
    this.hasCropSelection = false;
    this.onCropSelect = null;

    this.lastDrawX = -1;
    this.lastDrawY = -1;

    this.onionFrame = null;
    this.onionPrev = null;   // 洋葱皮：前一帧（红色 tint）
    this.onionNext = null;   // 洋葱皮：后一帧（蓝色 tint）
    this.onionAlpha = 0.3;   // 洋葱皮整体透明度

    // 视图变换：旋转（仅视觉，不修改像素数据）
    this.rotation = 0;
    this.onRotationChange = null;
    // 视图变换：平移（空格拖拽 / 平移工具）
    this.panX = 0;
    this.panY = 0;
    this._panLast = null;
    this._spaceHeld = false;

    // ★★★ 图形工具相关 ★★★
    this.shapeType = 'circle';
    this.shapeStart = null;
    this.shapeSnapshot = null;
    this._lastMousePos = { x: 0, y: 0 };

    // 绘制回调
    this.onDrawEnd = null;
    this.onDrawStart = null;
    this.onColorPick = null;

    // 图层绘制支持：绘制直接作用于"活动图层"像素缓冲，
    // 再通过 compositeFn 合成到 this.pixels（显示缓冲）。
    this.activeLayer = null;        // 当前图层的像素缓冲（绘制目标）
    this.compositeFn = null;        // (activeBuffer) => 合成像素
    this._previewMode = false;      // 预览阶段：直接绘制到合成图（预览用）
    this.activeLayerLocked = false; // 当前图层是否被锁定
    this.previewEnd = null;         // 预览工具（线/圆）的终点坐标

    this._bindEvents();
    this._updateCursor();
  }

  normalizeColor(color) {
    if (!color || typeof color !== 'string') return null;
    let hex = color.trim().toLowerCase();
    if (hex.startsWith('#')) hex = hex.slice(1);
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    if (hex.length === 6) return '#' + hex;
    return null;
  }

  createEmpty() {
    return new Array(this.width * this.height).fill(null);
  }

  loadFrame(pixels) {
    this.pixels = pixels ? pixels.slice() : this.createEmpty();
    this.history = [];
    this.future = [];
    this.lastDrawX = -1;
    this.lastDrawY = -1;
    this.render();
  }

  getPixels() {
    return this.pixels.slice();
  }

  // ---- 图层绘制支持 ----
  setActiveLayer(buffer) {
    this.activeLayer = buffer;
  }

  setCompositeFn(fn) {
    this.compositeFn = fn;
  }

  // 当前绘制目标：预览阶段画到合成图，否则画到活动图层缓冲
  _paintTarget() {
    if (this._previewMode) return this.pixels;
    return this.activeLayer || this.pixels;
  }

  // 用活动图层重新合成显示缓冲
  _recomposite() {
    if (this.compositeFn) {
      this.pixels = this.compositeFn();
    }
  }

  setTool(tool) {
    this.tool = tool;
    this.lastDrawX = -1;
    this.lastDrawY = -1;
    this._updateCursor();
  }

  setColor(color) {
    const norm = this.normalizeColor(color);
    if (norm) this.color = norm;
  }

  setEraserSize(size) {
    this.eraserSize = Math.max(1, Math.min(20, size));
    this._updateCursor();
  }

  setPenSize(size) {
    this.penSize = Math.max(1, Math.min(10, size));
  }

  setPixelSize(size) {
    this.pixelSize = size;
    this.canvas.width = this.width * size;
    this.canvas.height = this.height * size;
    this._updateCursor();
    this.render();
  }

  // 洋葱皮增强：前一帧(prev, 红色 tint) 与 后一帧(next, 蓝色 tint)，任一为 null 表示不显示
  setOnion(prev, next) {
    this.onionPrev = prev || null;
    this.onionNext = next || null;
    this.render();
  }

  setOnionFrame(frame) {   // 兼容旧调用（仅前一帧）
    this.onionPrev = frame || null;
    this.onionNext = null;
    this.render();
  }

  // 设置洋葱皮整体透明度（0.05 ~ 1）
  setOnionAlpha(a) {
    this.onionAlpha = Math.max(0.05, Math.min(1, a));
    if (this.onionPrev || this.onionNext) this.render();
  }

  // 画布旋转（视图变换，不修改像素数据）。deg 为绝对角度
  setRotation(deg) {
    this.rotation = ((Math.round(deg) % 360) + 360) % 360;
    this._applyTransform();
    this._updateCursor();
    if (this.onRotationChange) this.onRotationChange(this.rotation);
  }

  // 合并 平移 + 旋转 到 CSS transform
  _applyTransform() {
    const t = `translate(${this.panX}px, ${this.panY}px) rotate(${this.rotation}deg)`;
    this.canvas.style.transformOrigin = 'center center';
    this.canvas.style.transform = t;
  }

  setPan(x, y) {
    this.panX = x;
    this.panY = y;
    this._applyTransform();
  }

  panBy(dx, dy) {
    this.panX += dx;
    this.panY += dy;
    this._applyTransform();
  }

  resetView() {
    this.rotation = 0;
    this.panX = 0;
    this.panY = 0;
    this._applyTransform();
    if (this.onRotationChange) this.onRotationChange(0);
  }

  setSpacePan(on) {
    this._spaceHeld = !!on;
    if (this.canvas) this.canvas.style.cursor = on ? 'grab' : '';
  }

  // ★★★ 设置图形类型 ★★★
  setShapeType(type) {
    const validTypes = ['circle', 'ellipse', 'rect', 'triangle', 'star', 'diamond', 'heart'];
    if (validTypes.includes(type)) {
      this.shapeType = type;
    }
  }

  _updateCursor() {
    const canvas = this.canvas;
    if (this.tool === 'eraser') {
      const size = this.eraserSize * this.pixelSize;
      const radius = Math.max(4, size / 2);
      const cursorCanvas = document.createElement('canvas');
      cursorCanvas.width = radius * 2 + 4;
      cursorCanvas.height = radius * 2 + 4;
      const ctx = cursorCanvas.getContext('2d');
      const cx = cursorCanvas.width / 2;
      const cy = cursorCanvas.height / 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx + 1, cy + 1, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx - 3, cy);
      ctx.lineTo(cx + 3, cy);
      ctx.moveTo(cx, cy - 3);
      ctx.lineTo(cx, cy + 3);
      ctx.stroke();
      const cursorUrl = cursorCanvas.toDataURL();
      canvas.style.cursor = `url(${cursorUrl}) ${Math.round(cx)} ${Math.round(cy)}, crosshair`;
    } else if (this.tool === 'eyedropper') {
      canvas.style.cursor = 'crosshair';
    } else {
      canvas.style.cursor = 'crosshair';
    }
  }

  resize(newW, newH, newPixelSize) {
    const oldW = this.width, oldH = this.height;
    const oldPixels = this.pixels;
    const newPixels = new Array(newW * newH).fill(null);
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
    this.lastDrawX = -1;
    this.lastDrawY = -1;
    this.onionFrame = null;
    this._updateCursor();
    this.render();
  }

  getCropRect() {
    if (!this.cropStart || !this.cropEnd) return null;
    const x1 = Math.min(this.cropStart.x, this.cropEnd.x);
    const y1 = Math.min(this.cropStart.y, this.cropEnd.y);
    const x2 = Math.max(this.cropStart.x, this.cropEnd.x);
    const y2 = Math.max(this.cropStart.y, this.cropEnd.y);
    return { x1, y1, x2, y2, w: x2 - x1 + 1, h: y2 - y1 + 1 };
  }

  clearCrop() {
    this.cropStart = null;
    this.cropEnd = null;
    this.hasCropSelection = false;
    this.render();
  }

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
    this.lastDrawX = -1;
    this.lastDrawY = -1;
    this.onionFrame = null;
    this._updateCursor();
    this.render();
  }

  _idx(x, y) {
    return y * this.width + x;
  }

  _getPixelCoord(e) {
    // 画布中心的屏幕坐标（CSS transform 绕中心旋转，中心位置不变；平移已含在 rect 中）
    const rect = this.canvas.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    // 鼠标相对中心的偏移
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    // 用 offsetWidth/offsetHeight（不受 transform 影响）还原 CSS 缩放
    const scale = (this.canvas.offsetWidth || this.canvas.width) / this.width;
    // 逆旋转：视图旋转 r 度，鼠标坐标需逆向还原 R(-r)
    const r = this.rotation * Math.PI / 180;
    const cos = Math.round(Math.cos(r) * 1e6) / 1e6;
    const sin = Math.round(Math.sin(r) * 1e6) / 1e6;
    const vx = dx * cos + dy * sin;
    const vy = -dx * sin + dy * cos;
    const ux = vx / scale;
    const uy = vy / scale;
    const px = Math.floor(ux + this.width / 2);
    const py = Math.floor(uy + this.height / 2);
    return { x: Math.max(0, Math.min(this.width - 1, px)), y: Math.max(0, Math.min(this.height - 1, py)) };
  }

  _bindEvents() {
    const self = this;

    const onDown = (e) => {
      e.preventDefault();

      // 画布平移：按住空格 或 平移工具
      if (this._spaceHeld || this.tool === 'pan') {
        this._isPanning = true;
        this._panLast = { x: e.clientX, y: e.clientY };
        this.canvas.style.cursor = 'grabbing';
        return;
      }

      const { x, y } = this._getPixelCoord(e);

      // 锁定图层保护：绘制类工具在锁定图层上无效（吸管/裁剪仍可操作）
      if (this.activeLayerLocked && (this.tool === 'pencil' || this.tool === 'eraser' || this.tool === 'fill' || this.tool === 'line' || this.tool === 'circle' || this.tool === 'shape')) {
        return;
      }

      // 裁剪工具
      if (this.tool === 'crop') {
        this.isDrawing = true;
        this.cropStart = { x, y };
        this.cropEnd = { x, y };
        this.hasCropSelection = false;
        if (this.onCropSelect) this.onCropSelect(null);
        this.render();
        return;
      }

      // 吸管工具
      if (this.tool === 'eyedropper') {
        const color = this._getPixelColor(x, y);
        if (color) {
          this.setColor(color);
          if (this.onColorPick) this.onColorPick(color);
        }
        return;
      }

      // ★★★ 图形工具 - 记录起点 ★★★
      if (this.tool === 'shape') {
        this.isDrawing = true;
        this._previewMode = true;
        this.shapeStart = { x, y };
        this.shapeSnapshot = this.pixels.slice();
        if (this.onDrawStart) this.onDrawStart();
        return;
      }

      // 线条/圆形工具（预览模式）
      if (this.tool === 'line' || this.tool === 'circle') {
        this.isDrawing = true;
        this._previewMode = true;
        this.previewStart = { x, y };
        this.previewEnd = { x, y };
        this.previewSnapshot = this.pixels.slice();
        return;
      }

      // 普通绘制工具
      this.isDrawing = true;
      this.pushHistory();
      this.lastDrawX = -1;
      this.lastDrawY = -1;
      if (this.onDrawStart) this.onDrawStart();
      this._applyTool(x, y);
      this._recomposite();
      this.render();
      this.lastDrawX = x;
      this.lastDrawY = y;
    };

    const onMove = (e) => {
      // 画布平移中：实时跟随鼠标
      if (this._isPanning && this._panLast) {
        this.panBy(e.clientX - this._panLast.x, e.clientY - this._panLast.y);
        this._panLast = { x: e.clientX, y: e.clientY };
        return;
      }
      if (!this.isDrawing) return;
      const { x, y } = this._getPixelCoord(e);
      
      // ★★★ 缓存鼠标位置 ★★★
      this._lastMousePos = { x, y };

      // 裁剪工具
      if (this.tool === 'crop') {
        this.cropEnd = { x, y };
        this.render();
        return;
      }

      // 吸管工具
      if (this.tool === 'eyedropper') return;

      // ★★★ 图形工具 - 实时预览 ★★★
      if (this.tool === 'shape' && this.shapeStart) {
        this.pixels = this.shapeSnapshot.slice();
        this._drawShapeOutline(this.shapeStart.x, this.shapeStart.y, x, y, this.color);
        this.render();
        return;
      }

      // 线条工具
      if (this.tool === 'line') {
        this.previewEnd = { x, y };
        this.pixels = this.previewSnapshot.slice();
        this._drawLinePixels(this.previewStart.x, this.previewStart.y, x, y, this.color);
        this.render();
        return;
      }

      // 圆形工具
      if (this.tool === 'circle') {
        this.previewEnd = { x, y };
        this.pixels = this.previewSnapshot.slice();
        const r = Math.round(Math.hypot(x - this.previewStart.x, y - this.previewStart.y));
        this._drawCirclePixels(this.previewStart.x, this.previewStart.y, r, this.color);
        this.render();
        return;
      }

      // 普通绘制
      if (this.lastDrawX >= 0 && this.lastDrawY >= 0) {
        this._drawLinePixels(this.lastDrawX, this.lastDrawY, x, y, this.tool === 'eraser' ? null : this.color);
      } else {
        this._applyTool(x, y);
      }
      this.lastDrawX = x;
      this.lastDrawY = y;
      this._recomposite();
      this.render();
    };

    const onUp = () => {
      // 结束画布平移
      if (this._isPanning) {
        this._isPanning = false;
        this._panLast = null;
        this.canvas.style.cursor = this._spaceHeld ? 'grab' : '';
        if (this.onViewChange) this.onViewChange();
        return;
      }

      // 裁剪工具
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

      // ★★★ 图形工具 - 完成绘制（落笔到活动图层） ★★★
      if (this.tool === 'shape' && this.isDrawing && this.shapeStart) {
        const { x, y } = this._lastMousePos;
        const dx = Math.abs(x - this.shapeStart.x);
        const dy = Math.abs(y - this.shapeStart.y);

        this.isDrawing = false;
        this._previewMode = false;
        this._recomposite(); // 清除预览笔迹

        if (dx > 0 || dy > 0) {
          this._drawShapeOutline(this.shapeStart.x, this.shapeStart.y, x, y, this.color);
        } else {
          // 点击没有拖动，画一个点
          this._drawDot(this.shapeStart.x, this.shapeStart.y, this.color);
        }
        this._recomposite();
        this.shapeStart = null;
        this.shapeSnapshot = null;
        if (this.onDrawEnd) {
          this.onDrawEnd(this.pixels.slice());
        }
        this.render();
        return;
      }

      // 线条/圆形工具 - 完成绘制（落笔到活动图层）
      if ((this.tool === 'line' || this.tool === 'circle') && this.isDrawing) {
        this.isDrawing = false;
        this._previewMode = false;
        this._recomposite(); // 清除预览笔迹
        const start = this.previewStart;
        const end = this.previewEnd || this._lastMousePos;
        if (start) {
          if (this.tool === 'line') {
            this._drawLinePixels(start.x, start.y, end.x, end.y, this.color);
          } else {
            const r = Math.round(Math.hypot(end.x - start.x, end.y - start.y));
            this._drawCirclePixels(start.x, start.y, r, this.color);
          }
          this._recomposite();
        }
        this.previewStart = null;
        this.previewSnapshot = null;
        this.previewEnd = null;
        this.lastDrawX = -1;
        this.lastDrawY = -1;
        if (this.onDrawEnd) {
          this.onDrawEnd(this.pixels.slice());
        }
        this.render();
        return;
      }

      // 判断是否在绘制中（非预览工具，非裁剪工具）
      const wasDrawing = this.isDrawing && 
                          this.tool !== 'line' && 
                          this.tool !== 'circle' && 
                          this.tool !== 'crop' &&
                          this.tool !== 'eyedropper' &&
                          this.tool !== 'shape';

      this.isDrawing = false;
      this.previewStart = null;
      this.previewSnapshot = null;
      this.shapeStart = null;
      this.shapeSnapshot = null;
      this.lastDrawX = -1;
      this.lastDrawY = -1;

      if (wasDrawing && this.onDrawEnd) {
        this.onDrawEnd(this.pixels.slice());
      }
    };

    this.canvas.addEventListener('mousedown', onDown);
    this.canvas.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);

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

  _getPixelColor(x, y) {
    const i = this._idx(x, y);
    const color = this.pixels[i] || null;
    if (color) return this.normalizeColor(color) || color;
    return null;
  }

  _applyTool(x, y) {
    if (this.tool === 'pencil') {
      this._drawDot(x, y, this.color);
    } else if (this.tool === 'eraser') {
      this._eraseArea(x, y);
    } else if (this.tool === 'fill') {
      this._floodFill(x, y, this.color);
    } else if (this.tool === 'shape') {
      // 图形工具在鼠标按下时记录起点，在拖动时预览，在松开时绘制
      // 实际绘制在 onMove 和 onUp 中处理
    }
  }

  _drawDot(x, y, color) {
    const size = this.penSize;
    const radius = Math.floor(size / 2);
    const buf = this._paintTarget();
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy <= radius * radius + 0.5) {
          const px = x + dx;
          const py = y + dy;
          if (px >= 0 && px < this.width && py >= 0 && py < this.height) {
            const i = this._idx(px, py);
            buf[i] = color;
          }
        }
      }
    }
  }

  _setPixel(x, y, color) {
    const i = this._idx(x, y);
    const buf = this._paintTarget();
    if (buf[i] !== color) {
      buf[i] = color;
    }
  }

  _eraseArea(cx, cy) {
    const size = this.eraserSize;
    const radius = Math.floor(size / 2);
    const buf = this._paintTarget();
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy <= radius * radius + 0.5) {
          const x = cx + dx;
          const y = cy + dy;
          if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
            const i = this._idx(x, y);
            buf[i] = null;
          }
        }
      }
    }
  }

  _floodFill(sx, sy, newColor) {
    const buf = this._paintTarget();
    const target = buf[this._idx(sx, sy)];
    if (target === newColor) return;
    const stack = [[sx, sy]];
    const visited = new Set();
    while (stack.length) {
      const [x, y] = stack.pop();
      if (x < 0 || x >= this.width || y < 0 || y >= this.height) continue;
      const key = x + ',' + y;
      if (visited.has(key)) continue;
      visited.add(key);
      const i = this._idx(x, y);
      if (buf[i] !== target) continue;
      buf[i] = newColor;
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
  }

  _drawLinePixels(x0, y0, x1, y1, color) {
    let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    let sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    if (dx <= 1 && dy <= 1) {
      if (color === null) {
        this._eraseArea(x1, y1);
      } else {
        this._drawDot(x1, y1, color);
      }
      return;
    }
    while (true) {
      if (color === null) {
        this._eraseArea(x0, y0);
      } else {
        this._drawDot(x0, y0, color);
      }
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
    }
  }

  _drawCirclePixels(cx, cy, r, color) {
    if (r < 0) r = 0;
    if (r === 0) {
      if (color === null) this._eraseArea(cx, cy);
      else this._drawDot(cx, cy, color);
      return;
    }
    let x = r, y = 0, err = 0;
    while (x >= y) {
      const points = [
        [cx + x, cy + y], [cx + y, cy + x],
        [cx - y, cy + x], [cx - x, cy + y],
        [cx - x, cy - y], [cx - y, cy - x],
        [cx + y, cy - x], [cx + x, cy - y]
      ];
      for (const [px, py] of points) {
        if (px >= 0 && px < this.width && py >= 0 && py < this.height) {
          if (color === null) this._eraseArea(px, py);
          else this._drawDot(px, py, color);
        }
      }
      y++;
      if (err <= 0) { err += 2 * y + 1; }
      if (err > 0) { x--; err -= 2 * x + 1; }
    }
  }

  // ★★★ 绘制各种图形的描边（轮廓） ★★★
  _drawShapeOutline(x1, y1, x2, y2, color) {
    const left = Math.min(x1, x2);
    const right = Math.max(x1, x2);
    const top = Math.min(y1, y2);
    const bottom = Math.max(y1, y2);
    const w = right - left + 1;
    const h = bottom - top + 1;
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;
    const radius = Math.round(Math.hypot(x2 - x1, y2 - y1));
    
    switch (this.shapeType) {
      case 'rect':
        this._drawRectOutline(left, top, w, h, color);
        break;
      case 'ellipse':
        this._drawEllipseOutline(cx, cy, w/2, h/2, color);
        break;
      case 'triangle':
        this._drawTriangleOutline(x1, y1, x2, y2, color);
        break;
      case 'star':
        this._drawStarOutline(cx, cy, Math.min(w, h) / 2, color);
        break;
      case 'diamond':
        this._drawDiamondOutline(cx, cy, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, color);
        break;
      case 'heart':
        this._drawHeartOutline(cx, cy, Math.min(Math.abs(x2 - x1), Math.abs(y2 - y1)) / 2, color);
        break;
      case 'circle':
      default:
        this._drawCirclePixels(x1, y1, radius, color);
        break;
    }
  }

  // ★★★ 矩形描边 ★★★
  _drawRectOutline(x, y, w, h, color) {
    // 上边
    for (let dx = 0; dx < w; dx++) {
      this._drawDot(x + dx, y, color);
    }
    // 下边
    for (let dx = 0; dx < w; dx++) {
      this._drawDot(x + dx, y + h - 1, color);
    }
    // 左边
    for (let dy = 0; dy < h; dy++) {
      this._drawDot(x, y + dy, color);
    }
    // 右边
    for (let dy = 0; dy < h; dy++) {
      this._drawDot(x + w - 1, y + dy, color);
    }
  }

  // ★★★ 椭圆描边（使用Bresenham算法） ★★★
  _drawEllipseOutline(cx, cy, rx, ry, color) {
    rx = Math.abs(rx);
    ry = Math.abs(ry);
    if (rx < 1 || ry < 1) {
      this._drawDot(Math.round(cx), Math.round(cy), color);
      return;
    }

    let x = 0, y = Math.round(ry);
    let rx2 = rx * rx;
    let ry2 = ry * ry;
    let p1 = ry2 - rx2 * ry + 0.25 * rx2;
    
    // 上半部分
    while (2 * ry2 * x < 2 * rx2 * y) {
      this._drawEllipsePoints(cx, cy, x, y, color);
      x++;
      if (p1 < 0) {
        p1 += 2 * ry2 * x + ry2;
      } else {
        y--;
        p1 += 2 * ry2 * x - 2 * rx2 * y + ry2;
      }
    }
    
    let p2 = ry2 * (x + 0.5) * (x + 0.5) + rx2 * (y - 1) * (y - 1) - rx2 * ry2;
    
    // 下半部分
    while (y >= 0) {
      this._drawEllipsePoints(cx, cy, x, y, color);
      y--;
      if (p2 > 0) {
        p2 -= 2 * rx2 * y + rx2;
      } else {
        x++;
        p2 += 2 * ry2 * x - 2 * rx2 * y + rx2;
      }
    }
  }

  _drawEllipsePoints(cx, cy, x, y, color) {
    const points = [
      [cx + x, cy + y], [cx - x, cy + y],
      [cx + x, cy - y], [cx - x, cy - y]
    ];
    for (const [px, py] of points) {
      if (px >= 0 && px < this.width && py >= 0 && py < this.height) {
        this._drawDot(Math.round(px), Math.round(py), color);
      }
    }
  }

  // ★★★ 三角形描边 ★★★
  _drawTriangleOutline(x1, y1, x2, y2, color) {
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    
    if (len < 1) {
      this._drawDot(x1, y1, color);
      return;
    }
    
    // 三角形三个顶点：顶点在 (x1, y1)，底边两端在 (x2, y2) 和 (2*cx - x2, 2*cy - y2)
    const ax = x1, ay = y1;
    const bx = x2, by = y2;
    const cx3 = 2 * cx - x2, cy3 = 2 * cy - y2;
    
    // 绘制三条边
    this._drawLinePixels(ax, ay, bx, by, color);
    this._drawLinePixels(bx, by, cx3, cy3, color);
    this._drawLinePixels(cx3, cy3, ax, ay, color);
  }

  // ★★★ 五角星描边 ★★★
  _drawStarOutline(cx, cy, radius, color) {
    if (radius < 1) {
      this._drawDot(Math.round(cx), Math.round(cy), color);
      return;
    }
    
    const points = [];
    const outerR = radius;
    const innerR = radius * 0.4;
    
    for (let i = 0; i < 10; i++) {
      const angle = (i * Math.PI / 5) - Math.PI / 2;
      const r = i % 2 === 0 ? outerR : innerR;
      points.push({
        x: cx + Math.cos(angle) * r,
        y: cy + Math.sin(angle) * r
      });
    }
    
    // 绘制星形轮廓
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      this._drawLinePixels(
        Math.round(points[i].x), Math.round(points[i].y),
        Math.round(points[j].x), Math.round(points[j].y),
        color
      );
    }
  }

  // ★★★ 菱形描边 ★★★
  _drawDiamondOutline(cx, cy, rx, ry, color) {
    rx = Math.abs(rx);
    ry = Math.abs(ry);
    if (rx < 1 || ry < 1) {
      this._drawDot(Math.round(cx), Math.round(cy), color);
      return;
    }
    
    const p1 = { x: cx, y: cy - ry };
    const p2 = { x: cx + rx, y: cy };
    const p3 = { x: cx, y: cy + ry };
    const p4 = { x: cx - rx, y: cy };
    
    this._drawLinePixels(Math.round(p1.x), Math.round(p1.y), Math.round(p2.x), Math.round(p2.y), color);
    this._drawLinePixels(Math.round(p2.x), Math.round(p2.y), Math.round(p3.x), Math.round(p3.y), color);
    this._drawLinePixels(Math.round(p3.x), Math.round(p3.y), Math.round(p4.x), Math.round(p4.y), color);
    this._drawLinePixels(Math.round(p4.x), Math.round(p4.y), Math.round(p1.x), Math.round(p1.y), color);
  }

  // ★★★ 心形描边 ★★★
  _drawHeartOutline(cx, cy, size, color) {
    if (size < 1) {
      this._drawDot(Math.round(cx), Math.round(cy), color);
      return;
    }
    
    const step = 0.1;
    const points = [];
    
    for (let t = 0; t <= 2 * Math.PI; t += step) {
      const x = 16 * Math.pow(Math.sin(t), 3);
      const y = 13 * Math.cos(t) - 5 * Math.cos(2*t) - 2 * Math.cos(3*t) - Math.cos(4*t);
      points.push({
        x: cx + x / 16 * size,
        y: cy - y / 16 * size
      });
    }
    
    for (let i = 0; i < points.length - 1; i++) {
      this._drawLinePixels(
        Math.round(points[i].x), Math.round(points[i].y),
        Math.round(points[i + 1].x), Math.round(points[i + 1].y),
        color
      );
    }
  }

  render(onionFrame = null) {
    const ctx = this.ctx;
    const ps = this.pixelSize;
    // 洋葱皮增强：前一帧（红色 tint）+ 后一帧（蓝色 tint），整体透明度洋葱皮 alpha

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

    // 洋葱皮增强：前一帧红色 tint，后一帧蓝色 tint
    if (this.onionPrev || this.onionNext) {
      ctx.globalAlpha = this.onionAlpha;
      const drawOnion = (frame, tint) => {
        if (!frame) return;
        for (let y = 0; y < this.height; y++) {
          for (let x = 0; x < this.width; x++) {
            const c = frame[y * this.width + x];
            if (c) {
              ctx.fillStyle = tint;
              ctx.fillRect(x * ps, y * ps, ps, ps);
            }
          }
        }
      };
      drawOnion(this.onionPrev, '#ff3b30');
      drawOnion(this.onionNext, '#0a84ff');
      ctx.globalAlpha = 1;
    }

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const c = this.pixels[y * this.width + x];
        if (c) {
          ctx.fillStyle = c;
          ctx.fillRect(x * ps, y * ps, ps, ps);
        }
      }
    }

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

    if (this.tool === 'crop' && this.cropStart && this.cropEnd) {
      const rect = this.getCropRect();
      if (rect && rect.w >= 1 && rect.h >= 1) {
        const rx1 = rect.x1 * ps, ry1 = rect.y1 * ps;
        const rx2 = (rect.x2 + 1) * ps, ry2 = (rect.y2 + 1) * ps;
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(0, 0, this.canvas.width, ry1);
        ctx.fillRect(0, ry2, this.canvas.width, this.canvas.height - ry2);
        ctx.fillRect(0, ry1, rx1, rect.h * ps);
        ctx.fillRect(rx2, ry1, this.canvas.width - rx2, rect.h * ps);
        ctx.strokeStyle = '#4a7fff';
        ctx.lineWidth = 2;
        ctx.setLineDash(this.isDrawing ? [] : [6, 4]);
        ctx.strokeRect(rx1 + 1, ry1 + 1, rect.w * ps - 2, rect.h * ps - 2);
        ctx.setLineDash([]);
        const cornerLen = Math.min(8, ps);
        ctx.strokeStyle = '#4a7fff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(rx1, ry1 + cornerLen); ctx.lineTo(rx1, ry1); ctx.lineTo(rx1 + cornerLen, ry1);
        ctx.moveTo(rx2 - cornerLen, ry1); ctx.lineTo(rx2, ry1); ctx.lineTo(rx2, ry1 + cornerLen);
        ctx.moveTo(rx1, ry2 - cornerLen); ctx.lineTo(rx1, ry2); ctx.lineTo(rx1 + cornerLen, ry2);
        ctx.moveTo(rx2 - cornerLen, ry2); ctx.lineTo(rx2, ry2); ctx.lineTo(rx2, ry2 - cornerLen);
        ctx.stroke();
      }
    }
  }

  pushHistory() {
    this.history.push(this.pixels.slice());
    if (this.history.length > this.maxHistory) this.history.shift();
    this.future = [];
  }

  undo() {
    if (this.history.length === 0) return false;
    this.future.push(this.pixels.slice());
    this.pixels = this.history.pop();
    this.lastDrawX = -1;
    this.lastDrawY = -1;
    this.render();
    return true;
  }

  redo() {
    if (this.future.length === 0) return false;
    this.history.push(this.pixels.slice());
    this.pixels = this.future.pop();
    this.lastDrawX = -1;
    this.lastDrawY = -1;
    this.render();
    return true;
  }

  clear() {
    this.pushHistory();
    this.pixels = this.createEmpty();
    this.lastDrawX = -1;
    this.lastDrawY = -1;
    this.render();
  }

  // 像素级变换（静态纯函数）：对一帧像素数组做翻转/旋转。
  // kind: 'flipH' 水平翻转 | 'flipV' 垂直翻转 | 'rotCW' 顺时针90° | 'rotCCW' 逆时针90°
  // 旋转会交换宽高（新图 newW=h, newH=w）。返回新数组，源数组不变。
  static transformFrame(src, w, h, kind) {
    if (!src) return src;
    const isRot = (kind === 'rotCW' || kind === 'rotCCW');
    const newW = isRot ? h : w;
    const newH = isRot ? w : h;
    const out = new Array(newW * newH).fill(null);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = src[y * w + x];
        if (c == null) continue;
        let nx, ny;
        if (kind === 'flipH')      { nx = w - 1 - x; ny = y; }
        else if (kind === 'flipV') { nx = x; ny = h - 1 - y; }
        else if (kind === 'rotCW')  { nx = h - 1 - y; ny = x; }
        else if (kind === 'rotCCW') { nx = y; ny = w - 1 - x; }
        else { nx = x; ny = y; }
        out[ny * newW + nx] = c;
      }
    }
    return out;
  }
}

window.CanvasEngine = CanvasEngine;