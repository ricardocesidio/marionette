/* Marionette — Mirror Rig engine.
 *
 * Mirrors bones, poses and animation across a symmetry axis. DOM-free so it
 * runs in the editor and in Node for tests, like model.js / autorig.js.
 *
 * Directions: 'lr' left→right, 'rl' right→left (vertical axis),
 *             'tb' top→bottom, 'bt' bottom→top (horizontal axis).
 * Axis:       { type: 'vertical'|'horizontal', value: number } in stage space.
 *
 * Bone geometry is mirrored in WORLD space — reflect each rest segment's
 * origin and tip across the axis, then rebuild the local transform via the
 * skeleton's own localFromWorld(). Reflection is an isometry, so bone length
 * is preserved exactly and origin/tip land where you'd expect; rebuilding
 * through the mirrored parent keeps the hierarchy and angles correct.
 */
var RIG = RIG || {};

RIG.mirror = (function () {
  'use strict';

  function isVertical(direction) {
    return direction === 'lr' || direction === 'rl';
  }

  function reflect(axis, x, y) {
    if (axis.type === 'vertical') return { x: 2 * axis.value - x, y: y };
    return { x: x, y: 2 * axis.value - y };
  }

  // ----------------------------------------------------------- naming

  function matchCase(sample, repl) {
    if (sample === sample.toUpperCase() && sample !== sample.toLowerCase()) {
      return repl.toUpperCase();
    }
    if (sample[0] === sample[0].toUpperCase() && sample[0] !== sample[0].toLowerCase()) {
      return repl[0].toUpperCase() + repl.slice(1);
    }
    return repl.toLowerCase();
  }

  // Case-preserving whole-token swap of aWord <-> bWord. Token boundaries are
  // any non-letter (so '_', '-', '.' and spaces all delimit, unlike \b which
  // counts '_' as a word character and would miss left_arm / arm_R).
  function swapToken(name, aWord, bWord) {
    let re = new RegExp('(^|[^A-Za-z])(' + aWord + '|' + bWord + ')(?![A-Za-z])', 'gi');
    let changed = false;
    let out = name.replace(re, function (full, pre, tok) {
      changed = true;
      let repl = tok.toLowerCase() === aWord ? bWord : aWord;
      return pre + matchCase(tok, repl);
    });
    return { name: out, changed: changed };
  }

  /* left_arm → right_arm, arm.L → arm.R, arm_R → arm_L, top_wing →
   * bottom_wing, wing.Top → wing.Bottom. When no side token is present,
   * append the target side: .L/.R for left/right, .Top/.Bottom for top/bottom. */
  function mirrorName(name, direction) {
    if (isVertical(direction)) {
      let w = swapToken(name, 'left', 'right');
      if (w.changed) return w.name;
      let s = swapToken(name, 'l', 'r'); // delimited single-letter tokens
      if (s.changed) return s.name;
      return name + (direction === 'lr' ? '.R' : '.L');
    }
    let w = swapToken(name, 'top', 'bottom');
    if (w.changed) return w.name;
    return name + (direction === 'tb' ? '.Bottom' : '.Top');
  }

  function hasToken(name, word) {
    return new RegExp('(^|[^A-Za-z])' + word + '(?![A-Za-z])', 'i').test(name);
  }

  // Which side a bone name already declares, or null.
  function nameSide(name) {
    if (hasToken(name, 'left')) return 'left';
    if (hasToken(name, 'right')) return 'right';
    if (hasToken(name, 'l')) return 'left';
    if (hasToken(name, 'r')) return 'right';
    if (hasToken(name, 'top')) return 'top';
    if (hasToken(name, 'bottom')) return 'bottom';
    return null;
  }

  function sourceSideOf(direction) {
    return { lr: 'left', rl: 'right', tb: 'top', bt: 'bottom' }[direction];
  }

  function uniqueName(taken, base) {
    if (!taken[base]) return base;
    let i = 2;
    while (taken[base + '.' + i]) i++;
    return base + '.' + i;
  }

  // ------------------------------------------------------------- bones

  /* Mirror the given source bones across the axis.
   * opts: { sourceIds, direction, axis, conflict:'update'|'copy'|'skip' }
   * Returns { created, updated, skipped, idMap } (idMap: srcId → target bone). */
  function mirrorBones(skeleton, opts) {
    let axis = opts.axis, direction = opts.direction;
    let conflict = opts.conflict || 'update';
    let inSource = {};
    (opts.sourceIds || []).forEach(function (id) { inSource[id] = true; });

    // Snapshot + reflect each source bone's rest segment up front; these world
    // origin/tip points are invariant under the mutations that follow.
    let segs = skeleton.worldSegments(true);
    let world = {};
    skeleton.bones.forEach(function (b, i) {
      if (!inSource[b.id]) return;
      let o = reflect(axis, segs[i].x0, segs[i].y0);
      let t = reflect(axis, segs[i].x1, segs[i].y1);
      world[b.id] = { ox: o.x, oy: o.y, tx: t.x, ty: t.y };
    });

    let byName = {};
    skeleton.bones.forEach(function (b) { byName[b.name] = b; });

    let idMap = {};
    let created = [], updated = [], skipped = [];
    let targetWorld = {}; // mirror bone id → { ox, oy, tx, ty, parentId }

    // Parents precede children in bone order, so resolving in order means a
    // mirrored parent already has an idMap entry before its children are seen.
    skeleton.bones.slice().forEach(function (src) {
      if (!inSource[src.id]) return;
      let w = world[src.id];

      let mpId = null;
      if (src.parentId != null) {
        if (inSource[src.parentId] && idMap[src.parentId]) mpId = idMap[src.parentId].id;
        else mpId = src.parentId; // attach to the shared / original parent
      }

      let tname = mirrorName(src.name, direction);
      let existing = byName[tname];
      if (existing && existing.id === src.id) existing = null; // never onto self

      let target;
      if (existing && conflict === 'skip') {
        skipped.push(existing);
        idMap[src.id] = existing; // children may still parent under it
        return;
      } else if (existing && conflict === 'update') {
        target = existing;
        target.parentId = mpId;
        updated.push(target);
      } else {
        if (existing) tname = uniqueName(byName, tname); // 'copy'
        target = new RIG.model.Bone({ parentId: mpId, name: tname });
        skeleton.bones.push(target);
        byName[tname] = target;
        created.push(target);
      }

      idMap[src.id] = target;
      targetWorld[target.id] = { ox: w.ox, oy: w.oy, tx: w.tx, ty: w.ty, parentId: mpId };
    });

    // Guarantee parents-before-children, then bake local transforms. Walking
    // in order means each target's parent frame is finalized before it is read.
    skeleton.reorder();
    skeleton.bones.forEach(function (b) {
      let tw = targetWorld[b.id];
      if (!tw) return;
      let lp = skeleton.localFromWorld(tw.parentId, tw.ox, tw.oy, tw.tx, tw.ty);
      b.parentId = lp.parentId;
      b.x = lp.x;
      b.y = lp.y;
      b.rot = lp.rot;
      b.length = lp.length;
    });

    return { created: created, updated: updated, skipped: skipped, idMap: idMap };
  }

  // -------------------------------------------------- pose / animation

  // Source→target bone pairs matched by mirrored name.
  function pairBones(skeleton, opts) {
    let byName = {};
    skeleton.bones.forEach(function (b) { byName[b.name] = b; });
    let src;
    if (opts.sourceIds && opts.sourceIds.length) {
      src = opts.sourceIds.map(function (id) { return skeleton.byId(id); }).filter(Boolean);
    } else {
      let side = sourceSideOf(opts.direction);
      src = skeleton.bones.filter(function (b) { return nameSide(b.name) === side; });
    }
    let pairs = [];
    src.forEach(function (s) {
      let t = byName[mirrorName(s.name, opts.direction)];
      if (t && t.id !== s.id) pairs.push({ s: s, t: t });
    });
    return pairs;
  }

  // Mirror a local pose delta. Rotation negates (the target's rest frame is the
  // reflection of the source's); translation flips on the mirrored axis only.
  function mirrorDelta(rot, x, y, vertical) {
    return vertical
      ? { rot: -rot, x: -x, y: y }
      : { rot: -rot, x: x, y: -y };
  }

  /* Copy the current pose from each source bone to its mirrored counterpart.
   * Does not create bones. opts: { direction, axis?, sourceIds? }. */
  function mirrorPose(skeleton, opts) {
    let pairs = pairBones(skeleton, opts);
    let vertical = isVertical(opts.direction);
    pairs.forEach(function (p) {
      let d = mirrorDelta(p.s.poseRot, p.s.poseX, p.s.poseY, vertical);
      p.t.poseRot = d.rot;
      p.t.poseX = d.x;
      p.t.poseY = d.y;
    });
    return { applied: pairs.length, pairs: pairs };
  }

  /* Mirror keyframed pose values from each source bone onto its counterpart,
   * over opts.range = { t0, t1 } (defaults to the whole clip). Timing and
   * easing are preserved. opts: { direction, range?, sourceIds? }. */
  function mirrorAnimation(clip, skeleton, opts) {
    let pairs = pairBones(skeleton, opts);
    let vertical = isVertical(opts.direction);
    let range = opts.range;
    let keys = 0;
    clip.keys.forEach(function (k) {
      if (range && (k.t < range.t0 - 1e-6 || k.t > range.t1 + 1e-6)) return;
      pairs.forEach(function (p) {
        let sp = k.pose[p.s.id] || { rot: 0, x: 0, y: 0 };
        k.pose[p.t.id] = mirrorDelta(sp.rot, sp.x, sp.y, vertical);
      });
      keys++;
    });
    return { pairs: pairs.length, keys: keys };
  }

  return {
    reflect: reflect,
    mirrorName: mirrorName,
    nameSide: nameSide,
    mirrorBones: mirrorBones,
    mirrorPose: mirrorPose,
    mirrorAnimation: mirrorAnimation,
  };
})();
