/* Marionette — automatic skeleton detection ("auto-rig").
 *
 * Reads the character's silhouette from the image pixels — the alpha channel
 * when the PNG has transparency, otherwise the background color estimated
 * from the four corners — then finds body landmarks from the silhouette's
 * shape (head, neck pinch, shoulders, hand extremities, leg split, knees,
 * feet) and builds the same 17 named bones as the humanoid preset, placed
 * on the character instead of the image box.
 *
 * DOM-free: works on any ImageData-like {width, height, data} so it runs in
 * Node for tests. The editor downsamples the image before calling in.
 */
var RIG = RIG || {};

RIG.auto = (function () {
  'use strict';
  let model = RIG.model;

  // ------------------------------------------------------ foreground mask

  function buildMask(img) {
    let w = img.width, h = img.height, d = img.data;
    let fg = new Uint8Array(w * h);
    let transparent = false;
    let ALPHA_OPAQUE = 250;
    for (let i = 3; i < d.length; i += 4) {
      if (d[i] < ALPHA_OPAQUE) { transparent = true; break; }
    }
    if (transparent) {
      let FG_ALPHA = 40;
      for (let p = 0; p < fg.length; p++) fg[p] = d[p * 4 + 3] > FG_ALPHA ? 1 : 0;
    } else {
      let bg = estimateBackground(w, h, d);
      let FG_DIST = bg.std * 2.5 + 30;
      for (let q = 0; q < fg.length; q++) {
        let o2 = q * 4;
        let dr = d[o2] - bg.r, dg = d[o2 + 1] - bg.g, db = d[o2 + 2] - bg.b;
        fg[q] = (dr * dr + dg * dg + db * db) > FG_DIST * FG_DIST ? 1 : 0;
      }
    }
    return { w: w, h: h, fg: fg };
  }

  function estimateBackground(w, h, d) {
    let samples = [];
    let step = Math.max(2, Math.min(w, h) >> 5);
    function grab(x, y) {
      let o = (y * w + x) * 4;
      samples.push([d[o], d[o + 1], d[o + 2]]);
    }
    for (let bx = 0; bx < w; bx += step) {
      grab(bx, 0);
      grab(bx, h - 1);
    }
    for (let by = 0; by < h; by += step) {
      grab(0, by);
      grab(w - 1, by);
    }
    let n = samples.length;
    if (!n) return { r: 128, g: 128, b: 128, std: 90 };
    let mr = 0, mg = 0, mb = 0;
    for (let sk = 0; sk < n; sk++) { mr += samples[sk][0]; mg += samples[sk][1]; mb += samples[sk][2]; }
    mr /= n; mg /= n; mb /= n;
    let v = 0;
    for (let sl = 0; sl < n; sl++) {
      let dr = samples[sl][0] - mr, dg = samples[sl][1] - mg, db = samples[sl][2] - mb;
      v += dr * dr + dg * dg + db * db;
    }
    return { r: mr, g: mg, b: mb, std: Math.sqrt(v / n) };
  }

  // Per-row silhouette info: horizontal runs, pixel count, centroid x.
  function analyze(m) {
    let MIN_RUN = 2;
    let rows = new Array(m.h);
    let top = -1, bottom = -1, left = m.w, right = -1, total = 0;
    for (let y = 0; y < m.h; y++) {
      let runs = [], count = 0, sum = 0, start = -1;
      for (let x = 0; x <= m.w; x++) {
        let f = x < m.w && m.fg[y * m.w + x];
        if (f) {
          if (start < 0) start = x;
          count++;
          sum += x;
          if (x < left) left = x;
          if (x > right) right = x;
        } else if (start >= 0) {
          if (x - start >= MIN_RUN) runs.push([start, x - 1]);
          start = -1;
        }
      }
      rows[y] = { runs: runs, count: count, cx: count ? sum / count : 0 };
      if (count) {
        if (top < 0) top = y;
        bottom = y;
        total += count;
      }
    }
    return { rows: rows, top: top, bottom: bottom, left: left, right: right, total: total };
  }

  // ----------------------------------------------------------- landmarks

  function landmarks(a, m) {
    if (a.top < 0) return null;
    let H = a.bottom - a.top, W = a.right - a.left;
    if (H < 12 || W < 6 || a.total < 40) return null;
    let rows = a.rows;

    function rowAt(y) { return rows[Math.max(0, Math.min(m.h - 1, Math.round(y)))]; }
    function cxAt(y) {
      let r = rowAt(y);
      return r.count ? r.cx : (a.left + a.right) / 2;
    }
    function lerp(p, q, t) { return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }; }

    // Head: centroid and width of the top rows.
    let headRows = Math.max(2, Math.round(H * 0.08));
    let headW = 0, headCx = 0, n = 0;
    for (let hy = a.top; hy < a.top + headRows && hy <= a.bottom; hy++) {
      if (rows[hy].count) { headW += rows[hy].count; headCx += rows[hy].cx; n++; }
    }
    headW /= Math.max(1, n);
    headCx /= Math.max(1, n);

    // Neck: the narrowest row in the band below the head (round heads widen,
    // so a simple "first widening" would fire inside the head itself).
    let nFrom = Math.round(a.top + H * 0.12), nTo = Math.round(a.top + H * 0.45);
    let neckY = nFrom, nBest = Infinity;
    for (let ny = nFrom; ny <= nTo; ny++) {
      if (rows[ny].count > 0 && rows[ny].count < nBest) { nBest = rows[ny].count; neckY = ny; }
    }
    let shoulderY = Math.min(a.bottom, Math.round(neckY + H * 0.05));

    // Crotch: the silhouette splits into 2+ runs between the legs. Several
    // regions can split (arms away from the torso do too), so take the band
    // that reaches closest to the bottom of the figure.
    let yLimit = Math.max(shoulderY + 2, Math.round(a.top + H * 0.35));
    let bands = [], curTop = -1;
    for (let cy = yLimit; cy <= a.bottom + 1; cy++) {
      let multi = cy <= a.bottom && rows[cy].runs.length >= 2;
      if (multi && curTop < 0) curTop = cy;
      if (!multi && curTop >= 0) { bands.push({ top: curTop, end: cy - 1 }); curTop = -1; }
    }
    let band = null;
    bands.forEach(function (b) {
      if (b.end - b.top < H * 0.08) return;
      if (!band || b.end > band.end) band = b;
    });
    let legsSplit = !!band;
    let crotchY = legsSplit ? band.top : Math.round(a.top + H * 0.55);
    if (crotchY <= neckY + 4) crotchY = neckY + Math.max(4, Math.round(H * 0.3));

    let cx = cxAt((neckY + crotchY) / 2); // spine axis

    // Legs: run centers give the x of each leg; ankles just above the bottom.
    let ankleY = Math.max(crotchY + 2, Math.round(a.bottom - Math.max(2, H * 0.06)));
    let spread = Math.max(3, W * 0.10);
    let ankleRuns = rowAt(ankleY).runs;
    let ankleLX, ankleRX;
    if (legsSplit && ankleRuns.length >= 2) {
      let aLast = ankleRuns[ankleRuns.length - 1];
      ankleLX = (ankleRuns[0][0] + ankleRuns[0][1]) / 2;
      ankleRX = (aLast[0] + aLast[1]) / 2;
    } else {
      ankleLX = cx - spread;
      ankleRX = cx + spread;
    }

    function nearestRunCenter(y, x, fallback) {
      let cs = rowAt(y).runs.map(function (s) { return (s[0] + s[1]) / 2; });
      if (!cs.length) return fallback;
      let best = cs[0];
      cs.forEach(function (c) { if (Math.abs(c - x) < Math.abs(best - x)) best = c; });
      return best;
    }
    let kneeY = Math.round((crotchY + ankleY) / 2);
    let kneeLX = legsSplit ? nearestRunCenter(kneeY, ankleLX, (cx + ankleLX) / 2) : cx - spread;
    let kneeRX = legsSplit ? nearestRunCenter(kneeY, ankleRX, (cx + ankleRX) / 2) : cx + spread;

    // Feet point outward, toward the outer edge of the bottom rows.
    let toeY = Math.min(a.bottom, ankleY + Math.max(2, Math.round(H * 0.04)));
    let toeRuns = rowAt(toeY).runs;
    let toeLX, toeRX;
    if (legsSplit && toeRuns.length >= 2) {
      toeLX = toeRuns[0][0];
      toeRX = toeRuns[toeRuns.length - 1][1];
    } else {
      toeLX = ankleLX - Math.max(2, W * 0.05);
      toeRX = ankleRX + Math.max(2, W * 0.05);
    }

    // Hands: the extreme left/right silhouette points between the shoulders
    // and the hips. If neither sticks out past the torso, guess (armless or
    // arms-on-body artwork) and let the user Alt-drag.
    let bandTop = shoulderY;
    let bandBottom = Math.max(bandTop + 1, Math.min(a.bottom, Math.round(crotchY + H * 0.08)));
    let minX = m.w, minXY = shoulderY, maxX = -1, maxXY = shoulderY;
    for (let by = bandTop; by <= bandBottom; by++) {
      let rs = rows[by].runs;
      if (!rs.length) continue;
      if (rs[0][0] < minX) { minX = rs[0][0]; minXY = by; }
      let e = rs[rs.length - 1][1];
      if (e > maxX) { maxX = e; maxXY = by; }
    }
    let armsFound = (cx - minX) > W * 0.18 && (maxX - cx) > W * 0.18;
    let handL, handR;
    if (armsFound) {
      handL = { x: minX, y: minXY };
      handR = { x: maxX, y: maxXY };
    } else {
      handL = { x: cx - W * 0.32, y: shoulderY + H * 0.22 };
      handR = { x: cx + W * 0.32, y: shoulderY + H * 0.22 };
    }
    let shoulderL = lerp({ x: cx, y: shoulderY }, handL, 0.18);
    let shoulderR = lerp({ x: cx, y: shoulderY }, handR, 0.18);

    let hipY = Math.min(a.bottom, crotchY + Math.max(1, Math.round(H * 0.02)));

    return {
      cx: cx,
      neckY: neckY,
      crotchY: crotchY,
      armsFound: armsFound,
      legsSplit: legsSplit,
      headTop: { x: headCx, y: a.top + Math.max(1, H * 0.01) },
      headBase: { x: headCx, y: a.top + (neckY - a.top) * 0.78 },
      shoulderL: shoulderL,
      elbowL: lerp(shoulderL, handL, 0.52),
      wristL: lerp(shoulderL, handL, 0.84),
      handL: handL,
      shoulderR: shoulderR,
      elbowR: lerp(shoulderR, handR, 0.52),
      wristR: lerp(shoulderR, handR, 0.84),
      handR: handR,
      hipL: { x: (cx + kneeLX) / 2, y: hipY },
      kneeL: { x: kneeLX, y: kneeY },
      ankleL: { x: ankleLX, y: ankleY },
      toeL: { x: toeLX, y: toeY },
      hipR: { x: (cx + kneeRX) / 2, y: hipY },
      kneeR: { x: kneeRX, y: kneeY },
      ankleR: { x: ankleRX, y: ankleY },
      toeR: { x: toeRX, y: toeY },
    };
  }

  // ------------------------------------------------------ skeleton build

  function buildSkeleton(pts, toStage) {
    let sk = new model.Skeleton();
    function add(parent, p0, p1, name) {
      let s = toStage(p0), e = toStage(p1);
      let bone = sk.addBoneWorld(parent ? parent.id : null, s.x, s.y, e.x, e.y);
      bone.name = name;
      return bone;
    }
    let torsoH = pts.crotchY - pts.neckY;
    let base = { x: pts.cx, y: pts.crotchY };
    let mid = { x: pts.cx, y: pts.crotchY - torsoH * 0.25 };
    let upper = { x: pts.cx, y: pts.crotchY - torsoH * 0.60 };
    let neckPt = { x: pts.cx, y: pts.neckY };

    let hips = add(null, base, mid, 'hips');
    let spine = add(hips, mid, upper, 'spine');
    let chest = add(spine, upper, neckPt, 'chest');
    let neck = add(chest, neckPt, pts.headBase, 'neck');
    add(neck, pts.headBase, pts.headTop, 'head');

    let armL = add(chest, pts.shoulderL, pts.elbowL, 'left arm');
    let foreL = add(armL, pts.elbowL, pts.wristL, 'left forearm');
    add(foreL, pts.wristL, pts.handL, 'left hand');
    let armR = add(chest, pts.shoulderR, pts.elbowR, 'right arm');
    let foreR = add(armR, pts.elbowR, pts.wristR, 'right forearm');
    add(foreR, pts.wristR, pts.handR, 'right hand');

    let thighL = add(hips, pts.hipL, pts.kneeL, 'left thigh');
    let shinL = add(thighL, pts.kneeL, pts.ankleL, 'left shin');
    add(shinL, pts.ankleL, pts.toeL, 'left foot');
    let thighR = add(hips, pts.hipR, pts.kneeR, 'right thigh');
    let shinR = add(thighR, pts.kneeR, pts.ankleR, 'right shin');
    add(shinR, pts.ankleR, pts.toeR, 'right foot');
    return sk;
  }

  // -------------------------------------------------------------- pipeline

  // img: ImageData-like. box: {offX, offY, drawnW, drawnH} stage placement.
  function autoRig(img, box) {
    let m = buildMask(img);
    let a = analyze(m);
    let pts = landmarks(a, m);
    if (!pts) return { skeleton: null };

    let sx = box.drawnW / m.w, sy = box.drawnH / m.h;
    function toStage(p) { return { x: box.offX + p.x * sx, y: box.offY + p.y * sy }; }

    let guessed = [];
    if (!pts.armsFound) guessed.push('arms guessed');
    if (!pts.legsSplit) guessed.push('legs guessed');
    let note = 'Skeleton detected' +
      (guessed.length ? ' (' + guessed.join(', ') + ')' : '') +
      ' — Alt-drag joints to fine-tune.';
    return { skeleton: buildSkeleton(pts, toStage), landmarks: pts, note: note };
  }

  return {
    buildMask: buildMask,
    analyze: analyze,
    landmarks: landmarks,
    autoRig: autoRig,
  };
})();
