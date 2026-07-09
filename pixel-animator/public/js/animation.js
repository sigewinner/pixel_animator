// public/js/animation.js - 帧动画系统
// 负责：帧列表管理、洋葱皮、播放控制

class Animation {
  /**
   * @param {CanvasEngine} engine 画布引擎实例
   * @param {number} width 像素宽
   * @param {number} height 像素高
   */
  constructor(engine, width, height) {
    this.engine = engine;
    this.width = width;
    this.height = height;
    this.emptyPixel = () => new Array(width * height).fill(null);

    // 帧列表，每帧是一个图层帧对象 { layers: [...], activeLayer: 0 }
    this.frames = [LayerUtils.createFrame(width, height, 'Background')];
    this.current = 0;

    this.fps = 12;
    this.playing = false;
    this.timer = null;
    this.onionSkin = false;

    // 帧列表变化的回调（用于刷新 UI）
    this.onFramesChange = null;
    this.onFrameSelect = null;
  }

  /** 获取当前帧的完整图层数据 */
  getCurrentFrame() {
    return this.frames[this.current];
  }

  /** 获取当前帧的合成像素（用于导出/渲染） */
  getCurrentComposite() {
    return LayerUtils.getCompositePixels(this.frames[this.current], this.width, this.height);
  }

  /** 切换到指定帧 */
  selectFrame(index) {
    if (index < 0 || index >= this.frames.length) return;
    // 保存当前引擎状态到当前帧
    this.syncCurrentFrame();
    this.current = index;
    this.engine.loadFrame(this.frames[index]);
    this._renderOnion();
    if (this.onFrameSelect) this.onFrameSelect(index);
  }

  /** 添加新帧（空白） */
  addFrame() {
    this.syncCurrentFrame();
    const newFrame = LayerUtils.createFrame(this.width, this.height, 'Background');
    this.frames.splice(this.current + 1, 0, newFrame);
    this.current++;
    this.engine.loadFrame(newFrame);
    this._renderOnion();
    if (this.onFramesChange) this.onFramesChange();
  }

  /** 复制当前帧 */
  duplicateFrame() {
    this.syncCurrentFrame();
    const copy = LayerUtils.cloneFrame(this.frames[this.current]);
    this.frames.splice(this.current + 1, 0, copy);
    this.current++;
    this.engine.loadFrame(copy);
    this._renderOnion();
    if (this.onFramesChange) this.onFramesChange();
  }

  /** 删除当前帧（至少保留一帧） */
  deleteFrame() {
    if (this.frames.length <= 1) return;
    this.frames.splice(this.current, 1);
    if (this.current >= this.frames.length) this.current = this.frames.length - 1;
    this.engine.loadFrame(this.frames[this.current]);
    this._renderOnion();
    if (this.onFramesChange) this.onFramesChange();
  }

  /** 拖拽排序：把第 from 帧移动到 to 位置 */
  moveFrame(from, to) {
    if (from === to || from < 0 || to < 0 || from >= this.frames.length || to >= this.frames.length) return;
    this.syncCurrentFrame();
    const [moved] = this.frames.splice(from, 1);
    this.frames.splice(to, 0, moved);
    this.current = to;
    this.engine.loadFrame(this.frames[this.current]);
    this._renderOnion();
    if (this.onFramesChange) this.onFramesChange();
  }

  /** 渲染洋葱皮 */
  _renderOnion() {
    if (this.onionSkin && this.current > 0) {
      // 使用合成像素作为洋葱皮
      var onionPixels = LayerUtils.getCompositePixels(this.frames[this.current - 1], this.width, this.height);
      this.engine.render(onionPixels);
    } else {
      this.engine.render();
    }
  }

  toggleOnionSkin() {
    this.onionSkin = !this.onionSkin;
    this._renderOnion();
    return this.onionSkin;
  }

  /** 同步当前引擎状态到帧数据（保存/切换前调用） */
  syncCurrentFrame() {
    this.engine.syncToFrameData();
    this.frames[this.current] = LayerUtils.cloneFrame(this.engine.getFrameData());
  }

  /**
   * 调整所有帧到新尺寸（最近邻缩放）
   * @param {number} newW 新宽度
   * @param {number} newH 新高度
   */
  resize(newW, newH) {
    const oldW = this.width, oldH = this.height;
    this.width = newW;
    this.height = newH;
    this.emptyPixel = () => new Array(newW * newH).fill(null);

    this.frames = this.frames.map(frame => {
      if (LayerUtils.isLayerFrame(frame)) {
        return LayerUtils.resizeFrame(LayerUtils.cloneFrame(frame), oldW, oldH, newW, newH);
      }
      // 旧格式帧（理论上不应该出现，但做防御性处理）
      const newFrame = new Array(newW * newH).fill(null);
      for (let y = 0; y < newH; y++) {
        for (let x = 0; x < newW; x++) {
          const ox = Math.floor(x * oldW / newW);
          const oy = Math.floor(y * oldH / newH);
          newFrame[y * newW + x] = frame[oy * oldW + ox];
        }
      }
      return LayerUtils.convertLegacyFrame(newFrame, newW, newH);
    });

    if (this.current >= this.frames.length) this.current = this.frames.length - 1;
  }

  /**
   * 裁剪所有帧到指定选区
   * @param {number} x1 选区左上 x
   * @param {number} y1 选区左上 y
   * @param {number} x2 选区右下 x
   * @param {number} y2 选区右下 y
   */
  crop(x1, y1, x2, y2) {
    const oldW = this.width;
    const newW = x2 - x1 + 1;
    const newH = y2 - y1 + 1;
    this.width = newW;
    this.height = newH;
    this.emptyPixel = () => new Array(newW * newH).fill(null);

    this.frames = this.frames.map(frame => {
      if (LayerUtils.isLayerFrame(frame)) {
        return LayerUtils.cropFrame(LayerUtils.cloneFrame(frame), x1, y1, x2, y2, oldW);
      }
      // 旧格式帧防御性处理
      const newFrame = new Array(newW * newH).fill(null);
      for (let y = 0; y < newH; y++) {
        for (let x = 0; x < newW; x++) {
          newFrame[y * newW + x] = frame[(y1 + y) * oldW + (x1 + x)];
        }
      }
      return LayerUtils.convertLegacyFrame(newFrame, newW, newH);
    });

    if (this.current >= this.frames.length) this.current = this.frames.length - 1;
  }

  // ---- 播放控制 ----
  play() {
    if (this.frames.length < 2) return;
    this.syncCurrentFrame();
    this.playing = true;
    const interval = 1000 / this.fps;
    this.timer = setInterval(() => {
      this.current = (this.current + 1) % this.frames.length;
      // 播放时使用合成像素直接渲染（不切换引擎状态）
      var comp = LayerUtils.getCompositePixels(this.frames[this.current], this.width, this.height);
      this.engine.pixels = comp;
      this.engine.frameData = null; // 临时清除，避免渲染时叠加
      this.engine.render();
      if (this.onFrameSelect) this.onFrameSelect(this.current);
    }, interval);
  }

  stop() {
    this.playing = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    // 恢复引擎到当前帧的完整图层状态
    this.engine.loadFrame(this.frames[this.current]);
    this._renderOnion();
  }

  setFps(fps) {
    this.fps = fps;
    if (this.playing) {
      this.stop();
      this.play();
    }
  }

  /** 获取所有帧的合成像素（用于导出 GIF/PNG） */
  getAllFrames() {
    this.syncCurrentFrame();
    return this.frames.map(f => LayerUtils.getCompositePixels(f, this.width, this.height));
  }

  /** 获取所有帧的完整图层数据（用于保存项目） */
  getAllLayerFrames() {
    this.syncCurrentFrame();
    return this.frames.map(f => LayerUtils.cloneFrame(f));
  }

  /** 获取缩略图（第一帧合成，base64） */
  getThumbnail() {
    this.syncCurrentFrame();
    const frame = LayerUtils.getCompositePixels(this.frames[0], this.width, this.height);
    const tmp = document.createElement('canvas');
    const ps = 4;
    tmp.width = this.width * ps;
    tmp.height = this.height * ps;
    const ctx = tmp.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, tmp.width, tmp.height);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const c = frame[y * this.width + x];
        if (c) {
          ctx.fillStyle = c;
          ctx.fillRect(x * ps, y * ps, ps, ps);
        }
      }
    }
    return tmp.toDataURL('image/png');
  }
}

window.Animation = Animation;
