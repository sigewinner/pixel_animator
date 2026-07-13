// public/js/modules/playback.js - 播放控制、速度、洋葱皮
(function (PA) {
  var S = PA.state;

  function bindPlayback() {
    var btnPlay = document.getElementById('btnPlay');
    btnPlay.addEventListener('click', function () {
      if (S.anim.playing) {
        S.anim.stop();
        btnPlay.textContent = '播放';
      } else {
        S.anim.play();
        btnPlay.textContent = '停止';
      }
    });

    var fpsSlider = document.getElementById('fpsSlider');
    var fpsLabel = document.getElementById('fpsLabel');
    fpsSlider.addEventListener('input', function () {
      var fps = parseInt(fpsSlider.value);
      S.anim.setFps(fps);
      fpsLabel.textContent = fps + ' FPS';
    });

    var onionBtn = document.getElementById('btnOnion');
    var onionControl = document.getElementById('onionControl');
    var onionAlphaSlider = document.getElementById('onionAlphaSlider');
    var onionAlphaLabel = document.getElementById('onionAlphaLabel');

    function refreshOnionControl() {
      if (onionControl) onionControl.style.display = S.anim.onionSkin ? 'flex' : 'none';
    }

    onionBtn.addEventListener('click', function (e) {
      var on = S.anim.toggleOnionSkin();
      this.classList.toggle('active', on);
      refreshOnionControl();
    });
    onionBtn.classList.toggle('active', S.anim.onionSkin);

    if (onionAlphaSlider) {
      onionAlphaSlider.addEventListener('input', function () {
        var a = parseInt(onionAlphaSlider.value, 10) / 100;
        S.engine.setOnionAlpha(a);
        if (onionAlphaLabel) onionAlphaLabel.textContent = onionAlphaSlider.value + '%';
      });
    }
    refreshOnionControl();
  }

  function init() { bindPlayback(); }

  PA.Playback = { init: init, bindPlayback: bindPlayback };
})(window.PA);
