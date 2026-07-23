// public/js/gallery.js - 在线作品库逻辑
// 支持：标签页（全部/我的）、搜索、排序、预览播放、下载 .pixa、删除作品

(function () {
  let previewTimer = null;
  let allWorks = [];      // 所有作品缓存
  let currentTab = 'all'; // all | mine
  let currentWork = null; // 当前预览的作品

  // RLE 解码（与编辑器一致：{ rle:true, data:[ [count,color,...], ... ] }）
  function rleDecode(runs) {
    const out = [];
    for (let k = 0; k < runs.length; k += 2) {
      const cnt = runs[k], c = runs[k + 1];
      for (let t = 0; t < cnt; t++) out.push(c);
    }
    return out;
  }
  function decodeFramesPayload(payload) {
    if (payload && payload.rle) return payload.data.map(rleDecode);
    return payload;
  }

  // ---- 加载作品数据 ----
  async function loadWorks() {
    const wrap = document.getElementById('gallery');
    wrap.innerHTML = '<div class="empty-state">加载中...</div>';
    try {
      const res = await fetch('/api/works');
      const data = await res.json();
      if (data.ok && data.works && data.works.length > 0) {
        // 后端作品补充 frames 字段（列表不含，预览时再取详情）
        allWorks = data.works.map(w => ({
          id: w.id,
          title: w.title,
          author: w.author,
          width: w.width,
          height: w.height,
          frame_count: w.frame_count,
          fps: w.fps,
          thumbnail: w.thumbnail,
          created_at: w.created_at,
          source: 'server',
        }));
        renderGallery();
        return;
      }
    } catch (err) {
      // 后端不可用，走 localStorage
    }
    // 从 localStorage 加载
    allWorks = JSON.parse(localStorage.getItem('pa_works') || '[]').map(w => ({
      ...w,
      frame_count: w.frameCount || w.frame_count || (w.frames ? w.frames.length : 0),
      source: 'local',
    }));
    renderGallery();
  }

  // ---- 渲染画廊 ----
  function renderGallery() {
    const wrap = document.getElementById('gallery');
    const search = document.getElementById('searchInput').value.trim().toLowerCase();
    const sort = document.getElementById('sortSelect').value;
    const user = Auth.getCurrentUser();

    // 过滤
    let works = allWorks.slice();
    if (currentTab === 'mine' && user) {
      works = works.filter(w => w.author === user.username);
    }

    // 搜索
    if (search) {
      works = works.filter(w =>
        (w.title || '').toLowerCase().includes(search) ||
        (w.author || '').toLowerCase().includes(search)
      );
    }

    // 排序
    switch (sort) {
      case 'oldest':
        works.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
        break;
      case 'most-frames':
        works.sort((a, b) => (b.frame_count || 0) - (a.frame_count || 0));
        break;
      case 'largest':
        works.sort((a, b) => ((b.width || 0) * (b.height || 0)) - ((a.width || 0) * (a.height || 0)));
        break;
      case 'newest':
      default:
        works.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
        break;
    }

    if (works.length === 0) {
      wrap.innerHTML = makeEmptyState();
      return;
    }

    wrap.innerHTML = '';
    works.forEach(work => {
      const card = document.createElement('div');
      card.className = 'gallery-card';
      const isMine = user && work.author === user.username;
      card.innerHTML = `
        <div class="thumb-wrap">
          <img src="${work.thumbnail || ''}" alt="${escapeHtml(work.title)}">
          ${(work.frame_count || 0) > 1 ? '<div class="play-badge"><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>' + work.frame_count + '帧</div>' : ''}
          ${isMine ? '<div class="mine-badge">我的</div>' : ''}
        </div>
        <div class="info">
          <h4>${escapeHtml(work.title)}</h4>
          <p>by ${escapeHtml(work.author)}</p>
          <div class="meta">
            <span>${work.width}×${work.height}</span>
            <span>${work.fps || 12} FPS</span>
            <span>${formatDate(work.created_at)}</span>
          </div>
        </div>
      `;
      card.addEventListener('click', () => previewWork(work));
      wrap.appendChild(card);
    });
  }

  function makeEmptyState() {
    if (currentTab === 'mine') {
      return `<div class="empty-state">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        <h3>还没有作品</h3>
        <p>你还没有上传过作品，去 <a href="index.html" style="color:var(--accent)">创作</a> 第一个吧！</p>
      </div>`;
    }
    return `<div class="empty-state">
      <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
      <h3>暂无作品</h3>
      <p>作品库还是空的，去 <a href="index.html" style="color:var(--accent)">创作</a> 第一个吧！</p>
    </div>`;
  }

  // ---- 预览播放 ----
  async function previewWork(work) {
    currentWork = work;
    let fullWork = work;

    // 如果作品没有 frames 数据（后端列表不含），则取详情
    if (!work.frames) {
      try {
        const res = await fetch('/api/works/' + work.id);
        const data = await res.json();
        if (data.ok) {
          fullWork = { ...work, frames: data.work.frames };
        }
      } catch (err) {
        // localStorage 的作品已有 frames
      }
    }

    // 兼容 RLE 压缩格式（旧 .pixa / 旧作品为原始数组）
    fullWork.frames = decodeFramesPayload(fullWork.frames);

    if (!fullWork.frames || fullWork.frames.length === 0) {
      alert('无法加载作品帧数据');
      return;
    }

    const canvas = document.getElementById('previewCanvas');
    const ctx = canvas.getContext('2d');
    canvas.width = fullWork.width;
    canvas.height = fullWork.height;
    // 放大显示，最大 320px
    const scale = Math.min(320 / fullWork.width, 320 / fullWork.height, 12);
    canvas.style.width = Math.round(fullWork.width * scale) + 'px';
    canvas.style.height = Math.round(fullWork.height * scale) + 'px';
    canvas.style.imageRendering = 'pixelated';

    document.getElementById('previewTitle').textContent = fullWork.title;
    document.getElementById('previewAuthor').textContent =
      'by ' + fullWork.author + ' · ' + fullWork.width + '×' + fullWork.height + ' · ' + fullWork.frame_count + '帧 · ' + (fullWork.fps || 12) + ' FPS';

    const modal = document.getElementById('previewModal');
    modal.classList.add('show');

    let i = 0;
    const fps = fullWork.fps || 12;
    const interval = 1000 / fps;
    const drawFrame = () => {
      const frame = fullWork.frames[i];
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      for (let y = 0; y < fullWork.height; y++) {
        for (let x = 0; x < fullWork.width; x++) {
          const c = frame[y * fullWork.width + x];
          if (c) { ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1); }
        }
      }
      i = (i + 1) % fullWork.frames.length;
    };
    drawFrame();
    if (previewTimer) clearInterval(previewTimer);
    previewTimer = setInterval(drawFrame, interval);

    // 下载按钮
    document.getElementById('btnDownloadWork').onclick = () => downloadWork(fullWork);

    // 删除按钮：仅自己的作品可删
    const user = Auth.getCurrentUser();
    const delBtn = document.getElementById('btnDeleteWork');
    if (user && fullWork.author === user.username) {
      delBtn.style.display = '';
      delBtn.onclick = () => deleteWork(fullWork);
    } else {
      delBtn.style.display = 'none';
    }
  }

  // ---- 下载作品为 .pixa 文件 ----
  function downloadWork(work) {
    const project = {
      format: 'pixelforge-project',
      version: 1,
      title: work.title,
      author: work.author,
      width: work.width,
      height: work.height,
      fps: work.fps || 12,
      frames: work.frames,
      thumbnail: work.thumbnail || null,
      savedAt: new Date().toISOString(),
    };
    const json = JSON.stringify(project);
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const safeName = (work.title || 'untitled').replace(/[<>:"/\\|?*]/g, '_');
    a.download = safeName + '.pixa';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ---- 删除作品 ----
  async function deleteWork(work) {
    if (!confirm('确定删除作品「' + work.title + '」？此操作不可撤销。')) return;

    if (work.source === 'local' || work.source === undefined) {
      // 从 localStorage 删除
      const works = JSON.parse(localStorage.getItem('pa_works') || '[]');
      const filtered = works.filter(w => w.id != work.id);
      localStorage.setItem('pa_works', JSON.stringify(filtered));
      allWorks = allWorks.filter(w => w.id != work.id);
      renderGallery();
      closePreview();
      return;
    }

    // 从后端删除
    try {
      const res = await fetch('/api/works/' + work.id, { method: 'DELETE' });
      const data = await res.json();
      if (data.ok) {
        allWorks = allWorks.filter(w => w.id != work.id);
        renderGallery();
        closePreview();
      } else {
        alert('删除失败: ' + data.error);
      }
    } catch (err) {
      alert('删除失败: ' + err.message);
    }
  }

  window.closePreview = function () {
    document.getElementById('previewModal').classList.remove('show');
    if (previewTimer) { clearInterval(previewTimer); previewTimer = null; }
    currentWork = null;
  };

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  function formatDate(s) {
    if (!s) return '';
    // 截取日期部分
    return s.replace(/\s.*/, '').replace('T', ' ').slice(0, 10);
  }

  // ---- 绑定事件 ----
  document.getElementById('btnClosePreview').addEventListener('click', window.closePreview);

  // 标签页切换
  document.querySelectorAll('.gallery-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.gallery-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentTab = tab.dataset.tab;
      renderGallery();
    });
  });

  // 搜索（输入防抖）
  let searchTimer = null;
  document.getElementById('searchInput').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderGallery, 200);
  });

  // 排序
  document.getElementById('sortSelect').addEventListener('change', renderGallery);

  // 启动
  loadWorks();
})();
