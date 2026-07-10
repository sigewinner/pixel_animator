// public/js/layer-system.js - 图层系统（每帧独立图层）
(function() {
  'use strict';

  class LayerSystem {
    constructor(engine, anim) {
      this.engine = engine;
      this.anim = anim;
      
      // 存储所有帧的图层数据 { frameIndex: [layers] }
      this.frameLayers = {};
      this.currentFrameIndex = 0;
      this.currentLayerIndex = 0;
      this.nextId = 1;
      this.isVisible = false;

      // DOM 引用
      this.layerList = document.getElementById('layerList');
      this.opacitySlider = document.getElementById('layerOpacitySlider');
      this.opacityLabel = document.getElementById('layerOpacityLabel');
      this.layerPanel = document.getElementById('layerPanel');

      // 绑定事件
      this._bindEvents();
      
      // 初始化
      this._initFromFrames();
    }

    // ---- 从帧数据初始化 ----
    _initFromFrames() {
      if (!this.anim || !this.anim.frames || this.anim.frames.length === 0) {
        this._initDefaultLayerForFrame(0);
        return;
      }
      
      for (let i = 0; i < this.anim.frames.length; i++) {
        if (!this.frameLayers[i]) {
          this._initDefaultLayerForFrame(i);
        }
      }
      this.currentFrameIndex = this.anim.current || 0;
      this.currentLayerIndex = 0;
      this._renderLayerList();
      this._syncToEngine();
      this._updateOpacityUI();
    }

    _initDefaultLayerForFrame(frameIndex) {
      const w = this.engine.width;
      const h = this.engine.height;
      const emptyPixels = new Array(w * h).fill(null);
      
      // 如果有帧数据，使用帧数据
      let pixels = emptyPixels.slice();
      if (this.anim && this.anim.frames && this.anim.frames[frameIndex]) {
        pixels = this.anim.frames[frameIndex].slice();
      }
      
      this.frameLayers[frameIndex] = [{
        id: this.nextId++,
        name: '图层 1',
        visible: true,
        opacity: 1,
        locked: false,
        pixels: pixels
      }];
    }

    // ---- 创建空白帧的图层（只有一个空图层） ----
    createBlankFrameLayers(frameIndex) {
      const w = this.engine.width;
      const h = this.engine.height;
      const emptyPixels = new Array(w * h).fill(null);
      
      this.frameLayers[frameIndex] = [{
        id: this.nextId++,
        name: '图层 1',
        visible: true,
        opacity: 1,
        locked: false,
        pixels: emptyPixels.slice()
      }];
      
      // 更新帧数据为空
      if (this.anim && this.anim.frames[frameIndex]) {
        this.anim.frames[frameIndex] = emptyPixels.slice();
      }
    }

    // ---- 复制帧的图层 ----
    duplicateFrameLayers(fromIndex, toIndex) {
      if (!this.frameLayers[fromIndex]) {
        this._initDefaultLayerForFrame(fromIndex);
      }
      
      this.frameLayers[toIndex] = this.frameLayers[fromIndex].map(layer => ({
        id: this.nextId++,
        name: layer.name,
        visible: layer.visible,
        opacity: layer.opacity,
        locked: layer.locked,
        pixels: layer.pixels.slice()
      }));
    }

    // ---- 切换帧时更新图层 ----
    switchToFrame(frameIndex) {
      if (frameIndex === this.currentFrameIndex && this.frameLayers[frameIndex]) {
        return;
      }
      
      // 保存当前帧的图层数据
      this._saveCurrentFrameLayers();
      
      this.currentFrameIndex = frameIndex;
      this.currentLayerIndex = 0;
      
      // 如果该帧还没有图层，创建默认图层
      if (!this.frameLayers[frameIndex]) {
        this._initDefaultLayerForFrame(frameIndex);
      }
      
      // 确保当前帧的像素与图层同步
      const layers = this.frameLayers[frameIndex];
      if (layers && layers.length > 0 && this.anim) {
        const composite = this._getCompositeForLayers(layers);
        this.anim.frames[frameIndex] = composite;
        this.engine.loadFrame(composite);
      }
      
      this._renderLayerList();
      this._syncToEngine();
      this._updateOpacityUI();
    }

    // ---- 保存当前帧图层 ----
    _saveCurrentFrameLayers() {
      if (this.frameLayers[this.currentFrameIndex]) {
        const layers = this.frameLayers[this.currentFrameIndex];
        if (layers && layers.length > 0) {
          // 更新当前图层的像素
          const currentLayer = this.getCurrentLayer();
          if (currentLayer) {
            currentLayer.pixels = this.engine.getPixels();
          }
          // 更新帧数据为合成结果
          if (this.anim) {
            const composite = this._getCompositeForLayers(layers);
            this.anim.frames[this.currentFrameIndex] = composite;
          }
        }
      }
    }

    // ---- 从帧数据同步（初始化时调用） ----
    _syncFromFrames(frames) {
      if (!frames) return;
      
      // 重建 frameLayers 索引
      const newFrameLayers = {};
      for (let i = 0; i < frames.length; i++) {
        if (this.frameLayers[i]) {
          // 保留已有图层
          newFrameLayers[i] = this.frameLayers[i].map(layer => ({
            ...layer,
            pixels: layer.pixels.slice()
          }));
        } else {
          // 从帧数据创建图层
          const pixels = frames[i] ? frames[i].slice() : new Array(this.engine.width * this.engine.height).fill(null);
          newFrameLayers[i] = [{
            id: this.nextId++,
            name: '图层 1',
            visible: true,
            opacity: 1,
            locked: false,
            pixels: pixels
          }];
        }
      }
      
      this.frameLayers = newFrameLayers;
      this.currentFrameIndex = this.anim.current || 0;
      this.currentLayerIndex = 0;
      this._renderLayerList();
      this._syncToEngine();
      this._updateOpacityUI();
    }

    // ---- 删除帧时清理图层 ----
    removeFrameLayers(frameIndex) {
      delete this.frameLayers[frameIndex];
      // 重新索引
      const newFrameLayers = {};
      let idx = 0;
      const keys = Object.keys(this.frameLayers).sort((a, b) => parseInt(a) - parseInt(b));
      for (const key of keys) {
        newFrameLayers[idx] = this.frameLayers[key];
        idx++;
      }
      this.frameLayers = newFrameLayers;
      this.currentFrameIndex = this.anim.current || 0;
      this.currentLayerIndex = 0;
    }

    // ---- 获取当前图层 ----
    getCurrentLayer() {
      const layers = this.frameLayers[this.currentFrameIndex];
      if (!layers || layers.length === 0) return null;
      if (this.currentLayerIndex >= layers.length) {
        this.currentLayerIndex = layers.length - 1;
      }
      return layers[this.currentLayerIndex] || null;
    }

    getCurrentLayers() {
      return this.frameLayers[this.currentFrameIndex] || [];
    }

    getCurrentPixels() {
      const layer = this.getCurrentLayer();
      return layer ? layer.pixels : null;
    }

    // ---- 合并指定图层的合成结果 ----
    _getCompositeForLayers(layers) {
      const w = this.engine.width;
      const h = this.engine.height;
      const result = new Array(w * h).fill(null);

      // 从下到上合并（后面的图层覆盖前面的）
      for (let i = layers.length - 1; i >= 0; i--) {
        const layer = layers[i];
        if (!layer.visible) continue;
        const pixels = layer.pixels;
        const opacity = layer.opacity;
        
        for (let j = 0; j < pixels.length; j++) {
          const color = pixels[j];
          if (color !== null) {
            // 如果有透明度且不是完全不透明，进行混合
            if (opacity < 1 && opacity > 0) {
              // 简单混合：如果已有颜色，用半透明覆盖
              // 对于像素艺术，我们直接使用颜色，透明度作为参考
              result[j] = color;
            } else {
              result[j] = color;
            }
          }
        }
      }
      return result;
    }

    // ---- 合并所有可见图层 ----
    getCompositePixels() {
      const layers = this.getCurrentLayers();
      if (!layers || layers.length === 0) {
        return new Array(this.engine.width * this.engine.height).fill(null);
      }
      return this._getCompositeForLayers(layers);
    }

    // ---- 同步到引擎 ----
    _syncToEngine() {
      const composite = this.getCompositePixels();
      this.engine.pixels = composite;
      this.engine.render();
    }

    // ---- 同步到帧 ----
    _syncToFrames() {
      if (!this.anim) return;
      const layers = this.getCurrentLayers();
      if (layers && layers.length > 0) {
        const composite = this._getCompositeForLayers(layers);
        this.anim.frames[this.anim.current] = composite;
      }
    }

    // ---- 添加图层 ----
    addLayer(name) {
      const w = this.engine.width;
      const h = this.engine.height;
      const emptyPixels = new Array(w * h).fill(null);
      
      const layers = this.getCurrentLayers();
      const layer = {
        id: this.nextId++,
        name: name || '图层 ' + (layers.length + 1),
        visible: true,
        opacity: 1,
        locked: false,
        pixels: emptyPixels.slice()
      };
      
      layers.push(layer);
      this.currentLayerIndex = layers.length - 1;
      
      this._syncToFrames();
      this._renderLayerList();
      this._syncToEngine();
      this._updateOpacityUI();
      
      return layer;
    }

    // ---- 复制图层 ----
    duplicateLayer() {
      const current = this.getCurrentLayer();
      if (!current) return;
      
      const layers = this.getCurrentLayers();
      const newLayer = {
        id: this.nextId++,
        name: current.name + ' (复制)',
        visible: current.visible,
        opacity: current.opacity,
        locked: false,
        pixels: current.pixels.slice()
      };
      
      const idx = layers.indexOf(current);
      layers.splice(idx + 1, 0, newLayer);
      this.currentLayerIndex = idx + 1;
      
      this._syncToFrames();
      this._renderLayerList();
      this._syncToEngine();
      this._updateOpacityUI();
    }

    // ---- 删除图层 ----
    deleteLayer() {
      const layers = this.getCurrentLayers();
      if (layers.length <= 1) {
        alert('至少保留一个图层');
        return;
      }
      
      // 删除当前图层，其像素被丢弃
      layers.splice(this.currentLayerIndex, 1);
      if (this.currentLayerIndex >= layers.length) {
        this.currentLayerIndex = layers.length - 1;
      }
      
      // 更新帧数据
      this._syncToFrames();
      this._renderLayerList();
      this._syncToEngine();
      this._updateOpacityUI();
    }

    // ---- 移动图层 ----
    moveLayerUp() {
      const layers = this.getCurrentLayers();
      if (this.currentLayerIndex >= layers.length - 1) return;
      const [layer] = layers.splice(this.currentLayerIndex, 1);
      layers.splice(this.currentLayerIndex + 1, 0, layer);
      this.currentLayerIndex++;
      this._syncToFrames();
      this._renderLayerList();
      this._syncToEngine();
    }

    moveLayerDown() {
      const layers = this.getCurrentLayers();
      if (this.currentLayerIndex <= 0) return;
      const [layer] = layers.splice(this.currentLayerIndex, 1);
      layers.splice(this.currentLayerIndex - 1, 0, layer);
      this.currentLayerIndex--;
      this._syncToFrames();
      this._renderLayerList();
      this._syncToEngine();
    }

    // ---- 合并图层（选择模式） ----
    mergeLayers() {
      const layers = this.getCurrentLayers();
      if (layers.length <= 1) {
        alert('至少有两个图层才能合并');
        return;
      }
      
      this._showMergeDialog(layers);
    }

    _showMergeDialog(layers) {
      const overlay = document.createElement('div');
      overlay.className = 'batch-modal';
      overlay.style.display = 'flex';
      overlay.style.zIndex = '500';
      
      const content = document.createElement('div');
      content.className = 'batch-modal-content';
      content.style.maxWidth = '400px';
      
      const header = document.createElement('div');
      header.className = 'batch-modal-header';
      header.innerHTML = '<span>选择要合并的图层（合并到最下层）</span>';
      
      const closeBtn = document.createElement('button');
      closeBtn.className = 'batch-modal-close';
      closeBtn.textContent = '×';
      closeBtn.onclick = () => overlay.remove();
      header.appendChild(closeBtn);
      content.appendChild(header);
      
      const list = document.createElement('div');
      list.className = 'batch-frame-list';
      list.style.gridTemplateColumns = '1fr';
      list.style.maxHeight = '300px';
      
      const selected = new Set();
      
      layers.forEach((layer, idx) => {
        const item = document.createElement('div');
        item.className = 'batch-frame-card';
        item.style.padding = '8px 12px';
        item.style.justifyContent = 'flex-start';
        item.style.gap = '12px';
        item.style.aspectRatio = 'auto';
        item.style.height = '40px';
        
        const thumb = document.createElement('canvas');
        thumb.width = 32;
        thumb.height = 32;
        const ctx = thumb.getContext('2d');
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, 32, 32);
        for (let y = 0; y < Math.min(this.engine.height, 8); y++) {
          for (let x = 0; x < Math.min(this.engine.width, 8); x++) {
            const color = layer.pixels[y * this.engine.width + x];
            if (color) {
              ctx.fillStyle = color;
              ctx.fillRect(x * 4, y * 4, 4, 4);
            }
          }
        }
        thumb.style.width = '32px';
        thumb.style.height = '32px';
        thumb.style.flexShrink = '0';
        item.appendChild(thumb);
        
        const label = document.createElement('span');
        label.textContent = layer.name;
        label.style.flex = '1';
        label.style.fontSize = '13px';
        item.appendChild(label);
        
        const check = document.createElement('div');
        check.className = 'check-mark';
        check.textContent = '✓';
        check.style.display = 'none';
        item.appendChild(check);
        
        item.addEventListener('click', () => {
          if (selected.has(idx)) {
            selected.delete(idx);
            item.classList.remove('selected');
            check.style.display = 'none';
          } else {
            selected.add(idx);
            item.classList.add('selected');
            check.style.display = 'flex';
          }
          updateBtn();
        });
        
        list.appendChild(item);
      });
      
      content.appendChild(list);
      
      const footer = document.createElement('div');
      footer.className = 'batch-modal-footer';
      
      const selectAllBtn = document.createElement('button');
      selectAllBtn.className = 'action-btn';
      selectAllBtn.textContent = '全选';
      selectAllBtn.onclick = () => {
        layers.forEach((_, idx) => {
          selected.add(idx);
        });
        list.querySelectorAll('.batch-frame-card').forEach((el) => {
          el.classList.add('selected');
          el.querySelector('.check-mark').style.display = 'flex';
        });
        updateBtn();
      };
      footer.appendChild(selectAllBtn);
      
      const confirmBtn = document.createElement('button');
      confirmBtn.className = 'action-btn primary';
      confirmBtn.textContent = '合并选中 (0)';
      const updateBtn = () => {
        confirmBtn.textContent = '合并选中 (' + selected.size + ')';
        confirmBtn.disabled = selected.size === 0;
      };
      updateBtn();
      
      confirmBtn.onclick = () => {
        if (selected.size === 0) return;
        this._doMerge(Array.from(selected).sort((a,b) => a - b));
        overlay.remove();
      };
      footer.appendChild(confirmBtn);
      
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'action-btn';
      cancelBtn.textContent = '取消';
      cancelBtn.onclick = () => overlay.remove();
      footer.appendChild(cancelBtn);
      
      content.appendChild(footer);
      overlay.appendChild(content);
      document.body.appendChild(overlay);
      
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
      });
    }

    _doMerge(indices) {
      const layers = this.getCurrentLayers();
      if (indices.length === 0) return;
      
      // 从下到上合并
      const targetIndex = Math.min(...indices);
      const merged = layers[targetIndex].pixels.slice();
      
      for (const idx of indices) {
        if (idx === targetIndex) continue;
        const layer = layers[idx];
        for (let i = 0; i < layer.pixels.length; i++) {
          if (layer.pixels[i] !== null) {
            merged[i] = layer.pixels[i];
          }
        }
      }
      
      layers[targetIndex].pixels = merged;
      layers[targetIndex].name = '合并图层';
      
      // 删除被合并的图层（从大到小删除）
      const sorted = indices.slice().sort((a,b) => b - a);
      for (const idx of sorted) {
        if (idx === targetIndex) continue;
        layers.splice(idx, 1);
        if (this.currentLayerIndex === idx) {
          this.currentLayerIndex = targetIndex;
        } else if (this.currentLayerIndex > idx) {
          this.currentLayerIndex--;
        }
      }
      
      if (this.currentLayerIndex >= layers.length) {
        this.currentLayerIndex = layers.length - 1;
      }
      
      this._syncToFrames();
      this._renderLayerList();
      this._syncToEngine();
      this._updateOpacityUI();
    }

    // ---- 切换可见性 ----
    toggleVisibility(index) {
      if (index === undefined) index = this.currentLayerIndex;
      const layers = this.getCurrentLayers();
      const layer = layers[index];
      if (!layer) return;
      layer.visible = !layer.visible;
      this._syncToFrames();
      this._renderLayerList();
      this._syncToEngine();
    }

    // ---- 选择图层 ----
    selectLayer(index) {
      const layers = this.getCurrentLayers();
      if (index < 0 || index >= layers.length) return;
      
      this.currentLayerIndex = index;
      
      const layer = layers[index];
      if (layer && this.anim) {
        this.anim.frames[this.anim.current] = layer.pixels.slice();
        this.engine.loadFrame(layer.pixels);
      }
      
      this._renderLayerList();
      this._syncToEngine();
      this._updateOpacityUI();
    }

    // ---- 更新不透明度 ----
    setOpacity(value) {
      const layer = this.getCurrentLayer();
      if (!layer) return;
      const val = Math.max(0, Math.min(1, value / 100));
      layer.opacity = val;
      this._syncToFrames();
      this._syncToEngine();
      if (this.opacityLabel) {
        this.opacityLabel.textContent = Math.round(value) + '%';
      }
    }

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
      const layers = this.getCurrentLayers();
      const layer = layers[index];
      if (!layer) return;
      layer.name = newName.trim() || '图层 ' + (index + 1);
      this._renderLayerList();
    }

    // ---- 显示/隐藏面板 ----
    setVisible(visible) {
      this.isVisible = visible;
      if (this.layerPanel) {
        this.layerPanel.style.display = visible ? 'block' : 'none';
      }
      if (visible) {
        this._renderLayerList();
        this._syncToEngine();
        this._updateOpacityUI();
      }
    }

    toggleVisible() {
      this.setVisible(!this.isVisible);
      return this.isVisible;
    }

    // ---- 渲染图层列表 ----
    _renderLayerList() {
      if (!this.layerList) return;
      
      this.layerList.innerHTML = '';
      
      const layers = this.getCurrentLayers();
      if (!layers || layers.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'layer-empty';
        empty.textContent = '暂无图层，点击 "新建" 创建';
        this.layerList.appendChild(empty);
        return;
      }
      
      // 从下到上显示（底部图层在列表底部）
      for (let i = layers.length - 1; i >= 0; i--) {
        const layer = layers[i];
        const item = this._createLayerItem(layer, i);
        this.layerList.appendChild(item);
      }
      
      this._highlightCurrent();
    }

    // ---- 创建图层 DOM ----
    _createLayerItem(layer, index) {
      const item = document.createElement('div');
      item.className = 'layer-item' + (index === this.currentLayerIndex ? ' active' : '');
      item.dataset.index = index;
      
      // 可见性
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
            ctx.fillStyle = color;
            ctx.fillRect(x * ps, y * ps, ps, ps);
          }
        }
      }
      item.appendChild(thumb);
      
      // 图层名称（可编辑）
      const nameSpan = document.createElement('span');
      nameSpan.className = 'layer-name';
      nameSpan.textContent = layer.name;
      nameSpan.title = '双击重命名';
      
      // 重命名按钮
      const renameBtn = document.createElement('button');
      renameBtn.className = 'layer-rename-btn';
      renameBtn.innerHTML = '✎';
      renameBtn.title = '重命名图层';
      renameBtn.style.cssText = 'background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:12px;padding:0 4px;';
      renameBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._startRename(index);
      });
      
      nameSpan.addEventListener('dblclick', () => {
        this._startRename(index);
      });
      
      const nameWrapper = document.createElement('span');
      nameWrapper.style.cssText = 'display:flex;align-items:center;flex:1;gap:2px;';
      nameWrapper.appendChild(nameSpan);
      nameWrapper.appendChild(renameBtn);
      item.appendChild(nameWrapper);
      
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
      
      return item;
    }

    _startRename(index) {
      const layers = this.getCurrentLayers();
      const layer = layers[index];
      if (!layer) return;
      
      const items = this.layerList.querySelectorAll('.layer-item');
      const item = items[layers.length - 1 - index];
      if (!item) return;
      
      const nameWrapper = item.querySelector('.layer-name')?.parentElement;
      if (!nameWrapper) return;
      
      const input = document.createElement('input');
      input.className = 'layer-name-input';
      input.type = 'text';
      input.value = layer.name;
      input.maxLength = 20;
      input.style.cssText = 'flex:1;font-size:12px;font-weight:500;background:transparent;border:none;outline:none;color:var(--text);padding:0;font-family:inherit;border-bottom:1px solid var(--primary);';
      
      const oldSpan = nameWrapper.querySelector('.layer-name');
      const oldBtn = nameWrapper.querySelector('.layer-rename-btn');
      if (oldSpan) oldSpan.style.display = 'none';
      if (oldBtn) oldBtn.style.display = 'none';
      nameWrapper.insertBefore(input, oldBtn || null);
      input.focus();
      input.select();
      
      const finish = () => {
        const newName = input.value.trim() || '图层 ' + (index + 1);
        this.renameLayer(index, newName);
        if (oldSpan) oldSpan.style.display = '';
        if (oldBtn) oldBtn.style.display = '';
        input.remove();
      };
      
      input.addEventListener('blur', finish);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { input.blur(); }
        if (e.key === 'Escape') { 
          input.value = layer.name;
          input.blur();
        }
      });
    }

    _highlightCurrent() {
      const items = this.layerList.querySelectorAll('.layer-item');
      const layers = this.getCurrentLayers();
      items.forEach((item, idx) => {
        const actualIndex = layers.length - 1 - idx;
        item.classList.toggle('active', actualIndex === this.currentLayerIndex);
      });
    }

    // ---- 调整画布尺寸 ----
    resize(newW, newH) {
      const oldW = this.engine.width;
      const oldH = this.engine.height;
      
      for (const frameIndex in this.frameLayers) {
        const layers = this.frameLayers[frameIndex];
        for (const layer of layers) {
          const newPixels = new Array(newW * newH).fill(null);
          for (let y = 0; y < newH; y++) {
            for (let x = 0; x < newW; x++) {
              const ox = Math.floor(x * oldW / newW);
              const oy = Math.floor(y * oldH / newH);
              newPixels[y * newW + x] = layer.pixels[oy * oldW + ox];
            }
          }
          layer.pixels = newPixels;
        }
        // 更新帧数据
        if (this.anim && this.anim.frames[parseInt(frameIndex)]) {
          const composite = this._getCompositeForLayers(layers);
          this.anim.frames[parseInt(frameIndex)] = composite;
        }
      }
      
      this._renderLayerList();
      this._syncToEngine();
    }

    // ---- 绑定事件 ----
    _bindEvents() {
      const addBtn = document.getElementById('btnAddLayer');
      if (addBtn) {
        addBtn.addEventListener('click', () => {
          this.addLayer();
        });
      }
      
      const dupBtn = document.getElementById('btnDupLayer');
      if (dupBtn) {
        dupBtn.addEventListener('click', () => {
          this.duplicateLayer();
        });
      }
      
      const delBtn = document.getElementById('btnDelLayer');
      if (delBtn) {
        delBtn.addEventListener('click', () => {
          this.deleteLayer();
        });
      }
      
      const upBtn = document.getElementById('btnLayerUp');
      if (upBtn) {
        upBtn.addEventListener('click', () => {
          this.moveLayerUp();
        });
      }
      
      const downBtn = document.getElementById('btnLayerDown');
      if (downBtn) {
        downBtn.addEventListener('click', () => {
          this.moveLayerDown();
        });
      }
      
      const mergeBtn = document.getElementById('btnMergeLayer');
      if (mergeBtn) {
        mergeBtn.addEventListener('click', () => {
          this.mergeLayers();
        });
      }
      
      if (this.opacitySlider) {
        this.opacitySlider.addEventListener('input', () => {
          const val = parseInt(this.opacitySlider.value);
          this.setOpacity(val);
        });
      }
    }
  }

  window.LayerSystem = LayerSystem;

})();