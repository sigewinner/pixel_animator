// public/js/modules/batch.js - 批量导出 PNG / 批量删除关键帧
(function (PA) {
  var S = PA.state;

  function pushSnapshot() { return PA.pushSnapshot(); }
  function autoSave() { return PA.autoSave(); }
  function renderFrameList() { return PA.renderFrameList(); }

  function openModal(mode) {
    S.batchMode = mode || 'export';
    S.batchSelected.clear();
    var modal = document.getElementById('batchModal');
    var title = document.getElementById('batchModalTitle');
    if (title) title.textContent = S.batchMode === 'delete' ? '选择要删除的帧' : '选择要导出的帧';
    modal.style.display = 'flex';
    renderList();
  }

  function closeModal() {
    document.getElementById('batchModal').style.display = 'none';
    S.batchSelected.clear();
  }

  function renderList() {
    var container = document.getElementById('batchFrameList');
    container.innerHTML = '';
    var frames = S.anim.getAllFrames();
    var w = S.engine.width, h = S.engine.height;
    var thumbPs = Math.max(1, Math.ceil(60 / Math.max(w, h)));

    frames.forEach(function (frame, idx) {
      var card = document.createElement('div');
      card.className = 'batch-frame-card';
      if (S.batchSelected.has(idx)) card.classList.add('selected');

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

      card.addEventListener('click', function (e) {
        e.stopPropagation();
        if (S.batchSelected.has(idx)) {
          S.batchSelected.delete(idx);
          this.classList.remove('selected');
        } else {
          S.batchSelected.add(idx);
          this.classList.add('selected');
        }
        updateCount();
      });

      container.appendChild(card);
    });
    updateCount();
  }

  function updateCount() {
    var btn = document.getElementById('batchExportConfirm');
    if (S.batchMode === 'delete') btn.textContent = '删除选中 (' + S.batchSelected.size + ')';
    else btn.textContent = '导出选中 (' + S.batchSelected.size + ')';
    btn.disabled = (S.batchSelected.size === 0);
  }

  function selectAll(select) {
    var total = S.anim.frames.length;
    for (var i = 0; i < total; i++) {
      if (select) S.batchSelected.add(i);
      else S.batchSelected.delete(i);
    }
    renderList();
  }

  function exportSelected() {
    if (S.batchSelected.size === 0) return;
    var frames = S.anim.getAllFrames();
    var w = S.engine.width, h = S.engine.height;
    var selected = Array.from(S.batchSelected).sort(function (a, b) { return a - b; });
    var count = 0;
    selected.forEach(function (idx) {
      var frame = frames[idx];
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
      a.download = 'frame_' + String(idx + 1).padStart(3, '0') + '.png';
      a.click();
      count++;
    });
    closeModal();
    alert('已导出 ' + count + ' 张图片。');
  }

  function deleteSelected() {
    if (S.batchSelected.size === 0) return;
    var total = S.anim.frames.length;
    if (total - S.batchSelected.size < 1) {
      alert('删除后至少需保留一帧，请取消部分选择。');
      return;
    }
    if (!confirm('确定删除选中的 ' + S.batchSelected.size + ' 帧？\n（此操作可通过"撤销"恢复）')) return;

    // 降序删除，避免索引错位；同时同步删除各帧的图层缓冲
    var idxs = Array.from(S.batchSelected).sort(function (a, b) { return b - a; });
    idxs.forEach(function (idx) {
      if (S.layerSystem) S.layerSystem.deleteFrameLayers(idx);
      S.anim.frames.splice(idx, 1);
    });

    if (S.anim.current >= S.anim.frames.length) S.anim.current = S.anim.frames.length - 1;
    if (S.anim.current < 0) S.anim.current = 0;
    S.engine.loadFrame(S.anim.frames[S.anim.current]);
    S.anim._renderOnion();

    pushSnapshot();
    renderFrameList();
    autoSave();
    closeModal();
    alert('已删除 ' + idxs.length + ' 帧。');
  }

  function confirmAction() {
    if (S.batchMode === 'delete') deleteSelected();
    else exportSelected();
  }

  function init() {
    document.getElementById('batchModalClose').addEventListener('click', closeModal);
    document.getElementById('batchExportCancel').addEventListener('click', closeModal);
    document.getElementById('batchSelectAll').addEventListener('click', function () { selectAll(true); });
    document.getElementById('batchDeselectAll').addEventListener('click', function () { selectAll(false); });
    document.getElementById('batchExportConfirm').addEventListener('click', confirmAction);
    document.getElementById('batchModal').addEventListener('click', function (e) {
      if (e.target === this) closeModal();
    });
    // 批量删除入口
    var btnBatchDelete = document.getElementById('btnBatchDelete');
    if (btnBatchDelete) btnBatchDelete.addEventListener('click', function () { openModal('delete'); });
  }

  PA.Batch = {
    init: init,
    openModal: openModal,
    closeModal: closeModal,
    renderList: renderList,
    updateCount: updateCount,
    selectAll: selectAll,
    exportSelected: exportSelected,
    deleteSelected: deleteSelected,
  };
})(window.PA);
