// public/js/modules/canvas-size.js - 画布尺寸设置
(function (PA) {
  var S = PA.state;

  function pushSnapshot() { return PA.pushSnapshot(); }
  function autoSave() { return PA.autoSave(); }
  function renderFrameList() { return PA.renderFrameList(); }
  function updateSizeDisplay() { return PA.updateSizeDisplay(); }
  function updateZoomLabel() { return PA.updateZoomLabel(); }

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
    var dims = PA.computeDims(res, ratio);
    var display = document.getElementById('currentSize');
    var isCurrent = (dims.w === S.canvasW && dims.h === S.canvasH);
    display.textContent = dims.w + ' × ' + dims.h + (isCurrent ? '' : ' →');
    display.style.color = isCurrent ? 'var(--text-muted)' : 'var(--primary)';
  }

  function applyCanvasSize() {
    var res = parseInt(document.getElementById('resolutionSelect').value);
    var ratio = document.getElementById('ratioSelect').value;
    var dims = PA.computeDims(res, ratio);

    var currentW = S.engine.width;
    var currentH = S.engine.height;
    var sizeChanged = (dims.w !== currentW || dims.h !== currentH);

    if (sizeChanged) {
      S.anim.syncCurrentFrame();
      var hasContent = S.anim.frames.some(function (f) {
        return f.some(function (c) { return c !== null; });
      });
      if (hasContent && !confirm('调整画布尺寸将缩放现有内容（最近邻），确认继续？')) {
        closeSettingCardSafely();
        return;
      }
    }

    if (S.anim.playing) {
      S.anim.stop();
      document.getElementById('btnPlay').textContent = '播放';
    }

    if (sizeChanged) {
      var newPixelSize = PA.computePixelSize(dims.w, dims.h);
      S.basePixelSize = newPixelSize;
      S.zoomLevel = 1.0;
      var oldW = S.engine.width, oldH = S.engine.height;
      S.engine.resize(dims.w, dims.h, newPixelSize);
      S.anim.resize(dims.w, dims.h);
      if (S.layerSystem) S.layerSystem.resize(dims.w, dims.h, oldW, oldH);

      S.canvasW = dims.w;
      S.canvasH = dims.h;
      S.engine.loadFrame(S.anim.frames[S.anim.current]);
      S.anim._renderOnion();

      updateSizeDisplay();
      updateZoomLabel();
      renderFrameList();
      pushSnapshot();
      autoSave();
    }

    // 无论是否修改，都关闭卡片
    closeSettingCardSafely();
  }

  // 安全关闭设置卡片
  function closeSettingCardSafely() {
    if (typeof window.closeSettingCard === 'function') {
      window.closeSettingCard();
      return;
    }
    var overlay = document.getElementById('settingCardOverlay');
    if (overlay) {
      overlay.classList.remove('open');
    } else {
      var oldOverlay = document.getElementById('cardOverlay');
      if (oldOverlay) oldOverlay.classList.remove('open');
    }
    var mainContent = document.querySelector('.main-content');
    if (mainContent) mainContent.classList.remove('blurred');
    document.querySelectorAll('.card-overlay').forEach(function (el) { el.classList.remove('open'); });
  }

  function init() { bindCanvasSize(); }

  PA.CanvasSize = {
    init: init,
    bindCanvasSize: bindCanvasSize,
    updateSizePreview: updateSizePreview,
    applyCanvasSize: applyCanvasSize,
    closeSettingCardSafely: closeSettingCardSafely,
  };
})(window.PA);
