/* Marionette — timeline strip + transport controls. */
var RIG = RIG || {};

RIG.timeline = (function () {
  'use strict';
  let cv, ctx, ed, scrubbing = false;
  let PAD = 10;

  function $(id) { return document.getElementById(id); }

  function init(editor) {
    ed = editor;
    cv = $('timeline');
    ctx = cv.getContext('2d');

    cv.addEventListener('pointerdown', function (e) {
      cv.setPointerCapture(e.pointerId);
      scrubbing = true;
      scrub(e, false);
    });
    cv.addEventListener('pointermove', function (e) { if (scrubbing) scrub(e, true); });
    cv.addEventListener('pointerup', function () { scrubbing = false; });

    $('btnPlay').onclick = function () { ed.togglePlay(); this.blur(); };
    $('btnAddKey').onclick = function () {
      let st = ed.state;
      if (st.mode !== 'animate') return ed.toast('Switch to Animate mode (2) first.');
      ed.saveSnapshot();
      ed.currentClip().setKey(st.time, st.skeleton);
      this.blur();
    };
    $('btnDelKey').onclick = function () {
      let st = ed.state;
      ed.saveSnapshot();
      if (!ed.currentClip().removeKeyAt(st.time, keyTolerance())) ed.toast('No key at the playhead.');
      this.blur();
    };
    $('duration').onchange = function (e) {
      let v = parseFloat(e.target.value);
      if (!isFinite(v)) return;
      ed.currentClip().duration = Math.min(60, Math.max(0.2, v));
      e.target.value = ed.currentClip().duration;
      ed.state.time = Math.min(ed.state.time, ed.currentClip().duration);
    };
    $('chkLoop').onchange = function (e) { ed.state.loop = e.target.checked; };
    $('chkAutoKey').onchange = function (e) { ed.state.autoKey = e.target.checked; };
  }

  function keyTolerance() {
    return Math.max(0.02, ed.currentClip().duration / ((cv.clientWidth - 2 * PAD) / 6));
  }

  function timeAt(px) {
    let w = cv.clientWidth - 2 * PAD;
    let t = ((px - PAD) / Math.max(1, w)) * ed.currentClip().duration;
    return Math.min(ed.currentClip().duration, Math.max(0, t));
  }

  function scrub(e, dragging) {
    let st = ed.state;
    let clip = ed.currentClip();
    let r = cv.getBoundingClientRect();
    let t = timeAt(e.clientX - r.left);
    let near = clip.keyNear(t, keyTolerance());
    st.time = near ? near.t : t;
    if (dragging) st.playing = false;
    if (st.mode === 'animate' && clip.keys.length) {
      clip.apply(st.time, st.skeleton, st.loop);
    }
    ed.refreshTransport();
  }

  function draw() {
    let dpr = window.devicePixelRatio || 1;
    let w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    let clip = ed.currentClip();
    let dur = clip.duration;
    let span = w - 2 * PAD;
    let xOf = function (t) { return PAD + (t / dur) * span; };

    let step = dur > 8 ? 1 : dur > 3 ? 0.5 : 0.25;
    ctx.strokeStyle = '#2a2e36';
    ctx.fillStyle = '#6b7280';
    ctx.font = '10px sans-serif';
    ctx.beginPath();
    for (let t = 0; t <= dur + 1e-6; t += step) {
      let x = xOf(t);
      ctx.moveTo(x, h - 14);
      ctx.lineTo(x, h - 4);
      ctx.fillText(t.toFixed(t % 1 ? 2 : 0), x + 2, h - 5);
    }
    ctx.stroke();

    clip.keys.forEach(function (k) {
      let x = xOf(k.t);
      ctx.save();
      ctx.translate(x, h / 2 - 6);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = '#ffcc44';
      ctx.fillRect(-4.5, -4.5, 9, 9);
      ctx.restore();
    });

    let st = ed.state;
    let px = xOf(Math.min(st.time, dur));
    ctx.strokeStyle = '#ff5566';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px, 2);
    ctx.lineTo(px, h - 2);
    ctx.stroke();
  }

  return { init: init, draw: draw };
})();