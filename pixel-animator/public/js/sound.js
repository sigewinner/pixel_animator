// public/js/sound.js - Retro game-style sound effects engine
// Uses Web Audio API to generate 8-bit/16-bit sounds (no external files needed)

(function () {
  var audioCtx = null;
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

  // Play a single tone
  function tone(freq, duration, type, volume, startTime) {
    var ctx = getCtx();
    if (!ctx) return;
    type = type || 'square';
    volume = volume || 0.15;
    var t0 = startTime || ctx.currentTime;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(volume, t0 + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  // Play a frequency sweep
  function sweep(freqStart, freqEnd, duration, type, volume) {
    var ctx = getCtx();
    if (!ctx) return;
    type = type || 'square';
    volume = volume || 0.15;
    var t0 = ctx.currentTime;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + duration);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(volume, t0 + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  // Play a sequence of tones
  function sequence(notes, type, volume) {
    var ctx = getCtx();
    if (!ctx) return;
    type = type || 'square';
    volume = volume || 0.15;
    var t = ctx.currentTime;
    notes.forEach(function (note) {
      tone(note.f, note.d, type, volume, t);
      t += note.d;
    });
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

    // Generic button click - short blip
    click: function () {
      if (muted) return;
      tone(880, 0.04, 'square', 0.12);
      tone(1320, 0.03, 'square', 0.08, getCtx().currentTime + 0.02);
    },

    // Tool/option select - two ascending tones
    select: function () {
      if (muted) return;
      sequence([
        { f: 660, d: 0.03 },
        { f: 990, d: 0.04 }
      ], 'square', 0.12);
    },

    // Color swatch pick - pleasant blip
    pick: function () {
      if (muted) return;
      tone(1200, 0.03, 'square', 0.1);
      tone(1600, 0.04, 'triangle', 0.08, getCtx().currentTime + 0.02);
    },

    // Eyedropper - high blip with quick fall
    eyedropper: function () {
      if (muted) return;
      sweep(2000, 800, 0.08, 'square', 0.1);
    },

    // Confirm/apply - happy ascending arpeggio
    confirm: function () {
      if (muted) return;
      sequence([
        { f: 523, d: 0.04 },
        { f: 659, d: 0.04 },
        { f: 784, d: 0.06 }
      ], 'square', 0.12);
    },

    // Cancel - descending tone
    cancel: function () {
      if (muted) return;
      sweep(440, 220, 0.12, 'square', 0.1);
    },

    // Delete - low descending buzz
    delete: function () {
      if (muted) return;
      sweep(330, 110, 0.15, 'sawtooth', 0.12);
    },

    // Add (frame/color) - ascending two-tone
    add: function () {
      if (muted) return;
      sequence([
        { f: 587, d: 0.03 },
        { f: 880, d: 0.05 }
      ], 'square', 0.12);
    },

    // Undo - quick reverse blip
    undo: function () {
      if (muted) return;
      sweep(880, 440, 0.06, 'square', 0.1);
    },

    // Redo - quick forward blip
    redo: function () {
      if (muted) return;
      sweep(440, 880, 0.06, 'square', 0.1);
    },

    // Toggle (grid/onion/panel) - on/off switch
    toggle: function () {
      if (muted) return;
      tone(660, 0.02, 'square', 0.1);
      tone(990, 0.03, 'square', 0.1, getCtx().currentTime + 0.02);
    },

    // Play animation - rising arpeggio
    play: function () {
      if (muted) return;
      sequence([
        { f: 523, d: 0.03 },
        { f: 659, d: 0.03 },
        { f: 784, d: 0.03 },
        { f: 1047, d: 0.06 }
      ], 'square', 0.12);
    },

    // Stop animation - falling tone
    stop: function () {
      if (muted) return;
      sequence([
        { f: 1047, d: 0.03 },
        { f: 784, d: 0.03 },
        { f: 523, d: 0.05 }
      ], 'square', 0.1);
    },

    // Save - confirmation chime
    save: function () {
      if (muted) return;
      sequence([
        { f: 784, d: 0.03 },
        { f: 1047, d: 0.03 },
        { f: 1319, d: 0.08 }
      ], 'triangle', 0.12);
    },

    // Error - harsh low tone
    error: function () {
      if (muted) return;
      tone(140, 0.12, 'sawtooth', 0.12);
      tone(110, 0.1, 'sawtooth', 0.1, getCtx().currentTime + 0.06);
    },

    // Zoom in
    zoomIn: function () {
      if (muted) return;
      sweep(660, 990, 0.05, 'square', 0.08);
    },

    // Zoom out
    zoomOut: function () {
      if (muted) return;
      sweep(990, 660, 0.05, 'square', 0.08);
    },

    // Open modal/overlay
    open: function () {
      if (muted) return;
      sweep(440, 880, 0.08, 'triangle', 0.1);
    },

    // Close modal/overlay
    close: function () {
      if (muted) return;
      sweep(880, 440, 0.08, 'triangle', 0.1);
    },

    // Place pixel (pen draw) - very short tick
    pen: function () {
      if (muted) return;
      tone(1400, 0.015, 'square', 0.06);
    },

    // Erase
    erase: function () {
      if (muted) return;
      tone(500, 0.02, 'square', 0.06);
    },

    // Fill (bucket)
    fill: function () {
      if (muted) return;
      sweep(800, 1200, 0.08, 'triangle', 0.1);
    },

    // Frame select
    frameSelect: function () {
      if (muted) return;
      tone(740, 0.025, 'triangle', 0.08);
    },
  };

  window.SFX = SFX;
})();
