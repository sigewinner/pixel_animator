// public/js/window-manager.js — Win98-style floating window manager
// Handles: window creation, drag, resize, minimize, maximize, close, z-order

(function(global) {
  'use strict';

  var WindowManager = {};
  var windows = [];     // { id, el, tab, state: 'normal'|'minimized'|'maximized', zIndex, prevBounds }
  var activeWinId = null;
  var desktopEl = null;
  var taskbarEl = null;
  var nextZIndex = 10;
  var dragState = null;
  var resizeState = null;

  // ---- Public API ----

  WindowManager.init = function(desktop, taskbar) {
    desktopEl = desktop;
    taskbarEl = taskbar;
    // Prevent default browser drag on images
    desktopEl.addEventListener('dragstart', function(e) { e.preventDefault(); });
  };

  WindowManager.createWindow = function(tabData, tabIndex) {
    var winEl = document.createElement('div');
    winEl.className = 'canvas-window';
    winEl.dataset.winId = tabData.id;
    winEl.dataset.tabIndex = tabIndex;

    // ---- Title bar ----
    var titlebar = document.createElement('div');
    titlebar.className = 'win-titlebar';

    // Icon (4x4 pixel grid)
    var icon = document.createElement('div');
    icon.className = 'win-icon';
    var colors = ['#ffcd75','#41a6f6','#38b764','#b13e53','#ef7d57','#73eff7','#566c86','#94b0c2'];
    for (var ci = 0; ci < 16; ci++) {
      var px = document.createElement('span');
      px.style.background = colors[Math.floor(Math.random() * colors.length)];
      icon.appendChild(px);
    }
    titlebar.appendChild(icon);

    // Title text
    var title = document.createElement('span');
    title.className = 'win-title';
    title.textContent = tabData.name;
    titlebar.appendChild(title);

    // Title double-click to rename
    title.addEventListener('dblclick', function(e) {
      e.stopPropagation();
      e.preventDefault();
      if (WindowManager.onRename) {
        WindowManager.onRename(parseInt(winEl.dataset.tabIndex));
      }
    });

    // Control buttons
    var controls = document.createElement('div');
    controls.className = 'win-controls';

    // Minimize
    var minBtn = document.createElement('button');
    minBtn.className = 'win-ctrl-btn win-ctrl-minimize';
    minBtn.innerHTML = '&#9472;'; // ─
    minBtn.title = '最小化';
    minBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      WindowManager.minimizeWindow(tabData.id);
    });
    controls.appendChild(minBtn);

    // Maximize
    var maxBtn = document.createElement('button');
    maxBtn.className = 'win-ctrl-btn win-ctrl-maximize';
    maxBtn.innerHTML = '&#9724;'; // ■
    maxBtn.title = '最大化';
    maxBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      WindowManager.maximizeWindow(tabData.id);
    });
    controls.appendChild(maxBtn);

    // Close
    var closeBtn = document.createElement('button');
    closeBtn.className = 'win-ctrl-btn win-ctrl-close';
    closeBtn.innerHTML = '&#10005;'; // ✕
    closeBtn.title = '关闭';
    closeBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      if (WindowManager.onClose) {
        WindowManager.onClose(parseInt(winEl.dataset.tabIndex));
      }
    });
    controls.appendChild(closeBtn);

    titlebar.appendChild(controls);

    // Drag handling on title bar (entire titlebar is draggable except control buttons)
    titlebar.addEventListener('mousedown', function(e) {
      if (e.target.closest('.win-ctrl-btn')) return;
      var win = getWindowById(tabData.id);
      if (win && win.state === 'maximized') return; // can't drag maximized
      startDrag(e, tabData.id);
    });

    // Double-click titlebar = maximize/restore
    titlebar.addEventListener('dblclick', function(e) {
      if (e.target.closest('.win-ctrl-btn')) return;
      var win = getWindowById(tabData.id);
      if (!win) return;
      if (win.state === 'maximized') {
        WindowManager.restoreWindow(tabData.id);
      } else {
        WindowManager.maximizeWindow(tabData.id);
      }
    });

    winEl.appendChild(titlebar);

    // ---- Body (content area) ----
    var body = document.createElement('div');
    body.className = 'win-body';

    // Active area (where the real drawCanvas goes)
    var activeArea = document.createElement('div');
    activeArea.className = 'win-active-area';
    body.appendChild(activeArea);

    // Preview canvas (for inactive windows)
    var previewCanvas = document.createElement('canvas');
    previewCanvas.className = 'win-preview-canvas';
    previewCanvas.dataset.winId = tabData.id;
    body.appendChild(previewCanvas);

    // Mousedown on body: activate inactive window and store click coords
    // so app.js can forward the click to drawCanvas after DOM migration
    body.addEventListener('mousedown', function(e) {
      if (activeWinId === tabData.id) return; // already active, let events pass through
      // Don't activate from statusbar or resize handles (they handle themselves)
      if (e.target.closest('.win-statusbar') || e.target.closest('.win-resize-handle')) return;
      e.stopPropagation();
      // Store the click position for forwarding after activation
      WindowManager._pendingClick = { clientX: e.clientX, clientY: e.clientY };
      WindowManager.activateWindow(tabData.id);
    });

    winEl.appendChild(body);

    // ---- Status bar ----
    var statusbar = document.createElement('div');
    statusbar.className = 'win-statusbar';

    var statusInfo = document.createElement('div');
    statusInfo.className = 'win-status-info';
    var sizeLabel = document.createElement('span');
    sizeLabel.className = 'win-size-label';
    sizeLabel.textContent = tabData.canvasW + '\u00d7' + tabData.canvasH;
    statusInfo.appendChild(sizeLabel);
    statusbar.appendChild(statusInfo);

    // Zoom controls in status bar
    var zoomControls = document.createElement('div');
    zoomControls.className = 'win-zoom-controls';

    var zoomOutBtn = document.createElement('button');
    zoomOutBtn.className = 'win-zoom-btn';
    zoomOutBtn.textContent = '\u2212';
    zoomOutBtn.title = '缩小';
    zoomOutBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      WindowManager.activateWindow(tabData.id);
      if (WindowManager.onZoomOut) WindowManager.onZoomOut();
    });
    zoomControls.appendChild(zoomOutBtn);

    var zoomLabel = document.createElement('span');
    zoomLabel.className = 'win-zoom-level';
    zoomLabel.textContent = '100%';
    zoomLabel.dataset.winId = tabData.id;
    zoomControls.appendChild(zoomLabel);

    var zoomInBtn = document.createElement('button');
    zoomInBtn.className = 'win-zoom-btn';
    zoomInBtn.textContent = '+';
    zoomInBtn.title = '放大';
    zoomInBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      WindowManager.activateWindow(tabData.id);
      if (WindowManager.onZoomIn) WindowManager.onZoomIn();
    });
    zoomControls.appendChild(zoomInBtn);


    statusbar.appendChild(zoomControls);
    winEl.appendChild(statusbar);

    // ---- Resize handles (only corners, proportional resize) ----
    var dirs = ['ne','nw','se','sw'];
    dirs.forEach(function(dir) {
      var handle = document.createElement('div');
      handle.className = 'win-resize-handle win-resize-' + dir;
      handle.dataset.dir = dir;
      handle.addEventListener('mousedown', function(e) {
        var win = getWindowById(tabData.id);
        if (win && win.state === 'maximized') return;
        startResize(e, tabData.id, dir);
      });
      winEl.appendChild(handle);
    });

    // Position & size — compute to fit the canvas with padding
    var ps = tabData.basePixelSize || 16;
    var canvasContentW = tabData.canvasW * ps;
    var canvasContentH = tabData.canvasH * ps;
    // canvasWrap: content + padding(32) + border(2), body padding(8*2=16), window border(4), breathing room(20)
    var TITLEBAR_H = 32;
    var STATUSBAR_H = 24;
    var wrapTotalW = canvasContentW + 32 + 2;
    var wrapTotalH = canvasContentH + 32 + 2;
    var defaultW = wrapTotalW + 16 + 4 + 20;
    var defaultH = wrapTotalH + TITLEBAR_H + STATUSBAR_H + 16 + 4 + 20;
    // Cap to desktop bounds (leave room for other windows and taskbar)
    if (desktopEl) {
      var deskRect = desktopEl.getBoundingClientRect();
      // Only cap if desktop has valid dimensions (layout completed)
      if (deskRect.width > 50 && deskRect.height > 50) {
        var maxW = deskRect.width * 0.85;
        var maxH = deskRect.height * 0.85;
        defaultW = Math.min(defaultW, maxW);
        defaultH = Math.min(defaultH, maxH);
      }
    }
    // Minimum sensible size
    defaultW = Math.max(280, defaultW);
    defaultH = Math.max(220, defaultH);
    var offset = tabIndex * 30;
    winEl.style.left = (20 + offset) + 'px';
    winEl.style.top = (10 + offset) + 'px';
    winEl.style.width = defaultW + 'px';
    winEl.style.height = defaultH + 'px';
    winEl.style.zIndex = nextZIndex++;

    // Register window
    var winObj = {
      id: tabData.id,
      el: winEl,
      tab: tabData,
      tabIndex: tabIndex,
      state: 'normal',
      zIndex: parseInt(winEl.style.zIndex),
      prevBounds: null  // saved bounds before maximize
    };
    windows.push(winObj);

    // Update tabData's _winId reference
    tabData._winId = tabData.id;

    // Add to desktop
    desktopEl.appendChild(winEl);

    // Add taskbar button
    addTaskbarButton(winObj);

    return winObj;
  };

  WindowManager.destroyWindow = function(winId) {
    var win = getWindowById(winId);
    if (!win) return;
    win.el.remove();
    removeTaskbarButton(winId);
    windows = windows.filter(function(w) { return w.id !== winId; });
    if (activeWinId === winId) {
      activeWinId = null;
      // Activate next window
      if (windows.length > 0) {
        // find highest z-index
        var highest = windows.reduce(function(a, b) { return a.zIndex > b.zIndex ? a : b; });
        WindowManager.activateWindow(highest.id);
      }
    }
  };

  WindowManager.activateWindow = function(winId) {
    var win = getWindowById(winId);
    if (!win) return;

    // If minimized, restore first
    if (win.state === 'minimized') {
      WindowManager.restoreWindow(winId);
    }

    // Deactivate all
    windows.forEach(function(w) {
      w.el.classList.remove('active');
    });
    taskbarEl.querySelectorAll('.taskbar-btn').forEach(function(b) {
      b.classList.remove('active-task');
    });

    // Activate target
    win.el.classList.add('active');
    activeWinId = winId;
    win.zIndex = nextZIndex++;
    win.el.style.zIndex = win.zIndex;

    // Highlight taskbar button
    var tbBtn = taskbarEl.querySelector('.taskbar-btn[data-win-id="' + winId + '"]');
    if (tbBtn) tbBtn.classList.add('active-task');

    // Callback
    if (WindowManager.onActivate) {
      WindowManager.onActivate(win.tabIndex);
    }
  };

  WindowManager.minimizeWindow = function(winId) {
    var win = getWindowById(winId);
    if (!win) return;

    // Save current bounds if normal
    if (win.state === 'normal') {
      win.prevBounds = {
        left: win.el.style.left,
        top: win.el.style.top,
        width: win.el.style.width,
        height: win.el.style.height
      };
    } else if (win.state === 'maximized') {
      // Restore to saved bounds before minimize
      WindowManager.restoreWindow(winId);
      win.prevBounds = {
        left: win.el.style.left,
        top: win.el.style.top,
        width: win.el.style.width,
        height: win.el.style.height
      };
    }

    win.state = 'minimized';
    win.el.classList.add('minimized');
    win.el.classList.remove('maximized');
    win.el.classList.add('animating-minimize');

    // Remove active if this was active
    if (activeWinId === winId) {
      win.el.classList.remove('active');
      activeWinId = null;
      // Activate another window
      var normalWins = windows.filter(function(w) { return w.state !== 'minimized'; });
      if (normalWins.length > 0) {
        var highest = normalWins.reduce(function(a, b) { return a.zIndex > b.zIndex ? a : b; });
        WindowManager.activateWindow(highest.id);
      }
    }

    // Update taskbar button
    updateTaskbarButton(win);

    setTimeout(function() {
      win.el.classList.remove('animating-minimize');
    }, 280);
  };

  WindowManager.maximizeWindow = function(winId) {
    var win = getWindowById(winId);
    if (!win) return;

    // 已最大化 -> 点击切换回还原（与系统窗体一致）
    if (win.state === 'maximized') {
      WindowManager.restoreWindow(winId);
      return;
    }

    // Save bounds if currently normal
    if (win.state === 'normal') {
      win.prevBounds = {
        left: win.el.style.left,
        top: win.el.style.top,
        width: win.el.style.width,
        height: win.el.style.height
      };
    }

    win.el.classList.add('animating-geometry');
    win.state = 'maximized';
    win.el.classList.add('maximized');
    win.el.classList.remove('minimized');

    // 以像素内联设置几何（填满 desktop-area），保证最大化<->还原均为 px 平滑过渡
    var par = win.el.parentElement;
    var parW = par ? par.clientWidth : (win.el.offsetParent ? win.el.offsetParent.clientWidth : window.innerWidth);
    var parH = par ? par.clientHeight : (win.el.offsetParent ? win.el.offsetParent.clientHeight : window.innerHeight);
    win.el.style.left = '0px';
    win.el.style.top = '0px';
    win.el.style.width = Math.round(parW) + 'px';
    win.el.style.height = Math.round(parH) + 'px';

    // 最大化按钮切换为「还原」图标（与系统窗体一致）
    var maxBtnEl = win.el.querySelector('.win-ctrl-maximize');
    if (maxBtnEl) { maxBtnEl.classList.add('is-max'); maxBtnEl.innerHTML = '&#10065;'; }

    // Activate when maximizing
    WindowManager.activateWindow(winId);

    setTimeout(function() {
      win.el.classList.remove('animating-geometry');
    }, 220);
  };

  WindowManager.restoreWindow = function(winId) {
    var win = getWindowById(winId);
    if (!win) return;

    if (win.state === 'minimized') {
      // 从任务栏打开：从底部缩放回弹展开
      win.el.classList.add('animating-open');
    } else {
      // 从最大化返回：几何 px 过渡（修复「再次点击最大化返回」瞬间跳变）
      win.el.classList.add('animating-geometry');
    }

    win.state = 'normal';
    win.el.classList.remove('minimized');
    win.el.classList.remove('maximized');

    // 还原时，最大化按钮恢复为「最大化」图标
    var maxBtnEl = win.el.querySelector('.win-ctrl-maximize');
    if (maxBtnEl) { maxBtnEl.classList.remove('is-max'); maxBtnEl.innerHTML = '&#9724;'; }

    // Restore saved bounds
    if (win.prevBounds) {
      win.el.style.left = win.prevBounds.left;
      win.el.style.top = win.prevBounds.top;
      win.el.style.width = win.prevBounds.width;
      win.el.style.height = win.prevBounds.height;
    }

    // Activate
    WindowManager.activateWindow(winId);

    // Update taskbar button
    updateTaskbarButton(win);

    setTimeout(function() {
      win.el.classList.remove('animating-geometry');
      win.el.classList.remove('animating-open');
    }, 320);
  };

  WindowManager.updateWindowTitle = function(winId, name) {
    var win = getWindowById(winId);
    if (!win) return;
    var titleEl = win.el.querySelector('.win-title');
    if (titleEl) titleEl.textContent = name;
    // Update taskbar button too
    var tbBtn = taskbarEl.querySelector('.taskbar-btn[data-win-id="' + winId + '"]');
    if (tbBtn) {
      var tbName = tbBtn.querySelector('.taskbar-name');
      if (tbName) tbName.textContent = name;
    }
  };

  WindowManager.updateWindowZoom = function(winId, zoomPercent) {
    var win = getWindowById(winId);
    if (!win) return;
    var zoomLabel = win.el.querySelector('.win-zoom-level');
    if (zoomLabel) zoomLabel.textContent = zoomPercent;
  };

  WindowManager.updateWindowSize = function(winId, w, h) {
    var win = getWindowById(winId);
    if (!win) return;
    var sizeLabel = win.el.querySelector('.win-size-label');
    if (sizeLabel) sizeLabel.textContent = w + '\u00d7' + h;
  };

  WindowManager.getActiveWindow = function() {
    return getWindowById(activeWinId);
  };

  WindowManager.getActiveWindowEl = function() {
    var win = getWindowById(activeWinId);
    return win ? win.el : null;
  };

  WindowManager.getActiveBodyEl = function() {
    var win = getWindowById(activeWinId);
    if (!win) return null;
    return win.el.querySelector('.win-active-area');
  };

  WindowManager.getAllWindows = function() {
    return windows.slice();
  };

  WindowManager.getWindowByTabIndex = function(tabIndex) {
    return windows.find(function(w) { return w.tabIndex === tabIndex; });
  };

  WindowManager.updateTabIndex = function(winId, newTabIndex) {
    var win = getWindowById(winId);
    if (win) {
      win.tabIndex = newTabIndex;
      win.el.dataset.tabIndex = newTabIndex;
      // Update taskbar button too
      var tbBtn = taskbarEl.querySelector('.taskbar-btn[data-win-id="' + winId + '"]');
      if (tbBtn) tbBtn.dataset.tabIndex = newTabIndex;
    }
  };

  WindowManager.rebuildAllWindows = function(canvasTabs, activeIndex) {
    // Remove all existing windows
    windows.forEach(function(w) { w.el.remove(); });
    windows = [];
    taskbarEl.innerHTML = '';

    // Recreate
    canvasTabs.forEach(function(tab, i) {
      WindowManager.createWindow(tab, i);
    });

    // Activate the correct one
    if (canvasTabs.length > 0 && activeIndex >= 0 && activeIndex < canvasTabs.length) {
      WindowManager.activateWindow(canvasTabs[activeIndex].id);
    }

    // Add the "+" button
    addTaskbarAddButton();
  };

  WindowManager.renderPreview = function(winId, compositePixels, width, height) {
    var win = getWindowById(winId);
    if (!win) return;
    var previewCanvas = win.el.querySelector('.win-preview-canvas');
    if (!previewCanvas) return;

    // Determine pixel size based on window body size
    var bodyEl = win.el.querySelector('.win-body');
    var bodyW = bodyEl ? bodyEl.clientWidth - 16 : 280;
    var bodyH = bodyEl ? bodyEl.clientHeight - 16 : 220;
    var ps = Math.max(1, Math.min(Math.floor(bodyW / width), Math.floor(bodyH / height)));

    previewCanvas.width = width * ps;
    previewCanvas.height = height * ps;
    previewCanvas.style.width = (width * ps) + 'px';
    previewCanvas.style.height = (height * ps) + 'px';

    var ctx = previewCanvas.getContext('2d');
    ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);

    // Draw checkerboard background for transparency
    for (var cy = 0; cy < height; cy++) {
      for (var cx = 0; cx < width; cx++) {
        if (compositePixels[cy * width + cx] === null) {
          var isLight = (cx + cy) % 2 === 0;
          ctx.fillStyle = isLight ? '#e8eef5' : '#f5f8fc';
          ctx.fillRect(cx * ps, cy * ps, ps, ps);
        }
      }
    }

    // Draw pixels
    for (var y = 0; y < height; y++) {
      for (var x = 0; x < width; x++) {
        var color = compositePixels[y * width + x];
        if (color !== null) {
          ctx.fillStyle = color;
          ctx.fillRect(x * ps, y * ps, ps, ps);
        }
      }
    }
  };

  // Callbacks (set by app.js)
  WindowManager.onActivate = null;
  WindowManager.onClose = null;
  WindowManager.onRename = null;
  WindowManager.onAddCanvas = null;
  WindowManager.onZoomIn = null;
  WindowManager.onZoomOut = null;
  WindowManager._pendingClick = null; // { clientX, clientY } — click coords forwarded to drawCanvas

  // ---- Internal ----

  function getWindowById(winId) {
    return windows.find(function(w) { return w.id === winId; });
  }

  function addTaskbarButton(winObj) {
    var btn = document.createElement('button');
    btn.className = 'taskbar-btn';
    if (activeWinId === winObj.id) btn.classList.add('active-task');
    btn.dataset.winId = winObj.id;
    btn.dataset.tabIndex = winObj.tabIndex;

    var icon = document.createElement('div');
    icon.className = 'taskbar-icon';
    btn.appendChild(icon);

    var name = document.createElement('span');
    name.className = 'taskbar-name';
    name.textContent = winObj.tab.name;
    btn.appendChild(name);

    btn.addEventListener('click', function() {
      var win = getWindowById(winObj.id);
      if (!win) return;
      if (win.state === 'minimized') {
        WindowManager.restoreWindow(winObj.id);
      } else if (activeWinId === winObj.id) {
        WindowManager.minimizeWindow(winObj.id);
      } else {
        WindowManager.activateWindow(winObj.id);
      }
    });

    taskbarEl.appendChild(btn);
  }

  function removeTaskbarButton(winId) {
    var btn = taskbarEl.querySelector('.taskbar-btn[data-win-id="' + winId + '"]');
    if (btn) btn.remove();
  }

  function updateTaskbarButton(win) {
    var btn = taskbarEl.querySelector('.taskbar-btn[data-win-id="' + win.id + '"]');
    if (!btn) return;
    // Update visual state
    if (win.state === 'minimized') {
      btn.style.opacity = '0.7';
    } else {
      btn.style.opacity = '1';
    }
  }

  function addTaskbarAddButton() {
    // Check if add button already exists
    if (taskbarEl.querySelector('.taskbar-add-btn')) return;
    var addBtn = document.createElement('button');
    addBtn.className = 'taskbar-add-btn';
    addBtn.innerHTML = '+';
    addBtn.title = '新建画布';
    addBtn.addEventListener('click', function() {
      if (WindowManager.onAddCanvas) WindowManager.onAddCanvas();
    });
    // 固定到最左边：插入为第一个子元素（始终位于画布按钮之前）
    taskbarEl.insertBefore(addBtn, taskbarEl.firstChild);
  }

  // ---- Drag ----
  var DRAG_THRESHOLD = 4; // pixels — must move this much to start actual drag
  var dragStarted = false; // whether we've exceeded threshold

  function startDrag(e, winId) {
    var win = getWindowById(winId);
    if (!win) return;

    // Activate on drag start
    WindowManager.activateWindow(winId);

    dragState = {
      winId: winId,
      startX: e.clientX,
      startY: e.clientY,
      startLeft: parseInt(win.el.style.left) || 0,
      startTop: parseInt(win.el.style.top) || 0
    };
    dragStarted = false; // haven't exceeded threshold yet

    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);
    e.preventDefault();
  }

  function onDragMove(e) {
    if (!dragState) return;
    var win = getWindowById(dragState.winId);
    if (!win) return;

    var dx = e.clientX - dragState.startX;
    var dy = e.clientY - dragState.startY;

    // Only start moving after threshold to avoid accidental moves on double-click
    if (!dragStarted) {
      if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
      dragStarted = true;
    }

    var newLeft = dragState.startLeft + dx;
    var newTop = dragState.startTop + dy;

    // Constrain within desktop
    var deskRect = desktopEl.getBoundingClientRect();
    var winRect = win.el.getBoundingClientRect();
    var minLeft = -winRect.width + 60;
    var maxLeft = deskRect.width - 60;
    var minTop = 0;
    var maxTop = deskRect.height - 20;

    newLeft = Math.max(minLeft, Math.min(maxLeft, newLeft));
    newTop = Math.max(minTop, Math.min(maxTop, newTop));

    win.el.style.left = newLeft + 'px';
    win.el.style.top = newTop + 'px';
  }

  function onDragEnd() {
    dragState = null;
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragEnd);
  }

  // ---- Resize ----
  function startResize(e, winId, dir) {
    var win = getWindowById(winId);
    if (!win) return;

    // Activate on resize start
    WindowManager.activateWindow(winId);

    resizeState = {
      winId: winId,
      dir: dir,
      startX: e.clientX,
      startY: e.clientY,
      startLeft: parseInt(win.el.style.left) || 0,
      startTop: parseInt(win.el.style.top) || 0,
      startWidth: parseInt(win.el.style.width) || 280,
      startHeight: parseInt(win.el.style.height) || 220,
      aspectRatio: (parseInt(win.el.style.width) || 280) / (parseInt(win.el.style.height) || 220)
    };

    document.addEventListener('mousemove', onResizeMove);
    document.addEventListener('mouseup', onResizeEnd);
    e.preventDefault();
  }

  function onResizeMove(e) {
    if (!resizeState) return;
    var win = getWindowById(resizeState.winId);
    if (!win) return;

    var dx = e.clientX - resizeState.startX;
    var dy = e.clientY - resizeState.startY;
    var dir = resizeState.dir;
    var aspectRatio = resizeState.aspectRatio;
    var newLeft = resizeState.startLeft;
    var newTop = resizeState.startTop;

    // Proportional resize: use diagonal movement, keep aspect ratio
    // For corners involving 'e' (ne, se): width grows with dx
    // For corners involving 'w' (nw, sw): width shrinks with dx, left shifts
    // Height follows: newHeight = newWidth / aspectRatio
    // Top shifts for corners involving 'n' (ne, nw)

    var newWidth, newHeight;

    if (dir.indexOf('e') !== -1) {
      // Right-side corners (ne, se): width changes with dx
      newWidth = resizeState.startWidth + dx;
    } else {
      // Left-side corners (nw, sw): width changes with -dx, left shifts
      newWidth = resizeState.startWidth - dx;
      newLeft = resizeState.startLeft + dx;
    }

    // Height follows proportionally
    newHeight = newWidth / aspectRatio;

    // For top-side corners (ne, nw): top shifts as height changes
    if (dir.indexOf('n') !== -1) {
      newTop = resizeState.startTop + resizeState.startHeight - newHeight;
    }
    // For bottom-side corners (se, sw): top stays the same

    // Minimum size (preserving ratio)
    var minW = 220;
    var minH = 180;
    // Enforce minimums while keeping ratio
    if (newWidth < minW) {
      newWidth = minW;
      newHeight = newWidth / aspectRatio;
    }
    if (newHeight < minH) {
      newHeight = minH;
      newWidth = newHeight * aspectRatio;
    }

    // Constrain left/top within desktop
    var deskRect = desktopEl.getBoundingClientRect();
    newLeft = Math.max(-parseInt(win.el.style.width || 280) + 60, newLeft);
    newTop = Math.max(0, newTop);

    win.el.style.left = newLeft + 'px';
    win.el.style.top = newTop + 'px';
    win.el.style.width = Math.round(newWidth) + 'px';
    win.el.style.height = Math.round(newHeight) + 'px';
  }

  function onResizeEnd() {
    resizeState = null;
    document.removeEventListener('mousemove', onResizeMove);
    document.removeEventListener('mouseup', onResizeEnd);

    // Trigger preview re-render for inactive windows
    if (WindowManager.onResizeEnd) WindowManager.onResizeEnd();
  }

  // Expose globally
  global.WindowManager = WindowManager;

})(window);
