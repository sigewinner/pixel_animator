// public/js/animation.js - 帧动画系统
// 负责：帧列表管理、洋葱皮、播放控制

class Animation {
  constructor(engine, width, height) {
    this.engine = engine;
    this.width = width;
    this.height = height;
    this.emptyPixel = () => new Array(width * height).fill(null);

    this.frames = [this.emptyPixel()];
    this.current = 0;

    this.fps = 12;
    this.playing = false;
    this.timer = null;
    this.onionSkin = false;

    this.onFramesChange = null;
    this.onFrameSelect = null;
  }

  getCurrentFrame() {
    return this.frames[this.current];
  }

  selectFrame(index) {
    if (index < 0 || index >= this.frames.length) return;
    this.frames[this.current] = this.engine.getPixels();
    this.current = index;
    this.engine.loadFrame(this.frames[index]);
    this._renderOnion();
    if (this.onFrameSelect) this.onFrameSelect(index);
  }

  addFrame() {
    this.frames[this.current] = this.engine.getPixels();
    const newFrame = this.emptyPixel();
    this.frames.splice(this.current + 1, 0, newFrame);
    this.current++;
    this.engine.loadFrame(newFrame);
    this._renderOnion();
    if (this.onFramesChange) this.onFramesChange();
  }

  duplicateFrame() {
    this.frames[this.current] = this.engine.getPixels();
    const copy = this.frames[this.current].slice();
    this.frames.splice(this.current + 1, 0, copy);
    this.current++;
    this.engine.loadFrame(copy);
    this._renderOnion();
    if (this.onFramesChange) this.onFramesChange();
  }

  deleteFrame() {
    if (this.frames.length <= 1) return;
    this.frames.splice(this.current, 1);
    if (this.current >= this.frames.length) this.current = this.frames.length - 1;
    this.engine.loadFrame(this.frames[this.current]);
    this._renderOnion();
    if (this.onFramesChange) this.onFramesChange();
  }

  moveFrame(from, to) {
    if (from === to || from < 0 || to < 0 || from >= this.frames.length || to >= this.frames.length) return;
    this.frames[this.current] = this.engine.getPixels();
    const [moved] = this.frames.splice(from, 1);
    this.frames.splice(to, 0, moved);
    this.current = to;
    this.engine.loadFrame(this.frames[this.current]);
    this._renderOnion();
    if (this.onFramesChange) this.onFramesChange();
  }

  _renderOnion() {
    // 前一帧（红）与后一帧（蓝）同时显示，便于对位
    const prev = (this.onionSkin && this.current > 0) ? this.frames[this.current - 1] : null;
    const next = (this.onionSkin && this.current < this.frames.length - 1) ? this.frames[this.current + 1] : null;
    this.engine.setOnion(prev, next);
  }

  toggleOnionSkin() {
    this.onionSkin = !this.onionSkin;
    this._renderOnion();
    return this.onionSkin;
  }

  syncCurrentFrame() {
    this.frames[this.current] = this.engine.getPixels();
  }

  resize(newW, newH) {
    const oldW = this.width, oldH = this.height;
    this.width = newW;
    this.height = newH;
    this.emptyPixel = () => new Array(newW * newH).fill(null);

    this.frames = this.frames.map(frame => {
      const newFrame = new Array(newW * newH).fill(null);
      for (let y = 0; y < newH; y++) {
        for (let x = 0; x < newW; x++) {
          const ox = Math.floor(x * oldW / newW);
          const oy = Math.floor(y * oldH / newH);
          newFrame[y * newW + x] = frame[oy * oldW + ox];
        }
      }
      return newFrame;
    });

    if (this.current >= this.frames.length) this.current = this.frames.length - 1;
  }

  crop(x1, y1, x2, y2) {
    const oldW = this.width;
    const newW = x2 - x1 + 1;
    const newH = y2 - y1 + 1;
    this.width = newW;
    this.height = newH;
    this.emptyPixel = () => new Array(newW * newH).fill(null);

    this.frames = this.frames.map(frame => {
      const newFrame = new Array(newW * newH).fill(null);
      for (let y = 0; y < newH; y++) {
        for (let x = 0; x < newW; x++) {
          newFrame[y * newW + x] = frame[(y1 + y) * oldW + (x1 + x)];
        }
      }
      return newFrame;
    });

    if (this.current >= this.frames.length) this.current = this.frames.length - 1;
  }

  play() {
    if (this.frames.length < 2) return;
    this.syncCurrentFrame();
    this.playing = true;
    const interval = 1000 / this.fps;
    this.timer = setInterval(() => {
      this.current = (this.current + 1) % this.frames.length;
      this.engine.loadFrame(this.frames[this.current]);
      if (this.onFrameSelect) this.onFrameSelect(this.current);
    }, interval);
  }

  stop() {
    this.playing = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
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

  getAllFrames() {
    this.syncCurrentFrame();
    return this.frames.map(f => f.slice());
  }

  getThumbnail() {
    this.syncCurrentFrame();
    const frame = this.frames[0];
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