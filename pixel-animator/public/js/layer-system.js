// public/js/layer-system.js - 图层系统
// 功能：多图层 + 多帧管理、可见性、不透明度（alpha 混合）、合并、排序
//
// 数据模型（统一模型）：
//  - 图层结构在所有帧之间共享：this.layers[i] = { id, name, visible, opacity, locked }
//  - 每帧每层的像素数据：this.framePixelData[frameIndex][layerIndex]
//  - this.layers[i].pixels 是当前帧该图层的"实时缓冲"（指向 framePixelData[currentFrame][i]）
//  - anim.frames[i] 仍然保存每帧的"合成图"，用于渲染/导出/保存（向后兼容）

(function() {
  'use strict';

  // 颜色 alpha 混合：把前景色 fg 按不透明度 a 叠加到背景色 bg 上
  function blendHex(bg, fg, a) {
    if (!bg) return fg;
    if (a >= 1) return fg;
    const br = parseInt(bg.slice(1, 3), 16);
    const bgG = parseInt(bg.slice(3, 5), 16);
    const bgB = parseInt(bg.slice(5, 7), 16);
    const fr = parseInt(fg.slice(1, 3), 16);
    const fgG = parseInt(fg.slice(3, 5), 16);
    const fgB = parseInt(fg.slice(5, 7), 16);
    const r = Math.round(br + (fr - br) * a);
    const g = Math.round(bgG + (fgG - bgG) * a);
    const b = Math.round(bgB + (fgB - bgB) * a);
    return '#' + [r, g, b].map(function(v) { return v.toString(16).padStart(2, '0'); }).join('');
  }

  class LayerSystem {
    constructor(engine, anim) {
      this.engine = engine;
      this.anim = anim;
      this.layers = [];            // 共享结构：{ id, name, visible, opacity, locked, pixels(实时缓冲) }
      this.framePixelData = [];    // [frame][layer] => 像素数组
      this.currentLayerIndex = 0;
      this.currentFrame = 0;
      this.nextId = 1;
      this.onChange = null;        // 变更回调（由 app.js 设为 pushSnapshot）

      // DOM 引用
      this.layerList = document.getElementById('layerList');
      this.opacitySlider = document.getElementById('layerOpacitySlider');
      this.opacityLabel = document.getElementById('layerOpacityLabel');

      this._bindEvents();
      // 从已加载的动画帧初始化（不会清空画布）
      this._initFromAnim();
    }

    // ---- 初始化：从 anim.frames 构建单图层（结构在所有帧共享） ----
    _initFromAnim() {
      const w = this.engine.width;
      const h = this.engine.height;
      const numFrames = (this.anim && this.anim.frames) ? this.anim.frames.length : 1;

      this.layers = [{
        id: this.nextId++,
        name: '图层 1',
        visible: true,
        opacity: 1,
        locked: false,
        pixels: null
      }];

      this.framePixelData = [];
      for (let f = 0; f < numFrames; f++) {
        const composite = (this.anim.frames[f]) ? this.anim.frames[f].slice() : new Array(w * h).fill(null);
        this.framePixelData[f] = [composite];
      }

      this.currentFrame = (this.anim && this.anim.current) || 0;
      if (this.currentFrame >= numFrames) this.currentFrame = Math.max(0, numFrames - 1);

      this.currentLayerIndex = 0;
      this._wireLiveRefs();
      this._activateLayerInEngine();
      this._renderLayerList();
      this._syncToEngine();
      this._updateOpacityUI();
    }

    // 让 layers[i].pixels 指向当前帧对应的缓冲（实时引用）
    _wireLiveRefs() {
      for (let i = 0; i < this.layers.length; i++) {
        if (!this.framePixelData[this.currentFrame]) this.framePixelData[this.currentFrame] = [];
        if (!this.framePixelData[this.currentFrame][i]) {
          this.framePixelData[this.currentFrame][i] = new Array(this.engine.width * this.engine.height).fill(null);
        }
        this.layers[i].pixels = this.framePixelData[this.currentFrame][i];
      }
    }

    // 把引擎的活动图层与合成回调指向本系统
    _activateLayerInEngine() {
      const cur = this.getCurrentLayer();
      this.engine.activeLayer = cur ? cur.pixels : null;
      this.engine.activeLayerLocked = cur ? !!cur.locked : false;
      this.engine.compositeFn = () => this.getCompositePixels();
    }

    // ---- 获取当前图层 ----
    getCurrentLayer() {
      return this.layers[this.currentLayerIndex] || null;
    }

    getCurrentPixels() {
      const layer = this.getCurrentLayer();
      return layer ? layer.pixels : null;
    }

    // ---- 合并所有可见图层（自底向上，上层覆盖下层） ----
    getCompositePixels() {
      const w = this.engine.width;
      const h = this.engine.height;
      const result = new Array(w * h).fill(null);

      // 从最底层(i=0)向最顶层(i=length-1)叠加，
      // 这样上层（索引更大）绘制在更上面，且不透明度与下方已合成结果混合
      for (let i = 0; i < this.layers.length; i++) {
        const layer = this.layers[i];
        if (!layer.visible) continue;

        const pixels = layer.pixels;
        const opacity = layer.opacity;

        for (let j = 0; j < pixels.length; j++) {
          const color = pixels[j];
          if (color === null || color === undefined) continue;

          if (opacity >= 1 || result[j] === null) {
            result[j] = color;
          } else {
            result[j] = blendHex(result[j], color, opacity);
          }
        }
      }

      return result;
    }

    // ---- 同步到引擎（并同步当前帧合成图） ----
    _syncToEngine() {
      const composite = this.getCompositePixels();
      this.engine.pixels = composite;
      if (this.anim) this.anim.frames[this.anim.current] = composite.slice();
      this.engine.render();
    }

    // 统一提交：重绘 + 刷新列表 + 触发撤销快照
    _afterChange() {
      this._syncToEngine();
      this._renderLayerList();
      this._updateOpacityUI();
      if (this.onChange) this.onChange();
    }

    // ---- 添加图层 ----
    addLayer(name) {
      const w = this.engine.width;
      const h = this.engine.height;

      const layer = {
        id: this.nextId++,
        name: name || '图层 ' + (this.layers.length + 1),
        visible: true,
        opacity: 1,
        locked: false,
        pixels: null
      };

      this.layers.push(layer);
      this.currentLayerIndex = this.layers.length - 1;

      // 每一帧都新增一个空的图层缓冲（顶部）
      for (let f = 0; f < this.framePixelData.length; f++) {
        this.framePixelData[f].push(new Array(w * h).fill(null));
      }

      this._wireLiveRefs();
      this._activateLayerInEngine();
      this._afterChange();
      return layer;
    }

    // ---- 复制图层 ----
    duplicateLayer() {
      const current = this.getCurrentLayer();
      if (!current) return;

      const idx = this.currentLayerIndex;
      const newLayer = {
        id: this.nextId++,
        name: current.name + ' (复制)',
        visible: current.visible,
        opacity: current.opacity,
        locked: false,
        pixels: null
      };

      this.layers.splice(idx + 1, 0, newLayer);
      this.currentLayerIndex = idx + 1;

      for (let f = 0; f < this.framePixelData.length; f++) {
        this.framePixelData[f].splice(idx + 1, 0, this.framePixelData[f][idx].slice());
      }

      this._wireLiveRefs();
      this._activateLayerInEngine();
      this._afterChange();
    }

    // ---- 删除图层 ----
    deleteLayer() {
      if (this.layers.length <= 1) {
        alert('至少保留一个图层');
        return;
      }

      this.layers.splice(this.currentLayerIndex, 1);
      for (let f = 0; f < this.framePixelData.length; f++) {
        this.framePixelData[f].splice(this.currentLayerIndex, 1);
      }

      if (this.currentLayerIndex >= this.layers.length) {
        this.currentLayerIndex = this.layers.length - 1;
      }

      this._wireLiveRefs();
      this._activateLayerInEngine();
      this._afterChange();
    }

    // ---- 移动图层 ----
    moveLayerUp() {
      if (this.currentLayerIndex >= this.layers.length - 1) return;
      const i = this.currentLayerIndex;
      const [layer] = this.layers.splice(i, 1);
      this.layers.splice(i + 1, 0, layer);
      for (let f = 0; f < this.framePixelData.length; f++) {
        const [px] = this.framePixelData[f].splice(i, 1);
        this.framePixelData[f].splice(i + 1, 0, px);
      }
      this.currentLayerIndex++;
      this._wireLiveRefs();
      this._afterChange();
    }

    moveLayerDown() {
      if (this.currentLayerIndex <= 0) return;
      const i = this.currentLayerIndex;
      const [layer] = this.layers.splice(i, 1);
      this.layers.splice(i - 1, 0, layer);
      for (let f = 0; f < this.framePixelData.length; f++) {
        const [px] = this.framePixelData[f].splice(i, 1);
        this.framePixelData[f].splice(i - 1, 0, px);
      }
      this.currentLayerIndex--;
      this._wireLiveRefs();
      this._afterChange();
    }

    // ---- 合并向下（所有帧） ----
    mergeDown() {
      if (this.currentLayerIndex <= 0) {
        alert('没有下层图层可合并');
        return;
      }

      const curIdx = this.currentLayerIndex;
      const belowIdx = curIdx - 1;
      const opacity = this.layers[curIdx].opacity;

      for (let f = 0; f < this.framePixelData.length; f++) {
        const cur = this.framePixelData[f][curIdx];
        const below = this.framePixelData[f][belowIdx];
        for (let j = 0; j < cur.length; j++) {
          if (cur[j] !== null && cur[j] !== undefined) {
            if (below[j] === null || below[j] === undefined || opacity >= 1) {
              below[j] = cur[j];
            } else {
              below[j] = blendHex(below[j], cur[j], opacity);
            }
          }
        }
      }

      this.layers.splice(curIdx, 1);
      for (let f = 0; f < this.framePixelData.length; f++) {
        this.framePixelData[f].splice(curIdx, 1);
      }
      this.currentLayerIndex = belowIdx;

      this._wireLiveRefs();
      this._activateLayerInEngine();
      this._afterChange();
    }

    // ---- 切换可见性 ----
    toggleVisibility(index) {
      if (index === undefined) index = this.currentLayerIndex;
      const layer = this.layers[index];
      if (!layer) return;
      layer.visible = !layer.visible;
      this._afterChange();
    }

    // ---- 选择图层 ----
    selectLayer(index) {
      if (index < 0 || index >= this.layers.length) return;
      this.currentLayerIndex = index;
      this._activateLayerInEngine();
      this._renderLayerList();
      this._syncToEngine();
      this._updateOpacityUI();
    }

    // ---- 更新不透明度 ----
    setOpacity(value) {
      const layer = this.getCurrentLayer();
      if (!layer) return;
      layer.opacity = Math.max(0, Math.min(1, value / 100));
      this._afterChange();
      if (this.opacityLabel) {
        this.opacityLabel.textContent = Math.round(value) + '%';
      }
    }

    // ---- 更新不透明度 UI ----
    _updateOpacityUI() {
      const layer = this.getCurrentLayer();
      if (layer && this.opacitySlider) {
        const val = Math.round(layer.opacity * 100);
        this.opacitySlider.value = val;
        if (this.opacityLabel) {
          this.opacityLabel.textContent = val + '%';
        }
      }
    }

    // ---- 重命名图层 ----
    renameLayer(index, newName) {
      const layer = this.layers[index];
      if (!layer) return;
      layer.name = newName.trim() || '图层 ' + (index + 1);
      this._afterChange();
    }

    // ---- 清空当前图层（当前帧） ----
    clearCurrentLayer() {
      const layer = this.getCurrentLayer();
      if (!layer) return;
      const w = this.engine.width;
      const h = this.engine.height;
      layer.pixels = new Array(w * h).fill(null);
      this._afterChange();
    }

    // ---- 保存当前帧的图层像素到 framePixelData ----
    saveCurrentFrameLayers() {
      if (!this.framePixelData[this.currentFrame]) {
        this.framePixelData[this.currentFrame] = [];
      }
      for (let i = 0; i < this.layers.length; i++) {
        this.framePixelData[this.currentFrame][i] = this.layers[i].pixels
          ? this.layers[i].pixels.slice()
          : null;
      }
    }

    // ---- 加载某帧的图层数据并激活 ----
    loadFrameLayers(frameIndex) {
      if (frameIndex < 0 || frameIndex >= this.framePixelData.length) return;
      if (!this.framePixelData[frameIndex]) {
        this.framePixelData[frameIndex] = this.layers.map(() =>
          new Array(this.engine.width * this.engine.height).fill(null));
      }
      this.currentFrame = frameIndex;
      this._wireLiveRefs();
      this._activateLayerInEngine();
      this._renderLayerList();
      this._syncToEngine();
      this._updateOpacityUI();
    }

    // 从现有 anim 重新初始化（用于加载本地/云端项目）
    reinitFromAnim() {
      this._initFromAnim();
    }

    // ---- 帧操作：图层数据同步 ----
    addFrameLayers(atIndex) {
      const w = this.engine.width;
      const h = this.engine.height;
      const empty = this.layers.map(() => new Array(w * h).fill(null));
      this.framePixelData.splice(atIndex, 0, empty);
      this.loadFrameLayers(atIndex);
    }

    duplicateFrameLayers(srcIndex) {
      const copy = this.framePixelData[srcIndex].map(px => px.slice());
      this.framePixelData.splice(srcIndex + 1, 0, copy);
      this.loadFrameLayers(srcIndex + 1);
    }

    deleteFrameLayers(index) {
      this.framePixelData.splice(index, 1);
      if (this.currentFrame >= this.framePixelData.length) {
        this.currentFrame = this.framePixelData.length - 1;
      }
      if (this.currentFrame < 0) this.currentFrame = 0;
      this.loadFrameLayers(this.currentFrame);
    }

    moveFrameLayers(from, to) {
      const [moved] = this.framePixelData.splice(from, 1);
      this.framePixelData.splice(to, 0, moved);
      this.currentFrame = to;
      this.loadFrameLayers(to);
    }

    // ---- 调整画布尺寸（所有帧的所有图层） ----
    resize(newW, newH, oldW, oldH) {
      if (oldW === undefined) { oldW = this.engine.width; oldH = this.engine.height; }
      for (let f = 0; f < this.framePixelData.length; f++) {
        for (let i = 0; i < this.framePixelData[f].length; i++) {
          const oldPx = this.framePixelData[f][i];
          const newPx = new Array(newW * newH).fill(null);
          for (let y = 0; y < newH; y++) {
            for (let x = 0; x < newW; x++) {
              const ox = Math.floor(x * oldW / newW);
              const oy = Math.floor(y * oldH / newH);
              const v = oldPx[oy * oldW + ox];
              newPx[y * newW + x] = (v === undefined) ? null : v;
            }
          }
          this.framePixelData[f][i] = newPx;
        }
      }
      this._wireLiveRefs();
      this._syncToEngine();
    }

    // ---- 裁剪（所有帧的所有图层） ----
    crop(x1, y1, x2, y2, oldW, oldH) {
      if (oldW === undefined) { oldW = this.engine.width; oldH = this.engine.height; }
      const newW = x2 - x1 + 1;
      const newH = y2 - y1 + 1;
      for (let f = 0; f < this.framePixelData.length; f++) {
        for (let i = 0; i < this.framePixelData[f].length; i++) {
          const oldPx = this.framePixelData[f][i];
          const newPx = new Array(newW * newH).fill(null);
          for (let y = 0; y < newH; y++) {
            for (let x = 0; x < newW; x++) {
              const v = oldPx[(y1 + y) * oldW + (x1 + x)];
              newPx[y * newW + x] = (v === undefined) ? null : v;
            }
          }
          this.framePixelData[f][i] = newPx;
        }
      }
      this._wireLiveRefs();
      this._syncToEngine();
    }

    // ---- 渲染图层列表 ----
    _renderLayerList() {
      if (!this.layerList) return;

      this.layerList.innerHTML = '';

      if (this.layers.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'layer-empty';
        empty.textContent = '暂无图层，点击 "新建" 创建';
        this.layerList.appendChild(empty);
        return;
      }

      // 从下到上显示（底部图层在列表底部）
      for (let i = this.layers.length - 1; i >= 0; i--) {
        const layer = this.layers[i];
        const item = this._createLayerItem(layer, i);
        this.layerList.appendChild(item);
      }

      this._highlightCurrent();
    }

    // ---- 创建图层 DOM 元素 ----
    _createLayerItem(layer, index) {
      const item = document.createElement('div');
      item.className = 'layer-item' + (index === this.currentLayerIndex ? ' active' : '');
      item.dataset.index = index;
      if (layer.locked) item.classList.add('locked');

      // 可见性切换
      const visBtn = document.createElement('button');
      visBtn.className = 'layer-vis' + (layer.visible ? '' : ' hidden');
      visBtn.innerHTML = layer.visible
        ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'
        : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
      visBtn.title = layer.visible ? '隐藏图层' : '显示图层';
      visBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleVisibility(index);
      });
      item.appendChild(visBtn);

      // 缩略图
      const thumb = document.createElement('canvas');
      thumb.className = 'layer-thumb';
      const w = this.engine.width;
      const h = this.engine.height;
      const ps = Math.max(1, Math.floor(32 / Math.max(w, h)));
      thumb.width = w * ps;
      thumb.height = h * ps;
      const ctx = thumb.getContext('2d');
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, thumb.width, thumb.height);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if ((x + y) % 2 === 0) {
            ctx.fillStyle = '#2a2a3e';
            ctx.fillRect(x * ps, y * ps, ps, ps);
          }
        }
      }
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const color = layer.pixels[y * w + x];
          if (color) {
            ctx.globalAlpha = layer.opacity;
            ctx.fillStyle = color;
            ctx.fillRect(x * ps, y * ps, ps, ps);
            ctx.globalAlpha = 1;
          }
        }
      }
      item.appendChild(thumb);

      // 图层名称（可编辑）
      const nameSpan = document.createElement('span');
      nameSpan.className = 'layer-name';
      nameSpan.textContent = layer.name;
      nameSpan.title = '双击重命名';
      nameSpan.addEventListener('dblclick', () => {
        const input = document.createElement('input');
        input.className = 'layer-name-input';
        input.type = 'text';
        input.value = layer.name;
        input.maxLength = 20;
        nameSpan.replaceWith(input);
        input.focus();
        input.select();

        const finish = () => {
          const newName = input.value.trim() || '图层 ' + (index + 1);
          this.renameLayer(index, newName);
        };

        input.addEventListener('blur', finish);
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { input.blur(); }
          if (e.key === 'Escape') {
            input.value = layer.name;
            input.blur();
          }
        });
      });
      item.appendChild(nameSpan);

      // 不透明度徽章
      if (layer.opacity < 1) {
        const badge = document.createElement('span');
        badge.className = 'layer-opacity-badge';
        badge.textContent = Math.round(layer.opacity * 100) + '%';
        item.appendChild(badge);
      }

      // 选择图层
      item.addEventListener('click', () => {
        this.selectLayer(index);
      });

      // 拖拽排序
      item.draggable = true;
      item.addEventListener('dragstart', (e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(index));
        item.classList.add('dragging');
      });
      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
        document.querySelectorAll('.layer-item.drag-over').forEach(el => {
          el.classList.remove('drag-over');
        });
      });
      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        document.querySelectorAll('.layer-item.drag-over').forEach(el => {
          if (el !== item) el.classList.remove('drag-over');
        });
        item.classList.add('drag-over');
      });
      item.addEventListener('dragleave', () => {
        item.classList.remove('drag-over');
      });
      item.addEventListener('drop', (e) => {
        e.preventDefault();
        item.classList.remove('drag-over');
        const fromIndex = parseInt(e.dataTransfer.getData('text/plain'));
        const toIndex = index;
        if (fromIndex !== toIndex && !isNaN(fromIndex) && !isNaN(toIndex)) {
          this._moveLayerByIndex(fromIndex, toIndex);
        }
      });

      return item;
    }

    // ---- 通过索引移动图层 ----
    _moveLayerByIndex(from, to) {
      if (from === to) return;
      const [layer] = this.layers.splice(from, 1);
      this.layers.splice(to, 0, layer);
      for (let f = 0; f < this.framePixelData.length; f++) {
        const [px] = this.framePixelData[f].splice(from, 1);
        this.framePixelData[f].splice(to, 0, px);
      }

      if (this.currentLayerIndex === from) {
        this.currentLayerIndex = to;
      } else if (from < this.currentLayerIndex && to >= this.currentLayerIndex) {
        this.currentLayerIndex--;
      } else if (from > this.currentLayerIndex && to <= this.currentLayerIndex) {
        this.currentLayerIndex++;
      }

      this._wireLiveRefs();
      this._activateLayerInEngine();
      this._afterChange();
    }

    // ---- 高亮当前图层 ----
    _highlightCurrent() {
      const items = this.layerList.querySelectorAll('.layer-item');
      items.forEach((item, idx) => {
        const actualIndex = this.layers.length - 1 - idx;
        item.classList.toggle('active', actualIndex === this.currentLayerIndex);
      });
    }

    // ---- 绑定事件 ----
    _bindEvents() {
      const addBtn = document.getElementById('btnAddLayer');
      if (addBtn) addBtn.addEventListener('click', () => this.addLayer());

      const dupBtn = document.getElementById('btnDupLayer');
      if (dupBtn) dupBtn.addEventListener('click', () => this.duplicateLayer());

      const delBtn = document.getElementById('btnDelLayer');
      if (delBtn) delBtn.addEventListener('click', () => this.deleteLayer());

      const upBtn = document.getElementById('btnLayerUp');
      if (upBtn) upBtn.addEventListener('click', () => this.moveLayerUp());

      const downBtn = document.getElementById('btnLayerDown');
      if (downBtn) downBtn.addEventListener('click', () => this.moveLayerDown());

      const mergeBtn = document.getElementById('btnMergeLayer');
      if (mergeBtn) mergeBtn.addEventListener('click', () => this.mergeDown());

      if (this.opacitySlider) {
        this.opacitySlider.addEventListener('input', () => {
          const val = parseInt(this.opacitySlider.value);
          this.setOpacity(val);
        });
      }
    }

    // ---- 快照：图层结构与所有帧的图层像素 ----
    getSnapshot() {
      return {
        currentFrame: this.currentFrame,
        currentLayerIndex: this.currentLayerIndex,
        nextId: this.nextId,
        layers: this.layers.map(l => ({
          id: l.id, name: l.name, visible: l.visible, opacity: l.opacity, locked: !!l.locked
        })),
        framePixelData: this.framePixelData.map(frame =>
          frame.map(px => (px ? px.slice() : null))
        )
      };
    }

    // ---- 恢复快照 ----
    restoreSnapshot(data) {
      if (!data) return;
      const w = this.engine.width;
      const h = this.engine.height;

      this.layers = data.layers.map(l => ({
        id: l.id, name: l.name, visible: l.visible, opacity: l.opacity,
        locked: !!l.locked, pixels: null
      }));
      this.framePixelData = data.framePixelData.map(frame =>
        frame.map(px => (px ? px.slice() : new Array(w * h).fill(null)))
      );
      this.nextId = data.nextId || (this.layers.length + 1);

      let cf = (data.currentFrame != null) ? data.currentFrame : 0;
      if (cf >= this.framePixelData.length) cf = this.framePixelData.length - 1;
      if (cf < 0) cf = 0;
      this.currentFrame = cf;

      this.currentLayerIndex = data.currentLayerIndex || 0;
      if (this.currentLayerIndex >= this.layers.length) this.currentLayerIndex = this.layers.length - 1;
      if (this.currentLayerIndex < 0) this.currentLayerIndex = 0;

      this._wireLiveRefs();
      this._activateLayerInEngine();
      this._renderLayerList();
      this._syncToEngine();
      this._updateOpacityUI();
    }

    // ---- 从帧数据恢复图层（兼容旧项目，无图层数据） ----
    loadFromFrames(frames) {
      this._initFromAnim();
    }

    // ---- 获取所有图层数据（用于保存） ----
    getLayerData() {
      return this.layers.map(layer => ({
        id: layer.id,
        name: layer.name,
        visible: layer.visible,
        opacity: layer.opacity,
        pixels: layer.pixels ? layer.pixels.slice() : null
      }));
    }
  }

  // ---- 导出 ----
  window.LayerSystem = LayerSystem;

})();
