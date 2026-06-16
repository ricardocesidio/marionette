/* Marionette — minimal game runtime demo.
 * Loads an exported character (from localStorage handoff or a .json file)
 * and lets it walk around, animated live by its skeleton. */
(function () {
  'use strict';
  let model = RIG.model, R = RIG.render;

  let cv = document.getElementById('game');
  let ctx = cv.getContext('2d');
  let hudStatus = document.getElementById('status');

  let character = null; // {img, skeleton, mesh, clip, anchorX, anchorY, scale}
  let ent = { x: 0, dir: 1, t: 0 };
  let keys = {};

  window.addEventListener('keydown', function (e) {
    keys[e.code] = true;
    if (e.code.indexOf('Arrow') === 0) e.preventDefault();
  });
  window.addEventListener('keyup', function (e) { keys[e.code] = false; });

  document.getElementById('charFile').addEventListener('change', function (e) {
    if (!e.target.files.length) return;
    let reader = new FileReader();
    reader.onload = function () {
      try { buildCharacter(JSON.parse(reader.result)); }
      catch (err) { hudStatus.textContent = 'That is not a valid character file.'; }
    };
    reader.readAsText(e.target.files[0]);
    e.target.value = '';
  });

  function buildCharacter(data) {
    if (data.format !== 'marionette-character') {
      hudStatus.textContent = 'That is not a Marionette character file.';
      return;
    }
    let img = new Image();
    img.onload = function () {
      let skeleton = model.skeletonFromJSON(data);
      let mesh = new model.Mesh({
        natW: data.natW, natH: data.natH,
        drawnW: data.drawnW, drawnH: data.drawnH,
        offX: data.offX, offY: data.offY,
        divisions: data.divisions || 20,
      });
      mesh.bind(skeleton);
      mesh.analyzeVisibility(img);
      let clip = model.clipFromJSON(data);
      character = {
        img: img, skeleton: skeleton, mesh: mesh, clip: clip,
        anchorX: data.offX + data.drawnW / 2,
        anchorY: data.offY + data.drawnH,
        height: data.drawnH,
      };
      ent.x = cv.clientWidth / 2;
      ent.t = 0;
      hudStatus.textContent = clip.keys.length
        ? 'Character loaded — walk with ← → (or A/D).'
        : 'Character loaded (no keyframes yet — it will not animate). Walk with ← →.';
    };
    img.src = data.image;
  }

  // Quick handoff from the editor's "Test in Game" button.
  try {
    let stored = localStorage.getItem('marionette.character');
    if (stored) buildCharacter(JSON.parse(stored));
  } catch (e) { /* fall through to file picker */ }

  let last = performance.now();
  function frame(now) {
    let dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    let dpr = window.devicePixelRatio || 1;
    let w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // backdrop
    let sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#1a2c4d');
    sky.addColorStop(1, '#3d5a80');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f4e8c1';
    ctx.beginPath();
    ctx.arc(w - 110, 90, 38, 0, Math.PI * 2);
    ctx.fill();
    let groundY = h - 70;
    ctx.fillStyle = '#2e4a33';
    ctx.fillRect(0, groundY, w, h - groundY);
    ctx.fillStyle = '#3a5c40';
    ctx.fillRect(0, groundY, w, 6);

    if (character) {
      let move = (keys.ArrowRight || keys.KeyD ? 1 : 0) - (keys.ArrowLeft || keys.KeyA ? 1 : 0);
      if (move !== 0) {
        ent.x += move * 230 * dt;
        ent.dir = move;
      }
      ent.x = Math.max(60, Math.min(w - 60, ent.x));

      // Animation runs full speed while moving, idles slowly when standing.
      ent.t += dt * (move !== 0 ? 1 : 0.35);
      if (character.clip.keys.length) {
        character.clip.apply(ent.t % character.clip.duration, character.skeleton, true);
      }
      let pos = character.mesh.deform(character.skeleton);

      ctx.save();
      ctx.translate(ent.x, groundY + 4);
      ctx.scale(ent.dir, 1);
      ctx.translate(-character.anchorX, -character.anchorY);
      R.drawMesh(ctx, character.img, character.mesh, pos);
      ctx.restore();
    }

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
