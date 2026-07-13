// public/js/modules/toolbar.js - 工具栏、图形子菜单、缩放、裁剪
(function (PA) {
  var S = PA.state;

  function pushSnapshot() { return PA.pushSnapshot(); }
  function autoSave() { return PA.autoSave(); }
  function switchToPencil() { return PA.switchToPencil(); }
  function updateZoomLabel() { return PA.updateZoomLabel(); }

  function bindToolbar() {
    // 工具按钮点击事件
    document.querySelectorAll('[data-tool]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (S.isDeletingColor) S.isDeletingColor = false;
        if (S.engine.tool === 'crop' && btn.dataset.tool !== 'crop') {
          S.engine.clearCrop();
          document.getElementById('cropBar').style.display = 'none';
        }

        document.querySelectorAll('[data-tool]').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        S.engine.setTool(btn.dataset.tool);

        // 注意：切换工具时【不】取消图层激活状态（修复：点击其它按钮不再收起图层面板）。

        var eraserSizeControl = document.getElementById('eraserSizeControl');
        var penSizeControl = document.getElementById('penSizeControl');

        if (eraserSizeControl) eraserSizeControl.style.display = btn.dataset.tool === 'eraser' ? 'flex' : 'none';
        if (penSizeControl) penSizeControl.style.display = btn.dataset.tool === 'pencil' ? 'flex' : 'none';
      });
    });

    // 图层切换按钮（独立绑定，类似网格按钮）
    var layerToggleBtn = document.getElementById('btnToggleLayers');
    if (layerToggleBtn) {
      layerToggleBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        var layerPanel = document.getElementById('layerPanel');
        if (!layerPanel) return;
        this.classList.toggle('active');
        var isActive = this.classList.contains('active');
        layerPanel.style.display = isActive ? 'block' : 'none';
        if (isActive && S.layerSystem) S.layerSystem._renderLayerList();
      });
    }

    // 撤销
    document.getElementById('btnUndo').addEventListener('click', function () {
      if (!PA.undoOperation()) alert('没有可撤销的操作');
    });

    // 重做
    document.getElementById('btnRedo').addEventListener('click', function () {
      if (!PA.redoOperation()) alert('没有可重做的操作');
    });

    // 清空当前图层
    document.getElementById('btnClear').addEventListener('click', function () {
      if (!confirm('清空当前图层？')) return;
      if (S.layerSystem) {
        S.layerSystem.clearCurrentLayer();
      } else {
        S.engine.clear();
        var idx = S.anim.current;
        S.anim.frames[idx] = S.engine.pixels.slice();
        pushSnapshot();
      }
      autoSave();
    });

    // 网格按钮
    document.getElementById('btnGrid').addEventListener('click', function (e) {
      S.engine.showGrid = !S.engine.showGrid;
      e.currentTarget.classList.toggle('active', S.engine.showGrid);
      S.engine.render();
    });

    // 橡皮擦大小
    var eraserSizeSlider = document.getElementById('eraserSizeSlider');
    var eraserSizeLabel = document.getElementById('eraserSizeLabel');
    if (eraserSizeSlider && eraserSizeLabel) {
      eraserSizeSlider.addEventListener('input', function () {
        var size = parseInt(eraserSizeSlider.value);
        S.engine.setEraserSize(size);
        eraserSizeLabel.textContent = size + 'px';
      });
    }

    // 钢笔大小
    var penSizeSlider = document.getElementById('penSizeSlider');
    var penSizeLabel = document.getElementById('penSizeLabel');
    if (penSizeSlider && penSizeLabel) {
      penSizeSlider.addEventListener('input', function () {
        var size = parseInt(penSizeSlider.value);
        S.engine.setPenSize(size);
        penSizeLabel.textContent = size + 'px';
      });
    }
  }

  // ---- 图形子菜单 ----
  function initShapeMenu() {
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

    if (!btnShape || !shapeSubmenu) return;

    btnShape.addEventListener('click', function (e) {
      e.stopPropagation();
      if (S.engine.tool === 'shape') {
        shapeSubmenu.classList.toggle('show');
      } else {
        if (window.SFX) window.SFX.select();
        document.querySelectorAll('[data-tool]').forEach(function (b) { b.classList.remove('active'); });
        btnShape.classList.add('active');
        S.engine.setTool('shape');
        shapeSubmenu.classList.add('show');
      }
    });

    document.querySelectorAll('.shape-option').forEach(function (opt) {
      opt.addEventListener('click', function (e) {
        e.stopPropagation();
        var shapeType = opt.dataset.shape;
        document.querySelectorAll('.shape-option').forEach(function (o) { o.classList.remove('active'); });
        opt.classList.add('active');
        if (shapeIcon && shapeIcons[shapeType]) shapeIcon.innerHTML = shapeIcons[shapeType];
        S.engine.setShapeType(shapeType);
        if (window.SFX) window.SFX.select();
        document.querySelectorAll('[data-tool]').forEach(function (b) { b.classList.remove('active'); });
        btnShape.classList.add('active');
        S.engine.setTool('shape');
        shapeSubmenu.classList.remove('show');
      });
    });

    document.addEventListener('click', function (e) {
      if (shapeSubmenu && !shapeSubmenu.contains(e.target) && e.target !== btnShape) {
        shapeSubmenu.classList.remove('show');
      }
    });
  }

  function bindZoom() {
    document.getElementById('btnZoomIn').addEventListener('click', function () { setZoom(S.zoomLevel * 1.5); });
    document.getElementById('btnZoomOut').addEventListener('click', function () { setZoom(S.zoomLevel / 1.5); });
    document.getElementById('btnZoomFit').addEventListener('click', function () { setZoom(1.0); });
  }

  function setZoom(z) {
    S.zoomLevel = Math.max(0.25, Math.min(6, z));
    var ps = Math.max(2, Math.min(48, Math.round(S.basePixelSize * S.zoomLevel)));
    S.engine.setPixelSize(ps);
    updateZoomLabel();
  }

  function bindCrop() {
    S.engine.onCropSelect = function (rect) {
      var bar = document.getElementById('cropBar');
      if (rect) {
        bar.style.display = 'flex';
        document.getElementById('cropSize').textContent = rect.w + ' × ' + rect.h;
      } else {
        bar.style.display = 'none';
      }
    };

    document.getElementById('btnCropConfirm').addEventListener('click', function () {
      var rect = S.engine.getCropRect();
      if (!rect || rect.w < 1 || rect.h < 1) return;

      if (rect.w === S.engine.width && rect.h === S.engine.height) {
        exitCropMode();
        return;
      }

      S.anim.syncCurrentFrame();
      if (S.anim.playing) { S.anim.stop(); document.getElementById('btnPlay').textContent = '播放'; }

      var newPixelSize = PA.computePixelSize(rect.w, rect.h);
      S.basePixelSize = newPixelSize;
      S.zoomLevel = 1.0;
      var oldW = S.engine.width, oldH = S.engine.height;
      S.engine.applyCrop(rect.x1, rect.y1, rect.x2, rect.y2, newPixelSize);
      S.anim.crop(rect.x1, rect.y1, rect.x2, rect.y2);
      if (S.layerSystem) S.layerSystem.crop(rect.x1, rect.y1, rect.x2, rect.y2, oldW, oldH);

      S.canvasW = S.engine.width;
      S.canvasH = S.engine.height;
      S.engine.loadFrame(S.anim.frames[S.anim.current]);
      S.anim._renderOnion();

      PA.updateSizeDisplay();
      updateZoomLabel();
      PA.renderFrameList();
      pushSnapshot();
      exitCropMode();
    });

    document.getElementById('btnCropCancel').addEventListener('click', exitCropMode);
  }

  function exitCropMode() {
    S.engine.clearCrop();
    document.getElementById('cropBar').style.display = 'none';
    switchToPencil();
  }

  function init() {
    bindToolbar();
    initShapeMenu();
    bindZoom();
    bindCrop();
    bindView();
  }

  // ---- 视图变换：旋转 / 平移 / 像素翻转旋转 ----
  function bindView() {
    var engine = S.engine;

    // 旋转角度变化 -> 同步滑块与标签
    engine.onRotationChange = function (deg) {
      var slider = document.getElementById('rotSlider');
      var label = document.getElementById('rotLabel');
      if (slider) slider.value = deg;
      if (label) label.textContent = deg + '°';
    };

    var rotSlider = document.getElementById('rotSlider');
    if (rotSlider) {
      rotSlider.addEventListener('input', function () {
        var deg = parseInt(rotSlider.value, 10) || 0;
        engine.setRotation(deg);
      });
    }

    var btnRotLeft = document.getElementById('btnRotLeft');
    if (btnRotLeft) btnRotLeft.addEventListener('click', function () {
      engine.setRotation(engine.rotation - 90);
    });
    var btnRotRight = document.getElementById('btnRotRight');
    if (btnRotRight) btnRotRight.addEventListener('click', function () {
      engine.setRotation(engine.rotation + 90);
    });
    var btnViewReset = document.getElementById('btnViewReset');
    if (btnViewReset) btnViewReset.addEventListener('click', function () {
      engine.resetView();
    });

    // 像素级翻转 / 旋转（作用于所有帧）
    function doTransform(kind) {
      if (S.layerSystem) {
        S.layerSystem.transformAllFrames(kind);
      } else {
        var w = engine.width, h = engine.height;
        engine.pixels = CanvasEngine.transformFrame(engine.pixels, w, h, kind);
        S.anim.frames[S.anim.current] = engine.pixels.slice();
        if (kind === 'rotCW' || kind === 'rotCCW') {
          var nw = h, nh = w;
          engine.width = nw; engine.height = nh;
          engine.canvas.width = nw * engine.pixelSize;
          engine.canvas.height = nh * engine.pixelSize;
          engine.resetView();
        }
        engine.render();
        pushSnapshot();
      }
      S.canvasW = engine.width;
      S.canvasH = engine.height;
      PA.updateSizeDisplay();
      PA.renderFrameList();
      autoSave();
    }

    var btnFlipH = document.getElementById('btnFlipH');
    if (btnFlipH) btnFlipH.addEventListener('click', function () { doTransform('flipH'); });
    var btnFlipV = document.getElementById('btnFlipV');
    if (btnFlipV) btnFlipV.addEventListener('click', function () { doTransform('flipV'); });

    // 按住空格临时平移（松开恢复）
    var spaceHeld = false;
    window.addEventListener('keydown', function (e) {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (e.code === 'Space' || e.key === ' ') {
        if (!spaceHeld) {
          spaceHeld = true;
          engine.setSpacePan(true);
          e.preventDefault();
        }
      }
    });
    window.addEventListener('keyup', function (e) {
      if (e.code === 'Space' || e.key === ' ') {
        spaceHeld = false;
        engine.setSpacePan(false);
      }
    });
  }

  PA.Toolbar = {
    init: init,
    bindToolbar: bindToolbar,
    initShapeMenu: initShapeMenu,
    bindZoom: bindZoom,
    setZoom: setZoom,
    bindCrop: bindCrop,
    exitCropMode: exitCropMode,
    bindView: bindView,
  };
})(window.PA);
