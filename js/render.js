var RIG = RIG || {};

RIG.render = (function () {
  'use strict';
  let M = RIG.math;
  let TRI_EXPAND = 0.75;
  let DET_EPSILON = 1e-8;
  let JOINT_RADIUS = 4;
  let TIP_RADIUS = 3;
  let BONE_ALPHA = 0.85;
  let BONE_JOINT_FRAC = 0.18;
  let BONE_WIDTH_MIN = 3.5;
  let BONE_WIDTH_MAX = 10;
  let BONE_WIDTH_RATIO = 0.13;
  let WIRE_COLOR = 'rgba(120, 255, 170, 0.35)';
  let BONE_SEL = '#ffcc44';
  let BONE_ROOT = '#7fd4ff';
  let BONE_CHILD = '#6aa2ff';
  let JOINT_FILL = '#fff';
  let OUTLINE = 'rgba(0,0,0,0.55)';

  function texTri(ctx, img, x0, y0, x1, y1, x2, y2, u0, v0, u1, v1, u2, v2) {
    let det = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0);
    if (Math.abs(det) < DET_EPSILON) return;
    let a = ((x1 - x0) * (v2 - v0) - (x2 - x0) * (v1 - v0)) / det;
    let c = ((x2 - x0) * (u1 - u0) - (x1 - x0) * (u2 - u0)) / det;
    let b = ((y1 - y0) * (v2 - v0) - (y2 - y0) * (v1 - v0)) / det;
    let d = ((y2 - y0) * (u1 - u0) - (y1 - y0) * (u2 - u0)) / det;
    let e = x0 - a * u0 - c * v0;
    let f = y0 - b * u0 - d * v0;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.closePath();
    ctx.clip();
    ctx.transform(a, b, c, d, e, f);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  }

  function drawMesh(ctx, img, mesh, pos) {
    let tris = mesh.visTris || mesh.tris, uvs = mesh.uvs;
    for (let i = 0; i < tris.length; i += 3) {
      let i0 = tris[i] * 2, i1 = tris[i + 1] * 2, i2 = tris[i + 2] * 2;
      let x0 = pos[i0], y0 = pos[i0 + 1];
      let x1 = pos[i1], y1 = pos[i1 + 1];
      let x2 = pos[i2], y2 = pos[i2 + 1];
      let cx = (x0 + x1 + x2) / 3, cy = (y0 + y1 + y2) / 3;
      let p0 = expand(x0, y0, cx, cy, TRI_EXPAND);
      let p1 = expand(x1, y1, cx, cy, TRI_EXPAND);
      let p2 = expand(x2, y2, cx, cy, TRI_EXPAND);
      texTri(ctx, img,
        p0[0], p0[1], p1[0], p1[1], p2[0], p2[1],
        uvs[i0], uvs[i0 + 1], uvs[i1], uvs[i1 + 1], uvs[i2], uvs[i2 + 1]);
    }
  }

  function expand(x, y, cx, cy, e) {
    let dx = x - cx, dy = y - cy;
    let l = Math.hypot(dx, dy) || 1;
    return [x + (dx / l) * e, y + (dy / l) * e];
  }

  function drawWireframe(ctx, mesh, pos) {
    ctx.save();
    ctx.strokeStyle = WIRE_COLOR;
    ctx.lineWidth = 1;
    ctx.beginPath();
    let tris = mesh.visTris || mesh.tris;
    for (let i = 0; i < tris.length; i += 3) {
      let i0 = tris[i] * 2, i1 = tris[i + 1] * 2, i2 = tris[i + 2] * 2;
      ctx.moveTo(pos[i0], pos[i0 + 1]);
      ctx.lineTo(pos[i1], pos[i1 + 1]);
      ctx.lineTo(pos[i2], pos[i2 + 1]);
      ctx.closePath();
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawBones(ctx, skeleton, restOnly, selectedIds) {
    let ws = skeleton.worldMatrices(restOnly);
    let selArr = Array.isArray(selectedIds) ? selectedIds : (selectedIds != null ? [selectedIds] : []);
    skeleton.bones.forEach(function (b, i) {
      let m = ws[i];
      let tip = M.apply(m, b.length, 0);
      let sel = selArr.indexOf(b.id) >= 0;
      let col = sel ? BONE_SEL : (b.parentId == null ? BONE_ROOT : BONE_CHILD);
      boneShape(ctx, m[4], m[5], tip.x, tip.y, col);
    });
  }

  function boneShape(ctx, x0, y0, x1, y1, col) {
    let dx = x1 - x0, dy = y1 - y0;
    let len = Math.hypot(dx, dy) || 1;
    let nx = -dy / len, ny = dx / len;
    let w = Math.min(BONE_WIDTH_MAX, Math.max(BONE_WIDTH_MIN, len * BONE_WIDTH_RATIO));
    let jx = x0 + dx * BONE_JOINT_FRAC, jy = y0 + dy * BONE_JOINT_FRAC;

    ctx.save();
    ctx.globalAlpha = BONE_ALPHA;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(jx + nx * w, jy + ny * w);
    ctx.lineTo(x1, y1);
    ctx.lineTo(jx - nx * w, jy - ny * w);
    ctx.closePath();
    ctx.fillStyle = col;
    ctx.fill();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(x0, y0, JOINT_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = JOINT_FILL;
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(x1, y1, TIP_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = col;
    ctx.fill();
    ctx.restore();
  }

  return {
    texTri: texTri,
    drawMesh: drawMesh,
    drawWireframe: drawWireframe,
    drawBones: drawBones,
  };
})();
