// public/js/video-import.js - 视频转帧处理模块（修复版）
(function() {
  'use strict';

  // ---- DOM 引用 ----
  const videoInput = document.getElementById('videoInput');
  const btnImportVideo = document.getElementById('btnImportVideo');
  const videoFpsSelect = document.getElementById('videoFps');
  const videoInfo = document.getElementById('videoInfo');
  const videoProgress = document.getElementById('videoProgress');
  const videoProgressFill = videoProgress?.querySelector('.video-progress-fill');
  const videoProgressText = videoProgress?.querySelector('.video-progress-text');
  const videoImportHint = document.getElementById('videoImportHint');

  // ---- 状态 ----
  let isProcessing = false;

  // ---- 辅助函数 ----
  function showHint(msg, isError = false) {
    if (videoImportHint) {
      videoImportHint.textContent = msg;
      videoImportHint.style.color = isError ? 'var(--danger, #f87171)' : 'var(--primary, #8b5cf6)';
    }
  }

  function updateProgress(pct) {
    if (videoProgressFill) videoProgressFill.style.width = pct + '%';
    if (videoProgressText) videoProgressText.textContent = Math.round(pct) + '%';
  }

  function showProgress(show) {
    if (videoProgress) videoProgress.style.display = show ? 'flex' : 'none';
  }

  function showVideoInfo(msg) {
    if (videoInfo) videoInfo.textContent = msg;
  }

  // ---- 获取引擎和动画的辅助函数 ----
  function getEngine() {
    // 尝试从全局获取
    if (window.engine) return window.engine;
    // 尝试从 app.js 的闭包中获取（通过暴露的接口）
    if (window.__engine) return window.__engine;
    // 尝试从 window 的各个可能位置获取
    if (window.CanvasEngine && window._engine) return window._engine;
    return null;
  }

  function getAnimation() {
    if (window.anim) return window.anim;
    if (window.__anim) return window.__anim;
    return null;
  }

  // ---- 获取全局函数 ----
  function getRenderFrameList() {
    return window.renderFrameList || window.__renderFrameList || null;
  }

  function getPushSnapshot() {
    return window.pushSnapshot || window.__pushSnapshot || null;
  }

  function getAutoSave() {
    return window.autoSave || window.__autoSave || null;
  }

  // ---- 核心：视频转帧 ----
  async function processVideo(file) {
    if (isProcessing) return;
    if (!file) return;

    // 检查文件大小（限制 50MB）
    if (file.size > 50 * 1024 * 1024) {
      showHint('视频文件过大，请选择小于 50MB 的文件', true);
      return;
    }

    isProcessing = true;
    btnImportVideo.disabled = true;
    btnImportVideo.textContent = '处理中...';
    showProgress(true);
    updateProgress(0);
    showHint('正在解码视频...');

    try {
      // 1. 读取视频文件为 ArrayBuffer
      const arrayBuffer = await file.arrayBuffer();
      updateProgress(10);

      // 2. 创建视频元素并加载
      const video = await loadVideo(arrayBuffer, file.type);
      updateProgress(20);

      // 3. 获取视频信息
      const duration = video.duration;
      const videoWidth = video.videoWidth;
      const videoHeight = video.videoHeight;

      if (duration > 15) {
        showHint('视频时长 ' + duration.toFixed(1) + 's，超过 15 秒限制', true);
        showProgress(false);
        btnImportVideo.disabled = false;
        btnImportVideo.textContent = '选择视频（≤15秒）';
        isProcessing = false;
        return;
      }

      showVideoInfo('时长: ' + duration.toFixed(1) + 's · 分辨率: ' + videoWidth + '×' + videoHeight);
      showHint('正在采样帧...');

      // 4. 采样帧
      const fps = parseInt(videoFpsSelect.value) || 8;
      const totalFrames = Math.max(1, Math.floor(duration * fps));
      const frameInterval = duration / totalFrames;

      // 限制最大帧数（防止内存溢出）
      const MAX_FRAMES = 120;
      let frameCount = Math.min(totalFrames, MAX_FRAMES);
      if (totalFrames > MAX_FRAMES) {
        showHint('帧数过多 (' + totalFrames + ')，已限制为 ' + MAX_FRAMES + ' 帧', false);
        frameCount = MAX_FRAMES;
      }

      updateProgress(30);

      // 5. 提取帧
      const frames = await extractFrames(video, frameCount, frameInterval);
      updateProgress(80);

      // 6. 转换为像素帧
      showHint('正在转换为像素帧...');
      
      const engine = getEngine();
      if (!engine) {
        throw new Error('画布引擎未初始化，请先打开编辑器');
      }
      
      const targetW = engine.width;
      const targetH = engine.height;
      const pixelFrames = framesToPixels(frames, targetW, targetH);
      updateProgress(95);

      // 7. 导入到动画系统
      importToAnimation(pixelFrames);

      updateProgress(100);
      showHint('✅ 成功导入 ' + pixelFrames.length + ' 帧！', false);
      showVideoInfo('导入 ' + pixelFrames.length + ' 帧 · 时长 ' + duration.toFixed(1) + 's');

      // 关闭图片卡片（如果是打开的）
      if (typeof window.closePictureCard === 'function') {
        setTimeout(window.closePictureCard, 800);
      }

    } catch (err) {
      console.error('视频处理错误:', err);
      showHint('处理失败: ' + (err.message || '未知错误'), true);
    } finally {
      isProcessing = false;
      btnImportVideo.disabled = false;
      btnImportVideo.textContent = '选择视频（≤15秒）';
      setTimeout(() => showProgress(false), 2000);
    }
  }

  // ---- 加载视频 ----
  function loadVideo(arrayBuffer, mimeType) {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      const blob = new Blob([arrayBuffer], { type: mimeType || 'video/mp4' });
      const url = URL.createObjectURL(blob);

      video.preload = 'auto';
      video.muted = true;

      video.addEventListener('loadedmetadata', () => {
        URL.revokeObjectURL(url);
        if (video.videoWidth === 0 || video.videoHeight === 0) {
          reject(new Error('无法读取视频尺寸，可能文件已损坏'));
          return;
        }
        resolve(video);
      });

      video.addEventListener('error', () => {
        URL.revokeObjectURL(url);
        reject(new Error('视频加载失败: ' + (video.error?.message || '未知错误')));
      });

      video.src = url;
      video.load();
    });
  }

  // ---- 提取帧 ----
  function extractFrames(video, frameCount, interval) {
    return new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      let w = video.videoWidth;
      let h = video.videoHeight;
      const maxDim = 512;
      if (Math.max(w, h) > maxDim) {
        const scale = maxDim / Math.max(w, h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
      canvas.width = w;
      canvas.height = h;

      const frames = [];
      let currentFrame = 0;
      let isExtracting = false;

      function extractNextFrame() {
        if (isExtracting) return;
        if (currentFrame >= frameCount) {
          resolve(frames);
          return;
        }

        const time = currentFrame * interval;
        if (time >= video.duration) {
          resolve(frames);
          return;
        }

        isExtracting = true;
        video.currentTime = time;

        const onSeeked = () => {
          video.removeEventListener('seeked', onSeeked);
          try {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            frames.push({
              data: imageData.data.slice(),
              width: canvas.width,
              height: canvas.height
            });

            const progress = 30 + (currentFrame / frameCount) * 50;
            updateProgress(progress);

            currentFrame++;
            isExtracting = false;
            // 使用 requestAnimationFrame 让 UI 有时间更新
            requestAnimationFrame(extractNextFrame);
          } catch (err) {
            isExtracting = false;
            reject(err);
          }
        };

        video.addEventListener('seeked', onSeeked);

        // 如果 seek 失败，设置超时
        const timeout = setTimeout(() => {
          video.removeEventListener('seeked', onSeeked);
          isExtracting = false;
          // 如果超时，尝试直接绘制当前帧
          try {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            frames.push({
              data: imageData.data.slice(),
              width: canvas.width,
              height: canvas.height
            });
            const progress = 30 + (currentFrame / frameCount) * 50;
            updateProgress(progress);
            currentFrame++;
            requestAnimationFrame(extractNextFrame);
          } catch (err2) {
            reject(new Error('帧提取超时 (帧 ' + currentFrame + ')'));
          }
        }, 3000);

        // 如果时间已经接近目标，直接绘制
        setTimeout(() => {
          if (Math.abs(video.currentTime - time) < 0.001) {
            clearTimeout(timeout);
            video.removeEventListener('seeked', onSeeked);
            if (!isExtracting) return;
            isExtracting = false;
            try {
              ctx.clearRect(0, 0, canvas.width, canvas.height);
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
              frames.push({
                data: imageData.data.slice(),
                width: canvas.width,
                height: canvas.height
              });
              const progress = 30 + (currentFrame / frameCount) * 50;
              updateProgress(progress);
              currentFrame++;
              requestAnimationFrame(extractNextFrame);
            } catch (err) {
              reject(err);
            }
          }
        }, 100);
      }

      // 开始提取
      if (video.readyState >= 2) {
        extractNextFrame();
      } else {
        video.addEventListener('loadeddata', function onLoad() {
          video.removeEventListener('loadeddata', onLoad);
          extractNextFrame();
        });
        // 如果 5 秒后还没加载好，强制开始
        setTimeout(() => {
          if (frames.length === 0 && !isExtracting) {
            extractNextFrame();
          }
        }, 5000);
      }
    });
  }

  // ---- 帧数据转像素帧 ----
  function framesToPixels(frames, targetW, targetH) {
    if (!frames || frames.length === 0) return [];

    const pixelFrames = [];

    for (let fi = 0; fi < frames.length; fi++) {
      const frame = frames[fi];
      const srcW = frame.width;
      const srcH = frame.height;
      const data = frame.data;

      const pixels = new Array(targetW * targetH).fill(null);

      for (let y = 0; y < targetH; y++) {
        for (let x = 0; x < targetW; x++) {
          const srcX = Math.floor((x / targetW) * srcW);
          const srcY = Math.floor((y / targetH) * srcH);
          const idx = (srcY * srcW + srcX) * 4;

          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          const a = data[idx + 3];

          if (a > 128) {
            const hex = '#' + [r, g, b]
              .map(v => Math.round(v).toString(16).padStart(2, '0'))
              .join('');
            pixels[y * targetW + x] = hex;
          }
        }
      }

      pixelFrames.push(pixels);
    }

    return pixelFrames;
  }

  // ---- 导入到动画系统 ----
  function importToAnimation(pixelFrames) {
    if (!pixelFrames || pixelFrames.length === 0) {
      showHint('没有有效的帧可导入', true);
      return;
    }

    const engine = getEngine();
    const anim = getAnimation();

    if (!engine) {
      showHint('画布引擎未初始化', true);
      return;
    }
    if (!anim) {
      showHint('动画系统未初始化', true);
      return;
    }

    // 停止播放
    if (anim.playing) {
      anim.stop();
      const playBtn = document.getElementById('btnPlay');
      if (playBtn) playBtn.textContent = '播放';
    }

    const currentIdx = anim.current;
    const layerSys = window.layerSystem || null;

    // 替换当前帧为第一帧（写入当前帧的当前图层缓冲，保证图层数据持久化）
    if (layerSys) {
      const layer0 = layerSys.getCurrentLayer();
      if (layer0) {
        layer0.pixels = pixelFrames[0].slice();
        layerSys.saveCurrentFrameLayers();
        const composite = layerSys.getCompositePixels();
        anim.frames[currentIdx] = composite.slice();
        engine.pixels = composite;
        engine.render();
      }
    } else {
      anim.frames[currentIdx] = pixelFrames[0].slice();
      engine.loadFrame(pixelFrames[0]);
    }

    // 如果有更多帧，插入到当前帧后面（同步图层缓冲，并把导入像素写入当前图层）
    for (let i = 1; i < pixelFrames.length; i++) {
      anim.frames.splice(currentIdx + i, 0, pixelFrames[i].slice());
      if (layerSys) {
        layerSys.addFrameLayers(currentIdx + i);
        const layerI = layerSys.getCurrentLayer();
        if (layerI) {
          layerI.pixels = pixelFrames[i].slice();
          layerSys.saveCurrentFrameLayers();
        }
      }
    }

    // 统一把当前帧切回第一帧并重新合成（修正 addFrameLayers 过程中
    // _syncToEngine 对当前帧合成图的临时覆盖，确保当前帧显示导入的首帧）
    if (layerSys) {
      layerSys.loadFrameLayers(currentIdx);
    }

    anim.current = currentIdx;

    engine.render();
    if (anim._renderOnion) anim._renderOnion();

    // 更新帧列表
    const renderFn = getRenderFrameList();
    if (renderFn) renderFn();

    // 保存快照
    const pushFn = getPushSnapshot();
    if (pushFn) pushFn();

    // 自动保存
    const autoSaveFn = getAutoSave();
    if (autoSaveFn) autoSaveFn();

    // 更新 FPS
    const fps = parseInt(videoFpsSelect.value) || 8;
    const fpsSlider = document.getElementById('fpsSlider');
    const fpsLabel = document.getElementById('fpsLabel');
    if (fpsSlider && fpsLabel) {
      fpsSlider.value = fps;
      fpsLabel.textContent = fps + ' FPS';
      anim.setFps(fps);
    }

    showHint('✅ 已导入 ' + pixelFrames.length + ' 帧！', false);
  }

  // ---- 暴露引擎和动画到全局（供视频导入使用） ----
  // 在 app.js 加载后，会设置这些全局变量
  function tryBindGlobals() {
    // 尝试从各种可能的位置获取 engine 和 anim
    if (!window.engine) {
      // 检查是否在 app.js 的闭包中暴露了
      if (window.__engine) window.engine = window.__engine;
    }
    if (!window.anim) {
      if (window.__anim) window.anim = window.__anim;
    }
  }

  // 每 500ms 尝试绑定一次，最多尝试 10 次
  let bindAttempts = 0;
  const bindInterval = setInterval(() => {
    tryBindGlobals();
    bindAttempts++;
    if ((window.engine && window.anim) || bindAttempts > 10) {
      clearInterval(bindInterval);
    }
  }, 500);

  // ---- 绑定事件 ----
  if (btnImportVideo) {
    btnImportVideo.addEventListener('click', () => {
      if (!videoInput) return;
      videoInput.value = '';
      videoInput.click();
    });
  }

  if (videoInput) {
    videoInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) {
        processVideo(file);
      }
      videoInput.value = '';
    });
  }

  // ---- 折叠面板支持 ----
  document.querySelectorAll('.section-toggle').forEach(toggle => {
    toggle.addEventListener('click', function() {
      const targetId = this.dataset.target;
      const content = document.getElementById(targetId);
      if (content) {
        const isOpen = content.style.display !== 'none';
        content.style.display = isOpen ? 'none' : 'block';
        const arrow = this.querySelector('.toggle-arrow');
        if (arrow) {
          arrow.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(180deg)';
        }
      }
    });
  });

  // 默认展开
  const videoContent = document.getElementById('videoImportContent');
  if (videoContent) {
    videoContent.style.display = 'block';
    const arrow = document.querySelector('.section-toggle[data-target="videoImportContent"] .toggle-arrow');
    if (arrow) {
      arrow.style.transform = 'rotate(180deg)';
    }
  }

  // ---- 导出 ----
  window.VideoImport = {
    processVideo,
    framesToPixels,
    importToAnimation,
    showHint,
    updateProgress,
    getEngine,
    getAnimation,
  };

  console.log('📹 视频导入模块已加载');

})();