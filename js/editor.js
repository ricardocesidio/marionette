/* Marionette — editor: stage interaction, rigging, posing, import/export. */
var RIG = RIG || {};

RIG.editor = (function () {
  'use strict';
  let M = RIG.math, R = RIG.render, model = RIG.model;

  let state = {
    mode: 'rig',
    image: null,
    imageURL: null,
    natW: 0, natH: 0,
    drawnW: 0, drawnH: 0,
    offX: 0, offY: 0,
    skeleton: new model.Skeleton(),
    mesh: null,
    bound: false,
    divisions: 28,
    animations: [new model.Clip('idle', 2)],
    currentAnim: 0,
    time: 0,
    playing: false,
    loop: true,
    autoKey: true,
    selectedId: null,
    selectedIds: [],
    showBones: true,
    showMesh: false,
    drag: null,
    cameraX: 0, cameraY: 0, cameraZoom: 1,
  };

  function currentClip() {
    return state.animations[state.currentAnim] || state.animations[0];
  }

  function setSelection(ids) {
    state.selectedIds = ids.slice();
    state.selectedId = ids.length ? ids[0] : null;
  }

  function toggleSelection(id) {
    let idx = state.selectedIds.indexOf(id);
    if (idx >= 0) {
      state.selectedIds.splice(idx, 1);
      state.selectedId = state.selectedIds.length ? state.selectedIds[0] : null;
    } else {
      state.selectedIds.push(id);
      state.selectedId = id;
    }
  }

  function clearSelection() {
    state.selectedIds = [];
    state.selectedId = null;
  }

  function isSelected(id) {
    return state.selectedIds.indexOf(id) >= 0;
  }

  function selectedBones() {
    return state.selectedIds.map(function (id) { return state.skeleton.byId(id); }).filter(Boolean);
  }

  let stage, ctx, toastEl, toastTimer, loadingEl;
  let undoStack = [], redoStack = [];
  let UNDO_LIMIT = 50;

  function captureState() {
    return {
      bones: JSON.parse(JSON.stringify(state.skeleton.bones)),
      animations: JSON.parse(JSON.stringify(state.animations)),
    };
  }

  function restoreState(sn) {
    state.skeleton.bones = sn.bones.map(function (b) { return new model.Bone(b); });
    state.animations = sn.animations.map(function (a) {
      let c = new model.Clip(a.name, a.duration);
      c.keys = a.keys;
      return c;
    });
    if (state.currentAnim >= state.animations.length) state.currentAnim = 0;
    invalidateBind();
    refreshPanels();
  }

  function saveSnapshot() {
    undoStack.push(captureState());
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    redoStack = [];
  }

  function undo() {
    if (!undoStack.length) return toast('Nothing to undo.');
    redoStack.push(captureState());
    restoreState(undoStack.pop());
    toast('Undo');
  }

  function redo() {
    if (!redoStack.length) return toast('Nothing to redo.');
    undoStack.push(captureState());
    restoreState(redoStack.pop());
    toast('Redo');
  }

  // ------------------------------------------------------------- helpers

  function $(id) { return document.getElementById(id); }

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2600);
  }

  function selectedBone() {
    return state.selectedId != null ? state.skeleton.byId(state.selectedId) : null;
  }

  function scheduleRender() {
    if (RIG.editor && RIG.editor.requestFrame) RIG.editor.requestFrame();
  }

  function invalidateBind() {
    state.bound = false;
  }

  function ensureBound() {
    if (state.bound || !state.image || !state.skeleton.bones.length) return;
    state.mesh = new model.Mesh({
      natW: state.natW, natH: state.natH,
      drawnW: state.drawnW, drawnH: state.drawnH,
      offX: state.offX, offY: state.offY,
      divisions: state.divisions,
    });
    state.mesh.bind(state.skeleton);
    state.mesh.analyzeVisibility(state.image);
    state.bound = true;
  }

  // ---------------------------------------------------------------- mode

  function setMode(mode) {
    if (mode === 'animate') {
      if (!state.image) return toast('Load an image first (left panel).');
      if (!state.skeleton.bones.length) return toast('Draw at least one bone first (drag on the image).');
      ensureBound();
      let clip = currentClip();
      if (clip.keys.length) clip.apply(state.time, state.skeleton, state.loop);
    } else {
      state.skeleton.resetPose();
      state.playing = false;
    }
    state.mode = mode;
    $('modeRig').classList.toggle('active', mode === 'rig');
    $('modeAnimate').classList.toggle('active', mode === 'animate');
    refreshPanels();
  }

  // --------------------------------------------------------- image input

  function loadImageFile(file) {
    if (!file || !file.type.match(/^image\//)) return toast('Please choose an image file.');
    if (state.skeleton.bones.length &&
        !confirm('Loading a new image starts a new character. Continue?')) return;
    let reader = new FileReader();
    reader.onload = function () { loadImageFromURL(reader.result, false); };
    reader.readAsDataURL(file);
  }

  function loadImageFromURL(url, keepRig, onready) {
    showLoading(true);
    let img = new Image();
    img.onload = function () {
      showLoading(false);
      state.image = img;
      state.imageURL = url;
      state.natW = img.naturalWidth;
      state.natH = img.naturalHeight;
      if (!keepRig) {
        let maxW = stage.clientWidth * 0.72, maxH = stage.clientHeight * 0.86;
        let s = Math.min(1, maxW / state.natW, maxH / state.natH);
        state.drawnW = state.natW * s;
        state.drawnH = state.natH * s;
        state.offX = Math.round((stage.clientWidth - state.drawnW) / 2);
        state.offY = Math.round((stage.clientHeight - state.drawnH) / 2);
        state.skeleton = new model.Skeleton();
        state.animations = [new model.Clip('idle', currentClip().duration || 2)];
        state.currentAnim = 0;
        clearSelection();
        state.time = 0;
        state.playing = false;
      }
      invalidateBind();
      setMode('rig');
      refreshPanels();
      if (onready) onready();
    };
    img.onerror = function () { showLoading(false); toast('Could not load that image.'); };
    img.src = url;
  }

  // Swap in a freshly built skeleton; old keyframes target dead bone ids,
  // so the animation restarts too.
  function replaceSkeleton(sk, msg) {
    saveSnapshot();
    state.skeleton = sk;
    state.animations = [new model.Clip('idle', currentClip().duration || 2)];
    state.currentAnim = 0;
    state.time = 0;
    state.selectedId = null;
    invalidateBind();
    setMode('rig');
    refreshPanels();
    if (msg) toast(msg);
  }

  // One-click full humanoid rig (hips/spine/head, arms→forearms→hands,
  // thighs→shins→feet), fitted to the image box and adjustable by Alt-drag.
  function addHumanoid() {
    if (!state.image) return toast('Load an image first (left panel).');
    if (state.skeleton.bones.length &&
        !confirm('Replace the current bones with the humanoid preset?')) return;
    replaceSkeleton(model.humanoidSkeleton({
      offX: state.offX, offY: state.offY,
      drawnW: state.drawnW, drawnH: state.drawnH,
    }), 'Humanoid skeleton added — Alt-drag the joints to fit your character.');
  }

  // Auto-rig: analyse the image pixels, find the character's silhouette and
  // body landmarks, and place the whole named skeleton automatically.
  function autoDetectSkeleton() {
    if (!state.image) return toast('Load an image first (left panel).');
    if (state.skeleton.bones.length &&
        !confirm('Replace the current bones with the auto-detected skeleton?')) return;
    let MAX = 240; // downsample: silhouette analysis doesn't need full res
    let s = Math.min(1, MAX / Math.max(state.natW, state.natH));
    let w = Math.max(8, Math.round(state.natW * s));
    let h = Math.max(8, Math.round(state.natH * s));
    let c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    let g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(state.image, 0, 0, w, h);
    let pixels;
    try {
      pixels = g.getImageData(0, 0, w, h);
    } catch (e) {
      return toast('Could not read the image pixels.');
    }
    let res = RIG.auto.autoRig(pixels, {
      offX: state.offX, offY: state.offY,
      drawnW: state.drawnW, drawnH: state.drawnH,
    });
    if (!res.skeleton) {
      return toast('No character found — works best with a transparent or plain background.');
    }
    replaceSkeleton(res.skeleton, res.note);
  }

  function generateSample() {
    if (state.skeleton.bones.length &&
        !confirm('Generating the sample starts a new character. Continue?')) return;
    let w = 360, h = 480;
    let c = document.createElement('canvas');
    c.width = w; c.height = h;
    let g = c.getContext('2d');
    g.lineCap = 'round';

    function limb(x0, y0, x1, y1, width, col) {
      g.strokeStyle = col;
      g.lineWidth = width;
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();
    }

    limb(152, 330, 140, 442, 34, '#3b6ea5');
    limb(208, 330, 220, 442, 34, '#345f8e');
    g.fillStyle = '#e8743b';
    g.beginPath();
    g.ellipse(180, 258, 72, 92, 0, 0, Math.PI * 2);
    g.fill();
    limb(122, 215, 56, 300, 26, '#e8a13b');
    limb(238, 215, 304, 300, 26, '#d18f2f');
    g.fillStyle = '#f2c89b';
    g.beginPath();
    g.arc(180, 118, 62, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#222';
    g.beginPath(); g.arc(158, 106, 7, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(202, 106, 7, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#222';
    g.lineWidth = 5;
    g.beginPath();
    g.arc(180, 126, 26, 0.15 * Math.PI, 0.85 * Math.PI);
    g.stroke();

    loadImageFromURL(c.toDataURL('image/png'), false, function () {
      toast('Sample loaded. Drag on the image to draw bones!');
    });
  }

  function generateReadyCharacter() {
    if (state.skeleton.bones.length &&
        !confirm('Replace the current character with a ready-to-test puppet?')) return;
    let w = 360, h = 480;
    let c = document.createElement('canvas');
    c.width = w; c.height = h;
    let g = c.getContext('2d');
    g.lineCap = 'round';

    function limb(x0, y0, x1, y1, width, col) {
      g.strokeStyle = col;
      g.lineWidth = width;
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();
    }

    limb(152, 330, 140, 442, 34, '#3b6ea5');
    limb(208, 330, 220, 442, 34, '#345f8e');
    g.fillStyle = '#e8743b';
    g.beginPath();
    g.ellipse(180, 258, 72, 92, 0, 0, Math.PI * 2);
    g.fill();
    limb(122, 215, 56, 300, 26, '#e8a13b');
    limb(238, 215, 304, 300, 26, '#d18f2f');
    g.fillStyle = '#f2c89b';
    g.beginPath();
    g.arc(180, 118, 62, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#222';
    g.beginPath(); g.arc(158, 106, 7, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(202, 106, 7, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#222';
    g.lineWidth = 5;
    g.beginPath();
    g.arc(180, 126, 26, 0.15 * Math.PI, 0.85 * Math.PI);
    g.stroke();

    showLoading(true);
    let img = new Image();
    img.onload = function () {
      showLoading(false);
      state.image = img;
      state.imageURL = c.toDataURL('image/png');
      state.natW = w; state.natH = h;
      let maxW = stage.clientWidth * 0.72, maxH = stage.clientHeight * 0.86;
      let s = Math.min(1, maxW / w, maxH / h);
      state.drawnW = w * s; state.drawnH = h * s;
      state.offX = Math.round((stage.clientWidth - state.drawnW) / 2);
      state.offY = Math.round((stage.clientHeight - state.drawnH) / 2);

      let sk = new model.Skeleton();
      let ox = state.offX, oy = state.offY, dw = state.drawnW, dh = state.drawnH;
      function P(fx, fy) { return { x: ox + fx * dw, y: oy + fy * dh }; }

      let pelvis = P(0.50, 0.66), chest = P(0.50, 0.46), head = P(0.50, 0.22);
      let spine = sk.addBoneWorld(null, pelvis.x, pelvis.y, chest.x, chest.y);
      spine.name = 'spine';
      let neck = sk.addBoneWorld(spine.id, chest.x, chest.y, head.x, head.y);
      neck.name = 'neck';

      let aL = P(0.35, 0.45), aLe = P(0.14, 0.63);
      let aR = P(0.65, 0.45), aRe = P(0.86, 0.63);
      let armL = sk.addBoneWorld(spine.id, aL.x, aL.y, aLe.x, aLe.y);
      armL.name = 'left arm';
      let armR = sk.addBoneWorld(spine.id, aR.x, aR.y, aRe.x, aRe.y);
      armR.name = 'right arm';

      let lL = P(0.42, 0.70), lLe = P(0.39, 0.93);
      let lR = P(0.58, 0.70), lRe = P(0.61, 0.93);
      let legL = sk.addBoneWorld(spine.id, lL.x, lL.y, lLe.x, lLe.y);
      legL.name = 'left leg';
      let legR = sk.addBoneWorld(spine.id, lR.x, lR.y, lRe.x, lRe.y);
      legR.name = 'right leg';

      state.skeleton = sk;
      invalidateBind();

      let clip = new model.Clip('idle', 1.5);
      armR.poseRot = -1.2;
      clip.setKey(0, sk);
      armR.poseRot = 0.2;
      spine.poseRot = 0.08;
      clip.setKey(0.4, sk);
      armR.poseRot = -1.2;
      spine.poseRot = -0.08;
      clip.setKey(0.8, sk);
      armR.poseRot = 0.2;
      spine.poseRot = 0.08;
      clip.setKey(1.2, sk);
      armR.poseRot = -1.2;
      clip.setKey(1.5, sk);

      state.animations = [clip];
      state.currentAnim = 0;
      state.time = 0;
      state.playing = true;
      state.loop = true;
      state.mode = 'animate';
      clearSelection();
      $('modeRig').classList.toggle('active', false);
      $('modeAnimate').classList.toggle('active', true);
      refreshPanels();
      toast('Ready-to-test character loaded! Hit ▶ Test in Game.');
    };
    img.src = c.toDataURL('image/png');
  }

  // --------------------------------------------------------- hit testing

  function stagePoint(ev) {
    let r = stage.getBoundingClientRect();
    let sx = ev.clientX - r.left, sy = ev.clientY - r.top;
    let sw = stage.clientWidth, sh = stage.clientHeight;
    let cx = state.cameraX, cy = state.cameraY, cz = state.cameraZoom;
    let wx = (sx - sw / 2) / cz + sw / 2 - cx;
    let wy = (sy - sh / 2) / cz + sh / 2 - cy;
    return { x: wx, y: wy };
  }

  function pickBone(x, y, restOnly) {
    let segs = state.skeleton.worldSegments(restOnly);
    let best = -1, bestD = 10;
    for (let i = 0; i < segs.length; i++) {
      let s = segs[i];
      let d = M.distToSegment(x, y, s.x0, s.y0, s.x1, s.y1);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  function pickTip(x, y, restOnly) {
    let segs = state.skeleton.worldSegments(restOnly);
    let best = -1, bestD = 12;
    for (let i = 0; i < segs.length; i++) {
      let d = Math.hypot(x - segs[i].x1, y - segs[i].y1);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  function pickOrigin(x, y) {
    let segs = state.skeleton.worldSegments(true);
    let best = -1, bestD = 12;
    for (let i = 0; i < segs.length; i++) {
      let d = Math.hypot(x - segs[i].x0, y - segs[i].y0);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  // -------------------------------------------------------- pointer input

  function onPointerDown(ev) {
    if (!state.image) return;
    scheduleRender();
    stage.setPointerCapture(ev.pointerId);
    let p = stagePoint(ev);
    let bones = state.skeleton.bones;
    let ctrl = ev.ctrlKey || ev.metaKey;

    if (state.mode === 'rig') {
      if (ev.altKey) {
        let ati = pickTip(p.x, p.y, true);
        if (ati >= 0) {
          setSelection([bones[ati].id]);
          state.drag = { kind: 'tip', boneId: bones[ati].id };
          refreshPanels();
          return;
        }
        let aoi = pickOrigin(p.x, p.y);
        if (aoi >= 0) {
          setSelection([bones[aoi].id]);
          state.drag = { kind: 'origin', boneId: bones[aoi].id };
          refreshPanels();
          return;
        }
        return;
      }

      let ti = pickTip(p.x, p.y, true);
      if (ti >= 0) {
        let seg = state.skeleton.worldSegments(true)[ti];
        state.drag = { kind: 'newbone', parentId: bones[ti].id, sx: seg.x1, sy: seg.y1, ex: p.x, ey: p.y };
        return;
      }
      let bi = pickBone(p.x, p.y, true);
      if (bi >= 0) {
        if (ctrl) { toggleSelection(bones[bi].id); }
        else { setSelection([bones[bi].id]); }
        refreshPanels();
        return;
      }
      if (!ctrl) clearSelection();
      state.drag = { kind: 'newbone', parentId: state.selectedId, sx: p.x, sy: p.y, ex: p.x, ey: p.y };
      return;
    }

    let ai = pickBone(p.x, p.y, false);
    if (ai < 0) { if (!ctrl) clearSelection(); refreshPanels(); return; }
    let bone = bones[ai];
    if (ctrl) { toggleSelection(bone.id); }
    else { setSelection([bone.id]); }
    refreshPanels();
    let m = state.skeleton.worldMatrices(false)[ai];
    if (bone.parentId == null && ev.shiftKey) {
      state.drag = { kind: 'move', boneId: bone.id, lastX: p.x, lastY: p.y };
    } else {
      state.drag = {
        kind: 'rotate', boneId: bone.id,
        ox: m[4], oy: m[5],
        baseAngle: Math.atan2(p.y - m[5], p.x - m[4]),
        basePose: bone.poseRot,
      };
    }
  }

  function onPointerMove(ev) {
    if (!state.drag) return;
    let p = stagePoint(ev);
    let d = state.drag;

    if (d.kind === 'newbone') {
      d.ex = p.x; d.ey = p.y;
      return;
    }

    let bone = state.skeleton.byId(d.boneId);
    if (!bone) { state.drag = null; return; }

    if (d.kind === 'tip') {
      // Re-aim and resize the rest bone so its tip follows the cursor.
      let sk = state.skeleton;
      let ws = sk.worldMatrices(true);
      let bm = ws[sk.indexOf(bone.id)];
      let parentAngle = bone.parentId != null ? M.angleOf(ws[sk.indexOf(bone.parentId)]) : 0;
      let oldLen = bone.length;
      bone.rot = Math.atan2(p.y - bm[5], p.x - bm[4]) - parentAngle;
      bone.length = Math.max(4, Math.hypot(p.x - bm[4], p.y - bm[5]));
      // Children chained to the old tip stay attached to the new one.
      sk.bones.forEach(function (c) {
        if (c.parentId === bone.id && Math.abs(c.x - oldLen) < 3 && Math.abs(c.y) < 3) {
          c.x = bone.length;
          c.y = 0;
        }
      });
      invalidateBind();
      refreshProps();
      scheduleRender();
      return;
    }
    if (d.kind === 'origin') {
      // Move the joint: rewrite the rest offset in the parent's frame.
      let sk2 = state.skeleton;
      let pm = bone.parentId != null ? sk2.worldMatrices(true)[sk2.indexOf(bone.parentId)] : null;
      let lp = pm ? M.apply(M.invert(pm), p.x, p.y) : p;
      bone.x = lp.x;
      bone.y = lp.y;
      invalidateBind();
      refreshProps();
      scheduleRender();
      return;
    }

    if (d.kind === 'rotate') {
      let ang = Math.atan2(p.y - d.oy, p.x - d.ox);
      bone.poseRot = d.basePose + (ang - d.baseAngle);
    } else if (d.kind === 'move') {
      bone.poseX += p.x - d.lastX;
      bone.poseY += p.y - d.lastY;
      d.lastX = p.x; d.lastY = p.y;
    }
    if (state.autoKey) currentClip().setKey(state.time, state.skeleton);
    refreshProps();
    scheduleRender();
  }

  function onPointerUp(ev) {
    let d = state.drag;
    state.drag = null;
    if (!d) return;
    if (d.kind === 'newbone') {
      let len = Math.hypot(d.ex - d.sx, d.ey - d.sy);
      if (len < 8) {
        clearSelection();
        refreshPanels();
        return;
      }
      saveSnapshot();
      let bone = state.skeleton.addBoneWorld(d.parentId, d.sx, d.sy, d.ex, d.ey);
      setSelection([bone.id]);
      invalidateBind();
      refreshPanels();
    } else {
      saveSnapshot();
      refreshPanels();
    }
  }

  // ------------------------------------------------------------ keyboard

  function onKeyDown(ev) {
    let t = ev.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    if (ev.key === 'Delete' || ev.key === 'Backspace') {
      deleteSelectedBone();
      ev.preventDefault();
    } else if (ev.key === ' ') {
      if (state.mode === 'animate') togglePlay();
      ev.preventDefault();
    } else if (ev.key === 'Escape') {
      clearSelection();
      refreshPanels();
    } else if (ev.ctrlKey || ev.metaKey) {
      if (ev.key === 'z' && ev.shiftKey) { redo(); ev.preventDefault(); }
      else if (ev.key === 'z') { undo(); ev.preventDefault(); }
    } else if (state.mode === 'rig' && state.selectedIds.length && ev.key.startsWith('Arrow')) {
      saveSnapshot();
      let step = ev.shiftKey ? 5 : 1;
      let dx = 0, dy = 0;
      if (ev.key === 'ArrowRight') dx = step;
      else if (ev.key === 'ArrowLeft') dx = -step;
      else if (ev.key === 'ArrowDown') dy = step;
      else if (ev.key === 'ArrowUp') dy = -step;
      let ws = state.skeleton.worldMatrices(true);
      state.selectedIds.forEach(function (id) {
        let bone = state.skeleton.byId(id);
        if (!bone) return;
        let pm = bone.parentId != null ? ws[state.skeleton.indexOf(bone.parentId)] : null;
        if (pm) {
          let inv = M.invert(pm);
          bone.x += inv[0] * dx + inv[2] * dy;
          bone.y += inv[1] * dx + inv[3] * dy;
        } else {
          bone.x += dx;
          bone.y += dy;
        }
      });
      invalidateBind();
      refreshProps();
      ev.preventDefault();
    } else if (ev.key === '1') {
      setMode('rig');
    } else if (ev.key === '2') {
      setMode('animate');
    }
  }

  function deleteSelectedBone() {
    if (!state.selectedIds.length) return;
    if (state.mode !== 'rig') return toast('Switch to Rig mode (1) to edit bones.');
    saveSnapshot();
    let allDead = [];
    state.selectedIds.slice().forEach(function (sid) {
      let dead = state.skeleton.removeBone(sid);
      allDead = allDead.concat(dead);
    });
    let deadSet = {};
    allDead.forEach(function (id) { deadSet[id] = true; });
    state.animations.forEach(function (clip) {
      clip.keys.forEach(function (k) {
        Object.keys(k.pose).forEach(function (idStr) {
          if (deadSet[Number(idStr)]) delete k.pose[idStr];
        });
      });
    });
    clearSelection();
    invalidateBind();
    refreshPanels();
  }

  function togglePlay() {
    if (state.mode !== 'animate') return;
    let clip = currentClip();
    if (!clip.keys.length) return toast('Add a keyframe first (pose a bone, or press ◆ Key).');
    if (!state.playing && !state.loop && state.time >= clip.duration) state.time = 0;
    state.playing = !state.playing;
    refreshTransport();
    scheduleRender();
  }

  // ------------------------------------------------------- export/import

  function exportJSON() {
    if (!state.image || !state.skeleton.bones.length) return toast('Rig a character first.');
    let data = model.characterToJSON(state);
    let blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    let a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'character.marionette.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    toast('Exported character.marionette.json');
  }

  function importJSON(file) {
    let reader = new FileReader();
    reader.onload = function () {
      let data;
      try { data = JSON.parse(reader.result); } catch (e) { return toast('Not a valid JSON file.'); }
      if (data.format !== 'marionette-character') return toast('Not a Marionette character file.');
      loadImageFromURL(data.image, true, function () {
        state.drawnW = data.drawnW;
        state.drawnH = data.drawnH;
        state.offX = data.offX;
        state.offY = data.offY;
        state.divisions = data.divisions || 20;
        state.skeleton = model.skeletonFromJSON(data);
        state.animations = model.animationsFromJSON(data);
        state.currentAnim = 0;
        clearSelection();
        state.time = 0;
        invalidateBind();
        $('meshDetail').value = state.divisions;
        $('meshDetailVal').textContent = state.divisions;
        $('duration').value = currentClip().duration;
        refreshPanels();
        toast('Character imported.');
      });
    };
    reader.readAsText(file);
  }

  function testInGame() {
    if (!state.image || !state.skeleton.bones.length) return toast('Rig a character first.');
    try {
      localStorage.setItem('marionette.character', JSON.stringify(model.characterToJSON(state)));
    } catch (e) {
      toast('Image too large for the quick handoff — Export instead, then load the file in the game page.');
      return;
    }
    window.open('game.html');
  }

  // ----------------------------------------------------------- UI panels

  function refreshPanels() {
    refreshBoneList();
    refreshProps();
    refreshTransport();
    scheduleRender();
  }

  function refreshBoneList() {
    let ul = $('boneList');
    ul.innerHTML = '';
    let sk = state.skeleton;
    if (!sk.bones.length) {
      let li = document.createElement('li');
      li.textContent = 'No bones yet';
      li.style.color = 'var(--dim)';
      li.style.cursor = 'default';
      ul.appendChild(li);
      return;
    }
    sk.bones.forEach(function (b) {
      let li = document.createElement('li');
      let depth = sk.depthOf(b);
      li.setAttribute('data-depth', depth);
      li.textContent = (depth ? '└ ' : '') + b.name;
      if (isSelected(b.id)) li.classList.add('sel');
      li.onclick = function (ev2) {
        if (ev2.ctrlKey || ev2.metaKey) { toggleSelection(b.id); }
        else { setSelection([b.id]); }
        refreshPanels();
      };
      ul.appendChild(li);
    });
  }

  function refreshProps() {
    let bone = selectedBone();
    let props = $('boneProps');
    props.hidden = !bone && state.selectedIds.length !== 1;
    if (!bone) {
      if (state.selectedIds.length > 1) {
        props.hidden = false;
        $('boneName').value = '';
        $('boneInfo').textContent = state.selectedIds.length + ' bones selected';
      }
      return;
    }
    let nameInput = $('boneName');
    if (document.activeElement !== nameInput) nameInput.value = bone.name;
    let parent = bone.parentId != null ? state.skeleton.byId(bone.parentId) : null;
    let extra = state.selectedIds.length > 1 ? ' · +' + (state.selectedIds.length - 1) + ' more' : '';
    $('boneInfo').textContent =
      'parent: ' + (parent ? parent.name : 'none (root)') +
      ' · length: ' + Math.round(bone.length) + 'px' +
      ' · pose: ' + Math.round(bone.poseRot * 180 / Math.PI) + '°' + extra;
  }

  function refreshTransport() {
    $('btnPlay').textContent = state.playing ? '⏸' : '▶';
    $('timeLabel').textContent = state.time.toFixed(2) + 's';
  }

  // -------------------------------------------------------------- render

  function showLoading(on) {
    loadingEl.classList.toggle('show', on);
  }

  function fitCanvas(cv, context) {
    let dpr = window.devicePixelRatio || 1;
    let w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function applyCamera(ctx, sw, sh) {
    ctx.translate(sw / 2, sh / 2);
    ctx.scale(state.cameraZoom, state.cameraZoom);
    ctx.translate(-sw / 2 + state.cameraX, -sh / 2 + state.cameraY);
  }

  function render() {
    fitCanvas(stage, ctx);
    let w = stage.clientWidth, h = stage.clientHeight;
      ctx.clearRect(0, 0, w, h);
    ctx.save();
    applyCamera(ctx, w, h);

    if (!state.image) {
      ctx.fillStyle = '#3a404b';
      ctx.font = '600 18px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Drop an image here, or use the left panel', w / 2, h / 2 - 12);
      ctx.font = '14px sans-serif';
      ctx.fillText('"Generate sample character" works without any files', w / 2, h / 2 + 14);
      ctx.textAlign = 'left';
      ctx.restore();
      return;
    }

    if (state.mode === 'rig') {
      ctx.drawImage(state.image, state.offX, state.offY, state.drawnW, state.drawnH);
      if (state.showBones) R.drawBones(ctx, state.skeleton, true, state.selectedIds);
      let d = state.drag;
      if (d && d.kind === 'newbone') {
        ctx.save();
        ctx.strokeStyle = '#ffcc44';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(d.sx, d.sy);
        ctx.lineTo(d.ex, d.ey);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(d.sx, d.sy, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#ffcc44';
        ctx.fill();
        ctx.restore();
      }
    } else {
      ensureBound();
      let pos = state.mesh.deform(state.skeleton);
      R.drawMesh(ctx, state.image, state.mesh, pos);
      if (state.showMesh) R.drawWireframe(ctx, state.mesh, pos);
      if (state.showBones) R.drawBones(ctx, state.skeleton, false, state.selectedIds);
    }

    ctx.restore();

    ctx.fillStyle = 'rgba(216,220,227,0.55)';
    ctx.font = '12px sans-serif';
    ctx.fillText(
      state.mode === 'rig'
        ? 'RIG — drag: new bone · Tip: child · Alt: adjust · Arrows: nudge · Ctrl+click: multi · Del: remove'
        : 'ANIMATE — drag a bone to rotate · Shift-drag root to move · Space: play',
      12, h - 12);
    ctx.fillText(Math.round(state.cameraZoom * 100) + '%', w - 48, h - 12);
  }

  // ----------------------------------------------------------------- init

  function init() {
    stage = $('stage');
    ctx = stage.getContext('2d');
    toastEl = $('toast');
    loadingEl = $('loading');

    stage.addEventListener('pointerdown', onPointerDown);
    stage.addEventListener('pointermove', onPointerMove);
    stage.addEventListener('pointerup', onPointerUp);
    stage.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('keydown', onKeyDown);
    stage.addEventListener('wheel', function (e) {
      e.preventDefault();
      state.cameraZoom = Math.max(0.1, Math.min(5, state.cameraZoom - e.deltaY * 0.002 * state.cameraZoom));
    }, { passive: false });

    stage.addEventListener('dragover', function (e) { e.preventDefault(); });
    stage.addEventListener('drop', function (e) {
      e.preventDefault();
      if (e.dataTransfer.files.length) loadImageFile(e.dataTransfer.files[0]);
    });

    $('modeRig').onclick = function () { setMode('rig'); };
    $('modeAnimate').onclick = function () { setMode('animate'); };
    $('btnLoadImage').onclick = function () { $('imageFile').click(); };
    $('imageFile').onchange = function (e) {
      if (e.target.files.length) loadImageFile(e.target.files[0]);
      e.target.value = '';
    };
    $('btnSample').onclick = generateSample;
    $('btnReadyChar').onclick = generateReadyCharacter;
    $('btnAutoRig').onclick = autoDetectSkeleton;
    $('btnHumanoid').onclick = addHumanoid;
    $('btnExport').onclick = exportJSON;
    $('btnImport').onclick = function () { $('importFile').click(); };
    $('importFile').onchange = function (e) {
      if (e.target.files.length) importJSON(e.target.files[0]);
      e.target.value = '';
    };
    $('btnTest').onclick = testInGame;
    $('btnDeleteBone').onclick = deleteSelectedBone;

    $('boneName').oninput = function (e) {
      let bone = selectedBone();
      if (bone) { bone.name = e.target.value || bone.name; refreshBoneList(); }
    };

    $('btnZoomIn').onclick = function () { state.cameraZoom = Math.min(5, state.cameraZoom * 1.3); scheduleRender(); };
    $('btnZoomOut').onclick = function () { state.cameraZoom = Math.max(0.1, state.cameraZoom / 1.3); scheduleRender(); };
    $('btnZoomReset').onclick = function () {
      state.cameraX = 0; state.cameraY = 0; state.cameraZoom = 1; scheduleRender();
    };

    let animSel = $('animSelect');
    function refreshAnimSelect() {
      let cur = state.currentAnim;
      animSel.innerHTML = '';
      state.animations.forEach(function (a, i) {
        let opt = document.createElement('option');
        opt.value = i;
        opt.textContent = a.name;
        animSel.appendChild(opt);
      });
      animSel.value = cur;
    }
    refreshAnimSelect();
    animSel.onchange = function () {
      state.currentAnim = parseInt(this.value, 10);
      state.time = Math.min(state.time, currentClip().duration);
      setMode(state.mode);
      refreshPanels();
    };

    $('btnUndo').onclick = function () { undo(); };
    $('btnRedo').onclick = function () { redo(); };

    $('meshDetail').oninput = function (e) {
      state.divisions = parseInt(e.target.value, 10);
      $('meshDetailVal').textContent = state.divisions;
      invalidateBind();
      scheduleRender();
    };
    $('chkMesh').onchange = function (e) { state.showMesh = e.target.checked; scheduleRender(); };
    $('chkBones').onchange = function (e) { state.showBones = e.target.checked; scheduleRender(); };

    refreshPanels();
  }

  return {
    state: state,
    currentClip: currentClip,
    saveSnapshot: saveSnapshot,
    init: init,
    render: render,
    setMode: setMode,
    togglePlay: togglePlay,
    refreshTransport: refreshTransport,
    toast: toast,
  };
})();
