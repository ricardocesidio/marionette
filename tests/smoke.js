/* Marionette — core test suite. Run with: bash tests/run.sh
 * (concatenates math2d.js + model.js + this file and runs it in Node) */
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

function ok(cond, msg) {
  if (!cond) {
    failures++;
    console.error('FAIL ' + msg);
  } else {
    passes++;
  }
}

var M = RIG.math, model = RIG.model;

// ---- matrix algebra ------------------------------------------------------

(function () {
  var m = M.rotTrans(0.7, 30, -12);
  var i = M.multiply(m, M.invert(m));
  approx(i[0], 1, 'inv: a'); approx(i[1], 0, 'inv: b');
  approx(i[2], 0, 'inv: c'); approx(i[3], 1, 'inv: d');
  approx(i[4], 0, 'inv: e'); approx(i[5], 0, 'inv: f');

  var A = M.rotTrans(0.4, 5, 6), B = M.rotTrans(-1.1, -3, 9);
  var p1 = M.apply(M.multiply(A, B), 7, -2);
  var q = M.apply(B, 7, -2);
  var p2 = M.apply(A, q.x, q.y);
  approx(p1.x, p2.x, 'compose: x');
  approx(p1.y, p2.y, 'compose: y');

  approx(M.angleOf(M.rotTrans(1.234, 9, 9)), 1.234, 'angleOf');
  approx(M.distToSegment(0, 5, -10, 0, 10, 0), 5, 'distToSegment perpendicular');
  approx(M.distToSegment(15, 0, -10, 0, 10, 0), 5, 'distToSegment beyond end');
})();

// ---- skeleton hierarchy --------------------------------------------------

(function () {
  var sk = new model.Skeleton();
  var root = sk.addBoneWorld(null, 100, 100, 150, 100);   // points +x, len 50
  var child = sk.addBoneWorld(root.id, 150, 100, 150, 150); // from tip, points +y

  approx(root.x, 100, 'root local x');
  approx(root.rot, 0, 'root rest rot');
  approx(root.length, 50, 'root length');
  approx(child.x, 50, 'child local x (at parent tip)');
  approx(child.y, 0, 'child local y');
  approx(child.rot, Math.PI / 2, 'child local rot');

  var segs = sk.worldSegments(true);
  approx(segs[1].x1, 150, 'child rest tip x');
  approx(segs[1].y1, 150, 'child rest tip y');

  // Rotate the root 90°: child chain swings around (100,100).
  root.poseRot = Math.PI / 2;
  segs = sk.worldSegments(false);
  approx(segs[0].x1, 100, 'posed root tip x');
  approx(segs[0].y1, 150, 'posed root tip y');
  approx(segs[1].x0, 100, 'posed child origin x');
  approx(segs[1].y0, 150, 'posed child origin y');
  approx(segs[1].x1, 50, 'posed child tip x');
  approx(segs[1].y1, 150, 'posed child tip y');

  // Removing the root removes the descendant too.
  sk.removeBone(root.id);
  ok(sk.bones.length === 0, 'removeBone cascades to children');
})();

// ---- mesh binding + linear blend skinning --------------------------------

(function () {
  var sk = new model.Skeleton();
  var bone = sk.addBoneWorld(null, 10, 10, 60, 10);
  var mesh = new model.Mesh({
    natW: 100, natH: 100, drawnW: 100, drawnH: 100,
    offX: 0, offY: 0, divisions: 4,
  });
  ok(mesh.verts.length === 25 * 2, 'mesh vertex count (5x5 grid)');
  ok(mesh.tris.length === 32 * 3, 'mesh triangle count');

  mesh.bind(sk);
  ok(mesh.weights.length === 25, 'one weight list per vertex');
  approx(mesh.weights[0][0].w, 1, 'single bone owns every vertex fully');

  // Translating the only bone translates every vertex rigidly.
  bone.poseX = 10;
  bone.poseY = 5;
  var pos = mesh.deform(sk);
  approx(pos[0], mesh.verts[0] + 10, 'LBS translate x (first vert)');
  approx(pos[1], mesh.verts[1] + 5, 'LBS translate y (first vert)');
  approx(pos[48], mesh.verts[48] + 10, 'LBS translate x (last vert)');
  approx(pos[49], mesh.verts[49] + 5, 'LBS translate y (last vert)');

  // Rotating the bone 90° about its origin rotates vertices around (10,10).
  bone.poseX = 0; bone.poseY = 0; bone.poseRot = Math.PI / 2;
  pos = mesh.deform(sk);
  // vertex (25, 10) should land at origin + R90*(15, 0) = (10, 25)
  // grid vertex index for (25,?) : col=1, row=0 -> vi = 1 -> flat 2
  approx(mesh.verts[2], 25, 'sanity: second vertex rest x');
  approx(mesh.verts[3], 0, 'sanity: second vertex rest y');
  // (25, 0) relative to (10,10) is (15,-10); R90 gives (10,15); + (10,10) = (20,25)
  approx(pos[2], 20, 'LBS rotate x');
  approx(pos[3], 25, 'LBS rotate y');
})();

// ---- two-bone weights are local ------------------------------------------

(function () {
  var sk = new model.Skeleton();
  var left = sk.addBoneWorld(null, 0, 50, 40, 50);
  sk.addBoneWorld(null, 60, 50, 100, 50);
  var mesh = new model.Mesh({
    natW: 100, natH: 100, drawnW: 100, drawnH: 100,
    offX: 0, offY: 0, divisions: 10,
  });
  mesh.bind(sk);
  // Vertex at (0, 50): row 5, col 0 -> index 5*11+0 = 55
  var wLeft = 0;
  mesh.weights[55].forEach(function (w) { if (w.b === 0) wLeft = w.w; });
  ok(wLeft > 0.9, 'vertex on the left bone is owned by the left bone (w=' + wLeft.toFixed(3) + ')');
})();

// ---- animation clip -------------------------------------------------------

(function () {
  var sk = new model.Skeleton();
  var bone = sk.addBoneWorld(null, 0, 0, 50, 0);
  var clip = new model.Clip('walk', 2);

  bone.poseRot = 0;
  clip.setKey(0, sk);
  bone.poseRot = 2;
  clip.setKey(1, sk);
  ok(clip.keys.length === 2, 'two keys stored');

  clip.apply(0.5, sk, false);
  approx(bone.poseRot, 1, 'midpoint interpolation');

  clip.apply(1.0, sk, false);
  approx(bone.poseRot, 2, 'exact key time');

  clip.apply(1.5, sk, false);
  approx(bone.poseRot, 2, 'clamped past last key (no loop)');

  clip.apply(1.5, sk, true);
  approx(bone.poseRot, 1, 'loop wrap: halfway from last key back to first');

  // Overwriting a key at the same time updates instead of duplicating.
  bone.poseRot = 5;
  clip.setKey(1, sk);
  ok(clip.keys.length === 2, 'setKey at same time overwrites');
  clip.apply(1.0, sk, false);
  approx(bone.poseRot, 5, 'overwritten key value applies');

  ok(clip.removeKeyAt(1, 0.05), 'removeKeyAt finds the key');
  ok(clip.keys.length === 1, 'key removed');

  // JSON round-trip: numeric ids become string keys; lookups must still work.
  var json = JSON.parse(JSON.stringify({ animations: [{ name: 'walk', duration: 2, keys: clip.keys }] }));
  var clip2 = model.clipFromJSON(json);
  bone.poseRot = 99;
  clip2.apply(0, sk, false);
  approx(bone.poseRot, 0, 'clip survives JSON round-trip');
})();

// ---- character serialization ----------------------------------------------

(function () {
  var sk = new model.Skeleton();
  var root = sk.addBoneWorld(null, 10, 10, 60, 10);
  sk.addBoneWorld(root.id, 60, 10, 60, 60);
  var state = {
    imageURL: 'data:,', natW: 100, natH: 100, drawnW: 100, drawnH: 100,
    offX: 0, offY: 0, divisions: 12, skeleton: sk,
    animations: [new model.Clip('idle', 2)],
  };
  var json = JSON.parse(JSON.stringify(model.characterToJSON(state)));
  var sk2 = model.skeletonFromJSON(json);
  ok(sk2.bones.length === 2, 'skeleton round-trips');
  approx(sk2.bones[1].rot, sk.bones[1].rot, 'bone rotation round-trips');
  ok(sk2.bones[1].parentId === root.id, 'parent link round-trips');
})();

// ---- humanoid preset --------------------------------------------------------

(function () {
  var box = { offX: 50, offY: 20, drawnW: 200, drawnH: 400 };
  var sk = model.humanoidSkeleton(box);
  ok(sk.bones.length === 17, 'humanoid has 17 bones');

  var byName = {};
  sk.bones.forEach(function (b) { byName[b.name] = b; });
  ['hips', 'spine', 'chest', 'neck', 'head',
   'left arm', 'left forearm', 'left hand',
   'right arm', 'right forearm', 'right hand',
   'left thigh', 'left shin', 'left foot',
   'right thigh', 'right shin', 'right foot'].forEach(function (n) {
    ok(!!byName[n], 'humanoid bone exists: ' + n);
  });

  ok(byName['hips'].parentId === null, 'hips is the root');
  ok(byName['left forearm'].parentId === byName['left arm'].id, 'forearm chains to arm');
  ok(byName['right foot'].parentId === byName['right shin'].id, 'foot chains to shin');

  // Chained bones sit exactly on their parent's tip.
  approx(byName['left hand'].x, byName['left forearm'].length, 'hand starts at forearm tip', 1e-6);
  approx(byName['left hand'].y, 0, 'hand sits on the parent axis', 1e-6);

  // Every joint lands inside the image box.
  sk.worldSegments(true).forEach(function (s) {
    ok(s.x0 >= box.offX && s.x0 <= box.offX + box.drawnW &&
       s.y0 >= box.offY && s.y0 <= box.offY + box.drawnH, 'joint inside image box');
  });

  // Parents always precede children (required by worldMatrices).
  var seen = {};
  var ordered = true;
  sk.bones.forEach(function (b) {
    if (b.parentId != null && !seen[b.parentId]) ordered = false;
    seen[b.id] = true;
  });
  ok(ordered, 'parents precede children in bone order');
})();

// ---- auto-rig (silhouette detection) ---------------------------------------

(function () {
  var auto = RIG.auto;

  // Synthetic stick figure on a transparent 100x200 canvas.
  var W = 100, H = 200;
  var data = new Uint8ClampedArray(W * H * 4);
  function rect(x0, y0, x1, y1) {
    for (var y = y0; y <= y1; y++) {
      for (var x = x0; x <= x1; x++) {
        var o = (y * W + x) * 4;
        data[o] = 40; data[o + 1] = 40; data[o + 2] = 40; data[o + 3] = 255;
      }
    }
  }
  rect(40, 10, 60, 38);    // head
  rect(42, 38, 58, 110);   // torso
  rect(10, 50, 41, 58);    // left arm, reaching left
  rect(59, 50, 90, 58);    // right arm, reaching right
  rect(42, 111, 48, 184);  // left leg
  rect(52, 111, 58, 184);  // right leg
  rect(34, 185, 48, 194);  // left foot
  rect(52, 185, 66, 194);  // right foot

  var img = { width: W, height: H, data: data };
  var box = { offX: 0, offY: 0, drawnW: W, drawnH: H }; // identity mapping
  var res = auto.autoRig(img, box);
  ok(!!res.skeleton, 'auto-rig finds a skeleton');
  ok(res.skeleton.bones.length === 17, 'auto-rig builds all 17 bones');
  ok(res.landmarks.armsFound, 'auto-rig detects the arms');
  ok(res.landmarks.legsSplit, 'auto-rig detects the leg split');

  var byName = {}, segs = {};
  var ws = res.skeleton.worldSegments(true);
  res.skeleton.bones.forEach(function (b, i) { byName[b.name] = b; segs[b.name] = ws[i]; });

  ok(segs['head'].y1 < 30, 'head tip near the top of the figure');
  ok(Math.abs(segs['head'].x1 - 50) < 8, 'head centered on the figure');
  ok(segs['left hand'].x1 < 28, 'left hand reaches the left arm tip');
  ok(segs['right hand'].x1 > 72, 'right hand reaches the right arm tip');
  ok(segs['left hand'].y1 > 40 && segs['left hand'].y1 < 75, 'left hand at arm height');
  ok(Math.abs(segs['left thigh'].y0 - 111) < 15, 'thighs start near the crotch');
  ok(segs['left foot'].y1 > 175, 'feet near the bottom');
  ok(segs['left shin'].x1 < segs['right shin'].x1, 'legs sit left/right of each other');
  ok(byName['left forearm'].parentId === byName['left arm'].id, 'auto-rig keeps the chain hierarchy');

  // Same figure but opaque, dark on white: background comes from the corners.
  var data2 = new Uint8ClampedArray(W * H * 4);
  for (var i = 0; i < data2.length; i += 4) {
    data2[i] = data2[i + 1] = data2[i + 2] = 255;
    data2[i + 3] = 255;
  }
  for (var p = 0; p < W * H; p++) {
    if (data[p * 4 + 3]) data2[p * 4] = data2[p * 4 + 1] = data2[p * 4 + 2] = 30;
  }
  var res2 = auto.autoRig({ width: W, height: H, data: data2 }, box);
  ok(!!res2.skeleton && res2.skeleton.bones.length === 17,
    'auto-rig works on opaque images (background detected from corners)');

  // Empty image: refuse politely instead of building nonsense.
  var blank = { width: 50, height: 50, data: new Uint8ClampedArray(50 * 50 * 4) };
  ok(auto.autoRig(blank, box).skeleton === null, 'auto-rig rejects an empty image');
})();

// ---------------------------------------------------------------------------

console.log(passes + ' passed, ' + failures + ' failed');
if (failures) process.exit(1);
