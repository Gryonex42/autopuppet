# Memory

## Decisions & Context

- **electron-vite v5** uses Vite 7.3. Config file: `electron.vite.config.ts`. Three build targets: main, preload, renderer.
- **Directory layout** follows electron-vite convention: `src/main/`, `src/preload/`, `src/renderer/`. The renderer bundles from `src/renderer/index.html`.
- **Preload script** at `src/preload/index.ts` — exposes `window.api` via `contextBridge`. The renderer never imports electron directly.
- **electron** is a devDependency, not a regular dependency.
- **Wayland errors** on launch (`Incomplete image description info from compositor`, `UnitExists`) are benign compositor quirks — not app bugs.
- **Module system**: Using ESNext modules with bundler resolution (electron-vite handles CJS/ESM translation for Electron main process).
- **tsconfig split**: `tsconfig.json` (base), `tsconfig.node.json` (main+preload — no DOM), `tsconfig.web.json` (renderer — DOM libs).
