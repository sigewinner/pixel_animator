// public/js/app.js - 编排层
// 职责：核心共享状态、全局快照/撤销、初始化与模块调度。
// 具体功能（调色板、工具栏、帧、导入、导出、画布尺寸、批量操作）拆分到 js/modules/*。
(function () {
  var PA = window.PA = window.PA || {};

  // ---- 共享可变状态（所有模块通过 PA.state 读写） ----
  var S = PA.state = {
    engine: null,
    anim: null,
    layerSystem: null,
    canvasW: 32,
    canvasH: 32,
    zoomLevel: 1.0,
    basePixelSize: 16,
    customColors: [],
    tempPalette: [],
    selectedColor: '#000000',
    isDeletingColor: false,
    undoStack: [],
    redoStack: [],
    saveTimeout: null,
    isSaving: false,
    batchSelected: new Set(),
    batchMode: 'export', // 'export' | 'delete'
    colorWheel: null,
    frameClipboard: null,  // 帧复制剪贴板（像素数组）
    layerClipboard: null,  // 图层复制剪贴板（含所有帧像素）
  };
  try { S.customColors = JSON.parse(localStorage.getItem('pa_custom_colors') || '[]'); } catch (e) { S.customColors = []; }

  PA.DEFAULT_PALETTE = [
    '#000000', '#ffffff', '#7f7f7f', '#c3c3c3',
    '#ed1c24', '#ff7f27', '#fff200', '#22b14c',
    '#00a2e8', '#3f48cc', '#a349a4', '#ec1c8a',
    '#b97a57', '#ffaec9', '#ffc90e', '#efe4b0',
    '#b5e61d', '#99d9ea', '#7092be', '#c8bfe7',
  ];
  PA.MAX_HISTORY = 100;
  PA.MAX_TEMP_COLORS = 10;

  // ---- 尺寸计算 ----
  function computePixelSize(w, h) {
    var maxDim = Math.max(w, h);
    var ps = Math.floor(512 / maxDim);
    return Math.max(4, Math.min(32, ps));
  }
  function computeDims(resolution, ratioKey) {
    var parts = ratioKey.split(':').map(Number);
    var rw = parts[0], rh = parts[1];
    var w, h;
    if (rw >= rh) { w = resolution; h = Math.round(resolution * rh / rw); }
    else { h = resolution; w = Math.round(resolution * rw / rh); }
    return { w: w, h: h };
  }
  PA.computePixelSize = computePixelSize;
  PA.computeDims = computeDims;

  // ---- 调色板数据 ----
  function getActivePalette() { return PA.DEFAULT_PALETTE.concat(S.customColors); }
  PA.getActivePalette = getActivePalette;

  // ---- 快照历史（全局：包含图层数据与所有帧） ----
  function saveSnapshot() {
    return {
      width: S.engine.width,
      height: S.engine.height,
      frames: S.anim.frames.map(function (f) { return f.slice(); }),
      current: S.anim.current,
      penSize: S.engine.penSize,
      eraserSize: S.engine.eraserSize,
      layers: (S.layerSystem ? S.layerSystem.getSnapshot() : null)
    };
  }

  function pushSnapshot() {
    S.redoStack = [];
    var snap = saveSnapshot();
    S.undoStack.push(snap);
    if (S.undoStack.length > PA.MAX_HISTORY) S.undoStack.shift();
  }

  // 撤销：栈中保存的是「每次操作之后的状态」（各操作在变更后调用 pushSnapshot）。
  // 因此撤销 = 回退到栈中倒数第二个状态；当前状态移入重做栈。
  function undoOperation() {
    if (S.undoStack.length < 2) return false;
    var current = S.undoStack.pop();
    S.redoStack.push(current);
    var prev = S.undoStack.pop();
    S.undoStack.push(prev);
    restoreSnapshot(prev);
    return true;
  }

  // 重做：把重做栈顶状态恢复回去
  function redoOperation() {
    if (S.redoStack.length === 0) return false;
    var redoState = S.redoStack.pop();
    S.undoStack.push(redoState);
    restoreSnapshot(redoState);
    return true;
  }

  function restoreSnapshot(snap) {
    S.anim.frames = snap.frames.map(function (f) { return f.slice(); });
    if (snap.current != null) S.anim.current = snap.current;
    if (S.anim.current >= S.anim.frames.length) S.anim.current = S.anim.frames.length - 1;
    if (S.anim.current < 0) S.anim.current = 0;

    if (snap.width && snap.height && (S.engine.width !== snap.width || S.engine.height !== snap.height)) {
      var ps = computePixelSize(snap.width, snap.height);
      S.basePixelSize = ps;
      S.engine.resize(snap.width, snap.height, ps);
      S.anim.width = snap.width;
      S.anim.height = snap.height;
      S.canvasW = snap.width;
      S.canvasH = snap.height;
      updateSizeDisplay();
      updateZoomLabel();
      renderFrameList();
    }

    if (snap.layers && S.layerSystem) {
      S.layerSystem.restoreSnapshot(snap.layers);
    } else if (S.layerSystem) {
      S.layerSystem.reinitFromAnim();
      S.engine.loadFrame(S.anim.frames[S.anim.current]);
    } else {
      S.engine.loadFrame(S.anim.frames[S.anim.current]);
    }

    // 恢复画笔 / 橡皮大小（含滑块 UI）
    if (snap.penSize != null) {
      S.engine.setPenSize(snap.penSize);
      S.engine.setEraserSize(snap.eraserSize != null ? snap.eraserSize : S.engine.eraserSize);
      var penSlider = document.getElementById('penSizeSlider');
      if (penSlider) {
        penSlider.value = snap.penSize;
        var penLbl = document.getElementById('penSizeLabel');
        if (penLbl) penLbl.textContent = snap.penSize + 'px';
      }
      var erSlider = document.getElementById('eraserSizeSlider');
      if (erSlider) {
        erSlider.value = snap.eraserSize;
        var erLbl = document.getElementById('eraserSizeLabel');
        if (erLbl) erLbl.textContent = snap.eraserSize + 'px';
      }
    }

    S.anim._renderOnion();
    renderFrameList();
    S.engine.history = [];
    S.engine.future = [];
  }
  PA.saveSnapshot = saveSnapshot;
  PA.pushSnapshot = pushSnapshot;
  PA.undoOperation = undoOperation;
  PA.redoOperation = redoOperation;
  PA.restoreSnapshot = restoreSnapshot;

  // ---- 复制 / 粘贴（作用于图层与帧动画） ----
  // Ctrl+C：同时复制当前帧（像素）与当前图层（含所有帧像素）到各自剪贴板
  function copySelection() {
    S.anim.syncCurrentFrame();
    S.frameClipboard = S.anim.frames[S.anim.current].slice();

    if (S.layerSystem) {
      var ls = S.layerSystem;
      var idx = ls.currentLayerIndex;
      var layer = ls.layers[idx];
      if (layer) {
        S.layerClipboard = {
          name: layer.name,
          visible: layer.visible,
          opacity: layer.opacity,
          locked: layer.locked,
          framePixelData: ls.framePixelData.map(function (f) {
            return f[idx] ? f[idx].slice() : null;
          })
        };
      }
    }
  }

  // Ctrl+V：图层面板打开时粘贴图层，否则粘贴帧
  function pasteSelection() {
    var layerPanel = document.getElementById('layerPanel');
    var layerOpen = !!(layerPanel && layerPanel.style.display && layerPanel.style.display !== 'none');
    if (layerOpen) {
      if (S.layerSystem && S.layerClipboard) pasteLayer();
      else alert('图层剪贴板为空，无法粘贴图层。');
    } else {
      if (S.frameClipboard) pasteFrame();
      else alert('帧剪贴板为空，无法粘贴帧。');
    }
  }

  function pasteFrame() {
    if (!S.frameClipboard) { alert('帧剪贴板为空，无法粘贴帧。'); return; }
    var at = S.anim.current;
    var copied = S.frameClipboard.slice();

    // 1) 插入复制的帧到动画序列
    S.anim.frames.splice(at + 1, 0, copied);

    // 2) 在图层系统中插入对应帧：空图层缓冲 + 把复制像素写入最底层，保证合成图正确
    if (S.layerSystem) {
      var ls = S.layerSystem;
      var w = ls.engine.width, h = ls.engine.height;
      var emptyLayers = ls.layers.map(function () { return new Array(w * h).fill(null); });
      ls.framePixelData.splice(at + 1, 0, emptyLayers);
      ls.framePixelData[at + 1][0] = copied;
      ls.loadFrameLayers(at + 1);
    }

    S.anim.current = at + 1;
    S.engine.loadFrame(S.anim.frames[at + 1]);
    S.anim._renderOnion();
    pushSnapshot();
    PA.renderFrameList();
    PA.autoSave();
  }

  function pasteLayer() {
    if (!S.layerClipboard) { alert('图层剪贴板为空，无法粘贴图层。'); return; }
    var ls = S.layerSystem;
    var cb = S.layerClipboard;
    var w = ls.engine.width, h = ls.engine.height;

    var newLayer = {
      id: ls.nextId++,
      name: cb.name + ' (副本)',
      visible: cb.visible,
      opacity: cb.opacity,
      locked: false,
      pixels: null
    };
    ls.layers.splice(ls.currentLayerIndex + 1, 0, newLayer);
    ls.currentLayerIndex += 1;

    // 按当前帧数对齐插入，缺失帧补空、多余帧忽略
    for (var f = 0; f < ls.framePixelData.length; f++) {
      var src = (cb.framePixelData[f]) ? cb.framePixelData[f].slice() : new Array(w * h).fill(null);
      ls.framePixelData[f].splice(ls.currentLayerIndex, 0, src);
    }

    ls._wireLiveRefs();
    ls._activateLayerInEngine();
    ls._afterChange(); // 触发 onChange => pushSnapshot，使粘贴可撤销
  }

  PA.copySelection = copySelection;
  PA.pasteSelection = pasteSelection;
  PA.pasteFrame = pasteFrame;
  PA.pasteLayer = pasteLayer;

  // ---- 颜色标准化 ----
  function normalizeColor(color) {
    if (!color || typeof color !== 'string') return null;
    var hex = color.trim().toLowerCase();
    if (hex.startsWith('#')) hex = hex.slice(1);
    if (hex.length === 3) hex = hex.split('').map(function (c) { return c + c; }).join('');
    if (hex.length === 6) return '#' + hex;
    return null;
  }
  function normalizeFrame(frame) {
    if (!frame) return;
    for (var i = 0; i < frame.length; i++) {
      if (frame[i] !== null) {
        var norm = normalizeColor(frame[i]);
        if (norm !== null) frame[i] = norm;
      }
    }
  }
  PA.normalizeColor = normalizeColor;
  PA.normalizeFrame = normalizeFrame;

  // ---- 切换铅笔工具 ----
  function switchToPencil() {
    document.querySelectorAll('[data-tool]').forEach(function (b) { b.classList.remove('active'); });
    var pencil = document.querySelector('[data-tool="pencil"]');
    if (pencil) pencil.classList.add('active');
    S.engine.setTool('pencil');
    var eraserSizeControl = document.getElementById('eraserSizeControl');
    if (eraserSizeControl) eraserSizeControl.style.display = 'none';
    var penSizeControl = document.getElementById('penSizeControl');
    if (penSizeControl) penSizeControl.style.display = 'flex';
    S.isDeletingColor = false;
  }
  PA.switchToPencil = switchToPencil;

  // ---- 项目草稿保存 ----
  function getCurrentProjectData() {
    S.anim.syncCurrentFrame();
    for (var i = 0; i < S.anim.frames.length; i++) normalizeFrame(S.anim.frames[i]);
    return {
      title: document.getElementById('workTitle').value.trim() || '未命名作品',
      author: document.getElementById('workAuthor').value.trim() || '匿名',
      width: S.engine.width,
      height: S.engine.height,
      fps: S.anim.fps,
      frames: S.anim.getAllFrames(),
      currentFrame: S.anim.current,
      palette: getActivePalette(),
      customColors: S.customColors,
      thumbnail: S.anim.getThumbnail(),
      layerData: (S.layerSystem ? S.layerSystem.getSnapshot() : null),
      savedAt: new Date().toISOString(),
    };
  }

  async function saveProjectToServer(showMessage) {
    if (showMessage === undefined) showMessage = false;
    if (S.isSaving) return;
    S.isSaving = true;

    var user = Auth.getCurrentUser();
    if (!user) {
      try {
        localStorage.setItem('pa_local_project', JSON.stringify(getCurrentProjectData()));
        if (showMessage) alert('草稿已保存到本地（未登录）');
      } catch (e) {}
      S.isSaving = false;
      return;
    }

    try {
      var res = await fetch('/api/project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-username': user.username },
        body: JSON.stringify({ project: getCurrentProjectData() }),
      });
      var data = await res.json();
      if (data.ok) {
        if (showMessage) alert('项目已保存到云端！');
      } else {
        throw new Error(data.error || '保存失败');
      }
    } catch (err) {
      console.error('保存失败:', err);
      if (showMessage) alert('保存失败，已保存到本地缓存');
      try { localStorage.setItem('pa_local_project', JSON.stringify(getCurrentProjectData())); } catch (e) {}
    }
    S.isSaving = false;
  }

  function saveDraftLocally(showMessage) {
    if (showMessage === undefined) showMessage = true;
    try {
      localStorage.setItem('pa_local_project', JSON.stringify(getCurrentProjectData()));
      if (showMessage) alert('草稿已保存到本地！');
    } catch (e) {
      alert('保存草稿失败');
    }
  }

  function autoSave() {
    if (S.saveTimeout) clearTimeout(S.saveTimeout);
    S.saveTimeout = setTimeout(function () {
      saveProjectToServer(false);
      S.saveTimeout = null;
    }, 1000);
  }

  // ---- 加载草稿 ----
  async function loadProject() {
    var user = Auth.getCurrentUser();
    var project = null;

    if (user) {
      try {
        var res = await fetch('/api/project', { headers: { 'x-username': user.username } });
        var data = await res.json();
        if (data.ok && data.project) project = data.project;
      } catch (e) {}
    }

    if (!project) {
      try {
        var local = localStorage.getItem('pa_local_project');
        if (local) project = JSON.parse(local);
      } catch (e) {}
    }

    if (project) {
      var width = project.width, height = project.height, frames = project.frames, currentFrame = project.currentFrame, fps = project.fps;
      S.canvasW = width;
      S.canvasH = height;
      var newPixelSize = computePixelSize(width, height);
      S.engine.resize(width, height, newPixelSize);
      S.anim.resize(width, height);
      S.anim.frames = frames.map(function (f) {
        var newFrame = f.slice();
        normalizeFrame(newFrame);
        return newFrame;
      });
      // 暂存图层数据，待 LayerSystem 创建后恢复（保持与帧一致）
      window.__pendingLayerData = project.layerData || null;
      S.anim.current = currentFrame || 0;
      S.anim.fps = fps || 12;
      document.getElementById('workTitle').value = project.title || '';
      document.getElementById('workAuthor').value = project.author || '';
      document.getElementById('fpsSlider').value = S.anim.fps;
      document.getElementById('fpsLabel').textContent = S.anim.fps + ' FPS';
      syncSizeSelectors(width, height);
      S.engine.loadFrame(S.anim.frames[S.anim.current]);
      S.anim._renderOnion();
      if (project.customColors) {
        S.customColors = project.customColors;
        localStorage.setItem('pa_custom_colors', JSON.stringify(S.customColors));
        PA.Palette.buildPalette();
      }
      renderFrameList();
      updateSizeDisplay();
      updateZoomLabel();
      PA.Palette.renderTempPalette();
      // 清空历史
      S.undoStack = [];
      S.redoStack = [];
      return true;
    }
    return false;
  }
  PA.getCurrentProjectData = getCurrentProjectData;
  PA.saveProjectToServer = saveProjectToServer;
  PA.saveDraftLocally = saveDraftLocally;
  PA.autoSave = autoSave;
  PA.loadProject = loadProject;

  // ---- 帧列表渲染 ----
  function renderFrameList() {
    var list = document.getElementById('frameList');
    list.innerHTML = '';

    if (S.anim.frames.length === 0) {
      var emptyMsg = document.createElement('div');
      emptyMsg.className = 'empty-frames-msg';
      emptyMsg.textContent = '暂无帧，点击 "新帧" 创建';
      list.appendChild(emptyMsg);
      autoSave();
      return;
    }

    var w = S.engine.width, h = S.engine.height;
    var thumbPs = Math.max(1, Math.ceil(48 / Math.max(w, h)));

    S.anim.frames.forEach(function (frame, i) {
      var item = document.createElement('div');
      item.className = 'frame-item' + (i === S.anim.current ? ' active' : '');
      item.draggable = true;
      item.dataset.index = i;

      item.addEventListener('dragstart', function (e) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(i));
        setTimeout(function () { item.classList.add('dragging'); }, 0);
      });

      item.addEventListener('dragend', function () {
        item.classList.remove('dragging');
        document.querySelectorAll('.frame-item.drag-over').forEach(function (el) { el.classList.remove('drag-over'); });
      });

      item.addEventListener('dragover', function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        document.querySelectorAll('.frame-item.drag-over').forEach(function (el) { if (el !== item) el.classList.remove('drag-over'); });
        item.classList.add('drag-over');
      });

      item.addEventListener('dragleave', function () { item.classList.remove('drag-over'); });

      item.addEventListener('drop', function (e) {
        e.preventDefault();
        item.classList.remove('drag-over');
        var fromIndex = parseInt(e.dataTransfer.getData('text/plain'));
        var toIndex = parseInt(item.dataset.index);
        if (fromIndex !== toIndex && !isNaN(fromIndex) && !isNaN(toIndex)) {
          S.anim.moveFrame(fromIndex, toIndex);
          renderFrameList();
          var activeItem = list.querySelector('.frame-item.active');
          if (activeItem) activeItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      });

      var thumb = document.createElement('canvas');
      thumb.width = w * thumbPs;
      thumb.height = h * thumbPs;
      var ctx = thumb.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, thumb.width, thumb.height);
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          var c = frame[y * w + x];
          if (c) { ctx.fillStyle = c; ctx.fillRect(x * thumbPs, y * thumbPs, thumbPs, thumbPs); }
        }
      }
      var img = document.createElement('img');
      img.src = thumb.toDataURL();
      img.draggable = false;
      item.appendChild(img);

      var label = document.createElement('span');
      label.textContent = (i + 1);
      item.appendChild(label);

      var dragHint = document.createElement('span');
      dragHint.className = 'drag-hint';
      dragHint.textContent = '⠿';
      dragHint.title = '拖拽排序';
      item.appendChild(dragHint);

      item.addEventListener('click', function () { S.anim.selectFrame(i); });
      list.appendChild(item);
    });
    autoSave();
  }

  function updateFrameListSelection(index) {
    document.querySelectorAll('.frame-item').forEach(function (el, i) {
      el.classList.toggle('active', i === index);
    });
  }
  PA.renderFrameList = renderFrameList;
  PA.updateFrameListSelection = updateFrameListSelection;

  // ---- 尺寸 UI ----
  function updateSizeDisplay() {
    document.getElementById('canvasInfo').textContent = S.canvasW + ' × ' + S.canvasH + ' 像素';
    document.getElementById('currentSize').textContent = S.canvasW + ' × ' + S.canvasH;
  }
  function updateZoomLabel() {
    var el = document.getElementById('zoomLevel');
    if (el) el.textContent = Math.round(S.zoomLevel * 100) + '%';
  }
  function syncSizeSelectors(w, h) {
    var resSel = document.getElementById('resolutionSelect');
    var ratioSel = document.getElementById('ratioSelect');
    var maxDim = Math.max(w, h);
    var resolutions = [16, 24, 32, 48, 64, 96, 128];
    var bestRes = 32;
    var bestDiff = Infinity;
    for (var i = 0; i < resolutions.length; i++) {
      var r = resolutions[i];
      if (Math.abs(r - maxDim) < bestDiff) { bestDiff = Math.abs(r - maxDim); bestRes = r; }
    }
    resSel.value = bestRes;
    var ratios = ['1:1', '4:3', '3:4', '16:9', '9:16', '2:1', '1:2', '3:2', '2:3'];
    var bestRatio = '1:1';
    var bestRatioDiff = Infinity;
    for (var j = 0; j < ratios.length; j++) {
      var ratio = ratios[j];
      var parts = ratio.split(':').map(Number);
      var targetW = parts[0] >= parts[1] ? bestRes : Math.round(bestRes * parts[0] / parts[1]);
      var targetH = parts[0] >= parts[1] ? Math.round(bestRes * parts[1] / parts[0]) : bestRes;
      var diff = Math.abs(targetW - w) + Math.abs(targetH - h);
      if (diff < bestRatioDiff) { bestRatioDiff = diff; bestRatio = ratio; }
    }
    ratioSel.value = bestRatio;
  }
  PA.updateSizeDisplay = updateSizeDisplay;
  PA.updateZoomLabel = updateZoomLabel;
  PA.syncSizeSelectors = syncSizeSelectors;

  // ---- 初始化 / 编排 ----
  async function init() {
    var res = parseInt(document.getElementById('resolutionSelect').value);
    var ratio = document.getElementById('ratioSelect').value;
    var dims = computeDims(res, ratio);
    S.canvasW = dims.w;
    S.canvasH = dims.h;

    var canvas = document.getElementById('drawCanvas');
    S.basePixelSize = computePixelSize(S.canvasW, S.canvasH);
    S.engine = new CanvasEngine(canvas, S.canvasW, S.canvasH, S.basePixelSize);
    S.anim = new Animation(S.engine, S.canvasW, S.canvasH);

    // 绘制完成：先同步合成图，再保存快照（图层持久化在图层系统就绪后补充）
    S.engine.onDrawEnd = function (pixelsCopy) {
      var idx = S.anim.current;
      S.anim.frames[idx] = pixelsCopy.slice();
      pushSnapshot();
      renderFrameList(); // 每次绘制后刷新帧列表缩略图预览
    };

    S.engine.onColorPick = function (color) {
      var targetColor = normalizeColor(color);
      if (S.isDeletingColor) {
        S.isDeletingColor = false;
        if (!targetColor) { alert('无法识别该颜色'); switchToPencil(); return; }
        S.anim.syncCurrentFrame();
        var frame = S.anim.frames[S.anim.current];
        if (!confirm('确定要删除当前帧中所有「' + targetColor + '」像素吗？')) { switchToPencil(); return; }
        var count = 0;
        for (var i = 0; i < frame.length; i++) {
          var pixelNorm = normalizeColor(frame[i]);
          if (pixelNorm !== null && pixelNorm === targetColor) { frame[i] = null; count++; }
        }
        if (count > 0) {
          S.engine.loadFrame(frame);
          S.engine.render();
          renderFrameList();
          alert('已删除 ' + count + ' 个像素。');
          pushSnapshot();
        } else {
          alert('当前帧中没有该颜色。');
        }
        switchToPencil();
        return;
      }

      if (targetColor) {
        PA.Palette.addToTempPalette(targetColor);
        document.getElementById('colorPicker').value = targetColor;
        S.engine.setColor(targetColor);
        document.querySelectorAll('.swatch').forEach(function (s) { s.classList.remove('active'); });
        var swatches = document.querySelectorAll('.swatch');
        for (var i = 0; i < swatches.length; i++) {
          if (swatches[i].style.background === targetColor) { swatches[i].classList.add('active'); break; }
        }
        switchToPencil();
      }
    };

    // 模块初始化（各自负责绑定自己的 UI 事件）
    PA.Palette.init();
    PA.Toolbar.init();
    PA.Frames.init();
    PA.Playback.init();
    PA.Export.init();
    PA.Import.init();
    PA.CanvasSize.init();
    PA.Batch.init();

    var fitModeSelect = document.getElementById('fitMode');
    if (fitModeSelect) fitModeSelect.value = 'contain';

    for (var i = 0; i < S.anim.frames.length; i++) normalizeFrame(S.anim.frames[i]);

    S.anim.onFramesChange = renderFrameList;
    S.anim.onFrameSelect = function (i) {
      updateFrameListSelection(i);
      if (S.layerSystem) S.layerSystem.loadFrameLayers(i);
    };
    renderFrameList();
    updateSizeDisplay();
    updateZoomLabel();
    PA.Palette.renderTempPalette();

    await loadProject();

    if (S.anim.frames.length === 0) {
      var empty = new Array(S.canvasW * S.canvasH).fill(null);
      S.anim.frames = [empty];
      S.anim.current = 0;
      S.engine.loadFrame(empty);
      S.engine.render();
      renderFrameList();
    }

    // window.* 兼容（video-import.js 等依赖）
    window.engine = S.engine;
    window.anim = S.anim;
    window.renderFrameList = renderFrameList;
    window.pushSnapshot = pushSnapshot;
    window.autoSave = autoSave;

    // 图层系统
    window.layerSystem = S.layerSystem = new LayerSystem(S.engine, S.anim);
    S.layerSystem.onChange = pushSnapshot;

    // 切换帧时：先保存当前帧的图层像素，再让图层系统加载目标帧
    var _origSelectFrame = S.anim.selectFrame.bind(S.anim);
    S.anim.selectFrame = function (index) {
      if (S.layerSystem) S.layerSystem.saveCurrentFrameLayers();
      return _origSelectFrame(index);
    };

    // 绘制完成：同步图层像素并保存快照（覆盖上面的临时版本）
    S.engine.onDrawEnd = function (pixelsCopy) {
      S.anim.frames[S.anim.current] = pixelsCopy.slice();
      if (S.layerSystem) S.layerSystem.saveCurrentFrameLayers();
      pushSnapshot();
      renderFrameList(); // 每次绘制后刷新帧列表缩略图预览
    };

    // 若加载的项目携带图层数据，则恢复（覆盖构造时的单图层初始化）
    if (window.__pendingLayerData && S.layerSystem) {
      S.layerSystem.restoreSnapshot(window.__pendingLayerData);
      window.__pendingLayerData = null;
    }

    // 种入初始快照：作为撤销的"地基"，使第一次撤销可回到当前状态
    pushSnapshot();

    initSoundIntegration();
  }

  function initSoundIntegration() {
    if (typeof window.SFX === 'undefined') { console.warn('音效系统未加载'); return; }
    var SFX = window.SFX;

    var origSetTool = S.engine.setTool.bind(S.engine);
    S.engine.setTool = function (tool) {
      var oldTool = this.tool;
      origSetTool(tool);
      if (tool !== oldTool) SFX.select();
    };

    var origOnDrawEnd = S.engine.onDrawEnd;
    S.engine.onDrawEnd = function (pixelsCopy) {
      if (this.tool === 'eraser') SFX.erase();
      else if (this.tool === 'pencil') SFX.pen();
      else if (this.tool === 'fill') SFX.fill();
      else if (this.tool === 'eyedropper') SFX.eyedropper();
      else SFX.pen();
      if (origOnDrawEnd) origOnDrawEnd.call(this, pixelsCopy);
    };

    var origOnColorPick = S.engine.onColorPick;
    S.engine.onColorPick = function (color) {
      SFX.pick();
      if (origOnColorPick) origOnColorPick.call(this, color);
    };

    var origAddFrame = S.anim.addFrame.bind(S.anim);
    S.anim.addFrame = function () { origAddFrame(); SFX.add(); };

    var origDupFrame = S.anim.duplicateFrame.bind(S.anim);
    S.anim.duplicateFrame = function () { origDupFrame(); SFX.add(); };

    var origDeleteFrame = S.anim.deleteFrame.bind(S.anim);
    S.anim.deleteFrame = function () {
      if (this.frames.length >= 1) { origDeleteFrame(); SFX.delete(); }
      else SFX.error();
    };

    var origSelectFrame = S.anim.selectFrame.bind(S.anim);
    S.anim.selectFrame = function (index) {
      if (index !== this.current) { origSelectFrame(index); SFX.frameSelect(); }
      else origSelectFrame(index);
    };

    var origPlay = S.anim.play.bind(S.anim);
    S.anim.play = function () { origPlay(); SFX.play(); };

    var origStop = S.anim.stop.bind(S.anim);
    S.anim.stop = function () { origStop(); SFX.stop(); };

    var origClear = S.engine.clear.bind(S.engine);
    S.engine.clear = function () { origClear(); SFX.delete(); };

    document.addEventListener('click', function (e) {
      var swatch = e.target.closest('.swatch, .temp-swatch');
      if (swatch) SFX.pick();
    });

    document.addEventListener('click', function (e) {
      var btn = e.target.closest('.action-btn, .tool-btn, .auth-btn, .zoom-btn, .cw-add-btn');
      if (btn) {
        var skipIds = ['btnPlay', 'btnUndo', 'btnRedo', 'btnAddFrame', 'btnDupFrame', 'btnDelFrame',
          'btnZoomIn', 'btnZoomOut', 'btnCropConfirm', 'btnCropCancel',
          'btnColorWheel', 'cwClose', 'open-settingcard-btn', 'settingCardClose',
          'open-picturecard-btn', 'pictureCardClose'];
        if (skipIds.indexOf(btn.id) === -1 && !btn.closest('[data-tool]')) SFX.click();
      }
    });

    console.log('音效已集成');
  }

  PA.init = init;

  // 启动
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { init().catch(function (e) { console.error(e); }); });
  } else {
    init().catch(function (e) { console.error(e); });
  }
})();
