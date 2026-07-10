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
    this.rotation = 0; // 画布旋转角度（视图变换，不破坏像素数据）
    this.panX = 0;      // 画布平移（视图变换，屏幕像素）
    this.panY = 0;
    this.isPanning = false;
    this._panLast = null;
    this._spaceHeld = false;
    this.shapeFill = false; // 矩形/椭圆是否填充
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

    this.onionPrev = null;
    this.onionNext = null;
    this.onionAlpha = 0.3;

    // ★★★ 绘制完成回调 ★★★
    this.onDrawEnd = null;
    // ★★★ 绘制开始回调 ★★★
    this.onDrawStart = null;

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

  // 旋转画布（视图变换，不修改像素数据）。deg 为绝对角度，可累积
  setRotation(deg) {
    this.rotation = ((Math.round(deg) % 360) + 360) % 360;
    this._applyTransform();
    this._updateCursor();
    if (this.onRotationChange) this.onRotationChange(this.rotation);
  }

  // 合并「平移 + 旋转」为单一 transform（中心点不变，平移作用于屏幕坐标系）
  _applyTransform() {
    this.canvas.style.transformOrigin = 'center center';
    this.canvas.style.transform = `translate(${this.panX}px, ${this.panY}px) rotate(${this.rotation}deg)`;
  }

  // 直接设置平移（屏幕像素）
  setPan(x, y) {
    this.panX = x;
    this.panY = y;
    this._applyTransform();
  }

  // 相对平移（拖拽时累加）
  panBy(dx, dy) {
    this.setPan(this.panX + dx, this.panY + dy);
  }

  // 重置视图：平移归零 + 旋转归零
  resetView() {
    this.panX = 0;
    this.panY = 0;
    this.setRotation(0);
  }

  // 空格临时平移开关（按住空格即可拖拽画布）
  setSpacePan(v) {
    this._spaceHeld = !!v;
    this._updateCursor();
  }

  // 像素级变换：对单个扁平像素数组做 翻转/旋转，返回新数组与新尺寸。
  // kind: flipH | flipV | rotCW | rotCCW（旋转会交换宽高）
  static transformFrame(src, w, h, kind) {
    const n = w * h;
    const dst = new Array(n).fill(null);
    if (kind === 'flipH') {
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
          dst[y * w + (w - 1 - x)] = src[y * w + x];
      return { pixels: dst, w, h };
    }
    if (kind === 'flipV') {
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
          dst[(h - 1 - y) * w + x] = src[y * w + x];
      return { pixels: dst, w, h };
    }
    if (kind === 'rotCW') {
      // 新尺寸：宽 = h，高 = w
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
          dst[x * h + (h - 1 - y)] = src[y * w + x];
      return { pixels: dst, w: h, h: w };
    }
    if (kind === 'rotCCW') {
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
          dst[(w - 1 - x) * h + y] = src[y * w + x];
      return { pixels: dst, w: h, h: w };
    }
    return { pixels: src.slice(), w, h };
  }

  // 洋葱皮：prev=前一帧(红) next=后一帧(蓝)，均为扁平像素数组或 null
  setOnion(prev, next) {
    this.onionPrev = prev || null;
    this.onionNext = next || null;
    this.render();
  }
  setOnionAlpha(a) {
    this.onionAlpha = a;
    if (this.onionPrev || this.onionNext) this.render();
  }

  _updateCursor() {
    const canvas = this.canvas;
    if (this.tool === 'pan' || this._spaceHeld) {
      canvas.style.cursor = this.isPanning ? 'grabbing' : 'grab';
      return;
    }
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
    this.onionPrev = null;
    this.onionNext = null;
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
    this.onionPrev = null;
    this.onionNext = null;
    this._updateCursor();
    this.render();
  }

  _idx(x, y) {
    return y * this.width + x;
  }

  _getPixelCoord(e) {
    const rect = this.canvas.getBoundingClientRect();
    // 旋转后 getBoundingClientRect 返回的是旋转包围盒，但中心不变：用包围盒中心即元素中心
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    // offsetWidth/offsetHeight 是未受 transform 影响的真实显示尺寸
    const dispW = this.canvas.offsetWidth || rect.width;
    const dispH = this.canvas.offsetHeight || rect.height;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    // 撤销 CSS 旋转（rotate 顺时针 θ → 反向旋转 −θ 还原到显示坐标）
    const r = this.rotation * Math.PI / 180;
    const cos = Math.cos(r), sin = Math.sin(r);
    const vx = dx * cos + dy * sin;
    const vy = -dx * sin + dy * cos;
    // 显示坐标 → 内部像素坐标（考虑 max-width/max-height 的 CSS 缩放）
    const ux = vx * (this.canvas.width / dispW);
    const uy = vy * (this.canvas.height / dispH);
    const px = Math.floor((ux + this.canvas.width / 2 - this.pixelSize / 2) / this.pixelSize);
    const py = Math.floor((uy + this.canvas.height / 2 - this.pixelSize / 2) / this.pixelSize);
    return { x: Math.max(0, Math.min(this.width - 1, px)), y: Math.max(0, Math.min(this.height - 1, py)) };
  }

  _bindEvents() {
    const onDown = (e) => {
      e.preventDefault();
      const { x, y } = this._getPixelCoord(e);

      // 画布平移（pan 工具或按住空格）
      if (this.tool === 'pan' || this._spaceHeld) {
        this.isPanning = true;
        this._panLast = { x: e.clientX, y: e.clientY };
        this._updateCursor();
        return;
      }

      if (this.tool === 'crop') {
        this.isDrawing = true;
        this.cropStart = { x, y };
        this.cropEnd = { x, y };
        this.hasCropSelection = false;
        if (this.onCropSelect) this.onCropSelect(null);
        this.render();
        return;
      }

      if (this.tool === 'eyedropper') {
        const color = this._getPixelColor(x, y);
        if (color) {
          this.setColor(color);
          if (this.onColorPick) this.onColorPick(color);
        }
        return;
      }

      this.isDrawing = true;
      this.pushHistory();
      this.lastDrawX = -1;
      this.lastDrawY = -1;

      // ★★★ 绘制开始回调 ★★★
      if (this.onDrawStart) {
        this.onDrawStart();
      }

      if (this.tool === 'line' || this.tool === 'circle' || this.tool === 'rect' || this.tool === 'ellipse') {
        this.previewStart = { x, y };
        this.previewSnapshot = this.pixels.slice();
      } else {
        this._applyTool(x, y);
        this.lastDrawX = x;
        this.lastDrawY = y;
      }
    };

    const onMove = (e) => {
      if (!this.isDrawing) return;
      const { x, y } = this._getPixelCoord(e);

      if (this.tool === 'crop') {
        this.cropEnd = { x, y };
        this.render();
        return;
      }

      if (this.tool === 'eyedropper') return;

      if (this.tool === 'line') {
        this.pixels = this.previewSnapshot.slice();
        this._drawLinePixels(this.previewStart.x, this.previewStart.y, x, y, this.color);
        this.render();
      } else if (this.tool === 'circle') {
        this.pixels = this.previewSnapshot.slice();
        const r = Math.round(Math.hypot(x - this.previewStart.x, y - this.previewStart.y));
        this._drawCirclePixels(this.previewStart.x, this.previewStart.y, r, this.color);
        this.render();
      } else if (this.tool === 'rect') {
        this.pixels = this.previewSnapshot.slice();
        this._drawRectPixels(this.previewStart.x, this.previewStart.y, x, y, this.color);
        this.render();
      } else if (this.tool === 'ellipse') {
        this.pixels = this.previewSnapshot.slice();
        const rx = Math.abs(x - this.previewStart.x);
        const ry = Math.abs(y - this.previewStart.y);
        this._drawEllipsePixels(this.previewStart.x, this.previewStart.y, rx, ry, this.color);
        this.render();
      } else {
        if (this.lastDrawX >= 0 && this.lastDrawY >= 0) {
          this._drawLinePixels(this.lastDrawX, this.lastDrawY, x, y, this.tool === 'eraser' ? null : this.color);
        } else {
          this._applyTool(x, y);
        }
        this.lastDrawX = x;
        this.lastDrawY = y;
        this.render();
      }
    };

    const onUp = () => {
      if (this.isPanning) {
        this.isPanning = false;
        this._panLast = null;
        this._updateCursor();
        return;
      }

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

      // 判断是否在绘制中（非预览工具，非裁剪工具）
      const wasDrawing = this.isDrawing && 
                          this.tool !== 'line' && 
                          this.tool !== 'circle' &&
                          this.tool !== 'rect' &&
                          this.tool !== 'ellipse' &&
                          this.tool !== 'crop' &&
                          this.tool !== 'eyedropper';

      this.isDrawing = false;
      this.previewStart = null;
      this.previewSnapshot = null;
      this.lastDrawX = -1;
      this.lastDrawY = -1;

      // ★★★ 绘制完成回调 ★★★
      if (wasDrawing && this.onDrawEnd) {
        // 确保 pixels 是最新状态
        const pixelsCopy = this.pixels.slice();
        this.onDrawEnd(pixelsCopy);
      }
    };

    // 窗口级 mousemove：用于平移拖拽（鼠标可移出画布）
    const onWindowMove = (e) => {
      if (this.isPanning && this._panLast) {
        const dx = e.clientX - this._panLast.x;
        const dy = e.clientY - this._panLast.y;
        this._panLast = { x: e.clientX, y: e.clientY };
        this.panBy(dx, dy);
      }
    };

    this.canvas.addEventListener('mousedown', onDown);
    this.canvas.addEventListener('mousemove', onMove);
    window.addEventListener('mousemove', onWindowMove);
    window.addEventListener('mouseup', onUp);

    this.canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.touches[0];
      onDown({ clientX: t.clientX, clientY: t.clientY, preventDefault: () => {} });
    });
    this.canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      const t = e.touches[0];
      if (this.isPanning && this._panLast) {
        const dx = t.clientX - this._panLast.x;
        const dy = t.clientY - this._panLast.y;
        this._panLast = { x: t.clientX, y: t.clientY };
        this.panBy(dx, dy);
        return;
      }
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
    } else if (this.tool === 'rect' || this.tool === 'ellipse') {
      this._setPixel(x, y, this.color);
    }
  }

  _drawDot(x, y, color) {
    const size = this.penSize;
    const radius = Math.floor(size / 2);
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy <= radius * radius + 0.5) {
          const px = x + dx;
          const py = y + dy;
          if (px >= 0 && px < this.width && py >= 0 && py < this.height) {
            const i = this._idx(px, py);
            this.pixels[i] = color;
          }
        }
      }
    }
  }

  _setPixel(x, y, color) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    const i = this._idx(x, y);
    if (this.pixels[i] !== color) {
      this.pixels[i] = color;
    }
  }

  _eraseArea(cx, cy) {
    const size = this.eraserSize;
    const radius = Math.floor(size / 2);
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy <= radius * radius + 0.5) {
          const x = cx + dx;
          const y = cy + dy;
          if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
            const i = this._idx(x, y);
            this.pixels[i] = null;
          }
        }
      }
    }
  }

  _floodFill(sx, sy, newColor) {
    const target = this.pixels[this._idx(sx, sy)];
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
      if (this.pixels[i] !== target) continue;
      this.pixels[i] = newColor;
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

  _drawRectPixels(x0, y0, x1, y1, color) {
    const minX = Math.min(x0, x1), maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1), maxY = Math.max(y0, y1);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (this.shapeFill || x === minX || x === maxX || y === minY || y === maxY) {
          this._setPixel(x, y, color);
        }
      }
    }
  }

  _inEllipse(x, y, cx, cy, rx, ry) {
    if (rx === 0 && ry === 0) return x === cx && y === cy;
    const xr = rx || 1, yr = ry || 1;
    return ((x - cx) * (x - cx)) / (xr * xr) + ((y - cy) * (y - cy)) / (yr * yr) <= 1;
  }

  _drawEllipsePixels(cx, cy, rx, ry, color) {
    if (rx < 0) rx = 0;
    if (ry < 0) ry = 0;
    if (rx === 0 && ry === 0) { this._setPixel(cx, cy, color); return; }
    const xr = rx || 1, yr = ry || 1;
    for (let y = cy - ry; y <= cy + ry; y++) {
      for (let x = cx - rx; x <= cx + rx; x++) {
        if (!this._inEllipse(x, y, cx, cy, rx, ry)) continue;
        if (this.shapeFill) {
          this._setPixel(x, y, color);
        } else {
          const edge =
            !this._inEllipse(x - 1, y, cx, cy, rx, ry) ||
            !this._inEllipse(x + 1, y, cx, cy, rx, ry) ||
            !this._inEllipse(x, y - 1, cx, cy, rx, ry) ||
            !this._inEllipse(x, y + 1, cx, cy, rx, ry);
          if (edge) this._setPixel(x, y, color);
        }
      }
    }
  }

  render() {
    const ctx = this.ctx;
    const ps = this.pixelSize;

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

    if (this.onionPrev || this.onionNext) {
      const a = this.onionAlpha;
      if (this.onionPrev) {
        ctx.globalAlpha = a;
        ctx.fillStyle = '#ff3b30';
        for (let y = 0; y < this.height; y++) {
          for (let x = 0; x < this.width; x++) {
            if (this.onionPrev[y * this.width + x]) ctx.fillRect(x * ps, y * ps, ps, ps);
          }
        }
      }
      if (this.onionNext) {
        ctx.globalAlpha = a;
        ctx.fillStyle = '#0a84ff';
        for (let y = 0; y < this.height; y++) {
          for (let x = 0; x < this.width; x++) {
            if (this.onionNext[y * this.width + x]) ctx.fillRect(x * ps, y * ps, ps, ps);
          }
        }
      }
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
}

window.CanvasEngine = CanvasEngine;