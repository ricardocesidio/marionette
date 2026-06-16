/* Marionette — editor bootstrap and animation loop. */
(function () {
  'use strict';
  let ed = RIG.editor;
  ed.init();
  RIG.timeline.init(ed);

  let last = performance.now();
  let rAF = null;

  function frame(now) {
    let dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    let st = ed.state;
    let clip = ed.currentClip();

    if (st.playing && st.mode === 'animate') {
      st.time += dt;
      if (st.time > clip.duration) {
        if (st.loop) {
          st.time = st.time % clip.duration;
        } else {
          st.time = clip.duration;
          st.playing = false;
        }
      }
      clip.apply(st.time, st.skeleton, st.loop);
      ed.refreshTransport();
    }

    ed.render();
    RIG.timeline.draw();

    if (st.playing || st.drag) {
      rAF = requestAnimationFrame(frame);
    } else {
      rAF = null;
    }
  }

  ed.requestFrame = function () {
    if (rAF == null) {
      last = performance.now();
      rAF = requestAnimationFrame(frame);
    }
  };

  ed.requestFrame();
})();
