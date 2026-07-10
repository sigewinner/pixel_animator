// public/js/layers.js - 图层系统工具库
// 负责：图层帧数据结构、合成、克隆、缩放、裁剪、旧格式转换

var LayerUtils = (function () {

  var _layerCounter = 0;

  // 颜色解析缓存（hex -> [r,g,b]），避免逐像素 blendPixel 重复 parseInt
  var _rgbCache = {};
  function _parseHex(hex) {
    var c = _rgbCache[hex];
    if (c) return c;
    c = [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16)
    ];
    _rgbCache[hex] = c;
    return c;
  }

  function nextId() { return ++_layerCounter; }

  /** 创建一个空图层 */
  function createLayer(w, h, name) {
    return {
      id: nextId(),
      name: name || ('Layer ' + _layerCounter),
      visible: true,
      opacity: 1,
      pixels: new Array(w * h).fill(null)
    };
  }

  /** 创建一个包含单个图层的帧 */
  function createFrame(w, h, name) {
    return {
      layers: [createLayer(w, h, name || 'Background')],
      activeLayer: 0
    };
  }

  /** 判断帧是否为图层格式（而非旧的扁平数组） */
  function isLayerFrame(frame) {
    return frame && !Array.isArray(frame) && Array.isArray(frame.layers);
  }

  /** 将旧格式（扁平像素数组）转换为新格式（单图层帧） */
  function convertLegacyFrame(pixels, w, h) {
    if (isLayerFrame(pixels)) return pixels;
    if (!Array.isArray(pixels)) return createFrame(w, h);
    var layer = createLayer(w, h, 'Background');
    layer.pixels = pixels.slice();
    return { layers: [layer], activeLayer: 0 };
  }

  /** 获取帧的活动图层对象 */
  function getActiveLayer(frame) {
    if (!isLayerFrame(frame)) return null;
    return frame.layers[frame.activeLayer] || frame.layers[0];
  }

  /** 获取帧的活动图层像素数组 */
  function getActivePixels(frame) {
    var layer = getActiveLayer(frame);
    return layer ? layer.pixels : null;
  }

  /** 颜色混合：top over bottom，alpha 为 top 的不透明度 */
  function blendPixel(top, bottom, alpha) {
    if (!top) return bottom;
    if (!bottom || alpha >= 1) return top;
    var t = _parseHex(top);
    var b = _parseHex(bottom);
    var tr = t[0], tg = t[1], tb = t[2];
    var br = b[0], bg = b[1], bb = b[2];
    var r = Math.round(tr * alpha + br * (1 - alpha));
    var g = Math.round(tg * alpha + bg * (1 - alpha));
    var b2 = Math.round(tb * alpha + bb * (1 - alpha));
    return '#' + [r, g, b2].map(function (v) { return v.toString(16).padStart(2, '0'); }).join('');
  }

  /**
   * 合成帧的所有可见图层 → 扁平像素数组
   * 从底到顶渲染，上层覆盖下层
   */
  function getCompositePixels(frame, w, h) {
    var composite = new Array(w * h).fill(null);
    if (!isLayerFrame(frame)) {
      if (Array.isArray(frame)) return frame.slice();
      return composite;
    }
    // 从底到顶合成（layers[0] 是最底层）
    for (var i = 0; i < frame.layers.length; i++) {
      var layer = frame.layers[i];
      if (!layer.visible) continue;
      var alpha = layer.opacity !== undefined ? layer.opacity : 1;
      if (alpha <= 0) continue;
      for (var p = 0; p < composite.length; p++) {
        if (layer.pixels[p] !== null) {
          composite[p] = blendPixel(layer.pixels[p], composite[p], alpha);
        }
      }
    }
    return composite;
  }

  /** 深拷贝一个帧（含所有图层） */
  function cloneFrame(frame) {
    if (!isLayerFrame(frame)) {
      return Array.isArray(frame) ? frame.slice() : frame;
    }
    return {
      layers: frame.layers.map(function (layer) {
        return {
          id: layer.id,
          name: layer.name,
          visible: layer.visible,
          opacity: layer.opacity,
          pixels: layer.pixels.slice()
        };
      }),
      activeLayer: frame.activeLayer
    };
  }

  /** 缩放帧内所有图层（最近邻） */
  function resizeFrame(frame, oldW, oldH, newW, newH) {
    if (!isLayerFrame(frame)) return frame;
    frame.layers.forEach(function (layer) {
      var newPixels = new Array(newW * newH).fill(null);
      for (var y = 0; y < newH; y++) {
        for (var x = 0; x < newW; x++) {
          var ox = Math.floor(x * oldW / newW);
          var oy = Math.floor(y * oldH / newH);
          newPixels[y * newW + x] = layer.pixels[oy * oldW + ox];
        }
      }
      layer.pixels = newPixels;
    });
    return frame;
  }

  /** 裁剪帧内所有图层 */
  function cropFrame(frame, x1, y1, x2, y2, oldW) {
    if (!isLayerFrame(frame)) return frame;
    var newW = x2 - x1 + 1;
    var newH = y2 - y1 + 1;
    frame.layers.forEach(function (layer) {
      var newPixels = new Array(newW * newH).fill(null);
      for (var y = 0; y < newH; y++) {
        for (var x = 0; x < newW; x++) {
          newPixels[y * newW + x] = layer.pixels[(y1 + y) * oldW + (x1 + x)];
        }
      }
      layer.pixels = newPixels;
    });
    return frame;
  }

  /** 在帧中添加新图层（插入到活动层上方） */
  function addLayer(frame, w, h, name) {
    if (!isLayerFrame(frame)) return null;
    var layer = createLayer(w, h, name);
    frame.layers.splice(frame.activeLayer + 1, 0, layer);
    frame.activeLayer = frame.activeLayer + 1;
    return layer;
  }

  /** 删除活动图层（至少保留一个） */
  function deleteLayer(frame) {
    if (!isLayerFrame(frame)) return false;
    if (frame.layers.length <= 1) return false;
    frame.layers.splice(frame.activeLayer, 1);
    if (frame.activeLayer >= frame.layers.length) {
      frame.activeLayer = frame.layers.length - 1;
    }
    return true;
  }

  /** 复制活动图层 */
  function duplicateLayer(frame) {
    if (!isLayerFrame(frame)) return null;
    var src = frame.layers[frame.activeLayer];
    if (!src) return null;
    var copy = {
      id: nextId(),
      name: src.name + ' Copy',
      visible: src.visible,
      opacity: src.opacity,
      pixels: src.pixels.slice()
    };
    frame.layers.splice(frame.activeLayer + 1, 0, copy);
    frame.activeLayer = frame.activeLayer + 1;
    return copy;
  }

  /** 上移活动图层 */
  function moveLayerUp(frame) {
    if (!isLayerFrame(frame)) return false;
    var i = frame.activeLayer;
    if (i >= frame.layers.length - 1) return false;
    var tmp = frame.layers[i];
    frame.layers[i] = frame.layers[i + 1];
    frame.layers[i + 1] = tmp;
    frame.activeLayer = i + 1;
    return true;
  }

  /** 下移活动图层 */
  function moveLayerDown(frame) {
    if (!isLayerFrame(frame)) return false;
    var i = frame.activeLayer;
    if (i <= 0) return false;
    var tmp = frame.layers[i];
    frame.layers[i] = frame.layers[i - 1];
    frame.layers[i - 1] = tmp;
    frame.activeLayer = i - 1;
    return true;
  }

  /** 通过拖拽排序图层 */
  function moveLayerTo(frame, fromIdx, toIdx) {
    if (!isLayerFrame(frame)) return false;
    if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0) return false;
    if (fromIdx >= frame.layers.length || toIdx >= frame.layers.length) return false;
    var moved = frame.layers.splice(fromIdx, 1)[0];
    frame.layers.splice(toIdx, 0, moved);
    frame.activeLayer = toIdx;
    return true;
  }

  /** 合并活动图层与下方图层 */
  function mergeLayerDown(frame, w, h) {
    if (!isLayerFrame(frame)) return false;
    var i = frame.activeLayer;
    if (i <= 0) return false;
    var top = frame.layers[i];
    var bottom = frame.layers[i - 1];
    for (var p = 0; p < w * h; p++) {
      if (top.pixels[p] !== null) {
        bottom.pixels[p] = blendPixel(top.pixels[p], bottom.pixels[p], top.opacity || 1);
      }
    }
    frame.layers.splice(i, 1);
    frame.activeLayer = i - 1;
    return true;
  }

  return {
    createLayer: createLayer,
    createFrame: createFrame,
    isLayerFrame: isLayerFrame,
    convertLegacyFrame: convertLegacyFrame,
    getActiveLayer: getActiveLayer,
    getActivePixels: getActivePixels,
    getCompositePixels: getCompositePixels,
    blendPixel: blendPixel,
    cloneFrame: cloneFrame,
    resizeFrame: resizeFrame,
    cropFrame: cropFrame,
    addLayer: addLayer,
    deleteLayer: deleteLayer,
    duplicateLayer: duplicateLayer,
    moveLayerUp: moveLayerUp,
    moveLayerDown: moveLayerDown,
    moveLayerTo: moveLayerTo,
    mergeLayerDown: mergeLayerDown
  };
})();

window.LayerUtils = LayerUtils;
