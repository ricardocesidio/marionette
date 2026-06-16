/* Headless visual test driver: rig + pose the sample character automatically.
 * Loaded by tests/visual.sh (never by the real editor). */
(function () {
  'use strict';
  setTimeout(function () {
    document.getElementById('btnSample').click();
    setTimeout(function () {
      var ed = RIG.editor, st = ed.state, sk = st.skeleton;
      var ox = st.offX, oy = st.offY, w = st.drawnW, h = st.drawnH;
      function P(fx, fy) { return { x: ox + fx * w, y: oy + fy * h }; }

      var pelvis = P(0.50, 0.66), chest = P(0.50, 0.46), head = P(0.50, 0.22);
      var spine = sk.addBoneWorld(null, pelvis.x, pelvis.y, chest.x, chest.y);
      sk.addBoneWorld(spine.id, chest.x, chest.y, head.x, head.y);
      var aL = P(0.35, 0.45), aLe = P(0.14, 0.63);
      var aR = P(0.65, 0.45), aRe = P(0.86, 0.63);
      var armL = sk.addBoneWorld(spine.id, aL.x, aL.y, aLe.x, aLe.y);
      var armR = sk.addBoneWorld(spine.id, aR.x, aR.y, aRe.x, aRe.y);
      var lL = P(0.42, 0.70), lLe = P(0.39, 0.93);
      var lR = P(0.58, 0.70), lRe = P(0.61, 0.93);
      sk.addBoneWorld(spine.id, lL.x, lL.y, lLe.x, lLe.y);
      sk.addBoneWorld(spine.id, lR.x, lR.y, lRe.x, lRe.y);

      ed.setMode('animate');
      spine.poseRot = 0.10;
      armR.poseRot = -1.3; // wave!
      armL.poseRot = 0.35;
      ed.currentClip().setKey(0, sk);
      // Hand the character to the game page, like the "Test in Game" button.
      try {
        localStorage.setItem('marionette.character',
          JSON.stringify(RIG.model.characterToJSON(st)));
      } catch (e) { /* headless quota */ }
      document.title = 'DRIVE-OK bones=' + sk.bones.length +
        ' keys=' + ed.currentClip().keys.length + ' mode=' + st.mode;
    }, 500);
  }, 300);
})();
