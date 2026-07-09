// public/js/app.js - 快照方案，绝对不出错
// [MODIFIED] 默认分辨率从 32 改为 128
// [MODIFIED] 集成 WindowManager 实现 Win98 风格多窗口画布管理
(function () {
  var canvasW = 128;
  var canvasH = 128;
  var zoomLevel = 1.0;
  var basePixelSize = 16;
  var panX = 0;
  var panY = 0;

  // ---- 多画布标签系统 ----
  var canvasTabs = [];
  var activeTabIndex = 0;

  // ---- 缓存的可编辑画布容器引用（避免被移出文档后 getElementById 失效）----
  var canvasWrapEl = null;
  var cropBarEl = null;

  // ---- WindowManager 辅助函数 ----
  function getViewportEl() {
    if (typeof WindowManager !== 'undefined' && WindowManager.getActiveBodyEl) {
      return WindowManager.getActiveBodyEl();
    }
    return document.getElementById('canvasViewport');
  }

  function moveCanvasToActiveWindow(targetIndex) {
    if (typeof WindowManager === 'undefined') return;
    var tab = canvasTabs[targetIndex];
    if (!tab) return;
    var winObj = WindowManager.getWindowByTabIndex(targetIndex);
    if (!winObj) return;
    var bodyEl = winObj.el.querySelector('.win-active-area');
    if (!bodyEl) return;

    var wrap = canvasWrapEl || document.getElementById('canvasWrap');
    if (wrap && wrap.parentElement !== bodyEl) {
      bodyEl.appendChild(wrap);
    }

    var cropBar = cropBarEl || document.getElementById('cropBar');
    if (cropBar && cropBar.parentElement !== bodyEl) {
      bodyEl.appendChild(cropBar);
    }
  }

  function autoFitCanvasToWindow() {
    if (typeof WindowManager === 'undefined' || !engine) return;
    var winObj = WindowManager.getWindowByTabIndex(activeTabIndex);
    if (!winObj) return;
    var winBody = winObj.el.querySelector('.win-body');
    if (!winBody) return;

    // Force layout computation
    var bodyRect = winBody.getBoundingClientRect();
    var bodyW = bodyRect.width;
    var bodyH = bodyRect.height;
    // win-body padding = 8px each side, so available content area:
    // In border-box: clientWidth includes padding, so available = clientWidth - padding*2
    var availableW = winBody.clientWidth - 16; // body padding 8+8
    var availableH = winBody.clientHeight - 16;

    if (availableW < 20 || availableH < 20) {
      // Body too small — delay autoFit until layout completes
      requestAnimationFrame(function() { autoFitCanvasToWindow(); });
      return;
    }

    // Calculate the pixelSize that makes canvasWrap fit inside winBody
    // canvasWrap total size = canvasW * ps + padding(32) + border(2)
    // In border-box mode: style.width = content + padding + border
    // So: canvasW * ps + 34 <= availableW AND canvasH * ps + 34 <= availableH
    // ps <= (availableW - 34) / canvasW AND ps <= (availableH - 34) / canvasH
    var fitPs = Math.floor(Math.min(
      (availableW - 34) / canvasW,
      (availableH - 34) / canvasH
    ));
    fitPs = Math.max(2, Math.min(48, fitPs)); // Minimum ps=2 for visibility

    var currentPs = engine.pixelSize || basePixelSize;
    if (fitPs !== currentPs) {
      basePixelSize = fitPs;
      zoomLevel = 1.0;
      engine.setPixelSize(fitPs);
      setWrapSize();
      centerCanvas();
      updateZoomLabel();
      // Update tab data
      if (canvasTabs[activeTabIndex]) {
        canvasTabs[activeTabIndex].basePixelSize = basePixelSize;
        canvasTabs[activeTabIndex].zoomLevel = zoomLevel;
      }
      // Update window status bar
      var tab = canvasTabs[activeTabIndex];
      if (tab && tab._winId) {
        WindowManager.updateWindowZoom(tab._winId, Math.round(zoomLevel * 100));
      }
    }
  }

  function renderInactiveWindowPreviews() {
    if (typeof WindowManager === 'undefined') return;
    // Use requestAnimationFrame to ensure DOM layout is complete before rendering
    requestAnimationFrame(function() {
      for (var i = 0; i < canvasTabs.length; i++) {
        if (i === activeTabIndex) continue;
        var tab = canvasTabs[i];
        if (!tab._winId) continue;
        var frame = tab.frames[tab.currentFrame] || tab.frames[0];
        if (!frame) continue;
        var composite = LayerUtils.getCompositePixels(
          frame,
          tab.canvasW,
          tab.canvasH
        );
        WindowManager.renderPreview(tab._winId, composite, tab.canvasW, tab.canvasH);
      }
    });
  }

  function updateCanvasPosition() {
    var wrap = document.getElementById('canvasWrap');
    if (wrap) {
      wrap.style.transform = 'translate(' + panX + 'px, ' + panY + 'px)';
    }
  }

  function setWrapSize() {
    var wrap = document.getElementById('canvasWrap');
    if (!wrap || !engine) return;
    var ps = engine.pixelSize || basePixelSize;
    // In border-box mode: style.width = content + padding + border
    // content = canvasW * ps (drawCanvas intrinsic size)
    // padding = 16*2 = 32
    // border = 1*2 = 2 (frutiger-metro.css: 1px solid)
    var w = canvasW * ps + 32 + 2;
    var h = canvasH * ps + 32 + 2;
    wrap.style.width = w + 'px';
    wrap.style.height = h + 'px';
  }

  function centerCanvas() {
    panX = 0;
    panY = 0;
    updateCanvasPosition();
  }

  function computePixelSize(w, h) {
    var maxDim = Math.max(w, h);
    var ps = Math.floor(512 / maxDim);
    return Math.max(4, Math.min(32, ps));
  }

  function computeDims(resolution, ratioKey) {
    var parts = ratioKey.split(':').map(Number);
    var rw = parts[0], rh = parts[1];
    var w, h;
    if (rw >= rh) {
      w = resolution;
      h = Math.round(resolution * rh / rw);
    } else {
      h = resolution;
      w = Math.round(resolution * rw / rh);
    }
    return { w: w, h: h };
  }

  var DEFAULT_PALETTE = [
    '#000000', '#ffffff', '#7f7f7f', '#c3c3c3',
    '#ed1c24', '#ff7f27', '#fff200', '#22b14c',
    '#00a2e8', '#3f48cc', '#a349a4', '#ec1c8a',
    '#b97a57', '#ffaec9', '#ffc90e', '#efe4b0',
    '#b5e61d', '#99d9ea', '#7092be', '#c8bfe7',
  ];

  var customColors = [];
  try { customColors = JSON.parse(localStorage.getItem('pa_custom_colors') || '[]'); } catch (e) { customColors = []; }
  var hiddenDefaults = new Set();
  try {
    var savedHidden = JSON.parse(localStorage.getItem('pa_hidden_defaults') || '[]');
    hiddenDefaults = new Set(savedHidden);
  } catch (e) { hiddenDefaults = new Set(); }
  function getActivePalette() {
    return DEFAULT_PALETTE.filter(function(c) { return !hiddenDefaults.has(c); }).concat(customColors);
  }

  var engine, anim;
  var isDeletingColor = false;
  var batchDeleteMode = false;
  var batchSelectedColors = new Set();

  // ---- 快照历史 ----
  var undoStack = [];
  var redoStack = [];
  var MAX_HISTORY = 200;

  // 保存当前所有帧的快照（深拷贝图层帧）
  function saveSnapshot() {
    return anim.frames.map(function(f) { return LayerUtils.cloneFrame(f); });
  }

  function pushSnapshot() {
    redoStack = [];
    var snap = saveSnapshot();
    undoStack.push(snap);
    if (undoStack.length > MAX_HISTORY) {
      undoStack.shift();
    }
  }

  function undoOperation() {
    if (undoStack.length === 0) return false;
    var snap = undoStack.pop();
    redoStack.push(saveSnapshot());
    restoreSnapshot(snap);
    return true;
  }

  function redoOperation() {
    if (redoStack.length === 0) return false;
    var snap = redoStack.pop();
    undoStack.push(saveSnapshot());
    restoreSnapshot(snap);
    return true;
  }

  function restoreSnapshot(snap) {
    // 恢复帧数据（深拷贝图层帧）
    anim.frames = snap.map(function(f) { return LayerUtils.cloneFrame(f); });
    // 修正当前帧索引
    if (anim.current >= anim.frames.length) {
      anim.current = anim.frames.length - 1;
    }
    if (anim.current < 0) anim.current = 0;
    // 加载当前帧
    engine.loadFrame(anim.frames[anim.current]);
    anim._renderOnion();
    renderFrameList();
    renderLayerList();
    engine.history = [];
    engine.future = [];
  }

  // ---- 颜色标准化 ----
  function normalizeColor(color) {
    if (!color || typeof color !== 'string') return null;
    var hex = color.trim().toLowerCase();
    if (hex.startsWith('#')) hex = hex.slice(1);
    if (hex.length === 3) hex = hex.split('').map(function(c) { return c + c; }).join('');
    if (hex.length === 6) return '#' + hex;
    return null;
  }

  function normalizeFrame(frame) {
    if (LayerUtils.isLayerFrame(frame)) {
      frame.layers.forEach(function(layer) {
        for (var i = 0; i < layer.pixels.length; i++) {
          if (layer.pixels[i] !== null) {
            var norm = normalizeColor(layer.pixels[i]);
            if (norm !== null) layer.pixels[i] = norm;
          }
        }
      });
      return;
    }
    if (!frame) return;
    for (var i = 0; i < frame.length; i++) {
      if (frame[i] !== null) {
        var norm = normalizeColor(frame[i]);
        if (norm !== null) frame[i] = norm;
      }
    }
  }

  function switchToPencil() {
    document.querySelectorAll('[data-tool]').forEach(function(b) { b.classList.remove('active'); });
    var pencil = document.querySelector('[data-tool="pencil"]');
    if (pencil) pencil.classList.add('active');
    engine.setTool('pencil');
    var eraserSizeControl = document.getElementById('eraserSizeControl');
    if (eraserSizeControl) eraserSizeControl.style.display = 'none';
    var penSizeControl = document.getElementById('penSizeControl');
    if (penSizeControl) penSizeControl.style.display = 'flex';
    var eraserCursor = document.getElementById('eraserCursor');
    if (eraserCursor) eraserCursor.style.display = 'none';
    isDeletingColor = false;
  }

  // ---- 音效节流 ----
  var lastSfxTime = 0;
  function throttledSfx(fn) {
    var now = Date.now();
    if (now - lastSfxTime < 40) return;
    lastSfxTime = now;
    if (fn) fn();
  }

  // ---- 多画布标签管理 ----
  function createCanvasTab(name, res, ratio) {
    var resolution = res || parseInt(document.getElementById('resolutionSelect').value) || 128;
    var ratioKey = ratio || document.getElementById('ratioSelect').value || '1:1';
    var dims = computeDims(resolution, ratioKey);
    var w = dims.w, h = dims.h;
    var ps = computePixelSize(w, h);
    return {
      id: Date.now() + Math.random(),
      name: name || ('画布 ' + (canvasTabs.length + 1)),
      canvasW: w,
      canvasH: h,
      resolution: resolution,
      ratio: ratioKey,
      zoomLevel: 1.0,
      basePixelSize: ps,
      panX: 0,
      panY: 0,
      frames: [LayerUtils.createFrame(w, h, 'Background')],
      currentFrame: 0,
      fps: 12,
      undoStack: [],
      redoStack: [],
      _winId: null,
    };
  }

  function saveCurrentTabState() {
    if (canvasTabs.length === 0 || activeTabIndex < 0 || activeTabIndex >= canvasTabs.length) return;
    var tab = canvasTabs[activeTabIndex];
    if (anim) anim.syncCurrentFrame();
    tab.frames = anim.frames.map(function(f) { return LayerUtils.cloneFrame(f); });
    tab.currentFrame = anim.current;
    tab.fps = anim.fps;
    tab.canvasW = canvasW;
    tab.canvasH = canvasH;
    tab.zoomLevel = zoomLevel;
    tab.basePixelSize = basePixelSize;
    tab.panX = panX;
    tab.panY = panY;
    tab.resolution = parseInt(document.getElementById('resolutionSelect').value);
    tab.ratio = document.getElementById('ratioSelect').value;
    tab.undoStack = undoStack.slice();
    tab.redoStack = redoStack.slice();
  }

  function loadTabState(index) {
    if (index < 0 || index >= canvasTabs.length) return;
    var tab = canvasTabs[index];

    canvasW = tab.canvasW;
    canvasH = tab.canvasH;
    basePixelSize = tab.basePixelSize;
    zoomLevel = tab.zoomLevel;
    panX = tab.panX;
    panY = tab.panY;

    engine.resize(canvasW, canvasH, basePixelSize);
    anim.width = canvasW;
    anim.height = canvasH;
    anim.emptyPixel = function() { return new Array(canvasW * canvasH).fill(null); };
    anim.frames = tab.frames.map(function(f) { return LayerUtils.cloneFrame(f); });
    anim.current = tab.currentFrame;
    anim.fps = tab.fps;

    undoStack = tab.undoStack.slice();
    redoStack = tab.redoStack.slice();

    document.getElementById('resolutionSelect').value = tab.resolution;
    document.getElementById('ratioSelect').value = tab.ratio;
    document.getElementById('fpsSlider').value = anim.fps;
    document.getElementById('fpsLabel').textContent = anim.fps + ' FPS';

    if (anim.frames.length > 0) {
      engine.loadFrame(anim.frames[anim.current]);
    } else {
      anim.frames = [LayerUtils.createFrame(canvasW, canvasH, 'Background')];
      anim.current = 0;
      engine.loadFrame(anim.frames[0]);
    }
    anim._renderOnion();

    // 移动 canvasWrap 到活动窗口
    moveCanvasToActiveWindow(index);

    updateCanvasPosition();
    setWrapSize();
    updateSizeDisplay();
    setZoom(zoomLevel);
    renderFrameList();
    renderLayerList();

    // 更新窗口状态栏信息
    if (typeof WindowManager !== 'undefined' && tab._winId) {
      WindowManager.updateWindowZoom(tab._winId, Math.round(zoomLevel * 100));
      WindowManager.updateWindowSize(tab._winId, tab.canvasW, tab.canvasH);
    }
  }

  function switchTab(index) {
    if (index === activeTabIndex) return;
    if (anim && anim.playing) {
      anim.stop();
      document.getElementById('btnPlay').textContent = '播放';
    }
    saveCurrentTabState();
    activeTabIndex = index;

    // 窗口系统：先激活对应窗口（添加 .active 类使 .win-active-area 可见）
    // 这样后续的 DOM 移动和渲染都在可见容器中执行
    var tab = canvasTabs[index];
    if (typeof WindowManager !== 'undefined' && tab._winId) {
      // 临时禁用 onActivate 回调，避免循环调用 switchTab
      var origOnActivate = WindowManager.onActivate;
      WindowManager.onActivate = null;
      WindowManager.activateWindow(tab._winId);
      WindowManager.onActivate = origOnActivate;
    }

    // 现在窗口已激活，.win-active-area 是 display:flex（可见）
    moveCanvasToActiveWindow(index);
    loadTabState(index);

    // 加载状态后，如果画布超出窗口则自动缩放适应
    autoFitCanvasToWindow();

    // 确保 engine 在新窗口环境中渲染
    if (engine) engine.render();

    renderInactiveWindowPreviews();
    SFX.select();
  }

  function addCanvasTab() {
    saveCurrentTabState();
    var newTab = createCanvasTab();
    canvasTabs.push(newTab);

    // 窗口系统：创建新窗口
    var newIndex = canvasTabs.length - 1;
    if (typeof WindowManager !== 'undefined') {
      var winObj = WindowManager.createWindow(newTab, newIndex);
      newTab._winId = newTab.id;  // winId matches the tab's id
    }

    activeTabIndex = newIndex;

    // 先激活窗口（使 .win-active-area 可见）
    if (typeof WindowManager !== 'undefined') {
      var origOnActivate = WindowManager.onActivate;
      WindowManager.onActivate = null;
      WindowManager.activateWindow(newTab._winId);
      WindowManager.onActivate = origOnActivate;
    }

    // 现在窗口已激活，.win-active-area 可见
    moveCanvasToActiveWindow(activeTabIndex);
    loadTabState(activeTabIndex);
    autoFitCanvasToWindow();
    if (engine) engine.render();

    renderInactiveWindowPreviews();
    autoSave();
    SFX.add();
  }

  function closeCanvasTab(index) {
    if (canvasTabs.length <= 1) {
      alert('至少保留一个画布');
      return;
    }
    if (!confirm('确定删除画布「' + canvasTabs[index].name + '」？\n该画布的所有帧和图层将被删除。')) return;

    var tabToClose = canvasTabs[index];

    // 窗口系统：销毁窗口
    if (typeof WindowManager !== 'undefined' && tabToClose._winId) {
      WindowManager.destroyWindow(tabToClose._winId);
    }

    canvasTabs.splice(index, 1);
    if (activeTabIndex >= canvasTabs.length) {
      activeTabIndex = canvasTabs.length - 1;
    } else if (index < activeTabIndex) {
      activeTabIndex--;
    }

    // 更新所有窗口的 tabIndex 以匹配新的 canvasTabs 顺序
    if (typeof WindowManager !== 'undefined') {
      for (var ti = 0; ti < canvasTabs.length; ti++) {
        if (canvasTabs[ti]._winId) {
          WindowManager.updateTabIndex(canvasTabs[ti]._winId, ti);
        }
      }
    }

    // 先激活窗口（使 .win-active-area 可见）
    var newTab = canvasTabs[activeTabIndex];
    if (typeof WindowManager !== 'undefined' && newTab._winId) {
      var origOnActivate = WindowManager.onActivate;
      WindowManager.onActivate = null;
      WindowManager.activateWindow(newTab._winId);
      WindowManager.onActivate = origOnActivate;
    }

    // 现在窗口已激活，.win-active-area 可见
    moveCanvasToActiveWindow(activeTabIndex);
    loadTabState(activeTabIndex);
    autoFitCanvasToWindow();
    if (engine) engine.render();

    renderInactiveWindowPreviews();
    autoSave();
    SFX.delete();
  }

  function renameCanvasTab(index) {
    var tab = canvasTabs[index];
    var newName = prompt('画布名称:', tab.name);
    if (newName && newName.trim()) {
      tab.name = newName.trim();
      // 窗口系统：更新标题
      if (typeof WindowManager !== 'undefined' && tab._winId) {
        WindowManager.updateWindowTitle(tab._winId, tab.name);
      }
      autoSave();
    }
  }

  function bindCanvasTabs() {
    // 旧的 btnAddCanvas 保留兼容
    var addBtn = document.getElementById('btnAddCanvas');
    if (addBtn) {
      addBtn.addEventListener('click', function() {
        addCanvasTab();
      });
    }

    // WindowManager 回调设置
    if (typeof WindowManager !== 'undefined') {
      WindowManager.onActivate = function(tabIndex) {
        if (tabIndex !== undefined && tabIndex !== activeTabIndex) {
          switchTab(tabIndex);

          // Forward pending click to drawCanvas after DOM migration completes
          // This simulates real OS behavior: clicking inactive window activates AND interacts
          if (WindowManager._pendingClick) {
            var pending = WindowManager._pendingClick;
            WindowManager._pendingClick = null;
            requestAnimationFrame(function() {
              var canvas = document.getElementById('drawCanvas');
              if (canvas) {
                // Simulate mousedown at the same screen position
                var simulatedEvent = new MouseEvent('mousedown', {
                  clientX: pending.clientX,
                  clientY: pending.clientY,
                  bubbles: true,
                  cancelable: true
                });
                canvas.dispatchEvent(simulatedEvent);
              }
            });
          }
        }
      };

      WindowManager.onClose = function(tabIndex) {
        closeCanvasTab(tabIndex);
      };

      WindowManager.onRename = function(tabIndex) {
        renameCanvasTab(tabIndex);
      };

      WindowManager.onAddCanvas = function() {
        addCanvasTab();
      };

      WindowManager.onZoomIn = function() {
        SFX.zoomIn();
        setZoom(zoomLevel * 1.5);
      };

      WindowManager.onZoomOut = function() {
        SFX.zoomOut();
        setZoom(zoomLevel / 1.5);
      };

    }
  }

  // ---- 项目草稿保存 ----
  var saveTimeout = null;
  var isSaving = false;

  function getCanvasThumbnail(tab) {
    var frame = LayerUtils.getCompositePixels(tab.frames[0], tab.canvasW, tab.canvasH);
    var tmp = document.createElement('canvas');
    var ps = 4;
    tmp.width = tab.canvasW * ps;
    tmp.height = tab.canvasH * ps;
    var ctx = tmp.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, tmp.width, tmp.height);
    for (var y = 0; y < tab.canvasH; y++) {
      for (var x = 0; x < tab.canvasW; x++) {
        var c = frame[y * tab.canvasW + x];
        if (c) { ctx.fillStyle = c; ctx.fillRect(x * ps, y * ps, ps, ps); }
      }
    }
    return tmp.toDataURL('image/png');
  }

  function getCurrentProjectData() {
    saveCurrentTabState();

    var canvasesData = canvasTabs.map(function(tab) {
      var layerFrames = tab.frames.map(function(f) {
        var frame = LayerUtils.cloneFrame(f);
        normalizeFrame(frame);
        return frame;
      });
      var compositeFrames = layerFrames.map(function(f) {
        return LayerUtils.getCompositePixels(f, tab.canvasW, tab.canvasH);
      });
      return {
        name: tab.name,
        width: tab.canvasW,
        height: tab.canvasH,
        resolution: tab.resolution,
        ratio: tab.ratio,
        fps: tab.fps,
        frames: compositeFrames,
        layerFrames: layerFrames,
        currentFrame: tab.currentFrame,
      };
    });

    var first = canvasesData[0] || {};

    return {
      title: document.getElementById('workTitle').value.trim() || '未命名作品',
      author: document.getElementById('workAuthor').value.trim() || '匿名',
      canvases: canvasesData,
      // Backward compat (first canvas)
      width: first.width || 128,
      height: first.height || 128,
      fps: first.fps || 12,
      frames: first.frames || [],
      layerFrames: first.layerFrames || [],
      currentFrame: first.currentFrame || 0,
      palette: getActivePalette(),
      customColors: customColors,
      thumbnail: canvasTabs.length > 0 ? getCanvasThumbnail(canvasTabs[0]) : '',
      savedAt: new Date().toISOString(),
    };
  }

  async function saveProjectToServer(showMessage) {
    if (showMessage === undefined) showMessage = false;
    if (isSaving) return;
    isSaving = true;

    var user = Auth.getCurrentUser();
    if (!user) {
      try {
        localStorage.setItem('pa_local_project', JSON.stringify(getCurrentProjectData()));
        if (showMessage) alert('草稿已保存到本地（未登录）');
      } catch (e) {}
      isSaving = false;
      return;
    }

    try {
      var res = await fetch('/api/project', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-username': user.username,
        },
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
      try {
        localStorage.setItem('pa_local_project', JSON.stringify(getCurrentProjectData()));
      } catch (e) {}
    }
    isSaving = false;
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
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(function() {
      saveProjectToServer(false);
      saveTimeout = null;
    }, 1000);
  }

  // ---- 加载草稿 ----
  async function loadProject() {
    var user = Auth.getCurrentUser();
    var project = null;

    if (user) {
      try {
        var res = await fetch('/api/project', {
          headers: { 'x-username': user.username },
        });
        var data = await res.json();
        if (data.ok && data.project) {
          project = data.project;
        }
      } catch (e) {}
    }

    if (!project) {
      try {
        var local = localStorage.getItem('pa_local_project');
        if (local) {
          project = JSON.parse(local);
        }
      } catch (e) {}
    }

    if (project) {
      // Restore palette/customColors
      if (project.customColors) {
        customColors = project.customColors;
        localStorage.setItem('pa_custom_colors', JSON.stringify(customColors));
      }
      document.getElementById('workTitle').value = project.title || '';
      document.getElementById('workAuthor').value = project.author || '';

      if (project.canvases && project.canvases.length > 0) {
        // Multi-canvas project
        canvasTabs = project.canvases.map(function(c, idx) {
          var frames;
          if (c.layerFrames && c.layerFrames.length > 0) {
            frames = c.layerFrames.map(function(f) {
              var frame = LayerUtils.cloneFrame(f);
              normalizeFrame(frame);
              return frame;
            });
          } else {
            frames = (c.frames || []).map(function(f) {
              var frame = LayerUtils.convertLegacyFrame(f, c.width, c.height);
              normalizeFrame(frame);
              return frame;
            });
          }
          if (frames.length === 0) {
            frames = [LayerUtils.createFrame(c.width, c.height, 'Background')];
          }
          return {
            id: Date.now() + Math.random() + idx,
            name: c.name || ('画布 ' + (idx + 1)),
            canvasW: c.width,
            canvasH: c.height,
            resolution: c.resolution || 128,
            ratio: c.ratio || '1:1',
            zoomLevel: 1.0,
            basePixelSize: computePixelSize(c.width, c.height),
            panX: 0,
            panY: 0,
            frames: frames,
            currentFrame: c.currentFrame || 0,
            fps: c.fps || 12,
            undoStack: [],
            redoStack: [],
            _winId: null,
          };
        });
        activeTabIndex = 0;
        buildPalette();
        loadTabState(0);
        undoStack = [];
        redoStack = [];
        return true;
      }

      // Legacy single-canvas project
      var width = project.width, height = project.height, currentFrame = project.currentFrame, fps = project.fps;
      canvasTabs = [{
        id: Date.now() + Math.random(),
        name: '画布 1',
        canvasW: width,
        canvasH: height,
        resolution: 128,
        ratio: '1:1',
        zoomLevel: 1.0,
        basePixelSize: computePixelSize(width, height),
        panX: 0,
        panY: 0,
        frames: [],
        currentFrame: currentFrame || 0,
        fps: fps || 12,
        undoStack: [],
        redoStack: [],
        _winId: null,
      }];

      if (project.layerFrames && project.layerFrames.length > 0) {
        canvasTabs[0].frames = project.layerFrames.map(function(f) {
          var frame = LayerUtils.cloneFrame(f);
          normalizeFrame(frame);
          return frame;
        });
      } else {
        canvasTabs[0].frames = project.frames.map(function(f) {
          var frame = LayerUtils.convertLegacyFrame(f, width, height);
          normalizeFrame(frame);
          return frame;
        });
      }

      activeTabIndex = 0;
      buildPalette();
      loadTabState(0);
      undoStack = [];
      redoStack = [];
      return true;
    }
    return false;
  }

  // ---- 初始化 ----
  async function init() {
    var res = parseInt(document.getElementById('resolutionSelect').value);
    var ratio = document.getElementById('ratioSelect').value;
    var dims = computeDims(res, ratio);
    canvasW = dims.w;
    canvasH = dims.h;

    var canvas = document.getElementById('drawCanvas');
    basePixelSize = computePixelSize(canvasW, canvasH);
    engine = new CanvasEngine(canvas, canvasW, canvasH, basePixelSize);
    anim = new Animation(engine, canvasW, canvasH);

    // ★★★ 撤销/重做快照钩子 ★★★
    // 落笔前（onDrawStart）：此时 anim.frames 仍是操作前状态，压入撤销栈
    engine.onDrawStart = function() {
      pushSnapshot();
    };
    // 抬笔后（onDrawEnd）：把实时绘制的像素同步回 anim.frames 的当前帧，
    // 供下一次落笔前的快照使用，并更新非活动窗口预览
    engine.onDrawEnd = function() {
      anim.syncCurrentFrame();
      renderInactiveWindowPreviews();
    };

    // 图层变化时刷新图层面板
    engine.onLayersChange = function() {
      renderLayerList();
      autoSave();
    };

    // 画布拖动回调
    engine.onPanMove = function(dx, dy) {
      panX += dx;
      panY += dy;
      updateCanvasPosition();
    };

    engine.onColorPick = function(color) {
      var targetColor = normalizeColor(color);
      if (isDeletingColor) {
        isDeletingColor = false;
        if (!targetColor) {
          alert('无法识别该颜色');
          switchToPencil();
          return;
        }
        anim.syncCurrentFrame();
        var frame = anim.frames[anim.current];
        if (!confirm('确定要删除当前帧中所有「' + targetColor + '」像素吗？')) {
          switchToPencil();
          return;
        }
        var count = 0;
        for (var i = 0; i < frame.length; i++) {
          var pixelNorm = normalizeColor(frame[i]);
          if (pixelNorm !== null && pixelNorm === targetColor) {
            frame[i] = null;
            count++;
          }
        }
        if (count > 0) {
          engine.loadFrame(frame);
          engine.render();
          renderFrameList();
          alert('已删除 ' + count + ' 个像素。');
          // 删除颜色也是一个操作，保存快照
          pushSnapshot();
          renderInactiveWindowPreviews();
        } else {
          alert('当前帧中没有该颜色。');
        }
        switchToPencil();
        return;
      }

      if (targetColor) {
        selectedColor = targetColor;
        document.getElementById('colorPicker').value = targetColor;
        engine.setColor(targetColor);
        updateColorPanel(targetColor, true);
        SFX.eyedropper();
        document.querySelectorAll('.swatch').forEach(function(s) { s.classList.remove('active'); });
        var swatches = document.querySelectorAll('.swatch');
        for (var i = 0; i < swatches.length; i++) {
          if (swatches[i].style.background === targetColor) {
            swatches[i].classList.add('active');
            break;
          }
        }
        switchToPencil();
      }
    };

    buildPalette();
    updateColorPanel(selectedColor, false);
    bindColorPanel();
    bindToolbar();
    bindFrames();
    bindPlayback();
    bindExport();
    bindImport();
    bindVideoImport();
    bindCanvasSize();
    bindResizers();
    bindCrop();
    bindColorWheel();
    bindPaletteActions();
    bindZoom();
    bindCanvasDrag();
    bindCanvasResize();
    bindWheelZoom();
    bindEraserCursor();
    bindLayers();
    bindCanvasTabs();

    var fitModeSelect = document.getElementById('fitMode');
    if (fitModeSelect) fitModeSelect.value = 'contain';

    for (var i = 0; i < anim.frames.length; i++) {
      normalizeFrame(anim.frames[i]);
    }

    anim.onFramesChange = renderFrameList;
    anim.onFrameSelect = function(i) { updateFrameListSelection(i); renderLayerList(); };
    renderFrameList();
    renderLayerList();
    updateSizeDisplay();
    updateZoomLabel();

    // 初始化第一个画布标签
    canvasTabs = [createCanvasTab('画布 1', res, ratio)];
    activeTabIndex = 0;

    await loadProject();
    setWrapSize();

    // 确保引擎已加载当前画布的帧数据。
    // 重要：createCanvasTab 已为画布预置了 frames（长度 1），所以原先的
    // “frames.length === 0” 判断永远为假，导致全新项目时 loadTabState 从未被调用，
    // engine.frameData 始终为 null —— 绘制无法持久化，一切换画布当前内容即被清空。
    // 改为：只要引擎还没加载过帧数据（frameData 为 null）就加载一次。
    if (canvasTabs.length > 0 && !engine.getFrameData()) {
      if (canvasTabs[activeTabIndex].frames.length === 0) {
        canvasTabs[activeTabIndex].frames = [LayerUtils.createFrame(canvasW, canvasH, 'Background')];
        canvasTabs[activeTabIndex].currentFrame = 0;
      }
      loadTabState(activeTabIndex);
    }

    // ---- WindowManager 初始化 ----
    if (typeof WindowManager !== 'undefined') {
      var desktop = document.getElementById('desktopArea');
      var taskbar = document.getElementById('desktopTaskbar');

      if (desktop && taskbar) {
        WindowManager.init(desktop, taskbar);
      }

      // 从模板中取出 canvasWrap（仅隐藏模板，不要 removeChild 摘离文档，
      // 否则 moveCanvasToActiveWindow 里的 getElementById 会找不到它）
      var wrapTemplate = document.getElementById('canvasWrapTemplate');
      canvasWrapEl = document.getElementById('canvasWrap');
      cropBarEl = document.getElementById('cropBar');
      if (wrapTemplate) wrapTemplate.style.display = 'none';

      // 隐藏旧的 viewport / tabBar
      var vp = document.getElementById('canvasViewport');
      if (vp) vp.style.display = 'none';
      var tabEl = document.getElementById('canvasTabs');
      if (tabEl) tabEl.style.display = 'none';
      var tabBar = document.getElementById('canvasTabBar');
      if (tabBar) tabBar.style.display = 'none';

      // 重建所有窗口（确保 desktop-area 已有尺寸 — 触发强制布局）
      // Force layout calculation before creating windows
      desktop.getBoundingClientRect();

      WindowManager.rebuildAllWindows(canvasTabs, activeTabIndex);

      // 移动 canvasWrap 和 cropBar 到活动窗口
      moveCanvasToActiveWindow(activeTabIndex);

      // Delay autoFit and preview rendering until DOM layout completes
      requestAnimationFrame(function() {
        autoFitCanvasToWindow();
        // 确保 engine 在新环境中重新渲染
        if (engine) engine.render();
        renderInactiveWindowPreviews();
      });
    }

    document.getElementById('btnSaveDraft').addEventListener('click', function() {
      SFX.save();
      saveDraftLocally(true);
    });
    document.getElementById('btnSaveProject').addEventListener('click', function() {
      SFX.save();
      saveProjectToServer(true);
    });

    // ---- 面板折叠/展开 ----
    document.querySelectorAll('.section-toggle').forEach(function(header) {
      header.addEventListener('click', function() {
        var targetId = this.getAttribute('data-target');
        var content = document.getElementById(targetId);
        if (!content) return;
        var isCollapsed = this.classList.toggle('collapsed');
        content.classList.toggle('collapsed', isCollapsed);
        SFX.toggle();
      });
    });

    // ---- 音效开关 ----
    var soundBtn = document.getElementById('btnSoundToggle');
    if (soundBtn) {
      var onIcon = document.getElementById('soundOnIcon');
      var offIcon = document.getElementById('soundOffIcon');
      if (SFX.muted) { onIcon.style.display = 'none'; offIcon.style.display = ''; }
      soundBtn.addEventListener('click', function() {
        var m = SFX.toggleMute();
        onIcon.style.display = m ? 'none' : '';
        offIcon.style.display = m ? '' : 'none';
      });
    }

    engine.render();
    // 初始保存快照
    pushSnapshot();
  }

  // ---- 删除颜色按钮 ----
  function startDeleteColor() {
    if (isDeletingColor) {
      isDeletingColor = false;
      switchToPencil();
      return;
    }
    isDeletingColor = true;
    document.querySelectorAll('[data-tool]').forEach(function(b) { b.classList.remove('active'); });
    var eyedropper = document.querySelector('[data-tool="eyedropper"]');
    if (eyedropper) eyedropper.classList.add('active');
    engine.setTool('eyedropper');
    document.getElementById('penSizeControl').style.display = 'none';
    document.getElementById('eraserSizeControl').style.display = 'none';
    alert('点击画布上的颜色像素来删除该颜色（仅当前帧）。');
  }

  // ---- 调色板 ----
  function buildPalette() {
    var wrap = document.getElementById('palette');
    wrap.innerHTML = '';
    var palette = getActivePalette();
    palette.forEach(function(color, i) {
      var sw = document.createElement('button');
      var isDefault = DEFAULT_PALETTE.indexOf(color) !== -1;
      sw.className = 'swatch' + (isDefault ? '' : ' custom');
      sw.style.background = color;
      sw.title = color;
      if (i === 0) sw.classList.add('active');
      if (batchDeleteMode) {
        wrap.classList.add('batch-mode');
        if (batchSelectedColors.has(color)) sw.classList.add('batch-selected');
      }
      sw.addEventListener('click', function() {
        if (batchDeleteMode) {
          var norm = normalizeColor(color);
          if (batchSelectedColors.has(norm)) {
            batchSelectedColors.delete(norm);
            sw.classList.remove('batch-selected');
          } else {
            batchSelectedColors.add(norm);
            sw.classList.add('batch-selected');
          }
          updateBatchDeleteInfo();
          return;
        }
        selectColor(color, sw);
        SFX.pick();
        switchToPencil();
      });
      // Right-click: delete single color (both default and custom)
      sw.addEventListener('contextmenu', function(e) {
        e.preventDefault();
        if (batchDeleteMode) return;
        var norm = normalizeColor(color);
        if (isDefault) {
          if (confirm('隐藏默认颜色 ' + norm + ' ？\n可点击"恢复默认"恢复所有颜色。')) {
            hiddenDefaults.add(norm);
            localStorage.setItem('pa_hidden_defaults', JSON.stringify(Array.from(hiddenDefaults)));
            buildPalette();
            updatePaletteCount();
            autoSave();
          }
        } else {
          if (confirm('从调色板移除颜色 ' + norm + ' ?')) {
            var custIdx = customColors.indexOf(norm);
            if (custIdx !== -1) {
              customColors.splice(custIdx, 1);
              localStorage.setItem('pa_custom_colors', JSON.stringify(customColors));
              buildPalette();
              updatePaletteCount();
              autoSave();
            }
          }
        }
      });
      wrap.appendChild(sw);
    });
    var picker = document.getElementById('colorPicker');
    picker.oninput = null;
    picker.addEventListener('input', function() {
      var norm = normalizeColor(picker.value);
      if (norm) {
        engine.setColor(norm);
        selectedColor = norm;
        updateColorPanel(norm, false);
        document.querySelectorAll('.swatch').forEach(function(s) { s.classList.remove('active'); });
        throttledSfx(function() { SFX.pick(); });
        switchToPencil();
      }
    });
    updatePaletteCount();
    autoSave();

    // 调色盘键盘导航
    wrap.setAttribute('tabindex', '0');
    wrap.onkeydown = function(e) {
      var key = e.key;
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].indexOf(key) === -1) return;
      e.preventDefault();
      var swatches = wrap.querySelectorAll('.swatch');
      if (!swatches.length) return;
      var cols = 5;
      var curIdx = 0;
      for (var j = 0; j < swatches.length; j++) {
        if (swatches[j].classList.contains('active')) { curIdx = j; break; }
      }
      var newIdx = curIdx;
      if (key === 'ArrowRight') newIdx = Math.min(curIdx + 1, swatches.length - 1);
      else if (key === 'ArrowLeft') newIdx = Math.max(curIdx - 1, 0);
      else if (key === 'ArrowDown') newIdx = Math.min(curIdx + cols, swatches.length - 1);
      else if (key === 'ArrowUp') newIdx = Math.max(curIdx - cols, 0);
      if (newIdx !== curIdx) {
        var palette = getActivePalette();
        selectColor(palette[newIdx], swatches[newIdx]);
        SFX.pick();
        switchToPencil();
      }
    };
  }

  var selectedColor = DEFAULT_PALETTE[0];

  function selectColor(color, swEl) {
    var norm = normalizeColor(color);
    if (!norm) return;
    selectedColor = norm;
    document.querySelectorAll('.swatch').forEach(function(s) { s.classList.remove('active'); });
    if (swEl) {
      swEl.classList.add('active');
      swEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    engine.setColor(norm);
    document.getElementById('colorPicker').value = norm;
    updateColorPanel(norm, false);
  }

  function hexToRgb(hex) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map(function(c) { return c + c; }).join('');
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    };
  }

  function updateColorPanel(color, isPicked) {
    var norm = normalizeColor(color);
    if (!norm) return;
    var swatch = document.getElementById('colorPanelSwatch');
    var hexEl = document.getElementById('colorPanelHex');
    var rgbEl = document.getElementById('colorPanelRgb');
    if (!swatch || !hexEl || !rgbEl) return;
    swatch.style.background = norm;
    hexEl.textContent = norm.toUpperCase();
    var rgb = hexToRgb(norm);
    rgbEl.textContent = 'RGB ' + rgb.r + ', ' + rgb.g + ', ' + rgb.b;
    if (isPicked) {
      swatch.classList.remove('picked');
      void swatch.offsetWidth;
      swatch.classList.add('picked');
    }
  }

  function updatePaletteCount() {
    var el = document.getElementById('paletteCount');
    if (el) el.textContent = '调色板: ' + getActivePalette().length + ' 色';
  }

  function addCustomColor(hex) {
    var norm = normalizeColor(hex);
    if (!norm) return;
    var palette = getActivePalette();
    if (palette.indexOf(norm) !== -1) {
      var idx = palette.indexOf(norm);
      var sw = document.querySelectorAll('.swatch')[idx];
      if (sw) {
        selectColor(norm, sw);
        sw.classList.add('flash');
        setTimeout(function() { sw.classList.remove('flash'); }, 600);
      }
      return;
    }
    customColors.push(norm);
    localStorage.setItem('pa_custom_colors', JSON.stringify(customColors));
    buildPalette();
    var sws = document.querySelectorAll('.swatch');
    if (sws.length) selectColor(norm, sws[sws.length - 1]);
    autoSave();
  }

  function deleteSelectedColor() {
    startDeleteColor();
  }

  function resetPalette() {
    if (customColors.length === 0 && hiddenDefaults.size === 0) return;
    if (!confirm('确定恢复默认调色板？自定义颜色将被清空，隐藏的默认颜色将恢复。')) return;
    customColors = [];
    hiddenDefaults.clear();
    localStorage.setItem('pa_custom_colors', JSON.stringify(customColors));
    localStorage.setItem('pa_hidden_defaults', JSON.stringify([]));
    if (batchDeleteMode) toggleBatchDeleteMode();
    buildPalette();
    var firstSw = document.querySelector('.swatch');
    if (firstSw) selectColor(DEFAULT_PALETTE[0], firstSw);
    autoSave();
  }

  function bindPaletteActions() {
    document.getElementById('btnDeleteColor').addEventListener('click', function() { SFX.click(); deleteSelectedColor(); });
    document.getElementById('btnResetPalette').addEventListener('click', function() { SFX.confirm(); resetPalette(); });
    document.getElementById('btnBatchDelete').addEventListener('click', function() { SFX.toggle(); toggleBatchDeleteMode(); });
    document.getElementById('btnBatchDeleteConfirm').addEventListener('click', function() { SFX.delete(); confirmBatchDelete(); });
    document.getElementById('btnBatchDeleteCancel').addEventListener('click', function() { SFX.cancel(); toggleBatchDeleteMode(); });
    document.getElementById('btnBatchSelectAll').addEventListener('click', function() { SFX.click(); batchSelectAllColors(); });
  }

  // ---- 批量删除 ----
  function toggleBatchDeleteMode() {
    batchDeleteMode = !batchDeleteMode;
    batchSelectedColors.clear();
    var paletteEl = document.getElementById('palette');
    var bar = document.getElementById('batchDeleteBar');
    if (batchDeleteMode) {
      paletteEl.classList.add('batch-mode');
      bar.style.display = 'flex';
      document.querySelectorAll('.swatch').forEach(function(s) { s.classList.remove('active'); });
    } else {
      paletteEl.classList.remove('batch-mode');
      bar.style.display = 'none';
      document.querySelectorAll('.swatch').forEach(function(s) { s.classList.remove('batch-selected'); });
    }
    updateBatchDeleteInfo();
  }

  function updateBatchDeleteInfo() {
    var info = document.getElementById('batchDeleteInfo');
    var confirmBtn = document.getElementById('btnBatchDeleteConfirm');
    if (info) info.textContent = '已选 ' + batchSelectedColors.size + ' 色';
    if (confirmBtn) {
      confirmBtn.textContent = '删除 (' + batchSelectedColors.size + ')';
      confirmBtn.disabled = batchSelectedColors.size === 0;
    }
  }

  function batchSelectAllColors() {
    var pal = getActivePalette();
    var allSelected = pal.every(function(c) { return batchSelectedColors.has(c); });
    if (allSelected) {
      batchSelectedColors.clear();
    } else {
      pal.forEach(function(c) { batchSelectedColors.add(c); });
    }
    var swatches = document.querySelectorAll('.swatch');
    for (var i = 0; i < swatches.length; i++) {
      if (batchSelectedColors.has(pal[i])) {
        swatches[i].classList.add('batch-selected');
      } else {
        swatches[i].classList.remove('batch-selected');
      }
    }
    updateBatchDeleteInfo();
  }

  function confirmBatchDelete() {
    if (batchSelectedColors.size === 0) return;
    if (!confirm('确定删除选中的 ' + batchSelectedColors.size + ' 种颜色？')) return;

    batchSelectedColors.forEach(function(color) {
      var norm = normalizeColor(color);
      if (!norm) return;
      if (DEFAULT_PALETTE.indexOf(norm) !== -1) {
        hiddenDefaults.add(norm);
      } else {
        var custIdx = customColors.indexOf(norm);
        if (custIdx !== -1) customColors.splice(custIdx, 1);
      }
    });

    localStorage.setItem('pa_hidden_defaults', JSON.stringify(Array.from(hiddenDefaults)));
    localStorage.setItem('pa_custom_colors', JSON.stringify(customColors));

    var deletedCount = batchSelectedColors.size;
    batchSelectedColors.clear();
    toggleBatchDeleteMode();
    buildPalette();
    updatePaletteCount();

    // 选中第一个可用颜色
    var firstSw = document.querySelector('.swatch');
    if (firstSw) {
      var pal = getActivePalette();
      selectColor(pal[0], firstSw);
    }
    autoSave();
  }

  // ---- Canva/剪映风格颜色面板交互 ----
  function bindColorPanel() {
    var hexEl = document.getElementById('colorPanelHex');
    var addBtn = document.getElementById('colorPanelAdd');

    // 点击 hex 复制色值
    if (hexEl) {
      hexEl.addEventListener('click', function() {
        var text = hexEl.textContent;
        SFX.confirm();
        if (navigator.clipboard) {
          navigator.clipboard.writeText(text).then(function() {
            hexEl.classList.add('copied');
            hexEl.textContent = '已复制!';
            setTimeout(function() {
              hexEl.classList.remove('copied');
              hexEl.textContent = text;
            }, 800);
          });
        } else {
          // fallback
          var ta = document.createElement('textarea');
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          try { document.execCommand('copy'); } catch (e) {}
          document.body.removeChild(ta);
          hexEl.classList.add('copied');
          hexEl.textContent = '已复制!';
          setTimeout(function() {
            hexEl.classList.remove('copied');
            hexEl.textContent = text;
          }, 800);
        }
      });
    }

    // + 按钮添加当前颜色到调色板
    if (addBtn) {
      addBtn.addEventListener('click', function() {
        if (selectedColor) {
          addCustomColor(selectedColor);
          SFX.add();
        }
      });
    }
  }

  // ---- 色轮 ----
  var colorWheel = null;
  function bindColorWheel() {
    var overlay = document.getElementById('cwOverlay');
    var btnOpen = document.getElementById('btnColorWheel');
    var btnClose = document.getElementById('cwClose');

    btnOpen.addEventListener('click', function() {
      overlay.classList.add('show');
      SFX.open();
      var cur = engine.color || '#000000';
      var initColor = (cur === '#000000' || cur === '#ffffff') ? '#ff0000' : cur;
      if (!colorWheel) {
        colorWheel = new ColorWheel(document.getElementById('colorWheelContainer'), {
          color: initColor,
          onChange: function(hex) {
            var norm = normalizeColor(hex);
            if (norm) {
              engine.setColor(norm);
              selectedColor = norm;
              document.getElementById('colorPicker').value = norm;
              updateColorPanel(norm, false);
              document.querySelectorAll('.swatch').forEach(function(s) { s.classList.remove('active'); });
              throttledSfx(function() { SFX.pick(); });
              switchToPencil();
            }
          },
          onAddToPalette: function(hex) {
            addCustomColor(hex);
            SFX.add();
          },
        });
      } else {
        colorWheel.setColor(initColor);
      }
    });

    btnClose.addEventListener('click', function() { overlay.classList.remove('show'); SFX.close(); });
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) { overlay.classList.remove('show'); SFX.close(); }
    });

    var quantToggle = document.getElementById('quantizeToggle');
    var ditherRow = document.getElementById('ditherToggleRow');
    var extractToggle = document.getElementById('extractToggle');
    var extractRow = document.getElementById('extractToggleRow');
    quantToggle.addEventListener('change', function() {
      ditherRow.style.display = quantToggle.checked ? 'flex' : 'none';
      extractRow.style.display = quantToggle.checked ? 'flex' : 'none';
      if (!quantToggle.checked) extractToggle.checked = false;
      SFX.toggle();
    });
    ditherRow.style.display = quantToggle.checked ? 'flex' : 'none';
    extractRow.style.display = quantToggle.checked ? 'flex' : 'none';
    extractToggle.addEventListener('change', function() {
      if (extractToggle.checked && !quantToggle.checked) {
        quantToggle.checked = true;
        ditherRow.style.display = 'flex';
      }
      SFX.toggle();
    });
  }

  // ---- 工具栏 ----
  function bindToolbar() {
    document.querySelectorAll('[data-tool]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        SFX.select();
        if (isDeletingColor) {
          isDeletingColor = false;
        }
        if (engine.tool === 'crop' && btn.dataset.tool !== 'crop') {
          engine.clearCrop();
          document.getElementById('cropBar').style.display = 'none';
        }
        document.querySelectorAll('[data-tool]').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        engine.setTool(btn.dataset.tool);

        var eraserSizeControl = document.getElementById('eraserSizeControl');
        var penSizeControl = document.getElementById('penSizeControl');

        if (eraserSizeControl) {
          eraserSizeControl.style.display = btn.dataset.tool === 'eraser' ? 'flex' : 'none';
        }
        if (penSizeControl) {
          penSizeControl.style.display = btn.dataset.tool === 'pencil' ? 'flex' : 'none';
        }

        // 更新画布光标
        var cv = document.getElementById('drawCanvas');
        cv.classList.toggle('tool-pan', btn.dataset.tool === 'pan');
      });
    });

    // 图形子菜单
    var shapeSubmenu = document.getElementById('shapeSubmenu');
    var btnShape = document.getElementById('btnShape');
    var shapeIcon = document.getElementById('shapeIcon');
    var shapeIcons = {
      circle: '<circle cx="12" cy="12" r="8"/>',
      ellipse: '<ellipse cx="12" cy="12" rx="9" ry="6"/>',
      rect: '<rect x="4" y="5" width="16" height="14"/>',
      triangle: '<path d="M12 4l8 15H4z" stroke-linejoin="round"/>',
      star: '<path d="M12 3l2.5 6.5L21 10l-5 4.5L17.5 21 12 17.5 6.5 21 8 14.5 3 10l6.5-.5z" stroke-linejoin="round"/>',
      diamond: '<path d="M12 3l8 9-8 9-8-9z" stroke-linejoin="round"/>',
      heart: '<path d="M12 20s-7-4.5-7-10a4 4 0 017-2.5A4 4 0 0119 10c0 5.5-7 10-7 10z" stroke-linejoin="round"/>'
    };
    var currentShapeType = 'circle';

    // 点击主按钮：如果已是图形工具则切换菜单，否则激活图形工具
    btnShape.addEventListener('click', function(e) {
      e.stopPropagation();
      if (engine.tool === 'shape') {
        shapeSubmenu.classList.toggle('show');
      } else {
        // 激活图形工具
        SFX.select();
        document.querySelectorAll('[data-tool]').forEach(function(b) { b.classList.remove('active'); });
        btnShape.classList.add('active');
        engine.setTool('shape');
        shapeSubmenu.classList.add('show');
      }
    });

    document.querySelectorAll('.shape-option').forEach(function(opt) {
      opt.addEventListener('click', function(e) {
        e.stopPropagation();
        var shapeType = opt.dataset.shape;
        currentShapeType = shapeType;
        // 更新选中状态
        document.querySelectorAll('.shape-option').forEach(function(o) { o.classList.remove('active'); });
        opt.classList.add('active');
        // 更新主按钮图标
        shapeIcon.innerHTML = shapeIcons[shapeType] || shapeIcons.circle;
        // 设置引擎图形类型
        engine.setShapeType(shapeType);
        // 激活图形工具
        SFX.select();
        document.querySelectorAll('[data-tool]').forEach(function(b) { b.classList.remove('active'); });
        btnShape.classList.add('active');
        engine.setTool('shape');
        // 关闭子菜单
        shapeSubmenu.classList.remove('show');
      });
    });

    // 点击其他区域关闭子菜单
    document.addEventListener('click', function(e) {
      if (!shapeSubmenu.contains(e.target) && e.target !== btnShape) {
        shapeSubmenu.classList.remove('show');
      }
    });

    document.getElementById('btnUndo').addEventListener('click', function() {
      if (!undoOperation()) {
        SFX.error();
        alert('没有可撤销的操作');
      } else {
        SFX.undo();
        renderInactiveWindowPreviews();
      }
    });

    document.getElementById('btnRedo').addEventListener('click', function() {
      if (!redoOperation()) {
        SFX.error();
        alert('没有可重做的操作');
      } else {
        SFX.redo();
        renderInactiveWindowPreviews();
      }
    });

    document.getElementById('btnClear').addEventListener('click', function() {
      if (confirm('清空当前帧？')) {
        SFX.delete();
        engine.clear();
        // 清空也是操作，保存快照
        var idx = anim.current;
        anim.frames[idx] = engine.pixels.slice();
        pushSnapshot();
        renderInactiveWindowPreviews();
        autoSave();
      }
    });
    document.getElementById('btnGrid').addEventListener('click', function(e) {
      engine.showGrid = !engine.showGrid;
      e.currentTarget.classList.toggle('active', engine.showGrid);
      SFX.toggle();
      engine.render();
    });

    var eraserSizeSlider = document.getElementById('eraserSizeSlider');
    var eraserSizeLabel = document.getElementById('eraserSizeLabel');
    if (eraserSizeSlider && eraserSizeLabel) {
      eraserSizeSlider.addEventListener('input', function() {
        var size = parseInt(eraserSizeSlider.value);
        engine.setEraserSize(size);
        eraserSizeLabel.textContent = size + 'px';
        throttledSfx(function() { SFX.click(); });
      });
    }

    var penSizeSlider = document.getElementById('penSizeSlider');
    var penSizeLabel = document.getElementById('penSizeLabel');
    if (penSizeSlider && penSizeLabel) {
      penSizeSlider.addEventListener('input', function() {
        var size = parseInt(penSizeSlider.value);
        engine.setPenSize(size);
        penSizeLabel.textContent = size + 'px';
        throttledSfx(function() { SFX.click(); });
      });
    }
  }

  // ---- 帧列表 ----
  function bindFrames() {
    var origAdd = anim.addFrame.bind(anim);
    var origDup = anim.duplicateFrame.bind(anim);
    var origDel = anim.deleteFrame.bind(anim);
    var origMove = anim.moveFrame.bind(anim);

    anim.addFrame = function() {
      origAdd();
      SFX.add();
      // 保存快照
      pushSnapshot();
      renderFrameList();
      renderLayerList();
      renderInactiveWindowPreviews();
      autoSave();
    };

    anim.duplicateFrame = function() {
      origDup();
      SFX.add();
      pushSnapshot();
      renderFrameList();
      renderLayerList();
      renderInactiveWindowPreviews();
      autoSave();
    };

    anim.deleteFrame = function() {
      origDel();
      SFX.delete();
      pushSnapshot();
      renderFrameList();
      renderLayerList();
      renderInactiveWindowPreviews();
      autoSave();
    };

    anim.moveFrame = function(from, to) {
      origMove(from, to);
      pushSnapshot();
      renderFrameList();
      renderLayerList();
      renderInactiveWindowPreviews();
      autoSave();
    };

    document.getElementById('btnAddFrame').addEventListener('click', function() {
      anim.addFrame();
    });
    document.getElementById('btnDupFrame').addEventListener('click', function() {
      anim.duplicateFrame();
    });
    document.getElementById('btnDelFrame').addEventListener('click', function() {
      if (anim.frames.length <= 1) {
        alert('至少保留一帧，无法删除。');
        return;
      }
      anim.deleteFrame();
    });

    document.getElementById('btnDelAllFrames').addEventListener('click', function() {
      if (anim.frames.length <= 1) {
        alert('当前只有一帧，无需清空。');
        return;
      }
      if (!confirm('确定删除所有帧？\n这将清空全部 ' + anim.frames.length + ' 帧动画，仅保留一个空白帧。\n此操作可通过撤销(Ctrl+Z)恢复。')) return;
      // 重置为单个空白帧
      anim.frames = [LayerUtils.createFrame(anim.width, anim.height, 'Background')];
      anim.current = 0;
      anim.engine.loadFrame(anim.frames[0]);
      SFX.delete();
      pushSnapshot();
      renderFrameList();
      renderLayerList();
      renderInactiveWindowPreviews();
      autoSave();
    });
  }

  function renderFrameList() {
    var list = document.getElementById('frameList');
    list.innerHTML = '';

    if (anim.frames.length === 0) {
      var emptyMsg = document.createElement('div');
      emptyMsg.className = 'empty-frames-msg';
      emptyMsg.textContent = '暂无帧，点击 "新帧" 创建';
      list.appendChild(emptyMsg);
      autoSave();
      return;
    }

    var w = engine.width, h = engine.height;
    var thumbPs = Math.max(1, Math.ceil(48 / Math.max(w, h)));

    anim.frames.forEach(function(frameData, i) {
      // 使用合成像素渲染缩略图
      var frame = LayerUtils.getCompositePixels(frameData, w, h);
      var item = document.createElement('div');
      item.className = 'frame-item' + (i === anim.current ? ' active' : '');
      item.draggable = true;
      item.dataset.index = i;

      item.addEventListener('dragstart', function(e) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(i));
        setTimeout(function() { item.classList.add('dragging'); }, 0);
      });

      item.addEventListener('dragend', function() {
        item.classList.remove('dragging');
        document.querySelectorAll('.frame-item.drag-over').forEach(function(el) {
          el.classList.remove('drag-over');
        });
      });

      item.addEventListener('dragover', function(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        document.querySelectorAll('.frame-item.drag-over').forEach(function(el) {
          if (el !== item) el.classList.remove('drag-over');
        });
        item.classList.add('drag-over');
      });

      item.addEventListener('dragleave', function() {
        item.classList.remove('drag-over');
      });

      item.addEventListener('drop', function(e) {
        e.preventDefault();
        item.classList.remove('drag-over');
        var fromIndex = parseInt(e.dataTransfer.getData('text/plain'));
        var toIndex = parseInt(item.dataset.index);
        if (fromIndex !== toIndex && !isNaN(fromIndex) && !isNaN(toIndex)) {
          anim.moveFrame(fromIndex, toIndex);
          renderFrameList();
          var activeItem = list.querySelector('.frame-item.active');
          if (activeItem) {
            activeItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
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

      item.addEventListener('click', function() { anim.selectFrame(i); SFX.frameSelect(); });
      list.appendChild(item);
    });
    autoSave();
  }

  function updateFrameListSelection(index) {
    document.querySelectorAll('.frame-item').forEach(function(el, i) {
      el.classList.toggle('active', i === index);
    });
  }

  // ---- 播放控制 ----
  function bindPlayback() {
    var btnPlay = document.getElementById('btnPlay');
    btnPlay.addEventListener('click', function() {
      if (anim.playing) {
        anim.stop();
        btnPlay.textContent = '播放';
        SFX.stop();
        renderInactiveWindowPreviews();
      } else {
        anim.play();
        btnPlay.textContent = '停止';
        SFX.play();
      }
    });

    var fpsSlider = document.getElementById('fpsSlider');
    var fpsLabel = document.getElementById('fpsLabel');
    fpsSlider.addEventListener('input', function() {
      var fps = parseInt(fpsSlider.value);
      anim.setFps(fps);
      fpsLabel.textContent = fps + ' FPS';
      throttledSfx(function() { SFX.click(); });
    });

    var onionBtn = document.getElementById('btnOnion');
    onionBtn.addEventListener('click', function(e) {
      var on = anim.toggleOnionSkin();
      this.classList.toggle('active', on);
      SFX.toggle();
    });
    onionBtn.classList.toggle('active', anim.onionSkin);
  }

  // ---- 导出与保存 ----
  function bindExport() {
    document.getElementById('btnGif').addEventListener('click', function() { SFX.click(); exportGif(); });
    document.getElementById('btnSave').addEventListener('click', function() { SFX.click(); saveWork(); });
    document.getElementById('btnPng').addEventListener('click', function() { SFX.click(); showExportPngOptions(); });
    document.getElementById('btnSaveLocal').addEventListener('click', function() { SFX.click(); saveToLocalFile(); });
    document.getElementById('btnLoadLocal').addEventListener('click', function() { SFX.click(); document.getElementById('projectFileInput').click(); });
    document.getElementById('projectFileInput').addEventListener('change', function(e) {
      var file = e.target.files[0];
      if (file) loadFromLocalFile(file);
      e.target.value = '';
    });

    document.getElementById('batchModalClose').addEventListener('click', function() { SFX.close(); closeBatchModal(); });
    document.getElementById('batchExportCancel').addEventListener('click', function() { SFX.close(); closeBatchModal(); });
    document.getElementById('batchSelectAll').addEventListener('click', function() { SFX.click(); batchSelectAll(true); });
    document.getElementById('batchDeselectAll').addEventListener('click', function() { SFX.click(); batchSelectAll(false); });
    document.getElementById('batchExportConfirm').addEventListener('click', function() { SFX.save(); batchExportSelected(); });
    document.getElementById('batchModal').addEventListener('click', function(e) {
      if (e.target === this) closeBatchModal();
    });

    // 画布导出选择模态框
    document.getElementById('canvasExportClose').addEventListener('click', function() { SFX.close(); closeCanvasExportModal(); });
    document.getElementById('canvasExportCancelBtn').addEventListener('click', function() { SFX.close(); closeCanvasExportModal(); });
    document.getElementById('canvasExportSelectAll').addEventListener('click', function() { SFX.click(); canvasExportSelectAll(true); });
    document.getElementById('canvasExportDeselectAll').addEventListener('click', function() { SFX.click(); canvasExportSelectAll(false); });
    document.getElementById('canvasExportConfirmBtn').addEventListener('click', function() { SFX.save(); canvasExportConfirm(); });
    document.getElementById('canvasExportModal').addEventListener('click', function(e) {
      if (e.target === this) closeCanvasExportModal();
    });
  }

  // ---- 导出 PNG 选项 ----
  function showExportPngOptions() {
    if (canvasTabs.length > 1) {
      showCanvasExportModal('png');
    } else {
      var userChoice = confirm('点击"确定"导出当前帧，点击"取消"进入批量导出选择。');
      if (userChoice) {
        exportPng();
      } else {
        openBatchModal();
      }
    }
  }

  // ---- 批量导出模态框 ----
  var batchSelected = new Set();

  function openBatchModal() {
    var modal = document.getElementById('batchModal');
    modal.style.display = 'flex';
    SFX.open();
    renderBatchFrameList();
  }

  function closeBatchModal() {
    document.getElementById('batchModal').style.display = 'none';
    batchSelected.clear();
  }

  function renderBatchFrameList() {
    var container = document.getElementById('batchFrameList');
    container.innerHTML = '';
    var frames = anim.getAllFrames();
    var w = engine.width, h = engine.height;
    var thumbPs = Math.max(1, Math.ceil(60 / Math.max(w, h)));

    frames.forEach(function(frame, idx) {
      var card = document.createElement('div');
      card.className = 'batch-frame-card';
      if (batchSelected.has(idx)) card.classList.add('selected');

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
      card.appendChild(thumb);

      var check = document.createElement('div');
      check.className = 'check-mark';
      check.textContent = '✓';
      card.appendChild(check);

      var indexLabel = document.createElement('div');
      indexLabel.className = 'frame-index';
      indexLabel.textContent = idx + 1;
      card.appendChild(indexLabel);

      card.addEventListener('click', function(e) {
        e.stopPropagation();
        SFX.click();
        if (batchSelected.has(idx)) {
          batchSelected.delete(idx);
          this.classList.remove('selected');
        } else {
          batchSelected.add(idx);
          this.classList.add('selected');
        }
        updateBatchCount();
      });

      container.appendChild(card);
    });
    updateBatchCount();
  }

  function updateBatchCount() {
    var btn = document.getElementById('batchExportConfirm');
    btn.textContent = '导出选中 (' + batchSelected.size + ')';
    btn.disabled = (batchSelected.size === 0);
  }

  function batchSelectAll(select) {
    var total = anim.frames.length;
    for (var i = 0; i < total; i++) {
      if (select) batchSelected.add(i);
      else batchSelected.delete(i);
    }
    renderBatchFrameList();
  }

  function batchExportSelected() {
    if (batchSelected.size === 0) return;
    var frames = anim.getAllFrames();
    var w = engine.width, h = engine.height;
    var selected = Array.from(batchSelected).sort(function(a,b) { return a-b; });
    var count = 0;
    for (var idx = 0; idx < selected.length; idx++) {
      var frame = frames[selected[idx]];
      var canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      var ctx = canvas.getContext('2d');
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          var c = frame[y * w + x];
          if (c) { ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1); }
        }
      }
      var a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = 'frame_' + String(selected[idx]+1).padStart(3, '0') + '.png';
      a.click();
      count++;
    }
    closeBatchModal();
    alert('已导出 ' + count + ' 张图片。');
  }

  // ---- 画布导出选择模态框 ----
  var canvasExportSelected = new Set();
  var canvasExportMode = 'png';

  function showCanvasExportModal(mode) {
    canvasExportMode = mode;
    canvasExportSelected.clear();
    saveCurrentTabState();
    var modal = document.getElementById('canvasExportModal');
    var title = document.getElementById('canvasExportTitle');
    title.textContent = mode === 'gif' ? '选择要导出GIF的画布（可多选）' : '选择要导出PNG的画布（可多选）';
    modal.style.display = 'flex';
    SFX.open();
    renderCanvasExportList();
  }

  function closeCanvasExportModal() {
    document.getElementById('canvasExportModal').style.display = 'none';
    canvasExportSelected.clear();
  }

  function renderCanvasExportList() {
    var container = document.getElementById('canvasExportList');
    container.innerHTML = '';

    canvasTabs.forEach(function(tab, i) {
      var card = document.createElement('div');
      card.className = 'canvas-export-card';
      if (canvasExportSelected.has(i)) card.classList.add('selected');

      var frame = LayerUtils.getCompositePixels(tab.frames[tab.currentFrame || 0], tab.canvasW, tab.canvasH);
      var thumbPs = Math.max(1, Math.ceil(80 / Math.max(tab.canvasW, tab.canvasH)));
      var thumb = document.createElement('canvas');
      thumb.width = tab.canvasW * thumbPs;
      thumb.height = tab.canvasH * thumbPs;
      var ctx = thumb.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, thumb.width, thumb.height);
      for (var y = 0; y < tab.canvasH; y++) {
        for (var x = 0; x < tab.canvasW; x++) {
          var c = frame[y * tab.canvasW + x];
          if (c) { ctx.fillStyle = c; ctx.fillRect(x * thumbPs, y * thumbPs, thumbPs, thumbPs); }
        }
      }
      card.appendChild(thumb);

      var check = document.createElement('div');
      check.className = 'check-mark';
      check.textContent = '\u2713';
      card.appendChild(check);

      var name = document.createElement('div');
      name.className = 'card-name';
      name.textContent = tab.name;
      card.appendChild(name);

      var info = document.createElement('div');
      info.className = 'card-info';
      info.textContent = tab.canvasW + '\u00d7' + tab.canvasH + ' | ' + tab.frames.length + ' \u5e27';
      card.appendChild(info);

      card.addEventListener('click', function() {
        SFX.click();
        if (canvasExportSelected.has(i)) {
          canvasExportSelected.delete(i);
          card.classList.remove('selected');
        } else {
          canvasExportSelected.add(i);
          card.classList.add('selected');
        }
        updateCanvasExportCount();
      });

      container.appendChild(card);
    });
    updateCanvasExportCount();
  }

  function updateCanvasExportCount() {
    var btn = document.getElementById('canvasExportConfirmBtn');
    btn.textContent = '\u5bfc\u51fa\u9009\u4e2d (' + canvasExportSelected.size + ')';
    btn.disabled = canvasExportSelected.size === 0;
  }

  function canvasExportSelectAll(select) {
    for (var i = 0; i < canvasTabs.length; i++) {
      if (select) canvasExportSelected.add(i);
      else canvasExportSelected.delete(i);
    }
    renderCanvasExportList();
  }

  function canvasExportConfirm() {
    if (canvasExportSelected.size === 0) return;
    saveCurrentTabState();
    var indices = Array.from(canvasExportSelected).sort(function(a, b) { return a - b; });
    closeCanvasExportModal();

    if (canvasExportMode === 'png') {
      exportCanvasPngs(indices);
    } else {
      exportCanvasGifs(indices);
    }
  }

  function exportCanvasPngs(indices) {
    var count = 0;
    for (var idx = 0; idx < indices.length; idx++) {
      var tab = canvasTabs[indices[idx]];
      var w = tab.canvasW, h = tab.canvasH;
      var frame = LayerUtils.getCompositePixels(tab.frames[tab.currentFrame || 0], w, h);
      var canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      var ctx = canvas.getContext('2d');
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          var c = frame[y * w + x];
          if (c) { ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1); }
        }
      }
      var a = document.createElement('a');
      var safeName = tab.name.replace(/[<>:"/\\|?*]/g, '_');
      a.href = canvas.toDataURL('image/png');
      a.download = safeName + '.png';
      a.click();
      count++;
    }
    alert('已导出 ' + count + ' 张PNG图片。');
    SFX.save();
  }

  async function exportCanvasGifs(indices) {
    var scale = parseInt(document.getElementById('gifScale').value) || 1;
    var progressBar = document.getElementById('gifProgress');
    var gifBtn = document.getElementById('btnGif');
    var gifBtnText = gifBtn.textContent;

    try {
      var workerRes = await fetch('lib/gif.js/gif.worker.js');
      if (!workerRes.ok) throw new Error('Worker 脚本加载失败 (' + workerRes.status + ')');
      var workerCode = await workerRes.text();
      var workerBlob = new Blob([workerCode], { type: 'application/javascript' });
      var workerUrl = URL.createObjectURL(workerBlob);

      for (var tIdx = 0; tIdx < indices.length; tIdx++) {
        var tab = canvasTabs[indices[tIdx]];
        var w = tab.canvasW, h = tab.canvasH;
        var outW = w * scale, outH = h * scale;
        var frames = tab.frames.map(function(f) {
          return LayerUtils.getCompositePixels(f, w, h);
        });

        gifBtn.textContent = '生成中 ' + (tIdx + 1) + '/' + indices.length + '...';
        if (progressBar) {
          progressBar.style.display = 'block';
          progressBar.querySelector('.gif-progress-fill').style.width = '0%';
          progressBar.querySelector('.gif-progress-text').textContent = '0%';
        }

        var gif = new GIF({
          workers: 2,
          quality: 10,
          width: outW,
          height: outH,
          workerScript: workerUrl,
          dither: false,
        });

        var frameDelay = Math.round(1000 / (tab.fps || 12));

        frames.forEach(function(frame) {
          var tmp = document.createElement('canvas');
          tmp.width = w;
          tmp.height = h;
          var ctx = tmp.getContext('2d');
          var imgData = ctx.createImageData(w, h);
          var buf = imgData.data;
          for (var y = 0; y < h; y++) {
            for (var x = 0; x < w; x++) {
              var c = frame[y * w + x];
              var idx = (y * w + x) * 4;
              if (c) {
                buf[idx] = parseInt(c.slice(1, 3), 16);
                buf[idx + 1] = parseInt(c.slice(3, 5), 16);
                buf[idx + 2] = parseInt(c.slice(5, 7), 16);
                buf[idx + 3] = 255;
              } else {
                buf[idx] = 255; buf[idx + 1] = 255; buf[idx + 2] = 255; buf[idx + 3] = 255;
              }
            }
          }
          ctx.putImageData(imgData, 0, 0);
          if (scale > 1) {
            var scaled = document.createElement('canvas');
            scaled.width = outW;
            scaled.height = outH;
            var sctx = scaled.getContext('2d');
            sctx.imageSmoothingEnabled = false;
            sctx.drawImage(tmp, 0, 0, outW, outH);
            gif.addFrame(scaled, { delay: frameDelay, copy: true });
          } else {
            gif.addFrame(tmp, { delay: frameDelay, copy: true });
          }
        });

        await new Promise(function(resolve) {
          gif.on('progress', function(p) {
            var pct = Math.round(p * 100);
            if (progressBar) {
              progressBar.querySelector('.gif-progress-fill').style.width = pct + '%';
              progressBar.querySelector('.gif-progress-text').textContent = pct + '%';
            }
            gifBtn.textContent = '生成中 ' + (tIdx + 1) + '/' + indices.length + ' (' + pct + '%)';
          });
          gif.on('finished', function(blob) {
            var a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            var safeName = tab.name.replace(/[<>:"/\\|?*]/g, '_');
            a.download = safeName + '.gif';
            a.click();
            URL.revokeObjectURL(a.href);
            resolve();
          });
          gif.render();
        });
      }

      URL.revokeObjectURL(workerUrl);
      if (window.SFX) SFX.save();
      if (progressBar) { setTimeout(function() { progressBar.style.display = 'none'; }, 1000); }
      gifBtn.textContent = gifBtnText;
      alert('已导出 ' + indices.length + ' 个GIF动画。');
    } catch (err) {
      console.error('GIF 导出错误:', err);
      gifBtn.textContent = gifBtnText;
      if (progressBar) progressBar.style.display = 'none';
      alert('GIF 导出失败: ' + err.message);
    }
  }

  // ---- 照片转像素 ----
  function bindImport() {
    var btn = document.getElementById('btnImportImg');
    var input = document.getElementById('imgInput');
    btn.addEventListener('click', function() { SFX.click(); input.click(); });
    input.addEventListener('change', function(e) {
      var files = Array.from(e.target.files);
      if (files.length === 0) return;
      importImages(files);
      input.value = '';
    });
  }

  function importImages(files) {
    var hint = document.getElementById('importHint');
    var n = files.length;
    if (hint) hint.textContent = '正在读取 ' + n + ' 张图片...';

    var opts = readImportOptions();
    var images = new Array(n);
    var loaded = 0;

    files.forEach(function(file, idx) {
      var reader = new FileReader();
      reader.onload = function(ev) {
        var img = new Image();
        img.onload = function() { images[idx] = img; done(); };
        img.onerror = function() { done(); };
        img.src = ev.target.result;
      };
      reader.onerror = function() { done(); };
      reader.readAsDataURL(file);
    });

    function done() {
      loaded++;
      if (hint) hint.textContent = '已读取 ' + loaded + '/' + n;
      if (loaded < n) return;
      processAllImages(images.filter(Boolean), opts, hint);
    }
  }

  function readImportOptions() {
    return {
      quantize: document.getElementById('quantizeToggle').checked,
      dither: document.getElementById('ditherToggle').checked,
      extract: document.getElementById('extractToggle').checked,
      enhance: document.getElementById('enhanceToggle').checked,
      fitMode: document.getElementById('fitMode').value || 'contain',
    };
  }

  function processAllImages(images, opts, hint) {
    var w = engine.width, h = engine.height;

    var framesData = [];
    for (var imgIdx = 0; imgIdx < images.length; imgIdx++) {
      var img = images[imgIdx];
      var ctx = drawToCanvas(img, w, h, opts.fitMode);
      var data = ctx.getImageData(0, 0, w, h);
      if (opts.enhance) data = enhanceImageData(data);
      framesData.push(data);
    }
    if (framesData.length === 0) { if (hint) hint.textContent = '没有有效图片'; return; }

    var palette = getActivePalette();
    var extractedCount = 0;
    if (opts.quantize && opts.extract) {
      var sampled = [];
      for (var dataIdx = 0; dataIdx < framesData.length; dataIdx++) {
        samplePixels(framesData[dataIdx].data, sampled, 4000);
      }
      var extracted = medianCut(sampled, 64);
      extractedCount = extracted.length;
      // 提取的颜色仅用于本次量化，不添加到调色板
      palette = getActivePalette().concat(extracted);
      if (hint) hint.textContent = '已提取 ' + extractedCount + ' 种主色调用于量化...';
    }

    // 导入图片前，先同步当前帧
    anim.syncCurrentFrame();
    var currentFrameIndex = anim.current;
    // 处理第一张图片覆盖当前帧活动图层，其余新增帧
    engine.pushHistory();
    for (var dataIdx2 = 0; dataIdx2 < framesData.length; dataIdx2++) {
      var data = framesData[dataIdx2];
      var pixels = opts.quantize
        ? quantizeFrame(data.data, w, h, palette, opts.dither)
        : directSample(data.data, w, h);

      for (var p = 0; p < pixels.length; p++) {
        if (pixels[p] !== null) {
          var norm = normalizeColor(pixels[p]);
          if (norm !== null) pixels[p] = norm;
        }
      }

      if (dataIdx2 === 0) {
        // 写入当前帧的活动图层
        var frame0 = anim.frames[anim.current];
        if (LayerUtils.isLayerFrame(frame0)) {
          var activeL = LayerUtils.getActiveLayer(frame0);
          if (activeL) activeL.pixels = pixels.slice();
        } else {
          anim.frames[anim.current] = LayerUtils.convertLegacyFrame(pixels, w, h);
        }
        engine.loadFrame(anim.frames[anim.current]);
      } else {
        // 新增帧，使用导入的像素作为背景图层
        var newFrame = LayerUtils.createFrame(w, h, 'Background');
        newFrame.layers[0].pixels = pixels.slice();
        anim.frames.splice(anim.current + 1, 0, newFrame);
        anim.current++;
        engine.loadFrame(newFrame);
      }
    }
    renderFrameList();
    renderLayerList();
    // 保存快照
    pushSnapshot();
    renderInactiveWindowPreviews();

    if (hint) {
      var msg = framesData.length + ' 张图片已转为' + (framesData.length > 1 ? '帧序列' : '像素');
      if (extractedCount > 0) msg += '（提取 ' + extractedCount + ' 色已加入调色板）';
      hint.textContent = msg;
      setTimeout(function() { if (hint) hint.textContent = ''; }, 5000);
    }
    autoSave();
  }

  function drawToCanvas(img, w, h, fitMode) {
    var tmp = document.createElement('canvas');
    tmp.width = w; tmp.height = h;
    var ctx = tmp.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, w, h);

    var iw = img.width, ih = img.height;
    if (fitMode === 'stretch') {
      ctx.drawImage(img, 0, 0, iw, ih, 0, 0, w, h);
    } else if (fitMode === 'contain') {
      var scale = Math.min(w / iw, h / ih);
      var sw = iw * scale, sh = ih * scale;
      var dx = (w - sw) / 2, dy = (h - sh) / 2;
      ctx.drawImage(img, 0, 0, iw, ih, dx, dy, sw, sh);
    } else {
      var scale2 = Math.max(w / iw, h / ih);
      var sw2 = w / scale2, sh2 = h / scale2;
      var sx = (iw - sw2) / 2, sy = (ih - sh2) / 2;
      ctx.drawImage(img, sx, sy, sw2, sh2, 0, 0, w, h);
    }
    return ctx;
  }

  function enhanceImageData(imageData) {
    var d = imageData.data;
    var satBoost = 1.35;
    var conBoost = 1.18;
    var conMid = 128;
    for (var i = 0; i < d.length; i += 4) {
      var r = d[i], g = d[i + 1], b = d[i + 2];
      r = conMid + (r - conMid) * conBoost;
      g = conMid + (g - conMid) * conBoost;
      b = conMid + (b - conMid) * conBoost;
      var gray = 0.299 * r + 0.587 * g + 0.114 * b;
      r = gray + (r - gray) * satBoost;
      g = gray + (g - gray) * satBoost;
      b = gray + (b - gray) * satBoost;
      d[i] = Math.max(0, Math.min(255, r));
      d[i + 1] = Math.max(0, Math.min(255, g));
      d[i + 2] = Math.max(0, Math.min(255, b));
    }
    return imageData;
  }

  function samplePixels(data, out, maxCount) {
    var total = data.length / 4;
    var step = Math.max(1, Math.floor(total / maxCount));
    for (var i = 0; i < total; i += step) {
      var idx = i * 4;
      if (data[idx + 3] < 128) continue;
      out.push([data[idx], data[idx + 1], data[idx + 2]]);
    }
  }

  function medianCut(pixels, numColors) {
    if (pixels.length === 0) return [];
    var boxes = [pixels];
    while (boxes.length < numColors) {
      var maxBox = -1, maxVar = -1;
      for (var i = 0; i < boxes.length; i++) {
        if (boxes[i].length < 2) continue;
        var v = boxVariance(boxes[i]);
        if (v > maxVar) { maxVar = v; maxBox = i; }
      }
      if (maxBox === -1) break;
      var box = boxes[maxBox];
      var ch = boxMaxChannel(box);
      box.sort(function(a, b) { return a[ch] - b[ch]; });
      var mid = Math.floor(box.length / 2);
      boxes.splice(maxBox, 1, box.slice(0, mid), box.slice(mid));
    }
    return boxes.map(function(box) {
      var r = 0, g = 0, b = 0;
      for (var p = 0; p < box.length; p++) { r += box[p][0]; g += box[p][1]; b += box[p][2]; }
      var n = box.length;
      return rgbToHex(r / n, g / n, b / n);
    });
  }

  function boxVariance(box) {
    var n = box.length;
    var mr = 0, mg = 0, mb = 0;
    for (var p = 0; p < box.length; p++) { mr += box[p][0]; mg += box[p][1]; mb += box[p][2]; }
    mr /= n; mg /= n; mb /= n;
    var vr = 0, vg = 0, vb = 0;
    for (var p = 0; p < box.length; p++) { vr += (box[p][0]-mr)*(box[p][0]-mr); vg += (box[p][1]-mg)*(box[p][1]-mg); vb += (box[p][2]-mb)*(box[p][2]-mb); }
    return vr + vg + vb;
  }

  function boxMaxChannel(box) {
    var mn = [255,255,255], mx = [0,0,0];
    for (var p = 0; p < box.length; p++) {
      for (var c = 0; c < 3; c++) { if (box[p][c]<mn[c]) mn[c]=box[p][c]; if (box[p][c]>mx[c]) mx[c]=box[p][c]; }
    }
    var dr = mx[0]-mn[0], dg = mx[1]-mn[1], db = mx[2]-mn[2];
    if (dr >= dg && dr >= db) return 0;
    if (dg >= db) return 1;
    return 2;
  }

  function directSample(data, w, h) {
    var pixels = new Array(w * h).fill(null);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = (y * w + x) * 4;
        if (data[i + 3] < 128) { pixels[y * w + x] = null; continue; }
        pixels[y * w + x] = rgbToHex(data[i], data[i + 1], data[i + 2]);
      }
    }
    return pixels;
  }

  function quantizeFrame(data, w, h, palette, dither) {
    var pixels = new Array(w * h).fill(null);
    if (dither) {
      var buf = new Float32Array(w * h * 3);
      for (var i = 0; i < w * h; i++) {
        buf[i*3] = data[i*4]; buf[i*3+1] = data[i*4+1]; buf[i*3+2] = data[i*4+2];
      }
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          if (data[(y*w+x)*4+3] < 128) { pixels[y*w+x] = null; continue; }
          var idx = (y*w+x)*3;
          var r = Math.max(0, Math.min(255, buf[idx]));
          var g = Math.max(0, Math.min(255, buf[idx+1]));
          var b = Math.max(0, Math.min(255, buf[idx+2]));
          var hex = nearestPaletteColor(r, g, b, palette);
          pixels[y*w+x] = hex;
          var pr = parseInt(hex.slice(1,3),16);
          var pg = parseInt(hex.slice(3,5),16);
          var pb = parseInt(hex.slice(5,7),16);
          var er = r-pr, eg = g-pg, eb = b-pb;
          if (x+1 < w) { var ni=(y*w+x+1)*3; buf[ni]+=er*7/16; buf[ni+1]+=eg*7/16; buf[ni+2]+=eb*7/16; }
          if (y+1 < h) {
            if (x>0) { var ni=((y+1)*w+x-1)*3; buf[ni]+=er*3/16; buf[ni+1]+=eg*3/16; buf[ni+2]+=eb*3/16; }
            { var ni=((y+1)*w+x)*3; buf[ni]+=er*5/16; buf[ni+1]+=eg*5/16; buf[ni+2]+=eb*5/16; }
            if (x+1<w) { var ni=((y+1)*w+x+1)*3; buf[ni]+=er*1/16; buf[ni+1]+=eg*1/16; buf[ni+2]+=eb*1/16; }
          }
        }
      }
    } else {
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          var i = (y*w+x)*4;
          if (data[i+3] < 128) { pixels[y*w+x] = null; continue; }
          pixels[y*w+x] = nearestPaletteColor(data[i], data[i+1], data[i+2], palette);
        }
      }
    }
    return pixels;
  }

  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(function(v) { return Math.round(v).toString(16).padStart(2, '0'); }).join('');
  }

  function nearestPaletteColor(r, g, b, palette) {
    palette = palette || getActivePalette();
    var best = palette[0], bestDist = Infinity;
    for (var i = 0; i < palette.length; i++) {
      var c = palette[i];
      var pr = parseInt(c.slice(1, 3), 16);
      var pg = parseInt(c.slice(3, 5), 16);
      var pb = parseInt(c.slice(5, 7), 16);
      var ravg = (r + pr) / 2;
      var dr = r - pr, dg = g - pg, db = b - pb;
      var dist = (2 + ravg / 256) * dr * dr + 4 * dg * dg + (2 + (255 - ravg) / 256) * db * db;
      if (dist < bestDist) { bestDist = dist; best = c; }
    }
    return best;
  }

  // ---- 视频转帧 ----
  function bindVideoImport() {
    var btn = document.getElementById('btnImportVideo');
    var input = document.getElementById('videoInput');
    if (!btn || !input) return;
    btn.addEventListener('click', function() { SFX.click(); input.click(); });
    input.addEventListener('change', function(e) {
      var file = e.target.files[0];
      if (file) importVideo(file);
      input.value = '';
    });
  }

  function importVideo(file) {
    var hint = document.getElementById('videoImportHint');
    var info = document.getElementById('videoInfo');
    var progressBar = document.getElementById('videoProgress');

    if (!file.type.startsWith('video/')) {
      if (hint) hint.textContent = '请选择视频文件';
      return;
    }

    if (hint) hint.textContent = '正在加载视频...';
    if (info) info.textContent = '';

    var url = URL.createObjectURL(file);
    var video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;

    var cleaned = false;
    function cleanup() {
      if (cleaned) return;
      cleaned = true;
      URL.revokeObjectURL(url);
    }

    video.addEventListener('loadedmetadata', function() {
      var duration = video.duration;
      if (isNaN(duration) || duration <= 0) {
        if (hint) hint.textContent = '无法读取视频时长';
        cleanup();
        return;
      }
      if (duration > 60) {
        if (hint) hint.textContent = '视频时长 ' + duration.toFixed(1) + 's，超过 60 秒限制';
        alert('视频时长不能超过 60 秒！\n当前时长: ' + duration.toFixed(1) + ' 秒');
        cleanup();
        return;
      }

      var fps = parseInt(document.getElementById('videoFps').value);
      var totalFrames = Math.max(1, Math.ceil(duration * fps));

      if (info) info.textContent = '时长: ' + duration.toFixed(1) + 's | 帧率: ' + fps + ' FPS | 预计: ' + totalFrames + ' 帧';
      if (hint) hint.textContent = '准备提取帧...';

      // 等待视频可以播放后再开始提取
      if (video.readyState >= 2) {
        extractVideoFrames(video, fps, totalFrames, hint, progressBar, cleanup);
      } else {
        video.addEventListener('canplay', function() {
          extractVideoFrames(video, fps, totalFrames, hint, progressBar, cleanup);
        }, { once: true });
      }
    });

    video.addEventListener('error', function() {
      if (hint) hint.textContent = '视频加载失败，请检查文件格式';
      cleanup();
    });

    video.src = url;
  }

  async function extractVideoFrames(video, fps, totalFrames, hint, progressBar, cleanup) {
    var w = engine.width, h = engine.height;
    var opts = readImportOptions();
    var progressFill = progressBar ? progressBar.querySelector('.video-progress-fill') : null;
    var progressText = progressBar ? progressBar.querySelector('.video-progress-text') : null;

    if (progressBar) {
      progressBar.style.display = 'flex';
      if (progressFill) progressFill.style.width = '0%';
      if (progressText) progressText.textContent = '0%';
    }

    var framesData = [];

    for (var i = 0; i < totalFrames; i++) {
      var time = i / fps;
      if (hint) hint.textContent = '正在提取帧 ' + (i + 1) + '/' + totalFrames;

      // Seek 到目标时间点
      await new Promise(function(resolve) {
        function onSeeked() {
          video.removeEventListener('seeked', onSeeked);
          resolve();
        }
        video.addEventListener('seeked', onSeeked);
        video.currentTime = Math.min(time, video.duration);
      });

      // 绘制视频帧到画布并提取像素数据
      var ctx = drawVideoToCanvas(video, w, h, opts.fitMode);
      var data = ctx.getImageData(0, 0, w, h);
      if (opts.enhance) data = enhanceImageData(data);
      framesData.push(data);

      // 更新进度条
      var pct = Math.round((i + 1) / totalFrames * 100);
      if (progressFill) progressFill.style.width = pct + '%';
      if (progressText) progressText.textContent = pct + '%';

      // 让出 UI 线程，避免页面卡死
      await new Promise(function(resolve) { setTimeout(resolve, 0); });
    }

    processVideoFrames(framesData, opts, hint, progressBar, cleanup);
  }

  function drawVideoToCanvas(video, w, h, fitMode) {
    var tmp = document.createElement('canvas');
    tmp.width = w; tmp.height = h;
    var ctx = tmp.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, w, h);

    var iw = video.videoWidth || 320;
    var ih = video.videoHeight || 240;

    if (fitMode === 'stretch') {
      ctx.drawImage(video, 0, 0, iw, ih, 0, 0, w, h);
    } else if (fitMode === 'contain') {
      var scale = Math.min(w / iw, h / ih);
      var sw = iw * scale, sh = ih * scale;
      var dx = (w - sw) / 2, dy = (h - sh) / 2;
      ctx.drawImage(video, 0, 0, iw, ih, dx, dy, sw, sh);
    } else {
      // cover
      var scale2 = Math.max(w / iw, h / ih);
      var sw2 = w / scale2, sh2 = h / scale2;
      var sx = (iw - sw2) / 2, sy = (ih - sh2) / 2;
      ctx.drawImage(video, sx, sy, sw2, sh2, 0, 0, w, h);
    }
    return ctx;
  }

  function processVideoFrames(framesData, opts, hint, progressBar, cleanup) {
    var w = engine.width, h = engine.height;
    var palette = getActivePalette();
    var extractedCount = 0;

    // 如果开启提取主色调，从所有帧采样
    if (opts.quantize && opts.extract) {
      var sampled = [];
      for (var i = 0; i < framesData.length; i++) {
        samplePixels(framesData[i].data, sampled, 4000);
      }
      var extracted = medianCut(sampled, 64);
      extractedCount = extracted.length;
      palette = getActivePalette().concat(extracted);
      if (hint) hint.textContent = '已提取 ' + extractedCount + ' 种主色调，正在量化...';
    }

    // 同步当前帧
    anim.syncCurrentFrame();

    // 第一帧覆盖当前帧活动图层，其余新增帧
    for (var dataIdx = 0; dataIdx < framesData.length; dataIdx++) {
      var data = framesData[dataIdx];
      var pixels = opts.quantize
        ? quantizeFrame(data.data, w, h, palette, opts.dither)
        : directSample(data.data, w, h);

      // 颜色标准化
      for (var p = 0; p < pixels.length; p++) {
        if (pixels[p] !== null) {
          var norm = normalizeColor(pixels[p]);
          if (norm !== null) pixels[p] = norm;
        }
      }

      if (dataIdx === 0) {
        // 写入当前帧的活动图层
        var frame0 = anim.frames[anim.current];
        if (LayerUtils.isLayerFrame(frame0)) {
          var activeL = LayerUtils.getActiveLayer(frame0);
          if (activeL) activeL.pixels = pixels.slice();
        } else {
          anim.frames[anim.current] = LayerUtils.convertLegacyFrame(pixels, w, h);
        }
        engine.loadFrame(anim.frames[anim.current]);
      } else {
        // 新增帧
        var newFrame = LayerUtils.createFrame(w, h, 'Background');
        newFrame.layers[0].pixels = pixels.slice();
        anim.frames.splice(anim.current + 1, 0, newFrame);
        anim.current++;
        engine.loadFrame(newFrame);
      }
    }

    // 更新 UI
    renderFrameList();
    renderLayerList();
    pushSnapshot();
    renderInactiveWindowPreviews();

    // 隐藏进度条
    if (progressBar) {
      setTimeout(function() { progressBar.style.display = 'none'; }, 1000);
    }

    if (hint) {
      var msg = framesData.length + ' 帧已从视频提取并转为像素动画';
      if (extractedCount > 0) msg += '（提取 ' + extractedCount + ' 色用于量化）';
      hint.textContent = msg;
      setTimeout(function() { if (hint) hint.textContent = ''; }, 6000);
    }

    // 自动调整播放帧率以匹配视频帧率
    var fpsVal = parseInt(document.getElementById('videoFps').value);
    if (fpsVal && fpsVal <= 24) {
      anim.fps = fpsVal;
      document.getElementById('fpsSlider').value = fpsVal;
      document.getElementById('fpsLabel').textContent = fpsVal + ' FPS';
    }

    autoSave();
    if (cleanup) cleanup();
  }

  function bindResizers() {
    var sidebarLeft = document.querySelector('.sidebar-left');
    var sidebarRight = document.querySelector('.sidebar-right');
    var resizerLeft = document.getElementById('resizerLeft');
    var resizerRight = document.getElementById('resizerRight');

    function makeDraggable(resizer, sidebar, side) {
      var startX, startWidth;
      var dragging = false;

      function onMouseDown(e) {
        dragging = true;
        startX = e.clientX;
        startWidth = sidebar.offsetWidth;
        resizer.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        e.preventDefault();
      }

      function onMouseMove(e) {
        if (!dragging) return;
        var dx = e.clientX - startX;
        var newWidth;
        if (side === 'left') {
          newWidth = startWidth + dx;
        } else {
          newWidth = startWidth - dx;
        }
        newWidth = Math.max(120, Math.min(500, newWidth));
        sidebar.style.width = newWidth + 'px';
      }

      function onMouseUp() {
        dragging = false;
        resizer.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      }

      resizer.addEventListener('mousedown', onMouseDown);
    }

    makeDraggable(resizerLeft, sidebarLeft, 'left');
    makeDraggable(resizerRight, sidebarRight, 'right');
  }

  function bindCanvasSize() {
    var resSel = document.getElementById('resolutionSelect');
    var ratioSel = document.getElementById('ratioSelect');
    resSel.addEventListener('change', function() { SFX.click(); updateSizePreview(); });
    ratioSel.addEventListener('change', function() { SFX.click(); updateSizePreview(); });
    document.getElementById('btnApplySize').addEventListener('click', function() {
      var res = parseInt(document.getElementById('resolutionSelect').value);
      var ratio = document.getElementById('ratioSelect').value;
      var dims = computeDims(res, ratio);
      if (dims.w === canvasW && dims.h === canvasH) { SFX.error(); return; }
      SFX.confirm();
      applyCanvasSize();
    });  }

  function updateSizePreview() {
    var res = parseInt(document.getElementById('resolutionSelect').value);
    var ratio = document.getElementById('ratioSelect').value;
    var dims = computeDims(res, ratio);
    var display = document.getElementById('currentSize');
    var isCurrent = (dims.w === canvasW && dims.h === canvasH);
    display.textContent = dims.w + ' × ' + dims.h + (isCurrent ? '' : ' →');
    display.style.color = isCurrent ? 'var(--text-muted)' : 'var(--primary)';
  }

  function updateSizeDisplay() {
    document.getElementById('canvasInfo').textContent = canvasW + ' × ' + canvasH + ' 像素';
    document.getElementById('currentSize').textContent = canvasW + ' × ' + canvasH;
  }

  function applyCanvasSize() {
    var res = parseInt(document.getElementById('resolutionSelect').value);
    var ratio = document.getElementById('ratioSelect').value;
    var dims = computeDims(res, ratio);

    if (dims.w === canvasW && dims.h === canvasH) return;

    anim.syncCurrentFrame();
    var hasContent = anim.frames.some(function(f) {
      var composite = LayerUtils.getCompositePixels(f, canvasW, canvasH);
      return composite.some(function(c) { return c !== null; });
    });
    if (hasContent && !confirm('调整画布尺寸将缩放现有内容（最近邻），确认继续？')) return;

    if (anim.playing) {
      anim.stop();
      document.getElementById('btnPlay').textContent = '播放';
    }

    var newPixelSize = computePixelSize(dims.w, dims.h);
    basePixelSize = newPixelSize;
    zoomLevel = 1.0;
    centerCanvas();
    engine.resize(dims.w, dims.h, newPixelSize);
    anim.resize(dims.w, dims.h);
    setWrapSize();

    canvasW = dims.w;
    canvasH = dims.h;
    engine.loadFrame(anim.frames[anim.current]);
    anim._renderOnion();

    updateSizeDisplay();
    updateZoomLabel();
    renderFrameList();
    renderLayerList();
    // 调整尺寸后保存快照
    pushSnapshot();
    autoSave();
    // 更新当前标签的元数据
    if (canvasTabs.length > 0 && activeTabIndex < canvasTabs.length) {
      canvasTabs[activeTabIndex].canvasW = canvasW;
      canvasTabs[activeTabIndex].canvasH = canvasH;
      canvasTabs[activeTabIndex].resolution = res;
      canvasTabs[activeTabIndex].ratio = ratio;
      canvasTabs[activeTabIndex].basePixelSize = basePixelSize;
      canvasTabs[activeTabIndex].zoomLevel = zoomLevel;
      // 更新窗口标题和大小
      var tab = canvasTabs[activeTabIndex];
      if (typeof WindowManager !== 'undefined' && tab._winId) {
        WindowManager.updateWindowSize(tab._winId, canvasW, canvasH);
        WindowManager.updateWindowZoom(tab._winId, Math.round(zoomLevel * 100));
      }
    }
    updateCanvasPosition();
    setWrapSize();
    renderInactiveWindowPreviews();
  }

  function bindZoom() {
    document.getElementById('btnZoomIn').addEventListener('click', function() { SFX.zoomIn(); setZoom(zoomLevel * 1.5); });
    document.getElementById('btnZoomOut').addEventListener('click', function() { SFX.zoomOut(); setZoom(zoomLevel / 1.5); });
  }

  function setZoom(z) {
    zoomLevel = Math.max(0.25, Math.min(6, z));
    var ps = Math.max(2, Math.min(48, Math.round(basePixelSize * zoomLevel)));
    engine.setPixelSize(ps);
    setWrapSize();
    updateZoomLabel();
    // 更新窗口状态栏
    var tab = canvasTabs[activeTabIndex];
    if (typeof WindowManager !== 'undefined' && tab && tab._winId) {
      WindowManager.updateWindowZoom(tab._winId, Math.round(zoomLevel * 100));
    }
  }

  function updateZoomLabel() {
    var el = document.getElementById('zoomLevel');
    if (el) el.textContent = Math.round(zoomLevel * 100) + '%';
  }

  // ---- 画布拖拽手柄 ----
  function bindCanvasDrag() {
    var handle = document.getElementById('canvasDragHandle');
    if (!handle) return;
    var isDragging = false;
    var startX, startY, startPanX, startPanY;

    handle.addEventListener('mousedown', function(e) {
      e.preventDefault();
      e.stopPropagation();
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      startPanX = panX;
      startPanY = panY;
      handle.style.cursor = 'grabbing';
    });

    document.addEventListener('mousemove', function(e) {
      if (!isDragging) return;
      panX = startPanX + (e.clientX - startX);
      panY = startPanY + (e.clientY - startY);
      updateCanvasPosition();
    });

    document.addEventListener('mouseup', function() {
      if (isDragging) {
        isDragging = false;
        handle.style.cursor = 'grab';
      }
    });

    // 触摸支持
    handle.addEventListener('touchstart', function(e) {
      if (e.touches.length !== 1) return;
      e.preventDefault();
      e.stopPropagation();
      var t = e.touches[0];
      isDragging = true;
      startX = t.clientX;
      startY = t.clientY;
      startPanX = panX;
      startPanY = panY;
    });

    document.addEventListener('touchmove', function(e) {
      if (!isDragging || e.touches.length !== 1) return;
      var t = e.touches[0];
      panX = startPanX + (t.clientX - startX);
      panY = startPanY + (t.clientY - startY);
      updateCanvasPosition();
    });

    document.addEventListener('touchend', function() {
      isDragging = false;
    });
  }

  // ---- 窗体边缘缩放 ----
  function bindCanvasResize() {
    var wrap = document.getElementById('canvasWrap');
    if (!wrap) return;
    var handles = wrap.querySelectorAll('.resize-handle');
    if (!handles.length) return;

    var PAD = 16; // canvas-wrap padding per side
    var BORDER = 1; // canvas-wrap border per side (frutiger-metro.css)
    var MIN_W = 80;
    var MIN_H = 80;

    var resizing = false;
    var dir = '';
    var startX = 0, startY = 0;
    var startW = 0, startH = 0;
    var startPanX = 0, startPanY = 0;

    function getViewportRect() {
      var vp = getViewportEl();
      return vp ? vp.getBoundingClientRect() : { width: 9999, height: 9999 };
    }

    function fitCanvasToWrap() {
      // 根据当前 wrap 尺寸重新计算 pixelSize 使画布恰好填满
      // In border-box: offsetWidth = content + padding + border
      // So content area = offsetWidth - PAD*2 - BORDER*2
      var w = wrap.offsetWidth - PAD * 2 - BORDER * 2;
      var h = wrap.offsetHeight - PAD * 2 - BORDER * 2;
      if (w < 10 || h < 10) return;
      var ps = Math.floor(Math.min(w / canvasW, h / canvasH));
      ps = Math.max(2, Math.min(48, ps));
      basePixelSize = ps;
      zoomLevel = 1.0;
      engine.setPixelSize(ps);
      updateZoomLabel();
      if (canvasTabs[activeTabIndex]) {
        canvasTabs[activeTabIndex].basePixelSize = basePixelSize;
        canvasTabs[activeTabIndex].zoomLevel = zoomLevel;
      }
    }

    handles.forEach(function(h) {
      h.addEventListener('mousedown', function(e) {
        e.preventDefault();
        e.stopPropagation();
        resizing = true;
        dir = h.getAttribute('data-dir');
        startX = e.clientX;
        startY = e.clientY;
        startW = wrap.offsetWidth;
        startH = wrap.offsetHeight;
        startPanX = panX;
        startPanY = panY;
        wrap.style.width = startW + 'px';
        wrap.style.height = startH + 'px';
      });
    });

    document.addEventListener('mousemove', function(e) {
      if (!resizing) return;
      var dx = e.clientX - startX;
      var dy = e.clientY - startY;
      var newW = startW, newH = startH;
      var newPanX = startPanX, newPanY = startPanY;

      if (dir.indexOf('e') !== -1) newW = startW + dx;
      if (dir.indexOf('s') !== -1) newH = startH + dy;
      if (dir.indexOf('w') !== -1) {
        newW = startW - dx;
        newPanX = startPanX + dx;
      }
      if (dir.indexOf('n') !== -1) {
        newH = startH - dy;
        newPanY = startPanY + dy;
      }

      // 限制最小尺寸
      if (newW < MIN_W) {
        if (dir.indexOf('w') !== -1) newPanX = startPanX + (startW - MIN_W);
        newW = MIN_W;
      }
      if (newH < MIN_H) {
        if (dir.indexOf('n') !== -1) newPanY = startPanY + (startH - MIN_H);
        newH = MIN_H;
      }

      wrap.style.width = newW + 'px';
      wrap.style.height = newH + 'px';
      panX = newPanX;
      panY = newPanY;
      updateCanvasPosition();
      fitCanvasToWrap();
    });

    document.addEventListener('mouseup', function() {
      if (resizing) {
        resizing = false;
        if (canvasTabs[activeTabIndex]) {
          canvasTabs[activeTabIndex].panX = panX;
          canvasTabs[activeTabIndex].panY = panY;
        }
      }
    });

    // 触摸支持
    handles.forEach(function(h) {
      h.addEventListener('touchstart', function(e) {
        if (e.touches.length !== 1) return;
        e.preventDefault();
        e.stopPropagation();
        resizing = true;
        dir = h.getAttribute('data-dir');
        var t = e.touches[0];
        startX = t.clientX;
        startY = t.clientY;
        startW = wrap.offsetWidth;
        startH = wrap.offsetHeight;
        startPanX = panX;
        startPanY = panY;
        wrap.style.width = startW + 'px';
        wrap.style.height = startH + 'px';
      });
    });

    document.addEventListener('touchmove', function(e) {
      if (!resizing || e.touches.length !== 1) return;
      e.preventDefault();
      var t = e.touches[0];
      var dx = t.clientX - startX;
      var dy = t.clientY - startY;
      var newW = startW, newH = startH;
      var newPanX = startPanX, newPanY = startPanY;

      if (dir.indexOf('e') !== -1) newW = startW + dx;
      if (dir.indexOf('s') !== -1) newH = startH + dy;
      if (dir.indexOf('w') !== -1) {
        newW = startW - dx;
        newPanX = startPanX + dx;
      }
      if (dir.indexOf('n') !== -1) {
        newH = startH - dy;
        newPanY = startPanY + dy;
      }

      if (newW < MIN_W) {
        if (dir.indexOf('w') !== -1) newPanX = startPanX + (startW - MIN_W);
        newW = MIN_W;
      }
      if (newH < MIN_H) {
        if (dir.indexOf('n') !== -1) newPanY = startPanY + (startH - MIN_H);
        newH = MIN_H;
      }

      wrap.style.width = newW + 'px';
      wrap.style.height = newH + 'px';
      panX = newPanX;
      panY = newPanY;
      updateCanvasPosition();
      fitCanvasToWrap();
    }, { passive: false });

    document.addEventListener('touchend', function() {
      if (resizing) {
        resizing = false;
        if (canvasTabs[activeTabIndex]) {
          canvasTabs[activeTabIndex].panX = panX;
          canvasTabs[activeTabIndex].panY = panY;
        }
      }
    });
  }

  // ---- 鼠标滚轮缩放 ----
  function bindWheelZoom() {
    var canvasWrap = document.getElementById('canvasWrap');
    if (!canvasWrap) return;
    canvasWrap.addEventListener('wheel', function(e) {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        if (e.deltaY < 0) {
          setZoom(zoomLevel * 1.2);
        } else {
          setZoom(zoomLevel / 1.2);
        }
      }
    }, { passive: false });
  }

  // ---- 橡皮擦液态玻璃范围指示器 ----
  function bindEraserCursor() {
    var canvas = document.getElementById('drawCanvas');
    var canvasWrap = document.getElementById('canvasWrap');
    var cursor = document.getElementById('eraserCursor');
    if (!canvas || !canvasWrap || !cursor) return;

    function updateCursor(e) {
      if (engine.tool !== 'eraser') {
        cursor.style.display = 'none';
        canvas.style.cursor = '';
        return;
      }
      var canvasRect = canvas.getBoundingClientRect();
      if (e.clientX < canvasRect.left || e.clientX > canvasRect.right ||
          e.clientY < canvasRect.top || e.clientY > canvasRect.bottom) {
        cursor.style.display = 'none';
        canvas.style.cursor = '';
        return;
      }
      canvas.style.cursor = 'none';
      var wrapRect = canvasWrap.getBoundingClientRect();
      var x = e.clientX - wrapRect.left;
      var y = e.clientY - wrapRect.top;
      var size = engine.eraserSize * engine.pixelSize;
      cursor.style.display = 'block';
      cursor.style.left = x + 'px';
      cursor.style.top = y + 'px';
      cursor.style.width = size + 'px';
      cursor.style.height = size + 'px';
    }

    document.addEventListener('mousemove', updateCursor);
  }

  // ---- 图层面板 ----
  function bindLayers() {
    var btnAdd = document.getElementById('btnAddLayer');
    var btnDup = document.getElementById('btnDupLayer');
    var btnDel = document.getElementById('btnDelLayer');
    var btnUp = document.getElementById('btnLayerUp');
    var btnDown = document.getElementById('btnLayerDown');
    var btnMerge = document.getElementById('btnMergeLayer');
    var opacitySlider = document.getElementById('layerOpacitySlider');
    var opacityLabel = document.getElementById('layerOpacityLabel');

    if (btnAdd) btnAdd.addEventListener('click', function() {
      SFX.add();
      engine.addLayer();
      pushSnapshot();
      renderInactiveWindowPreviews();
      autoSave();
    });
    if (btnDup) btnDup.addEventListener('click', function() {
      SFX.add();
      engine.duplicateLayer();
      pushSnapshot();
      renderInactiveWindowPreviews();
      autoSave();
    });
    if (btnDel) btnDel.addEventListener('click', function() {
      if (engine.getLayerCount() <= 1) {
        SFX.error();
        alert('至少保留一个图层');
        return;
      }
      SFX.delete();
      engine.deleteLayer();
      pushSnapshot();
      renderInactiveWindowPreviews();
      autoSave();
    });
    if (btnUp) btnUp.addEventListener('click', function() {
      SFX.click();
      engine.moveLayerUp();
      pushSnapshot();
      renderInactiveWindowPreviews();
      autoSave();
    });
    if (btnDown) btnDown.addEventListener('click', function() {
      SFX.click();
      engine.moveLayerDown();
      pushSnapshot();
      renderInactiveWindowPreviews();
      autoSave();
    });
    if (btnMerge) btnMerge.addEventListener('click', function() {
      if (engine.getActiveLayerIndex() <= 0) {
        SFX.error();
        alert('已是最底层图层，无法向下合并');
        return;
      }
      SFX.confirm();
      engine.mergeLayerDown();
      pushSnapshot();
      renderInactiveWindowPreviews();
      autoSave();
    });

    if (opacitySlider) {
      opacitySlider.addEventListener('input', function() {
        var val = parseInt(opacitySlider.value);
        var idx = engine.getActiveLayerIndex();
        engine.setLayerOpacity(idx, val / 100);
        opacityLabel.textContent = val + '%';
        throttledSfx(function() { SFX.click(); });
      });
      opacitySlider.addEventListener('change', function() {
        renderInactiveWindowPreviews();
        autoSave();
      });
    }
  }

  function renderLayerList() {
    var list = document.getElementById('layerList');
    if (!list) return;
    list.innerHTML = '';

    var layers = engine.getLayers();
    var activeIdx = engine.getActiveLayerIndex();
    var w = engine.width, h = engine.height;
    var thumbPs = Math.max(1, Math.ceil(32 / Math.max(w, h)));

    // 从顶到底显示（数组末尾 = 顶层 = 列表顶部）
    for (var i = layers.length - 1; i >= 0; i--) {
      (function(layerInfo, idx) {
        var item = document.createElement('div');
        item.className = 'layer-item' + (idx === activeIdx ? ' active' : '');
        item.draggable = true;
        item.dataset.index = idx;

        // 可见性切换
        var visBtn = document.createElement('button');
        visBtn.className = 'layer-vis-btn';
        visBtn.innerHTML = layerInfo.visible
          ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'
          : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>';
        visBtn.title = layerInfo.visible ? '隐藏' : '显示';
        visBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          SFX.toggle();
          engine.setLayerVisible(idx, !layerInfo.visible);
          renderInactiveWindowPreviews();
        });
        item.appendChild(visBtn);

        // 缩略图
        var thumb = document.createElement('canvas');
        thumb.className = 'layer-thumb';
        thumb.width = w * thumbPs;
        thumb.height = h * thumbPs;
        var ctx = thumb.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, thumb.width, thumb.height);
        ctx.fillStyle = '#e0e0e0';
        for (var ty = 0; ty < h; ty++) {
          for (var tx = 0; tx < w; tx++) {
            if ((tx + ty) % 2 === 0) ctx.fillRect(tx * thumbPs, ty * thumbPs, thumbPs, thumbPs);
          }
        }
        // 获取该图层的像素
        var frameData = engine.getFrameData();
        if (frameData && frameData.layers[idx]) {
          var pix = frameData.layers[idx].pixels;
          for (var y = 0; y < h; y++) {
            for (var x = 0; x < w; x++) {
              var c = pix[y * w + x];
              if (c) { ctx.fillStyle = c; ctx.fillRect(x * thumbPs, y * thumbPs, thumbPs, thumbPs); }
            }
          }
        }
        item.appendChild(thumb);

        // 图层名
        var nameEl = document.createElement('span');
        nameEl.className = 'layer-name';
        nameEl.textContent = layerInfo.name;
        nameEl.title = '双击重命名';
        nameEl.addEventListener('dblclick', function(e) {
          e.stopPropagation();
          var newName = prompt('图层名称:', layerInfo.name);
          if (newName && newName.trim()) {
            engine.renameLayer(idx, newName.trim());
            SFX.click();
          }
        });
        item.appendChild(nameEl);

        // 拖拽排序
        item.addEventListener('dragstart', function(e) {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', String(idx));
          setTimeout(function() { item.classList.add('dragging'); }, 0);
        });
        item.addEventListener('dragend', function() {
          item.classList.remove('dragging');
          document.querySelectorAll('.layer-item.drag-over').forEach(function(el) {
            el.classList.remove('drag-over');
          });
        });
        item.addEventListener('dragover', function(e) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          document.querySelectorAll('.layer-item.drag-over').forEach(function(el) {
            if (el !== item) el.classList.remove('drag-over');
          });
          item.classList.add('drag-over');
        });
        item.addEventListener('drop', function(e) {
          e.preventDefault();
          item.classList.remove('drag-over');
          var fromIdx = parseInt(e.dataTransfer.getData('text/plain'));
          var toIdx = parseInt(item.dataset.index);
          if (fromIdx !== toIdx && !isNaN(fromIdx) && !isNaN(toIdx)) {
            engine.moveLayerTo(fromIdx, toIdx);
            pushSnapshot();
            renderInactiveWindowPreviews();
            autoSave();
          }
        });

        // 点击选中
        item.addEventListener('click', function() {
          SFX.select();
          engine.setActiveLayer(idx);
          renderLayerList();
        });

        list.appendChild(item);
      })(layers[i], i);
    }

    // 更新透明度滑块
    var opacitySlider = document.getElementById('layerOpacitySlider');
    var opacityLabel = document.getElementById('layerOpacityLabel');
    if (opacitySlider && layers[activeIdx]) {
      var op = Math.round((layers[activeIdx].opacity || 1) * 100);
      opacitySlider.value = op;
      if (opacityLabel) opacityLabel.textContent = op + '%';
    }
  }

  function bindCrop() {
    engine.onCropSelect = function(rect) {
      var bar = document.getElementById('cropBar');
      if (rect) {
        bar.style.display = 'flex';
        document.getElementById('cropSize').textContent = rect.w + ' × ' + rect.h;
      } else {
        bar.style.display = 'none';
      }
    };

    document.getElementById('btnCropConfirm').addEventListener('click', function() {
      var rect = engine.getCropRect();
      if (!rect || rect.w < 1 || rect.h < 1) { SFX.error(); return; }

      if (rect.w === engine.width && rect.h === engine.height) {
        SFX.cancel();
        exitCropMode();
        return;
      }
      SFX.confirm();

      anim.syncCurrentFrame();
      if (anim.playing) { anim.stop(); document.getElementById('btnPlay').textContent = '播放'; }

      var newPixelSize = computePixelSize(rect.w, rect.h);
      basePixelSize = newPixelSize;
      zoomLevel = 1.0;
      centerCanvas();
      engine.applyCrop(rect.x1, rect.y1, rect.x2, rect.y2, newPixelSize);
      anim.crop(rect.x1, rect.y1, rect.x2, rect.y2);

      canvasW = engine.width;
      canvasH = engine.height;
      engine.loadFrame(anim.frames[anim.current]);
      anim._renderOnion();

      updateSizeDisplay();
      updateZoomLabel();
    renderFrameList();
    renderLayerList();
    // 裁剪后保存快照
    pushSnapshot();
    renderInactiveWindowPreviews();
      exitCropMode();
    });

    document.getElementById('btnCropCancel').addEventListener('click', function() { SFX.cancel(); exitCropMode(); });
  }

  function exitCropMode() {
    engine.clearCrop();
    document.getElementById('cropBar').style.display = 'none';
    switchToPencil();
  }

  function exportPng() {
    anim.syncCurrentFrame();
    var w = engine.width, h = engine.height;
    var tmp = document.createElement('canvas');
    tmp.width = w;
    tmp.height = h;
    var ctx = tmp.getContext('2d');
    var frame = anim.getCurrentComposite();
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var c = frame[y * w + x];
        if (c) { ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1); }
      }
    }
    var a = document.createElement('a');
    a.href = tmp.toDataURL('image/png');
    a.download = 'frame.png';
    a.click();
    SFX.save();
  }

  async function exportGif() {
    if (canvasTabs.length > 1) {
      showCanvasExportModal('gif');
      return;
    }
    var frames = anim.getAllFrames();
    if (frames.length < 1) { alert('没有可导出的帧'); return; }

    var w = engine.width, h = engine.height;
    var scale = parseInt(document.getElementById('gifScale').value) || 1;
    var outW = w * scale;
    var outH = h * scale;
    var btn = document.getElementById('btnGif');
    var btnText = btn.textContent;
    var progressBar = document.getElementById('gifProgress');

    btn.textContent = '准备中...';
    btn.disabled = true;
    if (progressBar) {
      progressBar.style.display = 'block';
      progressBar.querySelector('.gif-progress-fill').style.width = '0%';
      progressBar.querySelector('.gif-progress-text').textContent = '0%';
    }

    var workerUrl = null;
    var watchdog = null;

    try {
      var workerRes = await fetch('lib/gif.js/gif.worker.js');
      if (!workerRes.ok) throw new Error('Worker 脚本加载失败 (' + workerRes.status + ')');
      var workerCode = await workerRes.text();
      var workerBlob = new Blob([workerCode], { type: 'application/javascript' });
      workerUrl = URL.createObjectURL(workerBlob);

      var gif = new GIF({
        workers: 4,
        quality: 10,
        width: outW,
        height: outH,
        workerScript: workerUrl,
        dither: false,
      });

      var frameDelay = Math.round(1000 / anim.fps);

      frames.forEach(function(frame) {
        var tmp = document.createElement('canvas');
        tmp.width = w;
        tmp.height = h;
        var ctx = tmp.getContext('2d');
        var imgData = ctx.createImageData(w, h);
        var buf = imgData.data;

        for (var y = 0; y < h; y++) {
          for (var x = 0; x < w; x++) {
            var c = frame[y * w + x];
            var idx = (y * w + x) * 4;
            if (c) {
              buf[idx]     = parseInt(c.slice(1, 3), 16);
              buf[idx + 1] = parseInt(c.slice(3, 5), 16);
              buf[idx + 2] = parseInt(c.slice(5, 7), 16);
              buf[idx + 3] = 255;
            } else {
              buf[idx] = 255; buf[idx + 1] = 255; buf[idx + 2] = 255; buf[idx + 3] = 255;
            }
          }
        }
        ctx.putImageData(imgData, 0, 0);

        if (scale > 1) {
          var scaled = document.createElement('canvas');
          scaled.width = outW;
          scaled.height = outH;
          var sctx = scaled.getContext('2d');
          sctx.imageSmoothingEnabled = false;
          sctx.drawImage(tmp, 0, 0, outW, outH);
          gif.addFrame(scaled, { delay: frameDelay, copy: true });
        } else {
          gif.addFrame(tmp, { delay: frameDelay, copy: true });
        }
      });

      watchdog = setTimeout(function() {
        if (gif.running) {
          console.error('GIF 导出超时');
          alert('GIF 生成超时。请尝试：\n1. 减少帧数\n2. 降低缩放倍数\n3. 刷新页面后重试');
          cleanup();
        }
      }, 15000);

      function cleanup() {
        if (watchdog) { clearTimeout(watchdog); watchdog = null; }
        if (workerUrl) { URL.revokeObjectURL(workerUrl); workerUrl = null; }
        btn.textContent = btnText;
        btn.disabled = false;
        if (progressBar) { setTimeout(function() { progressBar.style.display = 'none'; }, 1000); }
      }

      gif.on('progress', function(p) {
        var pct = Math.round(p * 100);
        if (progressBar) {
          progressBar.querySelector('.gif-progress-fill').style.width = pct + '%';
          progressBar.querySelector('.gif-progress-text').textContent = pct + '%';
        }
        btn.textContent = '生成中 ' + pct + '%';
      });

      gif.on('finished', function(blob) {
        if (watchdog) { clearTimeout(watchdog); watchdog = null; }
        if (workerUrl) { URL.revokeObjectURL(workerUrl); workerUrl = null; }
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'pixel-animation.gif';
        a.click();
        URL.revokeObjectURL(a.href);
        if (window.SFX) SFX.save();
        btn.textContent = btnText;
        btn.disabled = false;
        if (progressBar) {
          setTimeout(function() { progressBar.style.display = 'none'; }, 1000);
        }
      });

      gif.render();
    } catch (err) {
      console.error('GIF 导出错误:', err);
      if (watchdog) { clearTimeout(watchdog); }
      if (workerUrl) { URL.revokeObjectURL(workerUrl); }
      alert('GIF 导出失败: ' + err.message);
      btn.textContent = btnText;
      btn.disabled = false;
      if (progressBar) progressBar.style.display = 'none';
    }
  }

  async function saveWork() {
    var title = document.getElementById('workTitle').value.trim() || '未命名作品';
    var author = document.getElementById('workAuthor').value.trim() || '匿名';
    var btn = document.getElementById('btnSave');
    btn.textContent = '上传中...';
    btn.disabled = true;

    saveCurrentTabState();
    var firstTab = canvasTabs[0] || {};
    var workData = {
      title: title,
      author: author,
      width: firstTab.canvasW || engine.width,
      height: firstTab.canvasH || engine.height,
      frameCount: (firstTab.frames || anim.frames).length,
      fps: firstTab.fps || anim.fps,
      frames: (firstTab.frames || []).map(function(f) {
        return LayerUtils.getCompositePixels(f, firstTab.canvasW, firstTab.canvasH);
      }),
      thumbnail: canvasTabs.length > 0 ? getCanvasThumbnail(firstTab) : '',
      canvasCount: canvasTabs.length,
      created_at: new Date().toLocaleString('zh-CN'),
    };

    try {
      var res = await fetch('/api/works', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(workData)
      });
      var data = await res.json();
      if (data.ok) {
        alert('上传成功！作品已加入在线作品库，ID: ' + data.id);
      } else {
        throw new Error(data.error);
      }
    } catch (err) {
      var works = JSON.parse(localStorage.getItem('pa_works') || '[]');
      workData.id = Date.now();
      works.unshift(workData);
      localStorage.setItem('pa_works', JSON.stringify(works));
      alert('上传成功！作品已加入本地作品库（后端未连接）');
    }
    btn.textContent = '上传作品库';
    btn.disabled = false;
  }

  function saveToLocalFile() {
    saveCurrentTabState();
    var title = document.getElementById('workTitle').value.trim() || '未命名作品';
    var author = document.getElementById('workAuthor').value.trim() || '匿名';

    var canvasesData = canvasTabs.map(function(tab) {
      var layerFrames = tab.frames.map(function(f) {
        var frame = LayerUtils.cloneFrame(f);
        normalizeFrame(frame);
        return frame;
      });
      var compositeFrames = layerFrames.map(function(f) {
        return LayerUtils.getCompositePixels(f, tab.canvasW, tab.canvasH);
      });
      return {
        name: tab.name,
        width: tab.canvasW,
        height: tab.canvasH,
        resolution: tab.resolution,
        ratio: tab.ratio,
        fps: tab.fps,
        frames: compositeFrames,
        layerFrames: layerFrames,
        currentFrame: tab.currentFrame,
      };
    });

    var first = canvasesData[0] || {};
    var project = {
      format: 'pixelforge-project',
      version: 3,
      title: title,
      author: author,
      canvases: canvasesData,
      // Backward compat
      width: first.width || 128,
      height: first.height || 128,
      fps: first.fps || 12,
      frames: first.frames || [],
      layerFrames: first.layerFrames || [],
      thumbnail: canvasTabs.length > 0 ? getCanvasThumbnail(canvasTabs[0]) : '',
      savedAt: new Date().toISOString(),
    };

    var json = JSON.stringify(project);
    var blob = new Blob([json], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    var safeName = title.replace(/[<>:"/\\|?*]/g, '_');
    a.download = safeName + '.pixa';
    a.click();
    URL.revokeObjectURL(a.href);
    SFX.save();
  }

  function loadFromLocalFile(file) {
    var reader = new FileReader();
    reader.onload = function(ev) {
      try {
        var project = JSON.parse(ev.target.result);
        if (!project.format || !project.format.startsWith('pixelforge')) {
          alert('文件格式不正确，请选择 .pixa 项目文件');
          return;
        }

        if (anim.playing) {
          anim.stop();
          document.getElementById('btnPlay').textContent = '播放';
        }

        document.getElementById('workTitle').value = project.title || '';
        document.getElementById('workAuthor').value = project.author || '';

        if (project.canvases && project.canvases.length > 0) {
          // Multi-canvas project file
          canvasTabs = project.canvases.map(function(c, idx) {
            var frames;
            if (c.layerFrames && c.layerFrames.length > 0) {
              frames = c.layerFrames.map(function(f) {
                var frame = LayerUtils.cloneFrame(f);
                normalizeFrame(frame);
                return frame;
              });
            } else {
              frames = (c.frames || []).map(function(f) {
                var frame = LayerUtils.convertLegacyFrame(f, c.width, c.height);
                normalizeFrame(frame);
                return frame;
              });
            }
            if (frames.length === 0) {
              frames = [LayerUtils.createFrame(c.width, c.height, 'Background')];
            }
            return {
              id: Date.now() + Math.random() + idx,
              name: c.name || ('画布 ' + (idx + 1)),
              canvasW: c.width,
              canvasH: c.height,
              resolution: c.resolution || 128,
              ratio: c.ratio || '1:1',
              zoomLevel: 1.0,
              basePixelSize: computePixelSize(c.width, c.height),
              panX: 0,
              panY: 0,
              frames: frames,
              currentFrame: c.currentFrame || 0,
              fps: c.fps || 12,
              undoStack: [],
              redoStack: [],
              _winId: null,
            };
          });
        } else {
          // Legacy single-canvas project file
          if (!project.frames || !project.width || !project.height) {
            alert('项目文件已损坏或缺少必要数据');
            return;
          }
          var newW = project.width, newH = project.height;
          var frames;
          if (project.layerFrames && project.layerFrames.length > 0) {
            frames = project.layerFrames.map(function(f) {
              var frame = LayerUtils.cloneFrame(f);
              normalizeFrame(frame);
              return frame;
            });
          } else {
            frames = project.frames.map(function(f) {
              var frame = LayerUtils.convertLegacyFrame(f, newW, newH);
              normalizeFrame(frame);
              return frame;
            });
          }
          canvasTabs = [{
            id: Date.now() + Math.random(),
            name: '画布 1',
            canvasW: newW,
            canvasH: newH,
            resolution: 128,
            ratio: '1:1',
            zoomLevel: 1.0,
            basePixelSize: computePixelSize(newW, newH),
            panX: 0,
            panY: 0,
            frames: frames,
            currentFrame: 0,
            fps: project.fps || 12,
            undoStack: [],
            redoStack: [],
            _winId: null,
          }];
        }

        activeTabIndex = 0;
        loadTabState(0);
        undoStack = [];
        redoStack = [];
        pushSnapshot();

        // 重建窗口
        if (typeof WindowManager !== 'undefined') {
          WindowManager.rebuildAllWindows(canvasTabs, activeTabIndex);
          // rebuildAllWindows 会 activateWindow(activeTabIndex)，使 .win-active-area 可见
          // 然后才移动 canvasWrap 到活动窗口
          moveCanvasToActiveWindow(activeTabIndex);
          renderInactiveWindowPreviews();
        }

        SFX.confirm();
        alert('项目加载成功: ' + (project.title || '未命名') + '\n共 ' + canvasTabs.length + ' 个画布');
      } catch (err) {
        alert('加载失败: ' + err.message);
      }
    };
    reader.readAsText(file);
  }

  function syncSizeSelectors(w, h) {
    var resSel = document.getElementById('resolutionSelect');
    var ratioSel = document.getElementById('ratioSelect');
    var maxDim = Math.max(w, h);
    var resolutions = [16, 24, 32, 48, 64, 96, 128];
    var bestRes = 128;
    var bestDiff = Infinity;
    for (var i = 0; i < resolutions.length; i++) {
      var r = resolutions[i];
      if (Math.abs(r - maxDim) < bestDiff) { bestDiff = Math.abs(r - maxDim); bestRes = r; }
    }
    resSel.value = bestRes;
    var ratios = ['1:1','4:3','3:4','16:9','9:16','2:1','1:2','3:2','2:3'];
    var bestRatio = '1:1';
    var bestRatioDiff = Infinity;
    for (var i = 0; i < ratios.length; i++) {
      var ratio = ratios[i];
      var parts = ratio.split(':').map(Number);
      var targetW = parts[0] >= parts[1] ? bestRes : Math.round(bestRes * parts[0] / parts[1]);
      var targetH = parts[0] >= parts[1] ? Math.round(bestRes * parts[1] / parts[0]) : bestRes;
      var diff = Math.abs(targetW - w) + Math.abs(targetH - h);
      if (diff < bestRatioDiff) { bestRatioDiff = diff; bestRatio = ratio; }
    }
    ratioSel.value = bestRatio;
  }

  // 启动
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      init().catch(function(e) { console.error(e); });
    });
  } else {
    init().catch(function(e) { console.error(e); });
  }
})();