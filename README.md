# Marionette Studio

**2D skeletal animation studio** — rig any character image with a skeleton, animate it with keyframes, and deform it live by the bones. Zero runtime dependencies. Runs in the browser or as a desktop app (Electron).

> **⚠ Work in progress** — this project is actively being built. Some features are incomplete, and the API/format may change. See [Roadmap](#roadmap) below.

---

## What is this?

Marionette Studio lets you take any character image (PNG, JPG, WebP…), draw a skeleton inside it, and bring it to life:

- **Rig mode** — place bones inside the image to build a skeleton
- **Mirror Rig** — rig one side, then mirror bones, poses, and whole animations across a symmetry axis ([details](#mirror-rig))
- **Animate mode** — pose the skeleton over time with keyframes; the image bends with the bones
- **Export** — save the entire rigged character (image + skeleton + mesh + animations) into a single `.marionette.json` file
- **Game demo** — test your character walking around with arrow keys

It uses **Linear Blend Skinning** (the same technique 3D games use, adapted to 2D) on a triangulated mesh over the image. Weights are computed automatically based on bone proximity.

---

## Quick start — browser

```bash
cd marionette
python3 -m http.server 8000
# open http://localhost:8000
```

Or double-click `index.html` in most browsers.

1. Click **Generate sample character** or load your own image
2. Switch to **Rig mode (1)**:
   - **Drag joint balls** to move bone connections (parent bone follows)
   - **Drag tip balls** to re-aim and resize a bone
   - **Drag bone body** to slide the whole bone
   - **Alt+click a tip** to chain a child bone from it
   - Click empty space to draw a new bone
   - Click **Humanoid preset** for a full 17-bone skeleton, or **Auto-detect skeleton** to place one from the image silhouette
   - Rig one side, then **⇄ Mirror bones** to build the other across the symmetry axis
3. Switch to **Animate mode (2)** — drag bones to pose, keyframes are recorded automatically
   - **⇄ Mirror pose** flips the posed side to the other; **⇄ Mirror animation** mirrors a whole clip (e.g. a walk cycle)
4. Press **Play** to see the animation
5. Click **Test in Game** to run your character in a simple game demo

## Quick start — desktop app

```bash
npm install
npm run dev        # launches Electron with dev tools
# or
npm start          # launches Electron
```

To build an installer:

```bash
npm run dist       # macOS .dmg, Windows .exe, Linux .AppImage
```

---

## Mirror Rig

Symmetric characters only need half the work — rig one side and mirror the rest. The Mirror panel lives in the left sidebar in **Rig mode**, and its pose/animation actions work in **Animate mode**. Every mirror operation is a single, **undoable** step (`Ctrl/Cmd+Z`).

**Directions** — Left → Right, Right → Left, Top → Bottom, Bottom → Top.

**Scope** — what gets mirrored:

| Scope | Mirrors |
|---|---|
| **Selected bone** | just the selected bone(s) |
| **Selected chain** | the selected bone and all its descendants |
| **Entire side** | every bone on the source side of the axis (centre bones are left alone) |
| **Entire skeleton** | both off-axis sides — re-symmetrises the whole rig |

**Symmetry axis** — a draggable on-stage overlay (vertical for left/right, horizontal for top/bottom):

- Defaults to the **image centre**
- **Drag the knob** at the end of the axis, or type an exact value in the **Axis** field
- **⌖** resets it back to the image centre
- Toggle **Show mirror axis** to hide it

**Smart naming** — side tokens are swapped, with case preserved:

```
left_arm  ⇄  right_arm        arm.L  ⇄  arm.R        arm_R  ⇄  arm_L
top_wing  ⇄  bottom_wing      wing.Top  ⇄  wing.Bottom
```

If a bone has no side token, the target side is appended (`.L`/`.R`, or `.Top`/`.Bottom`).

**Conflict handling** — when the mirrored bone already exists:

- **Update existing** (default) — re-mirror in place; running it again never creates duplicates
- **Create copy** — add a new suffixed bone
- **Skip** — leave the existing bone untouched

**Geometry** — bones are reflected in world space, so length, hierarchy, and origin/tip placement are all preserved exactly; mirrored children re-parent under their mirrored parents. Mirroring rebinds the mesh, so **auto-weights regenerate** symmetrically.

**Pose & animation** — **⇄ Mirror pose** copies the source side's current pose to the other side (rotation negated, translation flipped on the mirror axis). **⇄ Mirror animation** does the same across every keyframe of the clip, preserving timing and easing — ideal for turning a half-built walk cycle into a full one.

---

## Project structure

```
marionette/
├── index.html              # Editor application
├── game.html               # Game demo runtime
├── package.json            # npm config (Electron dev dependencies)
├── css/style.css           # Dark theme styles
├── js/
│   ├── math2d.js           # 2D affine math library
│   ├── model.js            # Core data model: Bone, Skeleton, Mesh, Clip
│   ├── autorig.js          # Automatic skeleton detection from image silhouette
│   ├── mirror.js           # Mirror Rig engine: bone, pose, and animation mirroring
│   ├── render.js           # Canvas2D renderer (textured triangles, bone drawing)
│   ├── editor.js           # Editor UI logic (rigging, posing, mirroring, import/export)
│   ├── timeline.js         # Timeline strip and transport controls
│   ├── main.js             # Bootstrap and animation loop
│   └── game.js             # Game demo runtime
├── desktop/
│   ├── main.js             # Electron main process
│   └── dev.js              # Dev launcher
└── tests/
    ├── smoke.js            # Core test suite (math, skeleton, skinning, animation)
    ├── mirror.js           # Mirror Rig test suite (naming, geometry, pose, anim)
    ├── drive.js            # Headless visual test driver
    └── run.sh              # Test runner
```

---

## Architecture

```
┌────────────────────┐     .marionette.json      ┌──────────────────┐
│  EDITOR            │  ───────────────────────▶ │  GAME RUNTIME    │
│  index.html        │   image + bones + mesh +  │  game.html       │
│  rig · mirror ·    │   animation keys          │  loads, plays    │
│  animate · export  │                           │                  │
└────────────────────┘                           └──────────────────┘
        both built on the same core ▼
   js/math2d.js    2D affine matrices
   js/model.js     Bone, Skeleton, Mesh (auto-weights, LBS), Clip
   js/mirror.js    Mirror Rig — symmetry naming + bone/pose/animation reflection
   js/render.js    Canvas2D textured-triangle renderer
```

The core modules (`math2d`, `model`, `autorig`, `mirror`) are **DOM-free**, so the same code runs in the editor, in the game runtime, and in Node for the test suite.

### The character format (`.marionette.json` v1)

```jsonc
{
  "format": "marionette-character",
  "version": 1,
  "image": "data:image/png;base64,...",      // artwork embedded
  "natW": 360, "natH": 480,                  // image pixel size
  "drawnW": 360, "drawnH": 480,              // stage size
  "offX": 120, "offY": 40,                   // stage position
  "divisions": 20,                           // mesh grid density
  "bones": [{ "id": 1, "name": "spine", ... }],
  "animations": [{ "name": "idle", "duration": 2, "keys": [...] }]
}
```

Mirroring only ever produces ordinary bones, so the format stays **v1** — files round-trip unchanged between versions with and without the Mirror Rig feature.

---

## Tech stack

| Technology | Purpose |
|---|---|
| **Vanilla JavaScript** | Entire application logic — no frameworks |
| **HTML5 Canvas 2D API** | All rendering (editor + game) |
| **Electron** (dev only) | Desktop app shell |
| **electron-builder** (dev only) | Packaging / installers |
| **Node.js** | Test runner |

**Zero runtime dependencies.** No jQuery, React, PixiJS, Three.js, or any CDN scripts.

---

## Test

```bash
npm test
```

Runs the suites in Node — **160 tests** total: the core math/skinning/animation suite (`smoke.js`, 108) and the Mirror Rig suite (`mirror.js`, 52: naming, single-bone and chain geometry, no-duplicate updates, pose transforms, animation timing/easing, and export/import round-trip).

---

## What's new

- **Mirror Rig** — mirror bones, poses, and whole animations across a draggable symmetry axis, with smart left/right and top/bottom naming, update/copy/skip conflict handling, and full undo/redo. See [Mirror Rig](#mirror-rig).

## Recent fixes

- **ZBrush-like rigging** — grab any joint ball to move it; parent bones resize to stay connected, children follow
- **Drag-to-move bones** — click and drag any bone body to translate it in rig mode
- **Undo/redo** — now captures all bone edits: rotation, move, tip/origin drag, arrow-key nudge (previously only new-bone creation was recorded)
- **Idle rendering** — the editor no longer renders at 60fps when idle; the animation loop only runs during playback or interaction, saving CPU/battery
- **`setKey` performance** — key insertion uses binary search instead of sorting the entire key array (O(log n) vs O(n log n) per call)
- **CSS typo** — fixed `let(--dim)` → `var(--dim)` so the placeholder text renders at the correct muted color
- **Game handoff** — no longer opens a blank game page when the image is too large for localStorage; shows a clear error message instead
- **Test driver** — fixed `st.clip` undefined crash in the headless visual test suite
- **Mesh detail** — default slider value now matches the displayed label (28)

---

## Roadmap

Recently shipped:

- [x] **Mirror Rig** — bones, poses, and animations across a symmetry axis

Planned:

- [ ] Weight painting brush (override auto-weights)
- [ ] IK chains (drag a hand, the arm follows)
- [ ] Multiple named animations + blending (walk ↔ run ↔ jump)
- [ ] Animation clip tags (idle / walk / run / jump / attack)
- [ ] Easing curves per key
- [ ] Onion-skinning in the editor
- [ ] Pose library
- [ ] Character templates (humanoid, quadruped, bird/winged, creature, face rig)
- [ ] WebGL renderer (GPU skinning)
- [ ] Cut-out mode: rigid parts per bone
- [ ] Export runtimes: PNG sequence, GIF/WebM, sprite sheet, PixiJS plugin, Godot importer
- [ ] PWA offline support (service worker)
- [ ] Physics bones (hair/cloth jiggle)

---

## License

MIT
