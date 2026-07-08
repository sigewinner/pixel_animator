// public/js/app.js - 主控制器
(function () {
  let canvasW = 32;
  let canvasH = 32;
  let zoomLevel = 1.0;
  let basePixelSize = 16;

  function computePixelSize(w, h) {
    const maxDim = Math.max(w, h);
    let ps = Math.floor(512 / maxDim);
    return Math.max(4, Math.min(32, ps));
  }

  function computeDims(resolution, ratioKey) {
    const parts = ratioKey.split(':').map(Number);
    const rw = parts[0], rh = parts[1];
    let w, h;
    if (rw >= rh) {
      w = resolution;
      h = Math.round(resolution * rh / rw);
    } else {
      h = resolution;
      w = Math.round(resolution * rw / rh);
    }
    return { w, h };
  }

  const DEFAULT_PALETTE = [
    '#000000', '#ffffff', '#7f7f7f', '#c3c3c3',
    '#ed1c24', '#ff7f27', '#fff200', '#22b14c',
    '#00a2e8', '#3f48cc', '#a349a4', '#ec1c8a',
    '#b97a57', '#ffaec9', '#ffc90e', '#efe4b0',
    '#b5e61d', '#99d9ea', '#7092be', '#c8bfe7',
  ];

  let customColors = [];
  try { customColors = JSON.parse(localStorage.getItem('pa_custom_colors') || '[]'); } catch (e) { customColors = []; }
  function getActivePalette() { return DEFAULT_PALETTE.concat(customColors); }

  let engine, anim;
  let isDeletingColor = false;

  // ---- 颜色标准化 ----
  function normalizeColor(color) {
    if (!color || typeof color !== 'string') return null;
    let hex = color.trim().toLowerCase();
    if (hex.startsWith('#')) hex = hex.slice(1);
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    if (hex.length === 6) return '#' + hex;
    return null;
  }

  // ---- 强制标准化一帧所有像素 ----
  function normalizeFrame(frame) {
    if (!frame) return;
    for (let i = 0; i < frame.length; i++) {
      if (frame[i] !== null) {
        const norm = normalizeColor(frame[i]);
        frame[i] = norm; // 可能为 null
      }
    }
  }

  // ---- 切换到铅笔工具 ----
  function switchToPencil() {
    document.querySelectorAll('[data-tool]').forEach(b => b.classList.remove('active'));
    const pencil = document.querySelector('[data-tool="pencil"]');
    if (pencil) pencil.classList.add('active');
    engine.setTool('pencil');
    const eraserSizeControl = document.getElementById('eraserSizeControl');
    if (eraserSizeControl) eraserSizeControl.style.display = 'none';
    const penSizeControl = document.getElementById('penSizeControl');
    if (penSizeControl) penSizeControl.style.display = 'flex';
    isDeletingColor = false;
  }

  // ---- 初始化 ----
  function init() {
    const res = parseInt(document.getElementById('resolutionSelect').value);
    const ratio = document.getElementById('ratioSelect').value;
    const dims = computeDims(res, ratio);
    canvasW = dims.w;
    canvasH = dims.h;

    const canvas = document.getElementById('drawCanvas');
    basePixelSize = computePixelSize(canvasW, canvasH);
    engine = new CanvasEngine(canvas, canvasW, canvasH, basePixelSize);
    anim = new Animation(engine, canvasW, canvasH);

    // ---- 吸管取色回调 ----
    engine.onColorPick = (color) => {
      console.log('[吸管] 取到颜色:', color);

      // 标准化颜色
      const targetColor = normalizeColor(color);
      console.log('[吸管] 标准化后:', targetColor);

      if (isDeletingColor) {
        isDeletingColor = false;
        if (!targetColor) {
          alert('无法识别该颜色，请重新点击色块。');
          switchToPencil();
          return;
        }

        // ★★★ 关键修复：先同步当前帧，确保帧数据与引擎像素一致 ★★★
        anim.syncCurrentFrame();
        const frame = anim.frames[anim.current];
        console.log('[删除] 同步后当前帧长度:', frame.length);

        // ---- 调试：打印当前帧所有颜色统计 ----
        const colorStats = {};
        for (let i = 0; i < frame.length; i++) {
          const c = frame[i];
          if (c !== null) {
            const key = c; // 保留原始值
            colorStats[key] = (colorStats[key] || 0) + 1;
          }
        }
        console.log('[删除] 当前帧颜色统计 (原始值):', colorStats);

        // 确认删除
        if (!confirm('确定要删除当前帧中所有「' + targetColor + '」像素吗？（该操作不可撤销）')) {
          switchToPencil();
          return;
        }

        // 删除：对每个像素标准化后比较
        let count = 0;
        for (let i = 0; i < frame.length; i++) {
          const pixelNorm = normalizeColor(frame[i]);
          if (pixelNorm !== null && pixelNorm === targetColor) {
            frame[i] = null;
            count++;
          }
        }

        console.log('[删除] 共删除 ' + count + ' 个像素，颜色:', targetColor);

        if (count > 0) {
          engine.loadFrame(frame);
          engine.render();
          renderFrameList();
          alert('已删除 ' + count + ' 个「' + targetColor + '」像素。');
        } else {
          alert('当前帧中没有 ' + targetColor + ' 像素。');
        }
        switchToPencil();
        return;
      }

      // ---- 正常吸管取色 ----
      if (targetColor) {
        addToTempPalette(targetColor);
        document.getElementById('colorPicker').value = targetColor;
        engine.setColor(targetColor);
        document.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
        // 高亮调色板中的颜色
        const swatches = document.querySelectorAll('.swatch');
        for (const sw of swatches) {
          if (sw.style.background === targetColor) {
            sw.classList.add('active');
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

    // 设置导入图片默认缩放模式为 contain
    const fitModeSelect = document.getElementById('fitMode');
    if (fitModeSelect) fitModeSelect.value = 'contain';

    // 初始化时强制标准化所有帧
    for (let i = 0; i < anim.frames.length; i++) {
      normalizeFrame(anim.frames[i]);
    }

    anim.onFramesChange = renderFrameList;
    anim.onFrameSelect = (i) => updateFrameListSelection(i);
    renderFrameList();
    updateSizeDisplay();
    updateZoomLabel();
    renderTempPalette();
    engine.render();
  }

  // ---- 删除颜色按钮 ----
  function startDeleteColor() {
    if (isDeletingColor) {
      isDeletingColor = false;
      switchToPencil();
      return;
    }
    isDeletingColor = true;
    document.querySelectorAll('[data-tool]').forEach(b => b.classList.remove('active'));
    const eyedropper = document.querySelector('[data-tool="eyedropper"]');
    if (eyedropper) eyedropper.classList.add('active');
    engine.setTool('eyedropper');
    document.getElementById('penSizeControl').style.display = 'none';
    document.getElementById('eraserSizeControl').style.display = 'none';
    alert('点击画布上的颜色像素来删除该颜色（仅当前帧）。');
  }

  // ---- 调色板 ----
  function buildPalette() {
    const wrap = document.getElementById('palette');
    wrap.innerHTML = '';
    const palette = getActivePalette();
    palette.forEach((color, i) => {
      const sw = document.createElement('button');
      sw.className = 'swatch' + (i < DEFAULT_PALETTE.length ? '' : ' custom');
      sw.style.background = color;
      sw.title = color;
      if (i === 0) sw.classList.add('active');
      sw.addEventListener('click', () => {
        selectColor(color, sw);
        switchToPencil();
      });
      if (i >= DEFAULT_PALETTE.length) {
        sw.addEventListener('contextmenu', (e) => {
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
    const picker = document.getElementById('colorPicker');
    picker.oninput = null;
    picker.addEventListener('input', () => {
      const norm = normalizeColor(picker.value);
      if (norm) {
        engine.setColor(norm);
        document.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
        switchToPencil();
      }
    });
    updatePaletteCount();
  }

  let selectedColor = DEFAULT_PALETTE[0];

  function selectColor(color, swEl) {
    const norm = normalizeColor(color);
    if (!norm) return;
    selectedColor = norm;
    document.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
    if (swEl) swEl.classList.add('active');
    engine.setColor(norm);
    document.getElementById('colorPicker').value = norm;
  }

  function updatePaletteCount() {
    const el = document.getElementById('paletteCount');
    if (el) el.textContent = '调色板: ' + getActivePalette().length + ' 色';
  }

  function addCustomColor(hex) {
    const norm = normalizeColor(hex);
    if (!norm) return;
    const palette = getActivePalette();
    if (palette.indexOf(norm) !== -1) {
      const idx = palette.indexOf(norm);
      const sw = document.querySelectorAll('.swatch')[idx];
      if (sw) {
        selectColor(norm, sw);
        sw.classList.add('flash');
        setTimeout(() => sw.classList.remove('flash'), 600);
      }
      return;
    }
    customColors.push(norm);
    localStorage.setItem('pa_custom_colors', JSON.stringify(customColors));
    buildPalette();
    const sws = document.querySelectorAll('.swatch');
    if (sws.length) selectColor(norm, sws[sws.length - 1]);
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
    const firstSw = document.querySelector('.swatch');
    if (firstSw) selectColor(DEFAULT_PALETTE[0], firstSw);
  }

  function bindPaletteActions() {
    document.getElementById('btnDeleteColor').addEventListener('click', deleteSelectedColor);
    document.getElementById('btnResetPalette').addEventListener('click', resetPalette);
  }

  // ---- 临时调色板 ----
  const MAX_TEMP_COLORS = 10;
  let tempPalette = [];

  function addToTempPalette(color) {
    const norm = normalizeColor(color);
    if (!norm) return;
    const idx = tempPalette.indexOf(norm);
    if (idx !== -1) tempPalette.splice(idx, 1);
    tempPalette.unshift(norm);
    if (tempPalette.length > MAX_TEMP_COLORS) tempPalette.pop();
    renderTempPalette();
  }

  function renderTempPalette() {
    const container = document.getElementById('tempPalette');
    if (!container) return;
    container.innerHTML = '';
    if (tempPalette.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'temp-empty';
      empty.textContent = '🎨 点击吸管取色';
      container.appendChild(empty);
      return;
    }
    tempPalette.forEach((color, i) => {
      const sw = document.createElement('button');
      sw.className = 'temp-swatch';
      sw.style.background = color;
      sw.title = color + ' (点击使用，右键移除)';
      sw.dataset.color = color;
      sw.addEventListener('click', () => {
        const norm = normalizeColor(color);
        if (norm) {
          engine.setColor(norm);
          document.getElementById('colorPicker').value = norm;
          document.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
          document.querySelectorAll('.temp-swatch').forEach(s => s.classList.remove('active'));
          sw.classList.add('active');
          switchToPencil();
        }
      });
      sw.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        tempPalette.splice(i, 1);
        renderTempPalette();
      });
      container.appendChild(sw);
    });
    const count = document.createElement('span');
    count.className = 'temp-count';
    count.textContent = tempPalette.length + '/' + MAX_TEMP_COLORS;
    container.appendChild(count);
  }

  // ---- 色轮 ----
  let colorWheel = null;
  function bindColorWheel() {
    const overlay = document.getElementById('cwOverlay');
    const btnOpen = document.getElementById('btnColorWheel');
    const btnClose = document.getElementById('cwClose');

    btnOpen.addEventListener('click', () => {
      overlay.classList.add('show');
      const cur = engine.color || '#000000';
      const initColor = (cur === '#000000' || cur === '#ffffff') ? '#ff0000' : cur;
      if (!colorWheel) {
        colorWheel = new ColorWheel(document.getElementById('colorWheelContainer'), {
          color: initColor,
          onChange: (hex) => {
            const norm = normalizeColor(hex);
            if (norm) {
              engine.setColor(norm);
              document.getElementById('colorPicker').value = norm;
              document.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
              switchToPencil();
            }
          },
          onAddToPalette: (hex) => {
            addCustomColor(hex);
          },
        });
      } else {
        colorWheel.setColor(initColor);
      }
    });

    btnClose.addEventListener('click', () => overlay.classList.remove('show'));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.remove('show');
    });

    const quantToggle = document.getElementById('quantizeToggle');
    const ditherRow = document.getElementById('ditherToggleRow');
    const extractToggle = document.getElementById('extractToggle');
    const extractRow = document.getElementById('extractToggleRow');
    quantToggle.addEventListener('change', () => {
      ditherRow.style.display = quantToggle.checked ? 'flex' : 'none';
      extractRow.style.display = quantToggle.checked ? 'flex' : 'none';
      if (!quantToggle.checked) extractToggle.checked = false;
    });
    ditherRow.style.display = quantToggle.checked ? 'flex' : 'none';
    extractRow.style.display = quantToggle.checked ? 'flex' : 'none';
    extractToggle.addEventListener('change', () => {
      if (extractToggle.checked && !quantToggle.checked) {
        quantToggle.checked = true;
        ditherRow.style.display = 'flex';
      }
    });
  }

  // ---- 工具栏 ----
  function bindToolbar() {
    document.querySelectorAll('[data-tool]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (isDeletingColor) {
          isDeletingColor = false;
        }
        if (engine.tool === 'crop' && btn.dataset.tool !== 'crop') {
          engine.clearCrop();
          document.getElementById('cropBar').style.display = 'none';
        }
        document.querySelectorAll('[data-tool]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        engine.setTool(btn.dataset.tool);
        
        const eraserSizeControl = document.getElementById('eraserSizeControl');
        const penSizeControl = document.getElementById('penSizeControl');
        
        if (eraserSizeControl) {
          eraserSizeControl.style.display = btn.dataset.tool === 'eraser' ? 'flex' : 'none';
        }
        if (penSizeControl) {
          penSizeControl.style.display = btn.dataset.tool === 'pencil' ? 'flex' : 'none';
        }
      });
    });

    document.getElementById('btnUndo').addEventListener('click', () => engine.undo());
    document.getElementById('btnRedo').addEventListener('click', () => engine.redo());
    document.getElementById('btnClear').addEventListener('click', () => {
      if (confirm('清空当前帧？')) engine.clear();
    });
    document.getElementById('btnGrid').addEventListener('click', (e) => {
      engine.showGrid = !engine.showGrid;
      e.currentTarget.classList.toggle('active', engine.showGrid);
      engine.render();
    });

    const eraserSizeSlider = document.getElementById('eraserSizeSlider');
    const eraserSizeLabel = document.getElementById('eraserSizeLabel');
    if (eraserSizeSlider && eraserSizeLabel) {
      eraserSizeSlider.addEventListener('input', () => {
        const size = parseInt(eraserSizeSlider.value);
        engine.setEraserSize(size);
        eraserSizeLabel.textContent = size + 'px';
      });
    }

    const penSizeSlider = document.getElementById('penSizeSlider');
    const penSizeLabel = document.getElementById('penSizeLabel');
    if (penSizeSlider && penSizeLabel) {
      penSizeSlider.addEventListener('input', () => {
        const size = parseInt(penSizeSlider.value);
        engine.setPenSize(size);
        penSizeLabel.textContent = size + 'px';
      });
    }
  }

  // ---- 帧列表 ----
  function bindFrames() {
    document.getElementById('btnAddFrame').addEventListener('click', () => anim.addFrame());
    document.getElementById('btnDupFrame').addEventListener('click', () => anim.duplicateFrame());
    document.getElementById('btnDelFrame').addEventListener('click', () => anim.deleteFrame());
  }

  function renderFrameList() {
    const list = document.getElementById('frameList');
    list.innerHTML = '';
    
    if (anim.frames.length === 0) {
      const emptyMsg = document.createElement('div');
      emptyMsg.className = 'empty-frames-msg';
      emptyMsg.textContent = '暂无帧，点击 "新帧" 创建';
      list.appendChild(emptyMsg);
      return;
    }
    
    const w = engine.width, h = engine.height;
    const thumbPs = Math.max(1, Math.ceil(48 / Math.max(w, h)));
    
    anim.frames.forEach((frame, i) => {
      const item = document.createElement('div');
      item.className = 'frame-item' + (i === anim.current ? ' active' : '');
      item.draggable = true;
      item.dataset.index = i;
      
      item.addEventListener('dragstart', (e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(i));
        setTimeout(() => item.classList.add('dragging'), 0);
      });
      
      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
        document.querySelectorAll('.frame-item.drag-over').forEach(el => {
          el.classList.remove('drag-over');
        });
      });
      
      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        document.querySelectorAll('.frame-item.drag-over').forEach(el => {
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
        const toIndex = parseInt(item.dataset.index);
        if (fromIndex !== toIndex && !isNaN(fromIndex) && !isNaN(toIndex)) {
          anim.moveFrame(fromIndex, toIndex);
          renderFrameList();
          const activeItem = list.querySelector('.frame-item.active');
          if (activeItem) {
            activeItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
        }
      });
      
      const thumb = document.createElement('canvas');
      thumb.width = w * thumbPs;
      thumb.height = h * thumbPs;
      const ctx = thumb.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, thumb.width, thumb.height);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const c = frame[y * w + x];
          if (c) { ctx.fillStyle = c; ctx.fillRect(x * thumbPs, y * thumbPs, thumbPs, thumbPs); }
        }
      }
      const img = document.createElement('img');
      img.src = thumb.toDataURL();
      img.draggable = false;
      item.appendChild(img);

      const label = document.createElement('span');
      label.textContent = (i + 1);
      item.appendChild(label);

      const dragHint = document.createElement('span');
      dragHint.className = 'drag-hint';
      dragHint.textContent = '⠿';
      dragHint.title = '拖拽排序';
      item.appendChild(dragHint);

      item.addEventListener('click', () => anim.selectFrame(i));
      list.appendChild(item);
    });
  }

  function updateFrameListSelection(index) {
    document.querySelectorAll('.frame-item').forEach((el, i) => {
      el.classList.toggle('active', i === index);
    });
  }

  // ---- 播放控制 ----
  function bindPlayback() {
    const btnPlay = document.getElementById('btnPlay');
    btnPlay.addEventListener('click', () => {
      if (anim.playing) {
        anim.stop();
        btnPlay.textContent = '播放';
      } else {
        anim.play();
        btnPlay.textContent = '停止';
      }
    });

    const fpsSlider = document.getElementById('fpsSlider');
    const fpsLabel = document.getElementById('fpsLabel');
    fpsSlider.addEventListener('input', () => {
      const fps = parseInt(fpsSlider.value);
      anim.setFps(fps);
      fpsLabel.textContent = fps + ' FPS';
    });

    const onionBtn = document.getElementById('btnOnion');
    onionBtn.addEventListener('click', function(e) {
      const on = anim.toggleOnionSkin();
      this.classList.toggle('active', on);
    });
    onionBtn.classList.toggle('active', anim.onionSkin);
  }

  // ---- 导出与保存 ----
  function bindExport() {
    document.getElementById('btnGif').addEventListener('click', exportGif);
    document.getElementById('btnSave').addEventListener('click', saveWork);
    document.getElementById('btnPng').addEventListener('click', exportPng);
    document.getElementById('btnSaveLocal').addEventListener('click', saveToLocalFile);
    document.getElementById('btnLoadLocal').addEventListener('click', () => {
      document.getElementById('projectFileInput').click();
    });
    document.getElementById('projectFileInput').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) loadFromLocalFile(file);
      e.target.value = '';
    });
  }

  // ---- 照片转像素 ----
  function bindImport() {
    const btn = document.getElementById('btnImportImg');
    const input = document.getElementById('imgInput');
    btn.addEventListener('click', () => input.click());
    input.addEventListener('change', (e) => {
      const files = Array.from(e.target.files);
      if (files.length === 0) return;
      importImages(files);
      input.value = '';
    });
  }

  function importImages(files) {
    const hint = document.getElementById('importHint');
    const n = files.length;
    if (hint) hint.textContent = '正在读取 ' + n + ' 张图片...';

    const opts = readImportOptions();
    const images = new Array(n);
    let loaded = 0;

    files.forEach((file, idx) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => { images[idx] = img; done(); };
        img.onerror = () => { done(); };
        img.src = ev.target.result;
      };
      reader.onerror = () => { done(); };
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
    const w = engine.width, h = engine.height;

    const framesData = [];
    for (const img of images) {
      const ctx = drawToCanvas(img, w, h, opts.fitMode);
      let data = ctx.getImageData(0, 0, w, h);
      if (opts.enhance) data = enhanceImageData(data);
      framesData.push(data);
    }
    if (framesData.length === 0) { if (hint) hint.textContent = '没有有效图片'; return; }

    let palette = getActivePalette();
    let extractedCount = 0;
    if (opts.quantize && opts.extract) {
      const sampled = [];
      for (const data of framesData) samplePixels(data.data, sampled, 4000);
      const extracted = medianCut(sampled, 64);
      extractedCount = extracted.length;
      const existing = new Set(getActivePalette());
      let added = 0;
      for (const hex of extracted) {
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

    engine.pushHistory();
    framesData.forEach((data, idx) => {
      let pixels = opts.quantize
        ? quantizeFrame(data.data, w, h, palette, opts.dither)
        : directSample(data.data, w, h);

      // 标准化新生成的像素
      for (let i = 0; i < pixels.length; i++) {
        if (pixels[i] !== null) {
          const norm = normalizeColor(pixels[i]);
          pixels[i] = norm;
        }
      }

      if (idx === 0) {
        engine.loadFrame(pixels);
        anim.frames[anim.current] = pixels.slice();
      } else {
        anim.addFrame();
        anim.frames[anim.current] = pixels.slice();
        engine.loadFrame(pixels);
      }
    });
    renderFrameList();

    if (hint) {
      let msg = framesData.length + ' 张图片已转为' + (framesData.length > 1 ? '帧序列' : '像素');
      if (extractedCount > 0) msg += '（提取 ' + extractedCount + ' 色已加入调色板）';
      hint.textContent = msg;
      setTimeout(() => { if (hint) hint.textContent = ''; }, 5000);
    }
  }

  function drawToCanvas(img, w, h, fitMode) {
    const tmp = document.createElement('canvas');
    tmp.width = w; tmp.height = h;
    const ctx = tmp.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, w, h);

    const iw = img.width, ih = img.height;
    if (fitMode === 'stretch') {
      ctx.drawImage(img, 0, 0, iw, ih, 0, 0, w, h);
    } else if (fitMode === 'contain') {
      const scale = Math.min(w / iw, h / ih);
      const sw = iw * scale, sh = ih * scale;
      const dx = (w - sw) / 2, dy = (h - sh) / 2;
      ctx.drawImage(img, 0, 0, iw, ih, dx, dy, sw, sh);
    } else {
      const scale = Math.max(w / iw, h / ih);
      const sw = w / scale, sh = h / scale;
      const sx = (iw - sw) / 2, sy = (ih - sh) / 2;
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
    }
    return ctx;
  }

  function enhanceImageData(imageData) {
    const d = imageData.data;
    const satBoost = 1.35;
    const conBoost = 1.18;
    const conMid = 128;
    for (let i = 0; i < d.length; i += 4) {
      let r = d[i], g = d[i + 1], b = d[i + 2];
      r = conMid + (r - conMid) * conBoost;
      g = conMid + (g - conMid) * conBoost;
      b = conMid + (b - conMid) * conBoost;
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
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
    const total = data.length / 4;
    const step = Math.max(1, Math.floor(total / maxCount));
    for (let i = 0; i < total; i += step) {
      const idx = i * 4;
      if (data[idx + 3] < 128) continue;
      out.push([data[idx], data[idx + 1], data[idx + 2]]);
    }
  }

  function medianCut(pixels, numColors) {
    if (pixels.length === 0) return [];
    let boxes = [pixels];
    while (boxes.length < numColors) {
      let maxBox = -1, maxVar = -1;
      for (let i = 0; i < boxes.length; i++) {
        if (boxes[i].length < 2) continue;
        const v = boxVariance(boxes[i]);
        if (v > maxVar) { maxVar = v; maxBox = i; }
      }
      if (maxBox === -1) break;
      const box = boxes[maxBox];
      const ch = boxMaxChannel(box);
      box.sort((a, b) => a[ch] - b[ch]);
      const mid = Math.floor(box.length / 2);
      boxes.splice(maxBox, 1, box.slice(0, mid), box.slice(mid));
    }
    return boxes.map(box => {
      let r = 0, g = 0, b = 0;
      for (const p of box) { r += p[0]; g += p[1]; b += p[2]; }
      const n = box.length;
      return rgbToHex(r / n, g / n, b / n);
    });
  }

  function boxVariance(box) {
    const n = box.length;
    let mr = 0, mg = 0, mb = 0;
    for (const p of box) { mr += p[0]; mg += p[1]; mb += p[2]; }
    mr /= n; mg /= n; mb /= n;
    let vr = 0, vg = 0, vb = 0;
    for (const p of box) { vr += (p[0]-mr)**2; vg += (p[1]-mg)**2; vb += (p[2]-mb)**2; }
    return vr + vg + vb;
  }

  function boxMaxChannel(box) {
    let mn = [255,255,255], mx = [0,0,0];
    for (const p of box) {
      for (let c = 0; c < 3; c++) { if (p[c]<mn[c]) mn[c]=p[c]; if (p[c]>mx[c]) mx[c]=p[c]; }
    }
    const dr = mx[0]-mn[0], dg = mx[1]-mn[1], db = mx[2]-mn[2];
    if (dr >= dg && dr >= db) return 0;
    if (dg >= db) return 1;
    return 2;
  }

  function directSample(data, w, h) {
    const pixels = new Array(w * h).fill(null);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (data[i + 3] < 128) { pixels[y * w + x] = null; continue; }
        pixels[y * w + x] = rgbToHex(data[i], data[i + 1], data[i + 2]);
      }
    }
    return pixels;
  }

  function quantizeFrame(data, w, h, palette, dither) {
    const pixels = new Array(w * h).fill(null);
    if (dither) {
      const buf = new Float32Array(w * h * 3);
      for (let i = 0; i < w * h; i++) {
        buf[i*3] = data[i*4]; buf[i*3+1] = data[i*4+1]; buf[i*3+2] = data[i*4+2];
      }
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (data[(y*w+x)*4+3] < 128) { pixels[y*w+x] = null; continue; }
          const idx = (y*w+x)*3;
          const r = Math.max(0, Math.min(255, buf[idx]));
          const g = Math.max(0, Math.min(255, buf[idx+1]));
          const b = Math.max(0, Math.min(255, buf[idx+2]));
          const hex = nearestPaletteColor(r, g, b, palette);
          pixels[y*w+x] = hex;
          const pr = parseInt(hex.slice(1,3),16);
          const pg = parseInt(hex.slice(3,5),16);
          const pb = parseInt(hex.slice(5,7),16);
          const er = r-pr, eg = g-pg, eb = b-pb;
          if (x+1 < w) { const ni=(y*w+x+1)*3; buf[ni]+=er*7/16; buf[ni+1]+=eg*7/16; buf[ni+2]+=eb*7/16; }
          if (y+1 < h) {
            if (x>0) { const ni=((y+1)*w+x-1)*3; buf[ni]+=er*3/16; buf[ni+1]+=eg*3/16; buf[ni+2]+=eb*3/16; }
            { const ni=((y+1)*w+x)*3; buf[ni]+=er*5/16; buf[ni+1]+=eg*5/16; buf[ni+2]+=eb*5/16; }
            if (x+1<w) { const ni=((y+1)*w+x+1)*3; buf[ni]+=er*1/16; buf[ni+1]+=eg*1/16; buf[ni+2]+=eb*1/16; }
          }
        }
      }
    } else {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y*w+x)*4;
          if (data[i+3] < 128) { pixels[y*w+x] = null; continue; }
          pixels[y*w+x] = nearestPaletteColor(data[i], data[i+1], data[i+2], palette);
        }
      }
    }
    return pixels;
  }

  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  }

  function nearestPaletteColor(r, g, b, palette) {
    palette = palette || getActivePalette();
    let best = palette[0], bestDist = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const c = palette[i];
      const pr = parseInt(c.slice(1, 3), 16);
      const pg = parseInt(c.slice(3, 5), 16);
      const pb = parseInt(c.slice(5, 7), 16);
      const ravg = (r + pr) / 2;
      const dr = r - pr, dg = g - pg, db = b - pb;
      const dist = (2 + ravg / 256) * dr * dr + 4 * dg * dg + (2 + (255 - ravg) / 256) * db * db;
      if (dist < bestDist) { bestDist = dist; best = c; }
    }
    return best;
  }

  function bindCanvasSize() {
    const resSel = document.getElementById('resolutionSelect');
    const ratioSel = document.getElementById('ratioSelect');
    resSel.addEventListener('change', updateSizePreview);
    ratioSel.addEventListener('change', updateSizePreview);
    document.getElementById('btnApplySize').addEventListener('click', applyCanvasSize);
  }

  function updateSizePreview() {
    const res = parseInt(document.getElementById('resolutionSelect').value);
    const ratio = document.getElementById('ratioSelect').value;
    const dims = computeDims(res, ratio);
    const display = document.getElementById('currentSize');
    const isCurrent = (dims.w === canvasW && dims.h === canvasH);
    display.textContent = dims.w + ' × ' + dims.h + (isCurrent ? '' : ' →');
    display.style.color = isCurrent ? 'var(--text-muted)' : 'var(--primary)';
  }

  function updateSizeDisplay() {
    document.getElementById('canvasInfo').textContent = canvasW + ' × ' + canvasH + ' 像素';
    document.getElementById('currentSize').textContent = canvasW + ' × ' + canvasH;
  }

  function applyCanvasSize() {
    const res = parseInt(document.getElementById('resolutionSelect').value);
    const ratio = document.getElementById('ratioSelect').value;
    const dims = computeDims(res, ratio);

    if (dims.w === canvasW && dims.h === canvasH) return;

    anim.syncCurrentFrame();
    const hasContent = anim.frames.some(f => f.some(c => c !== null));
    if (hasContent && !confirm('调整画布尺寸将缩放现有内容（最近邻），确认继续？')) return;

    if (anim.playing) {
      anim.stop();
      document.getElementById('btnPlay').textContent = '播放';
    }

    const newPixelSize = computePixelSize(dims.w, dims.h);
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
  }

  function bindZoom() {
    document.getElementById('btnZoomIn').addEventListener('click', () => setZoom(zoomLevel * 1.5));
    document.getElementById('btnZoomOut').addEventListener('click', () => setZoom(zoomLevel / 1.5));
    document.getElementById('btnZoomFit').addEventListener('click', () => setZoom(1.0));
  }

  function setZoom(z) {
    zoomLevel = Math.max(0.25, Math.min(6, z));
    const ps = Math.max(2, Math.min(48, Math.round(basePixelSize * zoomLevel)));
    engine.setPixelSize(ps);
    updateZoomLabel();
  }

  function updateZoomLabel() {
    const el = document.getElementById('zoomLevel');
    if (el) el.textContent = Math.round(zoomLevel * 100) + '%';
  }

  function bindCrop() {
    engine.onCropSelect = (rect) => {
      const bar = document.getElementById('cropBar');
      if (rect) {
        bar.style.display = 'flex';
        document.getElementById('cropSize').textContent = rect.w + ' × ' + rect.h;
      } else {
        bar.style.display = 'none';
      }
    };

    document.getElementById('btnCropConfirm').addEventListener('click', () => {
      const rect = engine.getCropRect();
      if (!rect || rect.w < 1 || rect.h < 1) return;

      if (rect.w === engine.width && rect.h === engine.height) {
        exitCropMode();
        return;
      }

      anim.syncCurrentFrame();
      if (anim.playing) { anim.stop(); document.getElementById('btnPlay').textContent = '播放'; }

      const newPixelSize = computePixelSize(rect.w, rect.h);
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
    const w = engine.width, h = engine.height;
    const tmp = document.createElement('canvas');
    tmp.width = w;
    tmp.height = h;
    const ctx = tmp.getContext('2d');
    const frame = anim.getCurrentFrame();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = frame[y * w + x];
        if (c) { ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1); }
      }
    }
    const a = document.createElement('a');
    a.href = tmp.toDataURL('image/png');
    a.download = 'frame.png';
    a.click();
  }

  async function exportGif() {
    const frames = anim.getAllFrames();
    if (frames.length < 1) { alert('没有可导出的帧'); return; }

    const w = engine.width, h = engine.height;
    const scale = parseInt(document.getElementById('gifScale').value) || 1;
    const outW = w * scale;
    const outH = h * scale;
    const btn = document.getElementById('btnGif');
    const btnText = btn.textContent;
    const progressBar = document.getElementById('gifProgress');

    btn.textContent = '准备中...';
    btn.disabled = true;
    if (progressBar) {
      progressBar.style.display = 'block';
      progressBar.querySelector('.gif-progress-fill').style.width = '0%';
      progressBar.querySelector('.gif-progress-text').textContent = '0%';
    }

    let workerUrl = null;
    let watchdog = null;

    try {
      const workerRes = await fetch('lib/gif.js/gif.worker.js');
      if (!workerRes.ok) throw new Error('Worker 脚本加载失败 (' + workerRes.status + ')');
      const workerCode = await workerRes.text();
      const workerBlob = new Blob([workerCode], { type: 'application/javascript' });
      workerUrl = URL.createObjectURL(workerBlob);

      const gif = new GIF({
        workers: 4,
        quality: 10,
        width: outW,
        height: outH,
        workerScript: workerUrl,
        dither: false,
      });

      const frameDelay = Math.round(1000 / anim.fps);

      frames.forEach(frame => {
        const tmp = document.createElement('canvas');
        tmp.width = w;
        tmp.height = h;
        const ctx = tmp.getContext('2d');
        const imgData = ctx.createImageData(w, h);
        const buf = imgData.data;

        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const c = frame[y * w + x];
            const idx = (y * w + x) * 4;
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
          const scaled = document.createElement('canvas');
          scaled.width = outW;
          scaled.height = outH;
          const sctx = scaled.getContext('2d');
          sctx.imageSmoothingEnabled = false;
          sctx.drawImage(tmp, 0, 0, outW, outH);
          gif.addFrame(scaled, { delay: frameDelay, copy: true });
        } else {
          gif.addFrame(tmp, { delay: frameDelay, copy: true });
        }
      });

      watchdog = setTimeout(() => {
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
        if (progressBar) { setTimeout(() => { progressBar.style.display = 'none'; }, 1000); }
      }

      gif.on('progress', (p) => {
        const pct = Math.round(p * 100);
        if (progressBar) {
          progressBar.querySelector('.gif-progress-fill').style.width = pct + '%';
          progressBar.querySelector('.gif-progress-text').textContent = pct + '%';
        }
        btn.textContent = '生成中 ' + pct + '%';
      });

      gif.on('finished', (blob) => {
        if (watchdog) { clearTimeout(watchdog); watchdog = null; }
        if (workerUrl) { URL.revokeObjectURL(workerUrl); workerUrl = null; }
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'pixel-animation.gif';
        a.click();
        URL.revokeObjectURL(a.href);
        btn.textContent = btnText;
        btn.disabled = false;
        if (progressBar) {
          setTimeout(() => { progressBar.style.display = 'none'; }, 1000);
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
    const title = document.getElementById('workTitle').value.trim() || '未命名作品';
    const author = document.getElementById('workAuthor').value.trim() || '匿名';
    const btn = document.getElementById('btnSave');
    btn.textContent = '上传中...';
    btn.disabled = true;

    const workData = {
      title,
      author,
      width: engine.width,
      height: engine.height,
      frameCount: anim.frames.length,
      fps: anim.fps,
      frames: anim.getAllFrames(),
      thumbnail: anim.getThumbnail(),
      created_at: new Date().toLocaleString('zh-CN'),
    };

    try {
      const res = await fetch('/api/works', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(workData)
      });
      const data = await res.json();
      if (data.ok) {
        alert('上传成功！作品已加入在线作品库，ID: ' + data.id);
      } else {
        throw new Error(data.error);
      }
    } catch (err) {
      const works = JSON.parse(localStorage.getItem('pa_works') || '[]');
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
    const title = document.getElementById('workTitle').value.trim() || '未命名作品';
    const author = document.getElementById('workAuthor').value.trim() || '匿名';

    const project = {
      format: 'pixelforge-project',
      version: 1,
      title,
      author,
      width: engine.width,
      height: engine.height,
      fps: anim.fps,
      frames: anim.getAllFrames(),
      thumbnail: anim.getThumbnail(),
      savedAt: new Date().toISOString(),
    };

    const json = JSON.stringify(project);
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const safeName = title.replace(/[<>:"/\\|?*]/g, '_');
    a.download = safeName + '.pixa';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function loadFromLocalFile(file) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const project = JSON.parse(ev.target.result);
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

        const newW = project.width;
        const newH = project.height;
        const newPixelSize = computePixelSize(newW, newH);

        engine.resize(newW, newH, newPixelSize);
        anim.resize(newW, newH);

        // 加载帧并标准化所有像素
        anim.frames = project.frames.map(frame => {
          const newFrame = frame.slice();
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
        alert('项目加载成功: ' + (project.title || '未命名'));
      } catch (err) {
        alert('加载失败: ' + err.message);
      }
    };
    reader.readAsText(file);
  }

  function syncSizeSelectors(w, h) {
    const resSel = document.getElementById('resolutionSelect');
    const ratioSel = document.getElementById('ratioSelect');
    const maxDim = Math.max(w, h);
    const resolutions = [16, 24, 32, 48, 64, 96, 128];
    let bestRes = 32;
    let bestDiff = Infinity;
    for (const r of resolutions) {
      if (Math.abs(r - maxDim) < bestDiff) { bestDiff = Math.abs(r - maxDim); bestRes = r; }
    }
    resSel.value = bestRes;
    const ratios = ['1:1','4:3','3:4','16:9','9:16','2:1','1:2','3:2','2:3'];
    let bestRatio = '1:1';
    let bestRatioDiff = Infinity;
    for (const r of ratios) {
      const parts = r.split(':').map(Number);
      const targetW = parts[0] >= parts[1] ? bestRes : Math.round(bestRes * parts[0] / parts[1]);
      const targetH = parts[0] >= parts[1] ? Math.round(bestRes * parts[1] / parts[0]) : bestRes;
      const diff = Math.abs(targetW - w) + Math.abs(targetH - h);
      if (diff < bestRatioDiff) { bestRatioDiff = diff; bestRatio = r; }
    }
    ratioSel.value = bestRatio;
  }

  // 启动
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();