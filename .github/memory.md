# Memory

## Decisions & Context

- **electron-vite v5** uses Vite 7.3. Config file: `electron.vite.config.ts`. Three build targets: main, preload, renderer.
- **Directory layout** follows electron-vite convention: `src/main/`, `src/preload/`, `src/renderer/`. The renderer bundles from `src/renderer/index.html`.
- **Preload script** at `src/preload/index.ts` — exposes `window.api` via `contextBridge`. The renderer never imports electron directly.
- **electron** is a devDependency, not a regular dependency.
- **Wayland errors** on launch (`Incomplete image description info from compositor`, `UnitExists`) are benign compositor quirks — not app bugs.
- **Module system**: Using ESNext modules with bundler resolution (electron-vite handles CJS/ESM translation for Electron main process).
- **tsconfig split**: `tsconfig.json` (base), `tsconfig.node.json` (main+preload — no DOM), `tsconfig.web.json` (renderer — DOM libs).
- **Zod v4** (`^4.3.6`): `z.discriminatedUnion('type', [...])` works. `z.int()` exists for integer validation. `z.tuple()` for fixed-length arrays. `safeParse` returns `{ success, data, error }` as before.
- **Rig schema design**: `PartSchema.mesh` has a nested `deformers` field in the JSON fixture but the schema puts `deformers` on `PartSchema` directly. The `mesh.deformers` in the fixture is stripped (Zod strips unknown keys). Both schemas and cross-field validation live in a single `rig.ts` file.
- **Test fixture** at `test/fixtures/test-rig.json`: 2 parts (face, eye_left), 1 warp deformer (squeeze_center on face), 1 rotate deformer (on eye_left), 2 parameters (head_angle_x, eye_open_left), 1 physics entry (pendulum on face).
- **PixiJS v8** (`8.16.0`): `Application` uses async `init()` method. `MeshGeometry` takes `{ positions, uvs, indices }` options object (Float32Array/Uint32Array). `Mesh` takes `{ geometry, texture }` options. Setting `geometry.positions = newFloat32Array` updates the buffer. `Texture.WHITE` is the built-in white texture fallback. `Assets.load()` is the async texture loader.
- **Renderer architecture**: `RigRenderer` class owns a `PIXI.Application` + root `Container`. Each rig part maps to a `PartState` holding the PIXI Mesh, geometry, base positions (immutable), and deformer instances. Deformations are recomputed from base positions on every param change (no incremental updates).
- **Camera controls**: Pan via middle-mouse or Ctrl+left-click drag. Zoom via scroll wheel toward cursor (adjusts root container position + scale). All implemented in `setupCameraControls()`.
- **Part selection**: Uses PIXI's built-in `eventMode: 'static'` + pointer events. Wireframe overlay drawn with `Graphics.setStrokeStyle()` + `moveTo/lineTo/closePath/stroke`. Selection overlay is a separate Graphics child on the root container.
- **Manual test in main.ts**: The renderer entry point (`src/renderer/main.ts`) loads an inline copy of the test rig with `Texture.WHITE` fallback and creates interactive sliders in the param panel. Run `npm run dev` to visually verify.
- **Pre-existing TS error** in `deformer.test.ts` line 84 (3 args instead of 1-2 for `expect.toBeCloseTo`) — shows under `tsc --noEmit` but Vitest still runs it successfully. Non-blocking.
