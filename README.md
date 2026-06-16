# Marionette Studio

**2D skeletal animation studio** — rig any character image with a skeleton, animate it with keyframes, and deform it live by the bones. Zero runtime dependencies. Runs in the browser or as a desktop app (Electron).

> **⚠ Work in progress** — this project is actively being built. Some features are incomplete, and the API/format may change. See [Roadmap](#roadmap) below.

---

## What is this?

Marionette Studio lets you take any character image (PNG, JPG, WebP…), draw a skeleton inside it, and bring it to life:

- **Rig mode** — place bones inside the image to build a skeleton
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
2. Switch to **Rig mode (1)** — drag on the image to draw bones, or click **Humanoid preset** for a full 17-bone skeleton
3. Switch to **Animate mode (2)** — drag bones to pose, keyframes are recorded automatically
4. Press **Play** to see the animation
5. Click **Test in Game** to run your character in a simple game demo

## Quick start — desktop app

```bash
npm install
npm start
```

To build an installer:

```bash
npm run dist       # macOS .dmg, Windows .exe, Linux .AppImage
```

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
│   ├── render.js           # Canvas2D renderer (textured triangles, bone drawing)
│   ├── editor.js           # Editor UI logic (rigging, posing, import/export)
│   ├── timeline.js         # Timeline strip and transport controls
│   ├── main.js             # Bootstrap and animation loop
│   └── game.js             # Game demo runtime
├── desktop/
│   ├── main.js             # Electron main process
│   └── dev.js              # Dev launcher
└── tests/
    ├── smoke.js            # Core test suite (math, skeleton, skinning, animation)
    ├── drive.js            # Headless visual test driver
    └── run.sh              # Test runner
```

---

## Architecture

```
┌────────────────────┐     .marionette.json      ┌──────────────────┐
│  EDITOR            │  ───────────────────────▶ │  GAME RUNTIME    │
│  index.html        │   image + bones + mesh +  │  game.html       │
│  rig · animate ·   │   animation keys          │  loads, plays    │
│  keyframe · export │                           │                  │
└────────────────────┘                           └──────────────────┘
        both built on the same core ▼
   js/math2d.js    2D affine matrices
   js/model.js     Bone, Skeleton, Mesh (auto-weights, LBS), Clip
   js/render.js    Canvas2D textured-triangle renderer
```

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

Runs the core math/skinning/animation test suite via Node.

---

## Roadmap

- [ ] Weight painting brush (override auto-weights)
- [ ] IK chains (drag a hand, the arm follows)
- [ ] Multiple named animations + blending (walk ↔ run ↔ jump)
- [ ] Easing curves per key
- [ ] Onion-skinning in the editor
- [ ] WebGL renderer (GPU skinning)
- [ ] Cut-out mode: rigid parts per bone
- [ ] Export runtimes: PixiJS plugin, Godot importer
- [ ] Physics bones (hair/cloth jiggle)

---

## License

MIT
