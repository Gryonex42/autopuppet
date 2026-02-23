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
