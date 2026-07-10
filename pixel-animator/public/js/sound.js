// public/js/sound.js - 现代风格 UI 音效引擎
// 使用 Web Audio API 实时合成「柔和、克制」的现代界面音效：
//   · 以正弦 / 三角波为主，避免刺耳的方波
//   · 统一经过低通滤波（master bus）让音色更温润
//   · 柔和的 attack / 指数衰减包络，短促不突兀
// 不依赖任何外部音频文件。

(function () {
  var audioCtx = null;
  var master = null;
  var muted = false;
  try { muted = localStorage.getItem('pa_sound_muted') === '1'; } catch (e) {}

  function getCtx() {
    if (!audioCtx) {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) { return null; }
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  // 共享的「母带」链路：gain -> lowpass -> destination
  // 低通让所有音效听起来更柔和、现代，避免高频毛刺。
  function getMaster() {
    var ctx = getCtx();
    if (!ctx) return null;
    if (!master) {
      var bus = ctx.createGain();
      bus.gain.value = 0.85;

      var lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 5200;   // 温润、不过亮
      lp.Q.value = 0.4;

      bus.connect(lp);
      lp.connect(ctx.destination);
      master = bus;
    }
    return master;
  }

  // 单个「音色」：振荡器 -> 增益(包络) -> 母带
  function voice(freq, when, dur, opts) {
    opts = opts || {};
    var ctx = getCtx();
    if (!ctx) return;
    var m = getMaster();
    if (!m) return;

    var type = opts.type || 'sine';
    var peak = (opts.volume != null) ? opts.volume : 0.12;
    var attack = (opts.attack != null) ? opts.attack : 0.006;
    var release = (opts.release != null) ? opts.release : Math.min(0.14, dur * 0.85);

    var osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, when);
    if (opts.glideTo) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.glideTo), when + dur);
    }

    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(peak, when + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur + release);

    osc.connect(g);
    g.connect(m);
    osc.start(when);
    osc.stop(when + dur + release + 0.03);
  }

  // 顺序播放一组音符
  function seq(notes, opts) {
    var ctx = getCtx();
    if (!ctx) return;
    var t = ctx.currentTime;
    notes.forEach(function (n) {
      voice(n.f, t, n.d, Object.assign({}, opts, n));
      t += n.d;
    });
  }

  // 便捷：立即播放一个滑音（glide）
  function glide(f0, f1, dur, opts) {
    var ctx = getCtx();
    if (!ctx) return;
    voice(f0, ctx.currentTime, dur, Object.assign({}, opts, { glideTo: f1 }));
  }

  var SFX = {
    muted: muted,

    setMuted: function (m) {
      muted = m;
      this.muted = m;
      try { localStorage.setItem('pa_sound_muted', m ? '1' : '0'); } catch (e) {}
    },

    toggleMute: function () {
      this.setMuted(!muted);
      if (!muted) this.click();
      return muted;
    },

    // 通用点击：柔和短促的「啵」声
    click: function () {
      if (muted) return;
      glide(720, 980, 0.055, { type: 'sine', volume: 0.10, attack: 0.004, release: 0.05 });
    },

    // 选择工具：两声柔和上行（E5 -> A5）
    select: function () {
      if (muted) return;
      seq([
        { f: 659.25, d: 0.045 },
        { f: 880.00, d: 0.07 }
      ], { type: 'triangle', volume: 0.11 });
    },

    // 取色：明亮清脆的小跳音
    pick: function () {
      if (muted) return;
      glide(1046.5, 1318.5, 0.07, { type: 'sine', volume: 0.10, attack: 0.003, release: 0.06 });
    },

    // 吸管：快速下行轻音
    eyedropper: function () {
      if (muted) return;
      glide(1568, 784, 0.09, { type: 'sine', volume: 0.09, attack: 0.004, release: 0.08 });
    },

    // 确认 / 应用：温暖的上行大三和弦（C5 E5 G5）
    confirm: function () {
      if (muted) return;
      seq([
        { f: 523.25, d: 0.05 },
        { f: 659.25, d: 0.05 },
        { f: 783.99, d: 0.10 }
      ], { type: 'triangle', volume: 0.11 });
    },

    // 取消：柔和下行
    cancel: function () {
      if (muted) return;
      glide(440, 330, 0.13, { type: 'sine', volume: 0.10, release: 0.10 });
    },

    // 删除：低沉、克制的下行
    delete: function () {
      if (muted) return;
      glide(311.13, 196.00, 0.16, { type: 'triangle', volume: 0.12, release: 0.12 });
    },

    // 新增（帧 / 颜色）：轻快上行
    add: function () {
      if (muted) return;
      seq([
        { f: 587.33, d: 0.04 },
        { f: 880.00, d: 0.07 }
      ], { type: 'sine', volume: 0.10 });
    },

    // 撤销：反向轻滑
    undo: function () {
      if (muted) return;
      glide(880, 587.33, 0.07, { type: 'sine', volume: 0.09, release: 0.06 });
    },

    // 重做：正向轻滑
    redo: function () {
      if (muted) return;
      glide(587.33, 880, 0.07, { type: 'sine', volume: 0.09, release: 0.06 });
    },

    // 开关（网格 / 洋葱皮 / 面板）：两声极短轻点
    toggle: function () {
      if (muted) return;
      var ctx = getCtx();
      if (!ctx) return;
      voice(660, ctx.currentTime, 0.03, { type: 'sine', volume: 0.09 });
      voice(990, ctx.currentTime + 0.04, 0.035, { type: 'sine', volume: 0.09 });
    },

    // 播放动画：上行琶音
    play: function () {
      if (muted) return;
      seq([
        { f: 523.25, d: 0.04 },
        { f: 659.25, d: 0.04 },
        { f: 783.99, d: 0.04 },
        { f: 1046.5, d: 0.09 }
      ], { type: 'triangle', volume: 0.10 });
    },

    // 停止动画：下行琶音
    stop: function () {
      if (muted) return;
      seq([
        { f: 1046.5, d: 0.04 },
        { f: 783.99, d: 0.04 },
        { f: 523.25, d: 0.07 }
      ], { type: 'triangle', volume: 0.09 });
    },

    // 保存：明亮、令人安心的三音和声
    save: function () {
      if (muted) return;
      seq([
        { f: 783.99, d: 0.05 },
        { f: 1046.5, d: 0.05 },
        { f: 1318.5, d: 0.12 }
      ], { type: 'sine', volume: 0.11 });
    },

    // 错误：柔和低音双音（不再刺耳）
    error: function () {
      if (muted) return;
      var ctx = getCtx();
      if (!ctx) return;
      voice(174.61, ctx.currentTime, 0.12, { type: 'sine', volume: 0.12 });
      voice(130.81, ctx.currentTime + 0.08, 0.14, { type: 'sine', volume: 0.11 });
    },

    // 放大
    zoomIn: function () {
      if (muted) return;
      glide(660, 990, 0.06, { type: 'sine', volume: 0.08, release: 0.05 });
    },

    // 缩小
    zoomOut: function () {
      if (muted) return;
      glide(990, 660, 0.06, { type: 'sine', volume: 0.08, release: 0.05 });
    },

    // 打开弹窗 / 浮层：柔和上扬
    open: function () {
      if (muted) return;
      glide(392, 784, 0.10, { type: 'triangle', volume: 0.09, release: 0.08 });
    },

    // 关闭弹窗 / 浮层：柔和回落
    close: function () {
      if (muted) return;
      glide(784, 392, 0.10, { type: 'triangle', volume: 0.09, release: 0.08 });
    },

    // 落笔（铅笔）：极短轻点
    pen: function () {
      if (muted) return;
      var ctx = getCtx();
      if (!ctx) return;
      voice(1200, ctx.currentTime, 0.018, { type: 'sine', volume: 0.05, attack: 0.002, release: 0.02 });
    },

    // 橡皮擦
    erase: function () {
      if (muted) return;
      var ctx = getCtx();
      if (!ctx) return;
      voice(523.25, ctx.currentTime, 0.025, { type: 'sine', volume: 0.05, attack: 0.002, release: 0.025 });
    },

    // 填充（油漆桶）：柔和上滑
    fill: function () {
      if (muted) return;
      glide(740, 1174.7, 0.10, { type: 'triangle', volume: 0.10, release: 0.08 });
    },

    // 帧选择
    frameSelect: function () {
      if (muted) return;
      var ctx = getCtx();
      if (!ctx) return;
      voice(740, ctx.currentTime, 0.03, { type: 'triangle', volume: 0.08, attack: 0.003, release: 0.03 });
    }
  };

  window.SFX = SFX;
})();
