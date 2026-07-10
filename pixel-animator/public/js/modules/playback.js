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
    onionBtn.addEventListener('click', function (e) {
      var on = S.anim.toggleOnionSkin();
      this.classList.toggle('active', on);
    });
    onionBtn.classList.toggle('active', S.anim.onionSkin);
  }

  function init() { bindPlayback(); }

  PA.Playback = { init: init, bindPlayback: bindPlayback };
})(window.PA);
