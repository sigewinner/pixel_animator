// public/js/modules/import.js - 照片转像素
(function (PA) {
  var S = PA.state;

  function pushSnapshot() { return PA.pushSnapshot(); }
  function autoSave() { return PA.autoSave(); }
  function normalizeColor(c) { return PA.normalizeColor(c); }
  function getActivePalette() { return PA.getActivePalette(); }

  function bindImport() {
    var btn = document.getElementById('btnImportImg');
    var input = document.getElementById('imgInput');
    btn.addEventListener('click', function () { input.click(); });
    input.addEventListener('change', function (e) {
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

    files.forEach(function (file, idx) {
      var reader = new FileReader();
      reader.onload = function (ev) {
        var img = new Image();
        img.onload = function () { images[idx] = img; done(); };
        img.onerror = function () { done(); };
        img.src = ev.target.result;
      };
      reader.onerror = function () { done(); };
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
    var w = S.engine.width, h = S.engine.height;

    var framesData = [];
    for (var imgIdx = 0; imgIdx < images.length; imgIdx++) {
      var img = images[imgIdx];
      var ctx = drawToCanvas(img, w, h, opts.fitMode);
      var data = ctx.getImageData(0, 0, w, h);
      if (opts.enhance) data = enhanceImageData(data);
      framesData.push(data);
    }
    if (framesData.length === 0) { if (hint) hint.textContent = '没有有效图片'; return; }

    var extractedCount = 0;

    if (opts.quantize) {
      var palette = getActivePalette();
      var sampled = [];
      for (var dataIdx = 0; dataIdx < framesData.length; dataIdx++) {
        samplePixels(framesData[dataIdx].data, sampled, 8000);
      }
      var extracted = medianCut(sampled, 256);
      extractedCount = extracted.length;
      var existing = new Set(getActivePalette());
      var added = 0;
      for (var hexIdx = 0; hexIdx < extracted.length; hexIdx++) {
        var hex = extracted[hexIdx];
        if (!existing.has(hex)) {
          S.customColors.push(hex);
          existing.add(hex);
          added++;
        }
      }
      if (extracted.length < 8) {
        var defaultColors = ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff'];
        for (var d = 0; d < defaultColors.length; d++) {
          if (!existing.has(defaultColors[d])) {
            S.customColors.push(defaultColors[d]);
            existing.add(defaultColors[d]);
            added++;
          }
        }
      }
      localStorage.setItem('pa_custom_colors', JSON.stringify(S.customColors));
      PA.Palette.buildPalette();
      palette = getActivePalette();
      if (hint) hint.textContent = '已提取 ' + extractedCount + ' 种主色调，' + added + ' 种已加入调色板...';
    }

    for (var dataIdx2 = 0; dataIdx2 < framesData.length; dataIdx2++) {
      var data = framesData[dataIdx2];
      var pixels;

      if (opts.quantize) {
        pixels = quantizeFrame(data.data, w, h, getActivePalette(), opts.dither);
      } else {
        pixels = directSample(data.data, w, h);
      }

      for (var p = 0; p < pixels.length; p++) {
        if (pixels[p] !== null) {
          var norm = normalizeColor(pixels[p]);
          if (norm !== null) pixels[p] = norm;
        }
      }

      if (dataIdx2 === 0) {
        if (S.layerSystem) {
          var layer0 = S.layerSystem.getCurrentLayer();
          if (layer0) {
            layer0.pixels = pixels.slice();
            S.layerSystem.saveCurrentFrameLayers();
            S.layerSystem._syncToEngine();
          }
        } else {
          S.anim.frames[S.anim.current] = pixels.slice();
          S.engine.loadFrame(pixels);
        }
      } else {
        S.anim.addFrame();
        if (S.layerSystem) {
          var layerN = S.layerSystem.getCurrentLayer();
          if (layerN) {
            layerN.pixels = pixels.slice();
            S.layerSystem.saveCurrentFrameLayers();
            S.layerSystem._syncToEngine();
          }
        } else {
          S.anim.frames[S.anim.current] = pixels.slice();
          S.engine.loadFrame(pixels);
        }
      }
    }
    PA.renderFrameList();
    pushSnapshot();

    if (hint) {
      var msg = framesData.length + ' 张图片已转为' + (framesData.length > 1 ? '帧序列' : '像素');
      if (opts.quantize && extractedCount > 0) {
        msg += '（提取 ' + extractedCount + ' 色已加入调色板）';
      } else if (!opts.quantize) {
        msg += '（保持原色，未量化）';
      }
      hint.textContent = msg;
      setTimeout(function () { if (hint) hint.textContent = ''; }, 5000);
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
      box.sort(function (a, b) { return a[ch] - b[ch]; });
      var mid = Math.floor(box.length / 2);
      boxes.splice(maxBox, 1, box.slice(0, mid), box.slice(mid));
    }
    return boxes.map(function (box) {
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
    for (var p = 0; p < box.length; p++) { vr += (box[p][0] - mr) * (box[p][0] - mr); vg += (box[p][1] - mg) * (box[p][1] - mg); vb += (box[p][2] - mb) * (box[p][2] - mb); }
    return vr + vg + vb;
  }

  function boxMaxChannel(box) {
    var mn = [255, 255, 255], mx = [0, 0, 0];
    for (var p = 0; p < box.length; p++) {
      for (var c = 0; c < 3; c++) { if (box[p][c] < mn[c]) mn[c] = box[p][c]; if (box[p][c] > mx[c]) mx[c] = box[p][c]; }
    }
    var dr = mx[0] - mn[0], dg = mx[1] - mn[1], db = mx[2] - mn[2];
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
        buf[i * 3] = data[i * 4]; buf[i * 3 + 1] = data[i * 4 + 1]; buf[i * 3 + 2] = data[i * 4 + 2];
      }
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          if (data[(y * w + x) * 4 + 3] < 128) { pixels[y * w + x] = null; continue; }
          var idx = (y * w + x) * 3;
          var r = Math.max(0, Math.min(255, buf[idx]));
          var g = Math.max(0, Math.min(255, buf[idx + 1]));
          var b = Math.max(0, Math.min(255, buf[idx + 2]));
          var hex = nearestPaletteColor(r, g, b, palette);
          pixels[y * w + x] = hex;
          var pr = parseInt(hex.slice(1, 3), 16);
          var pg = parseInt(hex.slice(3, 5), 16);
          var pb = parseInt(hex.slice(5, 7), 16);
          var er = r - pr, eg = g - pg, eb = b - pb;
          if (x + 1 < w) { var ni = (y * w + x + 1) * 3; buf[ni] += er * 7 / 16; buf[ni + 1] += eg * 7 / 16; buf[ni + 2] += eb * 7 / 16; }
          if (y + 1 < h) {
            if (x > 0) { var ni = ((y + 1) * w + x - 1) * 3; buf[ni] += er * 3 / 16; buf[ni + 1] += eg * 3 / 16; buf[ni + 2] += eb * 3 / 16; }
            { var ni = ((y + 1) * w + x) * 3; buf[ni] += er * 5 / 16; buf[ni + 1] += eg * 5 / 16; buf[ni + 2] += eb * 5 / 16; }
            if (x + 1 < w) { var ni = ((y + 1) * w + x + 1) * 3; buf[ni] += er * 1 / 16; buf[ni + 1] += eg * 1 / 16; buf[ni + 2] += eb * 1 / 16; }
          }
        }
      }
    } else {
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          var i = (y * w + x) * 4;
          if (data[i + 3] < 128) { pixels[y * w + x] = null; continue; }
          pixels[y * w + x] = nearestPaletteColor(data[i], data[i + 1], data[i + 2], palette);
        }
      }
    }
    return pixels;
  }

  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(function (v) { return Math.round(v).toString(16).padStart(2, '0'); }).join('');
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

  function init() { bindImport(); }

  PA.Import = {
    init: init,
    bindImport: bindImport,
    importImages: importImages,
    processAllImages: processAllImages,
    drawToCanvas: drawToCanvas,
    enhanceImageData: enhanceImageData,
    samplePixels: samplePixels,
    medianCut: medianCut,
    boxVariance: boxVariance,
    boxMaxChannel: boxMaxChannel,
    directSample: directSample,
    quantizeFrame: quantizeFrame,
    rgbToHex: rgbToHex,
    nearestPaletteColor: nearestPaletteColor,
  };
})(window.PA);
