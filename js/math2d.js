/* Marionette — 2D affine math.
 *
 * Matrices are arrays [a, b, c, d, e, f], matching CanvasRenderingContext2D:
 *   x' = a*x + c*y + e
 *   y' = b*x + d*y + f
 */
var RIG = RIG || {};

RIG.math = (function () {
  'use strict';

  function identity() {
    return [1, 0, 0, 1, 0, 0];
  }

  // result = m ∘ n  (apply n first, then m)
  function multiply(m, n) {
    return [
      m[0] * n[0] + m[2] * n[1],
      m[1] * n[0] + m[3] * n[1],
      m[0] * n[2] + m[2] * n[3],
      m[1] * n[2] + m[3] * n[3],
      m[0] * n[4] + m[2] * n[5] + m[4],
      m[1] * n[4] + m[3] * n[5] + m[5],
    ];
  }

  // translate(tx, ty) then rotate(angle): T * R
  function rotTrans(angle, tx, ty) {
    const c = Math.cos(angle), s = Math.sin(angle);
    return [c, s, -s, c, tx, ty];
  }

  function invert(m) {
    const det = m[0] * m[3] - m[1] * m[2];
    const id = 1 / det;
    const a = m[3] * id, b = -m[1] * id, c = -m[2] * id, d = m[0] * id;
    return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
  }

  function apply(m, x, y) {
    return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
  }

  // Rotation of a rigid (non-scaled) matrix.
  function angleOf(m) {
    return Math.atan2(m[1], m[0]);
  }

  function distToSegment(px, py, x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((px - x0) * dx + (py - y0) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const qx = x0 + t * dx, qy = y0 + t * dy;
    return Math.hypot(px - qx, py - qy);
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  return {
    identity: identity,
    multiply: multiply,
    rotTrans: rotTrans,
    invert: invert,
    apply: apply,
    angleOf: angleOf,
    distToSegment: distToSegment,
    lerp: lerp,
  };
})();
