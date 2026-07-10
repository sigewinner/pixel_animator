// public/js/layer-system.js - 图层系统
// 功能：多图层管理、可见性、不透明度、合并、排序

(function() {
  'use strict';

  // ---- 图层数据结构 ----
  // 每个图层：{ id, name, visible, opacity, pixels: [...], locked }

  class LayerSystem {
    constructor(engine, anim) {
      this.engine = engine;
      this.anim = anim;
      this.layers = [];
      this.currentLayerIndex = 0;
      this.nextId = 1;

      // DOM 引用
      this.layerList = document.getElementById('layerList');
      this.opacitySlider = document.getElementById('layerOpacitySlider');
      this.opacityLabel = document.getElementById('layerOpacityLabel');

      // 绑定事件
      this._bindEvents();

      // 初始化：创建一个默认图层
      this._initDefaultLayer();
    }

    // ---- 初始化 ----
    _initDefaultLayer() {
      const w = this.engine.width;
      const h = this.engine.height;
      const emptyPixels = new Array(w * h).fill(null);
      
      this.layers = [{
        id: this.nextId++,
        name: '图层 1',
        visible: true,
        opacity: 1,
        locked: false,
        pixels: emptyPixels.slice()
      }];
      this.currentLayerIndex = 0;
      this._renderLayerList();
      this._syncToEngine();
    }

    // ---- 获取当前图层 ----
    getCurrentLayer() {
      return this.layers[this.currentLayerIndex] || null;
    }

    getCurrentPixels() {
      const layer = this.getCurrentLayer();
      return layer ? layer.pixels : null;
    }

    // ---- 合并所有可见图层 ----
    getCompositePixels() {
      const w = this.engine.width;
      const h = this.engine.height;
      const result = new Array(w * h).fill(null);

      // 从上到下合并（后面的图层覆盖前面的）
      for (let i = this.layers.length - 1; i >= 0; i--) {
        const layer = this.layers[i];
        if (!layer.visible) continue;
        
        const pixels = layer.pixels;
        const opacity = layer.opacity;
        
        for (let j = 0; j < pixels.length; j++) {
          const color = pixels[j];
          if (color === null) continue;
          
          if (opacity < 1) {
            // 简单透明度混合（只对非透明像素）
            const existing = result[j];
            if (existing === null) {
              result[j] = color;
            }
            // 如果已有颜色，简单覆盖（不混合，保持像素风格）
            // 为了更接近真实图层，用半透明混合
            // 但像素艺术中通常不混合，这里简单处理
          } else {
            result[j] = color;
          }
        }
      }

      return result;
    }

    // ---- 同步到引擎 ----
    _syncToEngine() {
      const composite = this.getCompositePixels();
      // 更新引擎的 pixels 为合成结果
      this.engine.pixels = composite;
      this.engine.render();
    }

    // ---- 添加图层 ----
    addLayer(name) {
      const w = this.engine.width;
      const h = this.engine.height;
      const emptyPixels = new Array(w * h).fill(null);
      
      const layer = {
        id: this.nextId++,
        name: name || '图层 ' + this.layers.length,
        visible: true,
        opacity: 1,
        locked: false,
        pixels: emptyPixels.slice()
      };
      
      // 添加到最上面
      this.layers.push(layer);
      this.currentLayerIndex = this.layers.length - 1;
      
      this._renderLayerList();
      this._syncToEngine();
      this._updateOpacityUI();
      
      return layer;
    }

    // ---- 复制图层 ----
    duplicateLayer() {
      const current = this.getCurrentLayer();
      if (!current) return;
      
      const newLayer = {
        id: this.nextId++,
        name: current.name + ' (复制)',
        visible: current.visible,
        opacity: current.opacity,
        locked: false,
        pixels: current.pixels.slice()
      };
      
      this.layers.splice(this.currentLayerIndex + 1, 0, newLayer);
      this.currentLayerIndex++;
      
      this._renderLayerList();
      this._syncToEngine();
      this._updateOpacityUI();
    }

    // ---- 删除图层 ----
    deleteLayer() {
      if (this.layers.length <= 1) {
        alert('至少保留一个图层');
        return;
      }
      
      this.layers.splice(this.currentLayerIndex, 1);
      if (this.currentLayerIndex >= this.layers.length) {
        this.currentLayerIndex = this.layers.length - 1;
      }
      
      this._renderLayerList();
      this._syncToEngine();
      this._updateOpacityUI();
    }

    // ---- 移动图层 ----
    moveLayerUp() {
      if (this.currentLayerIndex >= this.layers.length - 1) return;
      const [layer] = this.layers.splice(this.currentLayerIndex, 1);
      this.layers.splice(this.currentLayerIndex + 1, 0, layer);
      this.currentLayerIndex++;
      this._renderLayerList();
      this._syncToEngine();
    }

    moveLayerDown() {
      if (this.currentLayerIndex <= 0) return;
      const [layer] = this.layers.splice(this.currentLayerIndex, 1);
      this.layers.splice(this.currentLayerIndex - 1, 0, layer);
      this.currentLayerIndex--;
      this._renderLayerList();
      this._syncToEngine();
    }

    // ---- 合并向下 ----
    mergeDown() {
      if (this.currentLayerIndex <= 0) {
        alert('没有下层图层可合并');
        return;
      }
      
      const current = this.getCurrentLayer();
      const below = this.layers[this.currentLayerIndex - 1];
      
      if (!current || !below) return;
      
      // 合并：下面的图层被上面的覆盖
      const w = this.engine.width;
      const h = this.engine.height;
      const merged = below.pixels.slice();
      
      for (let i = 0; i < current.pixels.length; i++) {
        if (current.pixels[i] !== null) {
          merged[i] = current.pixels[i];
        }
      }
      
      below.pixels = merged;
      below.name = below.name + ' (合并)';
      
      // 删除当前图层
      this.layers.splice(this.currentLayerIndex, 1);
      this.currentLayerIndex--;
      
      this._renderLayerList();
      this._syncToEngine();
      this._updateOpacityUI();
    }

    // ---- 切换可见性 ----
    toggleVisibility(index) {
      if (index === undefined) index = this.currentLayerIndex;
      const layer = this.layers[index];
      if (!layer) return;
      layer.visible = !layer.visible;
      this._renderLayerList();
      this._syncToEngine();
    }

    // ---- 选择图层 ----
    selectLayer(index) {
      if (index < 0 || index >= this.layers.length) return;
      // 保存当前图层的内容
      const current = this.getCurrentLayer();
      if (current) {
        current.pixels = this.engine.pixels.slice();
      }
      
      this.currentLayerIndex = index;
      this._renderLayerList();
      this._syncToEngine();
      this._updateOpacityUI();
    }

    // ---- 更新不透明度 ----
    setOpacity(value) {
      const layer = this.getCurrentLayer();
      if (!layer) return;
      layer.opacity = Math.max(0, Math.min(1, value / 100));
      this._syncToEngine();
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
      this._renderLayerList();
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
      
      // 高亮当前图层
      this._highlightCurrent();
    }

    // ---- 创建图层 DOM 元素 ----
    _createLayerItem(layer, index) {
      const item = document.createElement('div');
      item.className = 'layer-item' + (index === this.currentLayerIndex ? ' active' : '');
      item.dataset.index = index;
      
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
      // 绘制棋盘格背景
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if ((x + y) % 2 === 0) {
            ctx.fillStyle = '#2a2a3e';
            ctx.fillRect(x * ps, y * ps, ps, ps);
          }
        }
      }
      // 绘制像素
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
      
      // 更新当前索引
      if (this.currentLayerIndex === from) {
        this.currentLayerIndex = to;
      } else if (from < this.currentLayerIndex && to >= this.currentLayerIndex) {
        this.currentLayerIndex--;
      } else if (from > this.currentLayerIndex && to <= this.currentLayerIndex) {
        this.currentLayerIndex++;
      }
      
      this._renderLayerList();
      this._syncToEngine();
    }

    // ---- 高亮当前图层 ----
    _highlightCurrent() {
      const items = this.layerList.querySelectorAll('.layer-item');
      items.forEach((item, idx) => {
        const actualIndex = this.layers.length - 1 - idx;
        item.classList.toggle('active', actualIndex === this.currentLayerIndex);
      });
    }

    // ---- 调整画布尺寸 ----
    resize(newW, newH) {
      const oldW = this.engine.width;
      const oldH = this.engine.height;
      
      for (const layer of this.layers) {
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
      
      this._renderLayerList();
      this._syncToEngine();
    }

    // ---- 绑定事件 ----
    _bindEvents() {
      // 新建图层
      const addBtn = document.getElementById('btnAddLayer');
      if (addBtn) {
        addBtn.addEventListener('click', () => {
          this.addLayer();
        });
      }
      
      // 复制图层
      const dupBtn = document.getElementById('btnDupLayer');
      if (dupBtn) {
        dupBtn.addEventListener('click', () => {
          this.duplicateLayer();
        });
      }
      
      // 删除图层
      const delBtn = document.getElementById('btnDelLayer');
      if (delBtn) {
        delBtn.addEventListener('click', () => {
          this.deleteLayer();
        });
      }
      
      // 上移
      const upBtn = document.getElementById('btnLayerUp');
      if (upBtn) {
        upBtn.addEventListener('click', () => {
          this.moveLayerUp();
        });
      }
      
      // 下移
      const downBtn = document.getElementById('btnLayerDown');
      if (downBtn) {
        downBtn.addEventListener('click', () => {
          this.moveLayerDown();
        });
      }
      
      // 合并
      const mergeBtn = document.getElementById('btnMergeLayer');
      if (mergeBtn) {
        mergeBtn.addEventListener('click', () => {
          this.mergeDown();
        });
      }
      
      // 不透明度滑块
      if (this.opacitySlider) {
        this.opacitySlider.addEventListener('input', () => {
          const val = parseInt(this.opacitySlider.value);
          this.setOpacity(val);
        });
      }
    }

    // ---- 从帧数据恢复图层 ----
    // 如果从已有项目加载，用帧数据初始化图层
    loadFromFrames(frames) {
      if (!frames || frames.length === 0) return;
      
      this.layers = [];
      this.nextId = 1;
      
      for (let i = 0; i < frames.length; i++) {
        this.layers.push({
          id: this.nextId++,
          name: '图层 ' + (i + 1),
          visible: true,
          opacity: 1,
          locked: false,
          pixels: frames[i].slice()
        });
      }
      
      this.currentLayerIndex = 0;
      this._renderLayerList();
      this._syncToEngine();
      this._updateOpacityUI();
    }

    // ---- 获取所有图层数据（用于保存） ----
    getLayerData() {
      return this.layers.map(layer => ({
        id: layer.id,
        name: layer.name,
        visible: layer.visible,
        opacity: layer.opacity,
        pixels: layer.pixels.slice()
      }));
    }
  }

  // ---- 导出 ----
  window.LayerSystem = LayerSystem;

})();