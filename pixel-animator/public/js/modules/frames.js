// public/js/modules/frames.js - 帧增删/复制/排序
(function (PA) {
  var S = PA.state;

  function pushSnapshot() { return PA.pushSnapshot(); }
  function autoSave() { return PA.autoSave(); }

  function bindFrames() {
    var origAdd = S.anim.addFrame.bind(S.anim);
    var origDup = S.anim.duplicateFrame.bind(S.anim);
    var origDel = S.anim.deleteFrame.bind(S.anim);
    var origMove = S.anim.moveFrame.bind(S.anim);

    S.anim.addFrame = function () {
      origAdd();
      if (S.layerSystem) S.layerSystem.addFrameLayers(S.anim.current);
      pushSnapshot();
      PA.renderFrameList();
      autoSave();
    };

    S.anim.duplicateFrame = function () {
      var src = S.anim.current;
      origDup();
      if (S.layerSystem) S.layerSystem.duplicateFrameLayers(src);
      pushSnapshot();
      PA.renderFrameList();
      autoSave();
    };

    S.anim.deleteFrame = function () {
      var old = S.anim.current;
      origDel();
      if (S.layerSystem) S.layerSystem.deleteFrameLayers(old);
      pushSnapshot();
      PA.renderFrameList();
      autoSave();
    };

    S.anim.moveFrame = function (from, to) {
      origMove(from, to);
      if (S.layerSystem) S.layerSystem.moveFrameLayers(from, to);
      pushSnapshot();
      PA.renderFrameList();
      autoSave();
    };

    document.getElementById('btnAddFrame').addEventListener('click', function () { S.anim.addFrame(); });
    document.getElementById('btnDupFrame').addEventListener('click', function () { S.anim.duplicateFrame(); });
    document.getElementById('btnDelFrame').addEventListener('click', function () {
      S.anim.deleteFrame();
    });
  }

  function init() { bindFrames(); }

  PA.Frames = { init: init, bindFrames: bindFrames };
})(window.PA);
