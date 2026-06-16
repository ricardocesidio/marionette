/* Marionette — core data model. DOM-free so it runs in the editor, the game
 * runtime, and in Node for tests.
 *
 * Concepts (same architecture as Spine / Godot Skeleton2D):
 *   Bone     — local transform relative to its parent (rest pose + pose deltas)
 *   Skeleton — ordered bone list (parents always before children)
 *   Mesh     — grid of vertices over the image; bound to bones with
 *              auto-computed weights; deformed by linear blend skinning
 *   Clip     — keyframed animation of bone pose values
 */
var RIG = RIG || {};

(function () {
  'use strict';
  let M = RIG.math;

  let AUTO_WEIGHT_K = 4;
  let AUTO_WEIGHT_POW = 2;
  let WEIGHT_SMOOTH_PASSES = 2;
  let TRI_EXPAND = 0.75;
  let HIT_TOLERANCE = 10;
  let TIP_TOLERANCE = 12;
  let MIN_BONE_LENGTH = 4;
  let MIN_DRAG_LENGTH = 8;
  let KEY_TOLERANCE = 1e-4;
  let ID_REUSE_GUARD = 1; // ensures nextId stays ahead

  let nextId = 1;

  // ---------------------------------------------------------------- Bone

  class Bone {
    constructor(opts) {
      opts = opts || {};
      this.id = opts.id != null ? opts.id : nextId++;
      if (this.id >= nextId) nextId = this.id + ID_REUSE_GUARD;
      this.name = opts.name || ('bone ' + this.id);
      this.parentId = opts.parentId != null ? opts.parentId : null;
      this.x = opts.x || 0;
      this.y = opts.y || 0;
      this.rot = opts.rot || 0;
      this.length = opts.length || 0;
      this.poseRot = 0;
      this.poseX = 0;
      this.poseY = 0;
    }
  }

  // ------------------------------------------------------------ Skeleton

  class Skeleton {
    constructor() {
      this.bones = [];
    }

    byId(id) {
      for (let i = 0; i < this.bones.length; i++) {
        if (this.bones[i].id === id) return this.bones[i];
      }
      return null;
    }

    indexOf(id) {
      for (let i = 0; i < this.bones.length; i++) {
        if (this.bones[i].id === id) return i;
      }
      return -1;
    }

    depthOf(bone) {
      let d = 0, b = bone;
      while (b && b.parentId != null) {
        b = this.byId(b.parentId);
        d++;
      }
      return d;
    }

    // World matrices in bone order. restOnly=true ignores pose deltas.
    worldMatrices(restOnly) {
      let out = [];
      let indexById = {};
      for (let i = 0; i < this.bones.length; i++) {
        let b = this.bones[i];
        let rot = restOnly ? b.rot : b.rot + b.poseRot;
        let x = restOnly ? b.x : b.x + b.poseX;
        let y = restOnly ? b.y : b.y + b.poseY;
        let local = M.rotTrans(rot, x, y);
        out.push(b.parentId == null ? local : M.multiply(out[indexById[b.parentId]], local));
        indexById[b.id] = i;
      }
      return out;
    }

    // Bone segments (origin -> tip) in world space, in bone order.
    worldSegments(restOnly) {
      let ws = this.worldMatrices(restOnly);
      return this.bones.map(function (b, i) {
        let m = ws[i];
        let tip = M.apply(m, b.length, 0);
        return { x0: m[4], y0: m[5], x1: tip.x, y1: tip.y };
      });
    }

    // Create a bone from two world-space points (rest pose).
    addBoneWorld(parentId, sx, sy, ex, ey) {
      let x = sx, y = sy, parentAngle = 0;
      if (parentId != null) {
        let pi = this.indexOf(parentId);
        if (pi < 0) { parentId = null; }
        else {
          let inv = M.invert(this.worldMatrices(true)[pi]);
          let p = M.apply(inv, sx, sy);
          x = p.x;
          y = p.y;
          parentAngle = M.angleOf(this.worldMatrices(true)[pi]);
        }
      }
      let bone = new Bone({
        parentId: parentId,
        x: x,
        y: y,
        rot: Math.atan2(ey - sy, ex - sx) - parentAngle,
        length: Math.hypot(ex - sx, ey - sy),
      });
      this.bones.push(bone);
      return bone;
    }

    // Remove a bone and all of its descendants. Returns removed ids.
    removeBone(id) {
      let dead = {};
      dead[id] = true;
      let changed = true;
      while (changed) {
        changed = false;
        for (let i = 0; i < this.bones.length; i++) {
          let b = this.bones[i];
          if (b.parentId != null && dead[b.parentId] && !dead[b.id]) {
            dead[b.id] = true;
            changed = true;
          }
        }
      }
      this.bones = this.bones.filter(function (b) { return !dead[b.id]; });
      return Object.keys(dead).map(Number);
    }

    resetPose() {
      this.bones.forEach(function (b) {
        b.poseRot = 0;
        b.poseX = 0;
        b.poseY = 0;
      });
    }
  }

  // ---------------------------------------------------------------- Mesh

  class Mesh {
    /* opts: natW/natH   image pixel size (texture space)
     *       drawnW/drawnH  size the image occupies on the stage
     *       offX/offY   stage position of the image's top-left corner
     *       divisions   grid cells along the longer side
     */
    constructor(opts) {
      this.opts = opts;
      let longSide = Math.max(opts.drawnW, opts.drawnH);
      let cell = longSide / Math.max(1, opts.divisions);
      this.cols = Math.max(1, Math.round(opts.drawnW / cell));
      this.rows = Math.max(1, Math.round(opts.drawnH / cell));

      this.verts = [];
      this.uvs = [];
      for (let r = 0; r <= this.rows; r++) {
        for (let c = 0; c <= this.cols; c++) {
          let fx = c / this.cols, fy = r / this.rows;
          this.verts.push(opts.offX + fx * opts.drawnW, opts.offY + fy * opts.drawnH);
          this.uvs.push(fx * opts.natW, fy * opts.natH);
        }
      }

      this.tris = []; // index triplets
      for (let rr = 0; rr < this.rows; rr++) {
        for (let cc = 0; cc < this.cols; cc++) {
          let i0 = rr * (this.cols + 1) + cc;
          let i1 = i0 + 1;
          let i2 = i0 + this.cols + 1;
          let i3 = i2 + 1;
          this.tris.push(i0, i2, i1, i1, i2, i3);
        }
      }

      this.weights = null;  // per-vertex: [{b: boneIndex, w}, ...]
      this.invRest = null;  // per-bone inverse rest world matrix
      this.deformed = new Float32Array(this.verts.length);
    }

    bind(skeleton) {
      let segs = skeleton.worldSegments(true);
      this.invRest = skeleton.worldMatrices(true).map(M.invert);
      this.weights = [];
      let vertCount = this.verts.length / 2;
      for (let i = 0; i < vertCount; i++) {
        let px = this.verts[i * 2], py = this.verts[i * 2 + 1];
        let ds = segs.map(function (s, bi) {
          return { b: bi, d: Math.max(0.001, M.distToSegment(px, py, s.x0, s.y0, s.x1, s.y1)) };
        });
        ds.sort(function (a, b) { return a.d - b.d; });
        let near = ds.slice(0, Math.min(AUTO_WEIGHT_K, ds.length));
        let sum = 0;
        near.forEach(function (n) { n.w = 1 / Math.pow(n.d, AUTO_WEIGHT_POW); sum += n.w; });
        this.weights.push(near.map(function (n) { return { b: n.b, w: n.w / sum }; }));
      }
      this.smoothWeights();
    }

    smoothWeights() {
      let cols = this.cols + 1;
      let rows = this.rows + 1;
      for (let pass = 0; pass < WEIGHT_SMOOTH_PASSES; pass++) {
        let newWeights = [];
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            let idx = r * cols + c;
            let neighbors = [idx];
            if (c > 0) neighbors.push(idx - 1);
            if (c < cols - 1) neighbors.push(idx + 1);
            if (r > 0) neighbors.push(idx - cols);
            if (r < rows - 1) neighbors.push(idx + cols);
            let boneMap = {};
            let total = 0;
            neighbors.forEach(function (ni) {
              let wl = this.weights[ni];
              if (!wl) return;
              wl.forEach(function (w) {
                boneMap[w.b] = (boneMap[w.b] || 0) + w.w;
                total += w.w;
              });
            }, this);
            let merged = [];
            if (total > 0) {
              for (let b in boneMap) {
                merged.push({ b: Number(b), w: boneMap[b] / total });
              }
            }
            merged.sort(function (a, b) { return b.w - a.w; });
            newWeights.push(merged.slice(0, AUTO_WEIGHT_K));
          }
        }
        this.weights = newWeights;
      }
    }

    // Linear blend skinning: v' = Σ w · (Wcurrent · Wrest⁻¹) · v
    analyzeVisibility(img) {
      let c = document.createElement('canvas');
      c.width = img.naturalWidth || img.width;
      c.height = img.naturalHeight || img.height;
      let g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      let pixels;
      try { pixels = g.getImageData(0, 0, c.width, c.height).data; } catch (e) { this.visTris = null; return; }
      this.visTris = [];
      let tris = this.tris, uvs = this.uvs;
      for (let i = 0; i < tris.length; i += 3) {
        let i0 = tris[i] * 2, i1 = tris[i + 1] * 2, i2 = tris[i + 2] * 2;
        let u0 = Math.round(uvs[i0]), v0 = Math.round(uvs[i0 + 1]);
        let u1 = Math.round(uvs[i1]), v1 = Math.round(uvs[i1 + 1]);
        let u2 = Math.round(uvs[i2]), v2 = Math.round(uvs[i2 + 1]);
        let minU = Math.max(0, Math.min(u0, u1, u2));
        let maxU = Math.min(c.width - 1, Math.max(u0, u1, u2));
        let minV = Math.max(0, Math.min(v0, v1, v2));
        let maxV = Math.min(c.height - 1, Math.max(v0, v1, v2));
        let visible = false;
        let step = 2;
        for (let uv = minV; uv <= maxV && !visible; uv += step) {
          for (let uu = minU; uu <= maxU && !visible; uu += step) {
            if (pixels[(uv * c.width + uu) * 4 + 3] > 10) visible = true;
          }
        }
        if (visible) this.visTris.push(tris[i], tris[i + 1], tris[i + 2]);
      }
    }

    deform(skeleton) {
      let cur = skeleton.worldMatrices(false);
      let invRest = this.invRest;
      let D = cur.map(function (w, i) { return M.multiply(w, invRest[i]); });
      let out = this.deformed;
      for (let i = 0, vi = 0; i < this.weights.length; i++, vi += 2) {
        let x = this.verts[vi], y = this.verts[vi + 1];
        let ox = 0, oy = 0;
        let ws = this.weights[i];
        for (let k = 0; k < ws.length; k++) {
          let m = D[ws[k].b], w = ws[k].w;
          ox += w * (m[0] * x + m[2] * y + m[4]);
          oy += w * (m[1] * x + m[3] * y + m[5]);
        }
        out[vi] = ox;
        out[vi + 1] = oy;
      }
      return out;
    }
  }

  // ---------------------------------------------------------------- Clip

  let ZERO_POSE = { rot: 0, x: 0, y: 0 };
  let EASING_LINEAR = 'linear';
  let EASING_IN = 'ease-in';
  let EASING_OUT = 'ease-out';
  let EASING_IN_OUT = 'ease-in-out';
  let EASING_FUNCS = {};
  EASING_FUNCS[EASING_LINEAR] = function (t) { return t; };
  EASING_FUNCS[EASING_IN] = function (t) { return t * t; };
  EASING_FUNCS[EASING_OUT] = function (t) { return t * (2 - t); };
  EASING_FUNCS[EASING_IN_OUT] = function (t) { return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; };

  class Clip {
    constructor(name, duration) {
      this.name = name || 'idle';
      this.duration = duration || 2;
      this.keys = [];
    }

    setKey(t, skeleton, easing) {
      t = Math.round(t * 1000) / 1000;
      let pose = {};
      skeleton.bones.forEach(function (b) {
        pose[b.id] = { rot: b.poseRot, x: b.poseX, y: b.poseY };
      });
      for (let i = 0; i < this.keys.length; i++) {
        if (Math.abs(this.keys[i].t - t) < KEY_TOLERANCE) {
          this.keys[i].pose = pose;
          if (easing) this.keys[i].easing = easing;
          return this.keys[i];
        }
      }
      let key = { t: t, pose: pose };
      if (easing && easing !== EASING_LINEAR) key.easing = easing;
      this.keys.push(key);
      this.keys.sort(function (a, b) { return a.t - b.t; });
      return key;
    }

    removeKeyAt(t, tol) {
      tol = tol == null ? 0.05 : tol;
      let before = this.keys.length;
      this.keys = this.keys.filter(function (k) { return Math.abs(k.t - t) > tol; });
      return this.keys.length !== before;
    }

    keyNear(t, tol) {
      for (let i = 0; i < this.keys.length; i++) {
        if (Math.abs(this.keys[i].t - t) <= tol) return this.keys[i];
      }
      return null;
    }

    apply(t, skeleton, loop) {
      let ks = this.keys;
      if (!ks.length) return;
      if (ks.length === 1) return applyPose(ks[0].pose, ks[0].pose, 0, ks[0].easing, skeleton);

      let first = ks[0], last = ks[ks.length - 1];
      let a, b, alpha;
      if (t < first.t || t > last.t) {
        if (loop && this.duration > 0) {
          let span = (this.duration - last.t) + first.t;
          if (span <= 1e-6) return applyPose(first.pose, first.pose, 0, first.easing, skeleton);
          let into = t > last.t ? (t - last.t) : (t + this.duration - last.t);
          a = last; b = first;
          alpha = Math.max(0, Math.min(1, into / span));
        } else {
          let p = t < first.t ? first.pose : last.pose;
          return applyPose(p, p, 0, null, skeleton);
        }
      } else {
        let i = ks.length - 2;
        while (i > 0 && ks[i].t > t) i--;
        a = ks[i]; b = ks[i + 1];
        alpha = (t - a.t) / Math.max(1e-6, b.t - a.t);
        alpha = Math.max(0, Math.min(1, alpha));
      }
      applyPose(a.pose, b.pose, alpha, a.easing, skeleton);
    }
  }

  function applyPose(poseA, poseB, alpha, easing, skeleton) {
    let fn = EASING_FUNCS[easing] || EASING_FUNCS[EASING_LINEAR];
    let ea = fn(alpha);
    skeleton.bones.forEach(function (b) {
      let pa = poseA[b.id] || ZERO_POSE;
      let pb = poseB[b.id] || ZERO_POSE;
      b.poseRot = M.lerp(pa.rot, pb.rot, ea);
      b.poseX = M.lerp(pa.x, pb.x, ea);
      b.poseY = M.lerp(pa.y, pb.y, ea);
    });
  }

  // ------------------------------------------------------ Skeleton presets

  /* Humanoid template: [name, parentName, fx0, fy0, fx1, fy1] where the
   * coordinates are fractions of the drawn image box. Parents are listed
   * before children, as worldMatrices() requires. */
  let HUMANOID_TEMPLATE = [
    ['hips',          null,            0.50, 0.60, 0.50, 0.52],
    ['spine',         'hips',          0.50, 0.52, 0.50, 0.40],
    ['chest',         'spine',         0.50, 0.40, 0.50, 0.30],
    ['neck',          'chest',         0.50, 0.30, 0.50, 0.25],
    ['head',          'neck',          0.50, 0.25, 0.50, 0.10],
    ['left arm',      'chest',         0.44, 0.33, 0.32, 0.45],
    ['left forearm',  'left arm',      0.32, 0.45, 0.22, 0.56],
    ['left hand',     'left forearm',  0.22, 0.56, 0.17, 0.62],
    ['right arm',     'chest',         0.56, 0.33, 0.68, 0.45],
    ['right forearm', 'right arm',     0.68, 0.45, 0.78, 0.56],
    ['right hand',    'right forearm', 0.78, 0.56, 0.83, 0.62],
    ['left thigh',    'hips',          0.46, 0.62, 0.44, 0.78],
    ['left shin',     'left thigh',    0.44, 0.78, 0.43, 0.93],
    ['left foot',     'left shin',     0.43, 0.93, 0.37, 0.96],
    ['right thigh',   'hips',          0.54, 0.62, 0.56, 0.78],
    ['right shin',    'right thigh',   0.56, 0.78, 0.57, 0.93],
    ['right foot',    'right shin',    0.57, 0.93, 0.63, 0.96],
  ];

  // Build a full named humanoid rig fitted to an image box
  // ({offX, offY, drawnW, drawnH} in stage coordinates).
  function humanoidSkeleton(box) {
    let sk = new Skeleton();
    let byName = {};
    HUMANOID_TEMPLATE.forEach(function (t) {
      let parent = t[1] ? byName[t[1]] : null;
      let bone = sk.addBoneWorld(
        parent ? parent.id : null,
        box.offX + t[2] * box.drawnW, box.offY + t[3] * box.drawnH,
        box.offX + t[4] * box.drawnW, box.offY + t[5] * box.drawnH);
      bone.name = t[0];
      byName[t[0]] = bone;
    });
    return sk;
  }

  // -------------------------------------------------------- Serialization

  function characterToJSON(state) {
    return {
      format: 'marionette-character',
      version: 1,
      image: state.imageURL,
      natW: state.natW, natH: state.natH,
      drawnW: state.drawnW, drawnH: state.drawnH,
      offX: state.offX, offY: state.offY,
      divisions: state.divisions,
      bones: state.skeleton.bones.map(function (b) {
        return { id: b.id, name: b.name, parentId: b.parentId, x: b.x, y: b.y, rot: b.rot, length: b.length };
      }),
      animations: state.animations.map(function (c) {
        return { name: c.name, duration: c.duration, keys: c.keys };
      }),
    };
  }

  function skeletonFromJSON(data) {
    let sk = new Skeleton();
    let ids = [];
    (data.bones || []).forEach(function (b) {
      sk.bones.push(new Bone(b));
      ids.push(b.id);
    });
    if (ids.length) nextId = Math.max.apply(null, ids) + 1;
    return sk;
  }

  function clipFromJSON(data) {
    let a = (data.animations && data.animations[0]) || null;
    let clip = new Clip(a ? a.name : 'idle', a ? a.duration : 2);
    if (a && a.keys) clip.keys = a.keys;
    return clip;
  }

  function animationsFromJSON(data) {
    let list = data.animations || [{ name: 'idle', duration: 2 }];
    return list.map(function (a) {
      let c = new Clip(a.name, a.duration);
      if (a.keys) c.keys = a.keys;
      return c;
    });
  }

  RIG.model = {
    Bone: Bone,
    Skeleton: Skeleton,
    Mesh: Mesh,
    Clip: Clip,
    humanoidSkeleton: humanoidSkeleton,
    characterToJSON: characterToJSON,
    skeletonFromJSON: skeletonFromJSON,
    clipFromJSON: clipFromJSON,
    animationsFromJSON: animationsFromJSON,
    EASING_LINEAR: EASING_LINEAR,
    EASING_IN: EASING_IN,
    EASING_OUT: EASING_OUT,
    EASING_IN_OUT: EASING_IN_OUT,
  };
})();
