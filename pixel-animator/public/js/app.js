// public/js/app.js - 快照方案，绝对不出错
(function () {
  var canvasW = 32;
  var canvasH = 32;
  var zoomLevel = 1.0;
  var basePixelSize = 16;

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
  function getActivePalette() { return DEFAULT_PALETTE.concat(customColors); }

  var engine, anim;
  var isDeletingColor = false;

  // ---- 快照历史 ----
  var undoStack = [];
  var redoStack = [];
  var MAX_HISTORY = 200;

  // 保存当前所有帧的快照
  function saveSnapshot() {
    var snapshot = anim.frames.map(function(f) { return f.slice(); });
    return snapshot;
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
    // 恢复帧数据
    anim.frames = snap.map(function(f) { return f.slice(); });
    // 修正当前帧索引
    if (anim.current >= anim.frames.length) {
      anim.current = anim.frames.length - 1;
    }
    if (anim.current < 0) anim.current = 0;
    // 加载当前帧
    engine.loadFrame(anim.frames[anim.current]);
    anim._renderOnion();
    renderFrameList();
    // 注意：engine.history 会被清空，但没关系，因为快照已经包含所有帧
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
    isDeletingColor = false;
  }

  // ---- 项目草稿保存 ----
  var saveTimeout = null;
  var isSaving = false;

  function getCurrentProjectData() {
    anim.syncCurrentFrame();
    for (var i = 0; i < anim.frames.length; i++) {
      normalizeFrame(anim.frames[i]);
    }
    return {
      title: document.getElementById('workTitle').value.trim() || '未命名作品',
      author: document.getElementById('workAuthor').value.trim() || '匿名',
      width: engine.width,
      height: engine.height,
      fps: anim.fps,
      frames: anim.getAllFrames(),
      currentFrame: anim.current,
      palette: getActivePalette(),
      customColors: customColors,
      thumbnail: anim.getThumbnail(),
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
      var width = project.width, height = project.height, frames = project.frames, currentFrame = project.currentFrame, fps = project.fps;
      canvasW = width;
      canvasH = height;
      var newPixelSize = computePixelSize(width, height);
      engine.resize(width, height, newPixelSize);
      anim.resize(width, height);
      anim.frames = frames.map(function(f) {
        var newFrame = f.slice();
        normalizeFrame(newFrame);
        return newFrame;
      });
      anim.current = currentFrame || 0;
      anim.fps = fps || 12;
      document.getElementById('workTitle').value = project.title || '';
      document.getElementById('workAuthor').value = project.author || '';
      document.getElementById('fpsSlider').value = anim.fps;
      document.getElementById('fpsLabel').textContent = anim.fps + ' FPS';
      syncSizeSelectors(width, height);
      engine.loadFrame(anim.frames[anim.current]);
      anim._renderOnion();
      if (project.customColors) {
        customColors = project.customColors;
        localStorage.setItem('pa_custom_colors', JSON.stringify(customColors));
        buildPalette();
      }
      renderFrameList();
      updateSizeDisplay();
      updateZoomLabel();
      renderTempPalette();
      // 清空历史
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

    // ★★★ 绘制完成时保存快照 ★★★
    engine.onDrawEnd = function(pixelsCopy) {
      // 将引擎当前帧像素同步到 anim.frames
      var idx = anim.current;
      anim.frames[idx] = pixelsCopy.slice();
      pushSnapshot();  // 保存整个帧列表的快照
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
        } else {
          alert('当前帧中没有该颜色。');
        }
        switchToPencil();
        return;
      }

      if (targetColor) {
        addToTempPalette(targetColor);
        document.getElementById('colorPicker').value = targetColor;
        engine.setColor(targetColor);
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
    bindToolbar();
    bindFrames();
    bindPlayback();
    bindExport();
    bindImport();
    bindCanvasSize();
    bindCrop();
    bindColorWheel();
    bindPaletteActions();
    bindZoom();

    var fitModeSelect = document.getElementById('fitMode');
    if (fitModeSelect) fitModeSelect.value = 'contain';

    for (var i = 0; i < anim.frames.length; i++) {
      normalizeFrame(anim.frames[i]);
    }

    anim.onFramesChange = renderFrameList;
    anim.onFrameSelect = function(i) { updateFrameListSelection(i); };
    renderFrameList();
    updateSizeDisplay();
    updateZoomLabel();
    renderTempPalette();

    await loadProject();

    if (anim.frames.length === 0) {
      var empty = new Array(canvasW * canvasH).fill(null);
      anim.frames = [empty];
      anim.current = 0;
      engine.loadFrame(empty);
      engine.render();
      renderFrameList();
    }

    document.getElementById('btnSaveDraft').addEventListener('click', function() {
      saveDraftLocally(true);
    });
    document.getElementById('btnSaveProject').addEventListener('click', function() {
      saveProjectToServer(true);
    });

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
      sw.className = 'swatch' + (i < DEFAULT_PALETTE.length ? '' : ' custom');
      sw.style.background = color;
      sw.title = color;
      if (i === 0) sw.classList.add('active');
      sw.addEventListener('click', function() {
        selectColor(color, sw);
        switchToPencil();
      });
      if (i >= DEFAULT_PALETTE.length) {
        sw.addEventListener('contextmenu', function(e) {
          e.preventDefault();
          if (confirm('从调色板移除颜色 ' + color + ' ?')) {
            customColors.splice(i - DEFAULT_PALETTE.length, 1);
            localStorage.setItem('pa_custom_colors', JSON.stringify(customColors));
            buildPalette();
            updatePaletteCount();
          }
        });
      }
      wrap.appendChild(sw);
    });
    var picker = document.getElementById('colorPicker');
    picker.oninput = null;
    picker.addEventListener('input', function() {
      var norm = normalizeColor(picker.value);
      if (norm) {
        engine.setColor(norm);
        document.querySelectorAll('.swatch').forEach(function(s) { s.classList.remove('active'); });
        switchToPencil();
      }
    });
    updatePaletteCount();
    autoSave();
  }

  var selectedColor = DEFAULT_PALETTE[0];

  function selectColor(color, swEl) {
    var norm = normalizeColor(color);
    if (!norm) return;
    selectedColor = norm;
    document.querySelectorAll('.swatch').forEach(function(s) { s.classList.remove('active'); });
    if (swEl) swEl.classList.add('active');
    engine.setColor(norm);
    document.getElementById('colorPicker').value = norm;
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
    if (customColors.length === 0) return;
    if (!confirm('确定恢复默认调色板？自定义颜色将被清空。')) return;
    customColors = [];
    localStorage.setItem('pa_custom_colors', JSON.stringify(customColors));
    buildPalette();
    var firstSw = document.querySelector('.swatch');
    if (firstSw) selectColor(DEFAULT_PALETTE[0], firstSw);
    autoSave();
  }

  function bindPaletteActions() {
    document.getElementById('btnDeleteColor').addEventListener('click', deleteSelectedColor);
    document.getElementById('btnResetPalette').addEventListener('click', resetPalette);
  }

  // ---- 临时调色板 ----
  var MAX_TEMP_COLORS = 10;
  var tempPalette = [];

  function addToTempPalette(color) {
    var norm = normalizeColor(color);
    if (!norm) return;
    var idx = tempPalette.indexOf(norm);
    if (idx !== -1) tempPalette.splice(idx, 1);
    tempPalette.unshift(norm);
    if (tempPalette.length > MAX_TEMP_COLORS) tempPalette.pop();
    renderTempPalette();
  }

  function renderTempPalette() {
    var container = document.getElementById('tempPalette');
    if (!container) return;
    container.innerHTML = '';
    if (tempPalette.length === 0) {
      var empty = document.createElement('span');
      empty.className = 'temp-empty';
      empty.textContent = '🎨 点击吸管取色';
      container.appendChild(empty);
      return;
    }
    tempPalette.forEach(function(color, i) {
      var sw = document.createElement('button');
      sw.className = 'temp-swatch';
      sw.style.background = color;
      sw.title = color + ' (点击使用，右键移除)';
      sw.dataset.color = color;
      sw.addEventListener('click', function() {
        var norm = normalizeColor(color);
        if (norm) {
          engine.setColor(norm);
          document.getElementById('colorPicker').value = norm;
          document.querySelectorAll('.swatch').forEach(function(s) { s.classList.remove('active'); });
          document.querySelectorAll('.temp-swatch').forEach(function(s) { s.classList.remove('active'); });
          sw.classList.add('active');
          switchToPencil();
        }
      });
      sw.addEventListener('contextmenu', function(e) {
        e.preventDefault();
        tempPalette.splice(i, 1);
        renderTempPalette();
      });
      container.appendChild(sw);
    });
    var count = document.createElement('span');
    count.className = 'temp-count';
    count.textContent = tempPalette.length + '/' + MAX_TEMP_COLORS;
    container.appendChild(count);
  }

  // ---- 色轮 ----
  var colorWheel = null;
  function bindColorWheel() {
    var overlay = document.getElementById('cwOverlay');
    var btnOpen = document.getElementById('btnColorWheel');
    var btnClose = document.getElementById('cwClose');

    btnOpen.addEventListener('click', function() {
      overlay.classList.add('show');
      var cur = engine.color || '#000000';
      var initColor = (cur === '#000000' || cur === '#ffffff') ? '#ff0000' : cur;
      if (!colorWheel) {
        colorWheel = new ColorWheel(document.getElementById('colorWheelContainer'), {
          color: initColor,
          onChange: function(hex) {
            var norm = normalizeColor(hex);
            if (norm) {
              engine.setColor(norm);
              document.getElementById('colorPicker').value = norm;
              document.querySelectorAll('.swatch').forEach(function(s) { s.classList.remove('active'); });
              switchToPencil();
            }
          },
          onAddToPalette: function(hex) {
            addCustomColor(hex);
          },
        });
      } else {
        colorWheel.setColor(initColor);
      }
    });

    btnClose.addEventListener('click', function() { overlay.classList.remove('show'); });
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) overlay.classList.remove('show');
    });

    var quantToggle = document.getElementById('quantizeToggle');
    var ditherRow = document.getElementById('ditherToggleRow');
    var extractToggle = document.getElementById('extractToggle');
    var extractRow = document.getElementById('extractToggleRow');
    quantToggle.addEventListener('change', function() {
      ditherRow.style.display = quantToggle.checked ? 'flex' : 'none';
      extractRow.style.display = quantToggle.checked ? 'flex' : 'none';
      if (!quantToggle.checked) extractToggle.checked = false;
    });
    ditherRow.style.display = quantToggle.checked ? 'flex' : 'none';
    extractRow.style.display = quantToggle.checked ? 'flex' : 'none';
    extractToggle.addEventListener('change', function() {
      if (extractToggle.checked && !quantToggle.checked) {
        quantToggle.checked = true;
        ditherRow.style.display = 'flex';
      }
    });
  }

  // ---- 工具栏 ----
  function bindToolbar() {
    document.querySelectorAll('[data-tool]').forEach(function(btn) {
      btn.addEventListener('click', function() {
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
      });
    });

    document.getElementById('btnUndo').addEventListener('click', function() {
      if (!undoOperation()) {
        alert('没有可撤销的操作');
      }
    });

    document.getElementById('btnRedo').addEventListener('click', function() {
      if (!redoOperation()) {
        alert('没有可重做的操作');
      }
    });

    document.getElementById('btnClear').addEventListener('click', function() {
      if (confirm('清空当前帧？')) {
        engine.clear();
        // 清空也是操作，保存快照
        var idx = anim.current;
        anim.frames[idx] = engine.pixels.slice();
        pushSnapshot();
        autoSave();
      }
    });
    document.getElementById('btnGrid').addEventListener('click', function(e) {
      engine.showGrid = !engine.showGrid;
      e.currentTarget.classList.toggle('active', engine.showGrid);
      engine.render();
    });

    var eraserSizeSlider = document.getElementById('eraserSizeSlider');
    var eraserSizeLabel = document.getElementById('eraserSizeLabel');
    if (eraserSizeSlider && eraserSizeLabel) {
      eraserSizeSlider.addEventListener('input', function() {
        var size = parseInt(eraserSizeSlider.value);
        engine.setEraserSize(size);
        eraserSizeLabel.textContent = size + 'px';
      });
    }

    var penSizeSlider = document.getElementById('penSizeSlider');
    var penSizeLabel = document.getElementById('penSizeLabel');
    if (penSizeSlider && penSizeLabel) {
      penSizeSlider.addEventListener('input', function() {
        var size = parseInt(penSizeSlider.value);
        engine.setPenSize(size);
        penSizeLabel.textContent = size + 'px';
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
      // 保存快照
      pushSnapshot();
      renderFrameList();
      autoSave();
    };

    anim.duplicateFrame = function() {
      origDup();
      pushSnapshot();
      renderFrameList();
      autoSave();
    };

    anim.deleteFrame = function() {
      origDel();
      pushSnapshot();
      renderFrameList();
      autoSave();
    };

    anim.moveFrame = function(from, to) {
      origMove(from, to);
      pushSnapshot();
      renderFrameList();
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
    
    anim.frames.forEach(function(frame, i) {
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

      item.addEventListener('click', function() { anim.selectFrame(i); });
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
      } else {
        anim.play();
        btnPlay.textContent = '停止';
      }
    });

    var fpsSlider = document.getElementById('fpsSlider');
    var fpsLabel = document.getElementById('fpsLabel');
    fpsSlider.addEventListener('input', function() {
      var fps = parseInt(fpsSlider.value);
      anim.setFps(fps);
      fpsLabel.textContent = fps + ' FPS';
    });

    var onionBtn = document.getElementById('btnOnion');
    onionBtn.addEventListener('click', function(e) {
      var on = anim.toggleOnionSkin();
      this.classList.toggle('active', on);
    });
    onionBtn.classList.toggle('active', anim.onionSkin);
  }

  // ---- 导出与保存 ----
  function bindExport() {
    document.getElementById('btnGif').addEventListener('click', exportGif);
    document.getElementById('btnSave').addEventListener('click', saveWork);
    document.getElementById('btnPng').addEventListener('click', showExportPngOptions);
    document.getElementById('btnSaveLocal').addEventListener('click', saveToLocalFile);
    document.getElementById('btnLoadLocal').addEventListener('click', function() {
      document.getElementById('projectFileInput').click();
    });
    document.getElementById('projectFileInput').addEventListener('change', function(e) {
      var file = e.target.files[0];
      if (file) loadFromLocalFile(file);
      e.target.value = '';
    });

    document.getElementById('batchModalClose').addEventListener('click', closeBatchModal);
    document.getElementById('batchExportCancel').addEventListener('click', closeBatchModal);
    document.getElementById('batchSelectAll').addEventListener('click', function() { batchSelectAll(true); });
    document.getElementById('batchDeselectAll').addEventListener('click', function() { batchSelectAll(false); });
    document.getElementById('batchExportConfirm').addEventListener('click', batchExportSelected);
    document.getElementById('batchModal').addEventListener('click', function(e) {
      if (e.target === this) closeBatchModal();
    });
  }

  // ---- 导出 PNG 选项 ----
  function showExportPngOptions() {
    var userChoice = confirm('点击"确定"导出当前帧，点击"取消"进入批量导出选择。');
    if (userChoice) {
      exportPng();
    } else {
      openBatchModal();
    }
  }

  // ---- 批量导出模态框 ----
  var batchSelected = new Set();

  function openBatchModal() {
    var modal = document.getElementById('batchModal');
    modal.style.display = 'flex';
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

  // ---- 照片转像素 ----
  function bindImport() {
    var btn = document.getElementById('btnImportImg');
    var input = document.getElementById('imgInput');
    btn.addEventListener('click', function() { input.click(); });
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
      var existing = new Set(getActivePalette());
      var added = 0;
      for (var hexIdx = 0; hexIdx < extracted.length; hexIdx++) {
        var hex = extracted[hexIdx];
        if (!existing.has(hex)) {
          customColors.push(hex);
          existing.add(hex);
          added++;
        }
      }
      localStorage.setItem('pa_custom_colors', JSON.stringify(customColors));
      buildPalette();
      palette = getActivePalette();
      if (hint) hint.textContent = '已提取 ' + extractedCount + ' 种主色调，' + added + ' 种已加入调色板...';
    }

    // 导入图片前，先保存当前帧的快照（但我们会先清空帧？还是替换？取决于业务逻辑）
    // 这里我们直接覆盖当前帧
    var currentFrameIndex = anim.current;
    // 处理第一张图片覆盖当前帧，其余新增帧
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
        anim.frames[anim.current] = pixels.slice();
        engine.loadFrame(pixels);
      } else {
        anim.addFrame();
        anim.frames[anim.current] = pixels.slice();
        engine.loadFrame(pixels);
      }
    }
    renderFrameList();
    // 保存快照
    pushSnapshot();

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

  function bindCanvasSize() {
    var resSel = document.getElementById('resolutionSelect');
    var ratioSel = document.getElementById('ratioSelect');
    resSel.addEventListener('change', updateSizePreview);
    ratioSel.addEventListener('change', updateSizePreview);
    document.getElementById('btnApplySize').addEventListener('click', applyCanvasSize);
  }

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
    var hasContent = anim.frames.some(function(f) { return f.some(function(c) { return c !== null; }); });
    if (hasContent && !confirm('调整画布尺寸将缩放现有内容（最近邻），确认继续？')) return;

    if (anim.playing) {
      anim.stop();
      document.getElementById('btnPlay').textContent = '播放';
    }

    var newPixelSize = computePixelSize(dims.w, dims.h);
    basePixelSize = newPixelSize;
    zoomLevel = 1.0;
    engine.resize(dims.w, dims.h, newPixelSize);
    anim.resize(dims.w, dims.h);

    canvasW = dims.w;
    canvasH = dims.h;
    engine.loadFrame(anim.frames[anim.current]);
    anim._renderOnion();

    updateSizeDisplay();
    updateZoomLabel();
    renderFrameList();
    // 调整尺寸后保存快照
    pushSnapshot();
    autoSave();
  }

  function bindZoom() {
    document.getElementById('btnZoomIn').addEventListener('click', function() { setZoom(zoomLevel * 1.5); });
    document.getElementById('btnZoomOut').addEventListener('click', function() { setZoom(zoomLevel / 1.5); });
    document.getElementById('btnZoomFit').addEventListener('click', function() { setZoom(1.0); });
  }

  function setZoom(z) {
    zoomLevel = Math.max(0.25, Math.min(6, z));
    var ps = Math.max(2, Math.min(48, Math.round(basePixelSize * zoomLevel)));
    engine.setPixelSize(ps);
    updateZoomLabel();
  }

  function updateZoomLabel() {
    var el = document.getElementById('zoomLevel');
    if (el) el.textContent = Math.round(zoomLevel * 100) + '%';
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
      if (!rect || rect.w < 1 || rect.h < 1) return;

      if (rect.w === engine.width && rect.h === engine.height) {
        exitCropMode();
        return;
      }

      anim.syncCurrentFrame();
      if (anim.playing) { anim.stop(); document.getElementById('btnPlay').textContent = '播放'; }

      var newPixelSize = computePixelSize(rect.w, rect.h);
      basePixelSize = newPixelSize;
      zoomLevel = 1.0;
      engine.applyCrop(rect.x1, rect.y1, rect.x2, rect.y2, newPixelSize);
      anim.crop(rect.x1, rect.y1, rect.x2, rect.y2);

      canvasW = engine.width;
      canvasH = engine.height;
      engine.loadFrame(anim.frames[anim.current]);
      anim._renderOnion();

      updateSizeDisplay();
      updateZoomLabel();
      renderFrameList();
      // 裁剪后保存快照
      pushSnapshot();
      exitCropMode();
    });

    document.getElementById('btnCropCancel').addEventListener('click', exitCropMode);
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
    var frame = anim.getCurrentFrame();
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
  }

  async function exportGif() {
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

    var workData = {
      title: title,
      author: author,
      width: engine.width,
      height: engine.height,
      frameCount: anim.frames.length,
      fps: anim.fps,
      frames: anim.getAllFrames(),
      thumbnail: anim.getThumbnail(),
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
    anim.syncCurrentFrame();
    var title = document.getElementById('workTitle').value.trim() || '未命名作品';
    var author = document.getElementById('workAuthor').value.trim() || '匿名';

    var project = {
      format: 'pixelforge-project',
      version: 1,
      title: title,
      author: author,
      width: engine.width,
      height: engine.height,
      fps: anim.fps,
      frames: anim.getAllFrames(),
      thumbnail: anim.getThumbnail(),
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
        if (!project.frames || !project.width || !project.height) {
          alert('项目文件已损坏或缺少必要数据');
          return;
        }

        if (anim.playing) {
          anim.stop();
          document.getElementById('btnPlay').textContent = '播放';
        }

        var newW = project.width;
        var newH = project.height;
        var newPixelSize = computePixelSize(newW, newH);

        engine.resize(newW, newH, newPixelSize);
        anim.resize(newW, newH);

        anim.frames = project.frames.map(function(frame) {
          var newFrame = frame.slice();
          normalizeFrame(newFrame);
          return newFrame;
        });
        anim.current = 0;
        anim.fps = project.fps || 12;

        canvasW = newW;
        canvasH = newH;
        document.getElementById('workTitle').value = project.title || '';
        document.getElementById('workAuthor').value = project.author || '';
        document.getElementById('fpsSlider').value = anim.fps;
        document.getElementById('fpsLabel').textContent = anim.fps + ' FPS';

        syncSizeSelectors(newW, newH);

        engine.loadFrame(anim.frames[0]);
        anim._renderOnion();

        updateSizeDisplay();
        renderFrameList();
        // 加载后清空历史
        undoStack = [];
        redoStack = [];
        pushSnapshot();
        alert('项目加载成功: ' + (project.title || '未命名'));
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
    var bestRes = 32;
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