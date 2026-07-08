// public/js/color-wheel.js
// HSV 圆形色轮选色器 — 色相环 + 饱和度轮 + 亮度滑块
// 设计参考: Aseprite / Photoshop 拾色器

(function (global) {
  'use strict';

  // ---- 颜色空间转换 ----
  function hsvToRgb(h, s, v) {
    var c = v * s;
    var hp = h / 60;
    var x = c * (1 - Math.abs((hp % 2) - 1));
    var r, g, b;
    if (hp < 1) { r = c; g = x; b = 0; }
    else if (hp < 2) { r = x; g = c; b = 0; }
    else if (hp < 3) { r = 0; g = c; b = x; }
    else if (hp < 4) { r = 0; g = x; b = c; }
    else if (hp < 5) { r = x; g = 0; b = c; }
    else { r = c; g = 0; b = x; }
    var m = v - c;
    return [
      Math.round((r + m) * 255),
      Math.round((g + m) * 255),
      Math.round((b + m) * 255)
    ];
  }

  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var d = max - min;
    var h = 0;
    if (d > 0) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    var s = max === 0 ? 0 : d / max;
    return [h, s, max];
  }

  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(function (v) { return v.toString(16).padStart(2, '0'); }).join('');
  }

  function hexToRgb(hex) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(function (c) { return c + c; }).join('');
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16)
    ];
  }


  var ColorWheel = function (container, options) {
    options = options || {};
    this.container = typeof container === 'string' ? document.querySelector(container) : container;
    this.onChange = options.onChange || function () {};
    this.onAddToPalette = options.onAddToPalette || function () {};

    this.h = 0;   // 0-360
    this.s = 1;   // 0-1
    this.v = 1;   // 0-1

    this.wheelSize = options.size || 180;
    this.sliderHeight = this.wheelSize;
    this.ringWidth = 14;
    this.wheelRadius = this.wheelSize / 2;
    this.innerRadius = this.wheelRadius - this.ringWidth;
    this.satRadius = this.innerRadius - 2;

    this._dragWheel = false;
    this._dragSlider = false;

    this._build();
    this._bindEvents();
    this.setColor(options.color || '#ff0000');
  };

  ColorWheel.prototype._build = function () {
    this.container.innerHTML =
      '<div class="cw-panel">' +
        '<div class="cw-main">' +
          '<div class="cw-wheel-wrap">' +
            '<canvas class="cw-wheel" width="' + this.wheelSize + '" height="' + this.wheelSize + '"></canvas>' +
            '<div class="cw-wheel-cursor"></div>' +
          '</div>' +
          '<div class="cw-slider-wrap">' +
            '<canvas class="cw-slider" width="22" height="' + this.sliderHeight + '"></canvas>' +
            '<div class="cw-slider-cursor"></div>' +
          '</div>' +
        '</div>' +
        '<div class="cw-bottom">' +
          '<div class="cw-preview-wrap">' +
            '<div class="cw-preview"></div>' +
          '</div>' +
          '<div class="cw-fields">' +
            '<div class="cw-field"><span>HEX</span><input type="text" class="cw-hex" maxlength="7"></div>' +
          '</div>' +
          '<button class="cw-add-btn">加入调色板</button>' +
        '</div>' +
      '</div>';

    this.wheelCanvas = this.container.querySelector('.cw-wheel');
    this.wheelCtx = this.wheelCanvas.getContext('2d');
    this.wheelCursor = this.container.querySelector('.cw-wheel-cursor');
    this.sliderCanvas = this.container.querySelector('.cw-slider');
    this.sliderCtx = this.sliderCanvas.getContext('2d');
    this.sliderCursor = this.container.querySelector('.cw-slider-cursor');
    this.preview = this.container.querySelector('.cw-preview');
    this.hexInput = this.container.querySelector('.cw-hex');
    this.addBtn = this.container.querySelector('.cw-add-btn');
  };

  ColorWheel.prototype.drawWheel = function () {
    var ctx = this.wheelCtx;
    var size = this.wheelSize;
    var cx = size / 2, cy = size / 2;
    var outerR = this.wheelRadius;
    var innerR = this.innerRadius;
    var satR = this.satRadius;

    ctx.clearRect(0, 0, size, size);

    // 色相环 + 饱和度轮 统一在一个 ImageData 中绘制
    // 避免 putImageData 覆盖之前 fill 画的色相环
    var imgData = ctx.createImageData(size, size);
    var data = imgData.data;
    for (var py = 0; py < size; py++) {
      for (var px = 0; px < size; px++) {
        var dx = px - cx;
        var dy = py - cy;
        var dist = Math.sqrt(dx * dx + dy * dy);
        var idx = (py * size + px) * 4;

        if (dist <= satR) {
          // 饱和度轮（内圆）：角度=色相，半径=饱和度
          // 始终用 v=1 绘制，保证色轮永远是彩色的（亮度由滑块单独控制）
          var angle = Math.atan2(dy, dx) * 180 / Math.PI + 90;
          if (angle < 0) angle += 360;
          var sat = dist / satR;
          var rgb = hsvToRgb(angle, sat, 1);
          // 边缘抗锯齿
          var alpha = dist > satR - 1.5 ? Math.max(0, (satR - dist) / 1.5 * 255) : 255;
          data[idx] = rgb[0];
          data[idx + 1] = rgb[1];
          data[idx + 2] = rgb[2];
          data[idx + 3] = Math.round(alpha);
        } else if (dist >= innerR - 0.5 && dist <= outerR) {
          // 色相环（外环）：固定饱和度=1, 亮度=1
          var angle2 = Math.atan2(dy, dx) * 180 / Math.PI + 90;
          if (angle2 < 0) angle2 += 360;
          var rgb2 = hsvToRgb(angle2, 1, 1);
          // 内外边缘抗锯齿
          var alpha2 = 255;
          if (dist > outerR - 1) alpha2 = Math.max(0, (outerR - dist) * 255);
          if (dist < innerR + 0.5) alpha2 = Math.max(0, (dist - innerR) / 0.5 * 255);
          data[idx] = rgb2[0];
          data[idx + 1] = rgb2[1];
          data[idx + 2] = rgb2[2];
          data[idx + 3] = Math.round(Math.min(255, alpha2));
        }
      }
    }
    ctx.putImageData(imgData, 0, 0);

    // 内圆边框
    ctx.beginPath();
    ctx.arc(cx, cy, satR, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();
  };

  ColorWheel.prototype.drawSlider = function () {
    var ctx = this.sliderCtx;
    var w = 22, h = this.sliderHeight;
    var imgData = ctx.createImageData(w, h);
    var data = imgData.data;
    for (var y = 0; y < h; y++) {
      var vv = 1 - y / (h - 1);
      var rgb = hsvToRgb(this.h, this.s, vv);
      for (var x = 0; x < w; x++) {
        var idx = (y * w + x) * 4;
        data[idx] = rgb[0];
        data[idx + 1] = rgb[1];
        data[idx + 2] = rgb[2];
        data[idx + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);
  };

  ColorWheel.prototype._updateCursors = function () {
    var cx = this.wheelSize / 2, cy = this.wheelSize / 2;
    var rad = (this.h - 90) * Math.PI / 180;
    var dist = this.s * this.satRadius;
    var x = cx + Math.cos(rad) * dist;
    var y = cy + Math.sin(rad) * dist;
    this.wheelCursor.style.left = (x - 7) + 'px';
    this.wheelCursor.style.top = (y - 7) + 'px';

    var sy = (1 - this.v) * (this.sliderHeight - 1);
    this.sliderCursor.style.top = (sy - 4) + 'px';
  };

  ColorWheel.prototype._updatePreview = function () {
    var rgb = hsvToRgb(this.h, this.s, this.v);
    var hex = rgbToHex(rgb[0], rgb[1], rgb[2]);
    this.preview.style.background = hex;
    if (document.activeElement !== this.hexInput) {
      this.hexInput.value = hex;
    }
  };

  ColorWheel.prototype.setColor = function (hex) {
    var rgb = hexToRgb(hex);
    var hsv = rgbToHsv(rgb[0], rgb[1], rgb[2]);
    this.h = hsv[0];
    this.s = hsv[1];
    this.v = hsv[2];
    this.drawWheel();
    this.drawSlider();
    this._updateCursors();
    this._updatePreview();
  };

  ColorWheel.prototype.getHex = function () {
    var rgb = hsvToRgb(this.h, this.s, this.v);
    return rgbToHex(rgb[0], rgb[1], rgb[2]);
  };

  // 事件绑定
  ColorWheel.prototype._bindEvents = function () {
    var self = this;

    function wheelPick(clientX, clientY) {
      var rect = self.wheelCanvas.getBoundingClientRect();
      var x = clientX - rect.left - self.wheelSize / 2;
      var y = clientY - rect.top - self.wheelSize / 2;
      var dist = Math.sqrt(x * x + y * y);
      var angle = Math.atan2(y, x) * 180 / Math.PI + 90;
      if (angle < 0) angle += 360;

      if (dist <= self.satRadius) {
        self.h = angle;
        self.s = dist / self.satRadius;
      } else if (dist <= self.wheelRadius) {
        self.h = angle;
      }
      self.drawWheel();
      self.drawSlider();
      self._updateCursors();
      self._updatePreview();
      self.onChange(self.getHex());
    }

    function sliderPick(clientY) {
      var rect = self.sliderCanvas.getBoundingClientRect();
      var y = clientY - rect.top;
      y = Math.max(0, Math.min(self.sliderHeight - 1, y));
      self.v = 1 - y / (self.sliderHeight - 1);
      self.drawWheel();
      self._updateCursors();
      self._updatePreview();
      self.onChange(self.getHex());
    }

    // 鼠标
    self.wheelCanvas.addEventListener('mousedown', function (e) {
      self._dragWheel = true;
      wheelPick(e.clientX, e.clientY);
      e.preventDefault();
    });
    self.sliderCanvas.addEventListener('mousedown', function (e) {
      self._dragSlider = true;
      sliderPick(e.clientY);
      e.preventDefault();
    });
    document.addEventListener('mousemove', function (e) {
      if (self._dragWheel) wheelPick(e.clientX, e.clientY);
      if (self._dragSlider) sliderPick(e.clientY);
    });
    document.addEventListener('mouseup', function () {
      self._dragWheel = false;
      self._dragSlider = false;
    });

    // 触摸
    self.wheelCanvas.addEventListener('touchstart', function (e) {
      self._dragWheel = true;
      var t = e.touches[0];
      wheelPick(t.clientX, t.clientY);
      e.preventDefault();
    });
    self.sliderCanvas.addEventListener('touchstart', function (e) {
      self._dragSlider = true;
      sliderPick(e.touches[0].clientY);
      e.preventDefault();
    });
    document.addEventListener('touchmove', function (e) {
      if (self._dragWheel) { wheelPick(e.touches[0].clientX, e.touches[0].clientY); e.preventDefault(); }
      if (self._dragSlider) { sliderPick(e.touches[0].clientY); e.preventDefault(); }
    }, { passive: false });
    document.addEventListener('touchend', function () {
      self._dragWheel = false;
      self._dragSlider = false;
    });

    // HEX 输入
    self.hexInput.addEventListener('change', function () {
      var val = self.hexInput.value.trim();
      if (!val) return;
      if (val[0] !== '#') val = '#' + val;
      if (/^#[0-9a-fA-F]{6}$/.test(val) || /^#[0-9a-fA-F]{3}$/.test(val)) {
        self.setColor(val);
        self.onChange(self.getHex());
      } else {
        self._updatePreview();
      }
    });

    // 加入调色板
    self.addBtn.addEventListener('click', function () {
      self.onAddToPalette(self.getHex());
    });
  };

  global.ColorWheel = ColorWheel;
  global.ColorWheelUtil = { hsvToRgb: hsvToRgb, rgbToHsv: rgbToHsv, rgbToHex: rgbToHex, hexToRgb: hexToRgb };
})(window);
