// public/js/modules/palette.js - 调色板、临时调色板、色轮
(function (PA) {
  var S = PA.state;

  // 便捷访问核心函数
  function pushSnapshot() { return PA.pushSnapshot(); }
  function autoSave() { return PA.autoSave(); }
  function normalizeColor(c) { return PA.normalizeColor(c); }
  function switchToPencil() { return PA.switchToPencil(); }
  function getActivePalette() { return PA.getActivePalette(); }

  function buildPalette() {
    var wrap = document.getElementById('palette');
    wrap.innerHTML = '';
    var palette = getActivePalette();
    palette.forEach(function (color, i) {
      var sw = document.createElement('button');
      sw.className = 'swatch' + (i < PA.DEFAULT_PALETTE.length ? '' : ' custom');
      sw.style.background = color;
      sw.title = color;
      if (i === 0) sw.classList.add('active');
      sw.addEventListener('click', function () {
        selectColor(color, sw);
        switchToPencil();
      });
      if (i >= PA.DEFAULT_PALETTE.length) {
        sw.addEventListener('contextmenu', function (e) {
          e.preventDefault();
          if (confirm('从调色板移除颜色 ' + color + ' ?')) {
            S.customColors.splice(i - PA.DEFAULT_PALETTE.length, 1);
            localStorage.setItem('pa_custom_colors', JSON.stringify(S.customColors));
            buildPalette();
            updatePaletteCount();
          }
        });
      }
      wrap.appendChild(sw);
    });
    var picker = document.getElementById('colorPicker');
    picker.oninput = null;
    picker.addEventListener('input', function () {
      var norm = normalizeColor(picker.value);
      if (norm) {
        S.engine.setColor(norm);
        document.querySelectorAll('.swatch').forEach(function (s) { s.classList.remove('active'); });
        switchToPencil();
      }
    });
    updatePaletteCount();
    autoSave();
  }

  function selectColor(color, swEl) {
    var norm = normalizeColor(color);
    if (!norm) return;
    S.selectedColor = norm;
    document.querySelectorAll('.swatch').forEach(function (s) { s.classList.remove('active'); });
    if (swEl) swEl.classList.add('active');
    S.engine.setColor(norm);
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
        setTimeout(function () { sw.classList.remove('flash'); }, 600);
      }
      return;
    }
    S.customColors.push(norm);
    localStorage.setItem('pa_custom_colors', JSON.stringify(S.customColors));
    buildPalette();
    var sws = document.querySelectorAll('.swatch');
    if (sws.length) selectColor(norm, sws[sws.length - 1]);
    autoSave();
  }

  function deleteSelectedColor() {
    startDeleteColor();
  }

  function resetPalette() {
    if (S.customColors.length === 0) return;
    if (!confirm('确定恢复默认调色板？自定义颜色将被清空。')) return;
    S.customColors = [];
    localStorage.setItem('pa_custom_colors', JSON.stringify(S.customColors));
    buildPalette();
    var firstSw = document.querySelector('.swatch');
    if (firstSw) selectColor(PA.DEFAULT_PALETTE[0], firstSw);
    autoSave();
  }

  function bindPaletteActions() {
    document.getElementById('btnDeleteColor').addEventListener('click', deleteSelectedColor);
    document.getElementById('btnResetPalette').addEventListener('click', resetPalette);
  }

  // ---- 删除颜色（吸管模式） ----
  function startDeleteColor() {
    if (S.isDeletingColor) {
      S.isDeletingColor = false;
      switchToPencil();
      return;
    }
    S.isDeletingColor = true;
    document.querySelectorAll('[data-tool]').forEach(function (b) { b.classList.remove('active'); });
    var eyedropper = document.querySelector('[data-tool="eyedropper"]');
    if (eyedropper) eyedropper.classList.add('active');
    S.engine.setTool('eyedropper');
    document.getElementById('penSizeControl').style.display = 'none';
    document.getElementById('eraserSizeControl').style.display = 'none';
    alert('点击画布上的颜色像素来删除该颜色（仅当前帧）。');
  }

  // ---- 临时调色板 ----
  function addToTempPalette(color) {
    var norm = normalizeColor(color);
    if (!norm) return;
    var idx = S.tempPalette.indexOf(norm);
    if (idx !== -1) S.tempPalette.splice(idx, 1);
    S.tempPalette.unshift(norm);
    if (S.tempPalette.length > PA.MAX_TEMP_COLORS) S.tempPalette.pop();
    renderTempPalette();
  }

  function renderTempPalette() {
    var container = document.getElementById('tempPalette');
    if (!container) return;
    container.innerHTML = '';
    if (S.tempPalette.length === 0) {
      var empty = document.createElement('span');
      empty.className = 'temp-empty';
      empty.textContent = '点击吸管取色';
      container.appendChild(empty);
      return;
    }
    S.tempPalette.forEach(function (color, i) {
      var sw = document.createElement('button');
      sw.className = 'temp-swatch';
      sw.style.background = color;
      sw.title = color + ' (点击使用，右键移除)';
      sw.dataset.color = color;
      sw.addEventListener('click', function () {
        var norm = normalizeColor(color);
        if (norm) {
          S.engine.setColor(norm);
          document.getElementById('colorPicker').value = norm;
          document.querySelectorAll('.swatch').forEach(function (s) { s.classList.remove('active'); });
          document.querySelectorAll('.temp-swatch').forEach(function (s) { s.classList.remove('active'); });
          sw.classList.add('active');
          switchToPencil();
        }
      });
      sw.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        S.tempPalette.splice(i, 1);
        renderTempPalette();
      });
      container.appendChild(sw);
    });
    var count = document.createElement('span');
    count.className = 'temp-count';
    count.textContent = S.tempPalette.length + '/' + PA.MAX_TEMP_COLORS;
    container.appendChild(count);
  }

  // ---- 色轮 ----
  function bindColorWheel() {
    var overlay = document.getElementById('cwOverlay');
    var btnOpen = document.getElementById('btnColorWheel');
    var btnClose = document.getElementById('cwClose');

    btnOpen.addEventListener('click', function () {
      overlay.classList.add('show');
      var cur = S.engine.color || '#000000';
      var initColor = (cur === '#000000' || cur === '#ffffff') ? '#ff0000' : cur;
      if (!S.colorWheel) {
        S.colorWheel = new ColorWheel(document.getElementById('colorWheelContainer'), {
          color: initColor,
          onChange: function (hex) {
            var norm = normalizeColor(hex);
            if (norm) {
              S.engine.setColor(norm);
              document.getElementById('colorPicker').value = norm;
              document.querySelectorAll('.swatch').forEach(function (s) { s.classList.remove('active'); });
              switchToPencil();
            }
          },
          onAddToPalette: function (hex) { addCustomColor(hex); },
        });
      } else {
        S.colorWheel.setColor(initColor);
      }
    });

    btnClose.addEventListener('click', function () { overlay.classList.remove('show'); });
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) overlay.classList.remove('show');
    });

    var quantToggle = document.getElementById('quantizeToggle');
    var ditherRow = document.getElementById('ditherToggleRow');
    var extractToggle = document.getElementById('extractToggle');
    var extractRow = document.getElementById('extractToggleRow');

    // 默认量化关闭
    quantToggle.checked = false;
    ditherRow.style.display = 'none';
    extractRow.style.display = 'none';

    quantToggle.addEventListener('change', function () {
      ditherRow.style.display = quantToggle.checked ? 'flex' : 'none';
      extractRow.style.display = quantToggle.checked ? 'flex' : 'none';
      if (!quantToggle.checked) extractToggle.checked = false;
    });

    extractToggle.addEventListener('change', function () {
      if (extractToggle.checked && !quantToggle.checked) {
        quantToggle.checked = true;
        ditherRow.style.display = 'flex';
      }
    });
  }

  function init() {
    buildPalette();
    bindPaletteActions();
    bindColorWheel();
  }

  PA.Palette = {
    init: init,
    buildPalette: buildPalette,
    selectColor: selectColor,
    updatePaletteCount: updatePaletteCount,
    addCustomColor: addCustomColor,
    deleteSelectedColor: deleteSelectedColor,
    resetPalette: resetPalette,
    bindPaletteActions: bindPaletteActions,
    startDeleteColor: startDeleteColor,
    addToTempPalette: addToTempPalette,
    renderTempPalette: renderTempPalette,
    bindColorWheel: bindColorWheel,
  };
})(window.PA);
