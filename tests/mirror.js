/* Marionette — Mirror Rig test suite. Run via tests/run.sh
 * (concatenates math2d.js + model.js + autorig.js + mirror.js + this file). */
'use strict';

var failures = 0, passes = 0;

function approx(actual, expected, msg, eps) {
  eps = eps || 1e-6;
  if (Math.abs(actual - expected) > eps) {
    failures++;
    console.error('FAIL ' + msg + ': expected ' + expected + ', got ' + actual);
  } else {
    passes++;
  }
}

function eq(actual, expected, msg) {
  if (actual !== expected) {
    failures++;
    console.error('FAIL ' + msg + ': expected ' + expected + ', got ' + actual);
  } else {
    passes++;
  }
}

function ok(cond, msg) {
  if (!cond) { failures++; console.error('FAIL ' + msg); } else { passes++; }
}

var model = RIG.model, mirror = RIG.mirror;
var V = { type: 'vertical', value: 125 };

// ---- smart naming ----------------------------------------------------------

(function () {
  eq(mirror.mirrorName('left_arm', 'lr'), 'right_arm', 'left_arm → right_arm');
  eq(mirror.mirrorName('right_arm', 'rl'), 'left_arm', 'right_arm → left_arm');
  eq(mirror.mirrorName('Left Arm', 'lr'), 'Right Arm', 'case preserved (Title)');
  eq(mirror.mirrorName('arm.L', 'lr'), 'arm.R', 'arm.L → arm.R');
  eq(mirror.mirrorName('arm_R', 'rl'), 'arm_L', 'arm_R → arm_L');
  eq(mirror.mirrorName('top_wing', 'tb'), 'bottom_wing', 'top_wing → bottom_wing');
  eq(mirror.mirrorName('bottom_wing', 'bt'), 'top_wing', 'bottom_wing → top_wing');
  eq(mirror.mirrorName('wing.Top', 'tb'), 'wing.Bottom', 'wing.Top → wing.Bottom');
  // No side token → append the target side.
  eq(mirror.mirrorName('arm', 'lr'), 'arm.R', 'append .R when no side token (lr)');
  eq(mirror.mirrorName('arm', 'rl'), 'arm.L', 'append .L when no side token (rl)');
  eq(mirror.mirrorName('wing', 'tb'), 'wing.Bottom', 'append .Bottom when no side token (tb)');
  eq(mirror.mirrorName('wing', 'bt'), 'wing.Top', 'append .Top when no side token (bt)');
})();

// ---- single bone across a vertical axis ------------------------------------

(function () {
  var sk = new model.Skeleton();
  var root = sk.addBoneWorld(null, 100, 100, 150, 100); // +x, length 50

  var res = mirror.mirrorBones(sk, { sourceIds: [root.id], direction: 'lr', axis: V, conflict: 'update' });
  ok(res.created.length === 1, 'single mirror creates one bone');
  ok(sk.bones.length === 2, 'skeleton now has both bones');

  var m = res.idMap[root.id];
  approx(m.length, 50, 'mirror preserves bone length');

  var segs = sk.worldSegments(true);
  var ms = segs[sk.indexOf(m.id)];
  approx(ms.x0, 150, 'mirror origin reflected across x=125');
  approx(ms.y0, 100, 'mirror origin y unchanged');
  approx(ms.x1, 100, 'mirror tip reflected');
  approx(ms.y1, 100, 'mirror tip y unchanged');
  ok(m.parentId === null, 'mirror of a root is a root');
})();

// ---- a chain preserves hierarchy -------------------------------------------

(function () {
  var sk = new model.Skeleton();
  var root = sk.addBoneWorld(null, 100, 100, 150, 100);
  var child = sk.addBoneWorld(root.id, 150, 100, 150, 150); // from tip, +y

  var res = mirror.mirrorBones(sk, {
    sourceIds: [root.id, child.id], direction: 'lr', axis: V, conflict: 'update',
  });
  ok(res.created.length === 2, 'chain mirror creates two bones');

  var mRoot = res.idMap[root.id], mChild = res.idMap[child.id];
  ok(mChild.parentId === mRoot.id, 'mirrored child re-parents under the mirrored root');

  // Parents still precede children after the mirror.
  var seen = {}, ordered = true;
  sk.bones.forEach(function (b) {
    if (b.parentId != null && !seen[b.parentId]) ordered = false;
    seen[b.id] = true;
  });
  ok(ordered, 'bone order stays topological after mirror');

  var segs = sk.worldSegments(true);
  var cs = segs[sk.indexOf(mChild.id)];
  approx(cs.x0, 100, 'mirrored child origin sits on the mirrored root tip');
  approx(cs.y0, 100, 'mirrored child origin y');
  approx(cs.x1, 100, 'mirrored child tip x');
  approx(cs.y1, 150, 'mirrored child tip y (length preserved)');
})();

// ---- update does not duplicate ---------------------------------------------

(function () {
  var sk = new model.Skeleton();
  var arm = sk.addBoneWorld(null, 100, 100, 80, 140);
  arm.name = 'left arm';

  var first = mirror.mirrorBones(sk, { sourceIds: [arm.id], direction: 'lr', axis: V, conflict: 'update' });
  ok(first.created.length === 1, 'first mirror creates right arm');
  ok(!!sk.byId(first.idMap[arm.id].id), 'right arm exists');
  eq(first.idMap[arm.id].name, 'right arm', 'mirrored name is right arm');
  ok(sk.bones.length === 2, 'two bones after first mirror');

  var second = mirror.mirrorBones(sk, { sourceIds: [arm.id], direction: 'lr', axis: V, conflict: 'update' });
  ok(second.created.length === 0, 'second mirror creates nothing (update)');
  ok(second.updated.length === 1, 'second mirror updates the existing bone');
  ok(sk.bones.length === 2, 'still two bones — no duplicate');

  var third = mirror.mirrorBones(sk, { sourceIds: [arm.id], direction: 'lr', axis: V, conflict: 'skip' });
  ok(third.skipped.length === 1 && third.created.length === 0, 'skip leaves the existing bone alone');

  var copy = mirror.mirrorBones(sk, { sourceIds: [arm.id], direction: 'lr', axis: V, conflict: 'copy' });
  ok(copy.created.length === 1, 'copy creates a new suffixed bone');
  ok(sk.bones.length === 3, 'copy adds a third bone');
})();

// ---- pose mirror produces the expected target-side transform ---------------

(function () {
  var sk = new model.Skeleton();
  var spine = sk.addBoneWorld(null, 200, 100, 200, 160); // centre column on the axis
  spine.name = 'spine';
  var armL = sk.addBoneWorld(spine.id, 200, 110, 150, 140);
  armL.name = 'left arm';

  var axis = { type: 'vertical', value: 200 };
  var built = mirror.mirrorBones(sk, { sourceIds: [armL.id], direction: 'lr', axis: axis, conflict: 'update' });
  var armR = built.idMap[armL.id];
  eq(armR.name, 'right arm', 'mirrored arm is named right arm');
  ok(armR.parentId === spine.id, 'mirrored arm attaches to the shared spine');

  armL.poseRot = 0.5;
  armL.poseX = 3;
  armL.poseY = 7;
  var res = mirror.mirrorPose(sk, { direction: 'lr', axis: axis });
  ok(res.applied === 1, 'pose mirror touches exactly one pair');
  approx(armR.poseRot, -0.5, 'mirrored rotation is negated');
  approx(armR.poseX, -3, 'mirrored translation flips on the vertical axis');
  approx(armR.poseY, 7, 'translation off the mirror axis is unchanged');
})();

// ---- animation mirror preserves timing/easing ------------------------------

(function () {
  var sk = new model.Skeleton();
  var spine = sk.addBoneWorld(null, 200, 100, 200, 160);
  spine.name = 'spine';
  var armL = sk.addBoneWorld(spine.id, 200, 110, 150, 140);
  armL.name = 'left arm';
  var axis = { type: 'vertical', value: 200 };
  var armR = mirror.mirrorBones(sk, { sourceIds: [armL.id], direction: 'lr', axis: axis, conflict: 'update' }).idMap[armL.id];

  var clip = new model.Clip('walk', 2);
  armL.poseRot = 0.8;
  clip.setKey(0.5, sk, model.EASING_IN_OUT);
  armL.poseRot = -0.4;
  clip.setKey(1.5, sk);

  var res = mirror.mirrorAnimation(clip, sk, { direction: 'lr', axis: axis });
  ok(res.pairs === 1 && res.keys === 2, 'animation mirror visits both keys for one pair');
  approx(clip.keys[0].pose[armR.id].rot, -0.8, 'key 0 mirrored rotation negated');
  approx(clip.keys[1].pose[armR.id].rot, 0.4, 'key 1 mirrored rotation negated');
  approx(clip.keys[0].t, 0.5, 'key timing preserved');
  eq(clip.keys[0].easing, model.EASING_IN_OUT, 'key easing preserved');
})();

// ---- export / import keeps mirrored bones ----------------------------------

(function () {
  var sk = new model.Skeleton();
  var arm = sk.addBoneWorld(null, 100, 100, 80, 140);
  arm.name = 'left arm';
  mirror.mirrorBones(sk, { sourceIds: [arm.id], direction: 'lr', axis: V, conflict: 'update' });

  var state = {
    imageURL: 'data:,', natW: 100, natH: 100, drawnW: 100, drawnH: 100,
    offX: 0, offY: 0, divisions: 12, skeleton: sk,
    animations: [new model.Clip('idle', 2)],
  };
  var json = JSON.parse(JSON.stringify(model.characterToJSON(state)));
  ok(json.version === 1, 'export stays schema version 1 (backward compatible)');

  var sk2 = model.skeletonFromJSON(json);
  ok(sk2.bones.length === 2, 'mirrored bones survive the round-trip');
  var names = sk2.bones.map(function (b) { return b.name; });
  ok(names.indexOf('left arm') >= 0 && names.indexOf('right arm') >= 0, 'both sides present after import');
  approx(sk2.bones[1].length, sk.bones[1].length, 'mirrored bone length round-trips');
})();

// ---------------------------------------------------------------------------

console.log(passes + ' passed, ' + failures + ' failed');
if (failures) process.exit(1);
