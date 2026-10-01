# TestRepository
Second Test Repository

## WorldForge – 3D world builder with real-world scan import

WorldForge is a cross-platform desktop app (Electron + Three.js) for building 3D worlds from scratch and pulling in 3D scans of real places and objects.

### Run it

```bash
npm install
npm start            # launch the app
npm test             # unit tests (scan receiver, point-cloud parser, terrain)
npm run dist         # build an installer for your OS (electron-builder)
```

If your machine has no working GPU driver, use `npm run start:software` (software WebGL).

### Build worlds from scratch

- **＋ Add** menu: generated terrain, flat ground, shapes (box, sphere, cylinder, cone, torus), props (tree, rock, house) and lights (point, spot, directional). New props drop onto whatever surface is under the view center.
- **Terrain generator**: fractal heightmap with height-based colouring (sand, grass, forest, rock, snow) and a water plane. Tweak size, height, detail, roughness, octaves, water level and seed live, or hit 🎲 Randomize.
- **Scatter**: with a terrain selected, scatter trees (avoids water, steep slopes and snow) or rocks.
- **Edit**: click to select, gizmos for move/rotate/scale (W/E/R), snap, inspector for transform, material, light and environment settings (sky, fog, exposure). Full undo/redo (Ctrl+Z / Ctrl+Shift+Z), duplicate (Ctrl+D), delete, focus (F).
- **Files**: save/open worlds as `.world` (JSON) and export the whole world to **GLB** for game engines, Blender, the web, etc.

### Bring in the real world

Supported scan formats: **GLB / GLTF, OBJ, PLY (meshes and point clouds), STL, PCD, XYZ / PTS / TXT / CSV** point clouds.

Three ways to get a scan in:

1. **Import scan** button (or Ctrl+I) to pick files.
2. **Drag & drop** files onto the 3D view.
3. **📡 Receive scans** – starts a small server on your local network. Scan the QR code with your phone, pick the file exported from your scanning app (Polycam, Scaniverse, 3d Scanner App, Kiri Engine, RealityScan, …) and it shows up in the scene instantly.
   Other tools can push scans too:
   ```bash
   curl -X POST "http://<computer-ip>:8765/upload" \
        -H "X-Filename: scan.ply" -H "X-WorldForge-Key: <k value from the link>" \
        --data-binary @scan.ply
   ```
   The `k` pairing key in the link stops other devices on the network from uploading without it.

Imported scans are centered and placed on the ground automatically. The Scan inspector shows point/triangle counts and real-world size, and has tools for Z-up → Y-up conversion, flipping, unit conversion (m / cm / mm / in / ft) and point size.

Try it with the sample scans in `samples/` (`room-corner.ply`, `boulder.xyz`; regenerate with `node samples/make-samples.mjs`).

### Project layout

```
src/main/        Electron main process: windows, menus, file dialogs, scan receiver (scan-server.js) and phone upload page
src/renderer/    UI + 3D editor (Three.js loaded through an import map, no bundler)
  editor/        editor core, undo history, terrain, primitives, scan loaders, inspector, outliner
test/            node:test unit tests
samples/         sample scans
```
