// public/js/modules/export.js - 导出 GIF/PNG、保存到作品库/本地文件、加载本地项目
(function (PA) {
  var S = PA.state;

  function pushSnapshot() { return PA.pushSnapshot(); }
  function autoSave() { return PA.autoSave(); }
  function normalizeFrame(f) { return PA.normalizeFrame(f); }
  function syncSizeSelectors(w, h) { return PA.syncSizeSelectors(w, h); }
  function updateSizeDisplay() { return PA.updateSizeDisplay(); }
  function updateZoomLabel() { return PA.updateZoomLabel(); }
  function renderFrameList() { return PA.renderFrameList(); }

  function bindExport() {
    document.getElementById('btnGif').addEventListener('click', exportGif);
    document.getElementById('btnSave').addEventListener('click', saveWork);
    document.getElementById('btnPng').addEventListener('click', function () { PA.Batch.openModal('export'); });
    document.getElementById('btnSaveLocal').addEventListener('click', saveToLocalFile);
    document.getElementById('btnLoadLocal').addEventListener('click', function () {
      document.getElementById('projectFileInput').click();
    });
    document.getElementById('projectFileInput').addEventListener('change', function (e) {
      var file = e.target.files[0];
      if (file) loadFromLocalFile(file);
      e.target.value = '';
    });
    // 草稿/项目保存按钮
    var btnSaveDraft = document.getElementById('btnSaveDraft');
    if (btnSaveDraft) btnSaveDraft.addEventListener('click', function () { PA.saveDraftLocally(true); });
    var btnSaveProject = document.getElementById('btnSaveProject');
    if (btnSaveProject) btnSaveProject.addEventListener('click', function () { PA.saveProjectToServer(true); });
  }

  function exportPng() {
    S.anim.syncCurrentFrame();
    var w = S.engine.width, h = S.engine.height;
    var tmp = document.createElement('canvas');
    tmp.width = w;
    tmp.height = h;
    var ctx = tmp.getContext('2d');
    var frame = S.anim.getCurrentFrame();
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
    var frames = S.anim.getAllFrames();
    if (frames.length < 1) { alert('没有可导出的帧'); return; }

    var title = document.getElementById('workTitle').value.trim() || '未命名作品';
    var safeTitle = title.replace(/[<>:"/\\|?*]/g, '_');

    var w = S.engine.width, h = S.engine.height;
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

      var frameDelay = Math.round(1000 / S.anim.fps);

      frames.forEach(function (frame) {
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

      watchdog = setTimeout(function () {
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
        if (progressBar) { setTimeout(function () { progressBar.style.display = 'none'; }, 1000); }
      }

      gif.on('progress', function (p) {
        var pct = Math.round(p * 100);
        if (progressBar) {
          progressBar.querySelector('.gif-progress-fill').style.width = pct + '%';
          progressBar.querySelector('.gif-progress-text').textContent = pct + '%';
        }
        btn.textContent = '生成中 ' + pct + '%';
      });

      gif.on('finished', function (blob) {
        if (watchdog) { clearTimeout(watchdog); watchdog = null; }
        if (workerUrl) { URL.revokeObjectURL(workerUrl); workerUrl = null; }
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = safeTitle + '.gif';
        a.click();
        URL.revokeObjectURL(a.href);
        btn.textContent = btnText;
        btn.disabled = false;
        if (progressBar) { setTimeout(function () { progressBar.style.display = 'none'; }, 1000); }
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
      width: S.engine.width,
      height: S.engine.height,
      frameCount: S.anim.frames.length,
      fps: S.anim.fps,
      frames: PA.encodeFrames(S.anim.getAllFrames()),
      thumbnail: S.anim.getThumbnail(),
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
    S.anim.syncCurrentFrame();
    var title = document.getElementById('workTitle').value.trim() || '未命名作品';
    var author = document.getElementById('workAuthor').value.trim() || '匿名';

    var layerSnap = S.layerSystem ? PA.encodeLayerSnapshot(S.layerSystem.getSnapshot()) : null;
    var project = {
      format: 'pixelforge-project',
      version: 1,
      title: title,
      author: author,
      width: S.engine.width,
      height: S.engine.height,
      fps: S.anim.fps,
      frames: PA.encodeFrames(S.anim.getAllFrames()),
      thumbnail: S.anim.getThumbnail(),
      layerData: layerSnap,
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
    reader.onload = function (ev) {
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

        if (S.anim.playing) {
          S.anim.stop();
          document.getElementById('btnPlay').textContent = '播放';
        }

        var newW = project.width;
        var newH = project.height;
        var newPixelSize = PA.computePixelSize(newW, newH);

        S.engine.resize(newW, newH, newPixelSize);
        S.anim.resize(newW, newH);

        S.anim.frames = PA.decodeFramesPayload(project.frames).map(function (frame) {
          var newFrame = frame.slice();
          normalizeFrame(newFrame);
          return newFrame;
        });
        S.anim.current = 0;
        S.anim.fps = project.fps || 12;

        if (S.layerSystem) {
          if (project.layerData) S.layerSystem.restoreSnapshot(PA.decodeLayerSnapshot(project.layerData));
          else S.layerSystem.reinitFromAnim();
        }

        S.canvasW = newW;
        S.canvasH = newH;
        document.getElementById('workTitle').value = project.title || '';
        document.getElementById('workAuthor').value = project.author || '';
        document.getElementById('fpsSlider').value = S.anim.fps;
        document.getElementById('fpsLabel').textContent = S.anim.fps + ' FPS';

        syncSizeSelectors(newW, newH);

        S.engine.loadFrame(S.anim.frames[0]);
        S.anim._renderOnion();

        updateSizeDisplay();
        renderFrameList();
        S.undoStack = [];
        S.redoStack = [];
        pushSnapshot();
        alert('项目加载成功: ' + (project.title || '未命名'));
      } catch (err) {
        alert('加载失败: ' + err.message);
      }
    };
    reader.readAsText(file);
  }

  function init() { bindExport(); }

  PA.Export = {
    init: init,
    bindExport: bindExport,
    exportPng: exportPng,
    exportGif: exportGif,
    saveWork: saveWork,
    saveToLocalFile: saveToLocalFile,
    loadFromLocalFile: loadFromLocalFile,
  };
})(window.PA);
