# Tasks: Live2D Clone with AI-Powered Rigging

> Generated from [live2d.md](live2d.md)

## Relevant Files

- `src/main/main.ts` - Electron main process entry point, window creation, app lifecycle
- `src/main/ipc.ts` - IPC handlers placeholder (ping/pong for now, expanded in Task 6)
- `src/preload/index.ts` - Preload script exposing IPC via contextBridge to window.api
- `src/renderer/index.html` - Electron renderer HTML entry point
- `src/renderer/main.ts` - Renderer process TypeScript entry point
- `src/renderer/styles.css` - Application CSS (CSS Grid layout, panel styles, dark theme)
- `electron.vite.config.ts` - electron-vite build configuration for main/preload/renderer
- `tsconfig.json` - Base TypeScript configuration (strict, ES2022)
- `tsconfig.node.json` - TypeScript config for main/preload processes
- `tsconfig.web.json` - TypeScript config for renderer process (includes DOM libs)
- `vitest.config.ts` - Vitest test runner configuration
- `package.json` - Project dependencies and scripts
- `src/renderer/engine/rig.ts` - Rig data model: Zod schemas, TypeScript interfaces, load/save JSON
- `src/renderer/engine/rig.test.ts` - Unit tests for rig data model parsing and validation
- `src/renderer/engine/deformer.ts` - Warp grid and rotation deformer math (Float32Array-based)
- `src/renderer/engine/deformer.test.ts` - Unit tests for deformer math (known inputs → known outputs)
- `src/renderer/engine/renderer.ts` - PixiJS WebGL mesh renderer, draws textured triangle meshes per part
- `src/renderer/engine/renderer.test.ts` - Visual regression tests for renderer output
- `src/renderer/engine/physics.ts` - Verlet integration physics chains for hair/cloth simulation
- `src/renderer/engine/physics.test.ts` - Unit tests for physics chain math and constraint satisfaction
- `src/renderer/ai/keypoint.ts` - Keypoint detection via MediaPipe JS + heuristic fallback
- `src/renderer/ai/keypoint.test.ts` - Tests for keypoint detection and heuristic estimation
- `src/renderer/ai/segmenter.ts` - SAM ONNX part segmentation, overlap resolution, mask export
- `src/renderer/ai/segmenter.test.ts` - Tests for segmentation pipeline and mask quality
- `src/renderer/ai/meshGen.ts` - Contour extraction, Poisson sampling, Delaunay triangulation, UV mapping
- `src/renderer/ai/meshGen.test.ts` - Tests for mesh generation (degenerate tri checks, vertex counts)
- `src/renderer/ai/autoRig.ts` - Orchestrator: rules engine, hierarchy builder, keyframe generator
- `src/renderer/ai/autoRig.test.ts` - Tests for auto-rig pipeline (PNG → rig JSON end-to-end)
- `src/renderer/ui/events.ts` - Typed EventBus class for state change propagation
- `src/renderer/ui/events.test.ts` - Tests for EventBus subscribe/emit/unsubscribe
- `src/renderer/ui/app.ts` - Root UI shell: CSS Grid layout, panel management, menu wiring
- `src/renderer/ui/viewport.ts` - PixiJS canvas mount, pan/zoom, part selection highlighting
- `src/renderer/ui/paramPanel.ts` - Parameter slider panel (DOM range inputs, grouped by category)
- `src/renderer/ui/partTree.ts` - Part hierarchy tree (nested DOM lists, visibility toggle, z-order drag)
- `src/renderer/ui/timeline.ts` - Canvas-drawn animation timeline, keyframe editing, playback controls
- `src/renderer/ui/timeline.test.ts` - Tests for timeline keyframe interpolation and playback logic
- `src/renderer/animation/player.ts` - AnimationPlayer and AnimationClip evaluation, easing functions
- `src/renderer/animation/player.test.ts` - Tests for animation interpolation and easing
- `src/renderer/animation/presets.ts` - Pre-built animation generators (idle, blink, talk, nod, shake)
- `src/renderer/animation/exporter.ts` - Export pipeline: GIF, spritesheet, MP4, web bundle
- `src/renderer/index.html` - Electron renderer HTML entry point
- `src/renderer/styles.css` - Application CSS (layout grid, panel styles, slider styling)
- `models/README.md` - Instructions for downloading SAM ONNX and MediaPipe WASM models
- `test/fixtures/test-character.png` - Sample character illustration for integration tests
- `test/fixtures/test-rig.json` - Hand-crafted rig JSON for renderer/deformer tests
- `package.json` - Project dependencies and scripts
- `tsconfig.json` - TypeScript configuration
- `electron-builder.yml` - Electron packaging configuration
- `vitest.config.ts` - Vitest test runner configuration

### Notes

- Unit tests should be placed alongside the code files they test (e.g., `rig.ts` and `rig.test.ts` in the same directory).
- Use `npx vitest` to run all tests. Use `npx vitest run src/renderer/engine/rig.test.ts` to run a specific test file.
- Tasks are ordered by dependency — complete earlier tasks before starting later ones.
- Each parent task produces a testable artifact. Verify it works before moving on.
- The `/models/` directory contains large binary files (ONNX models). These are downloaded, not committed to git.

---

## Tasks

- [x] 1.0 Project Scaffold & Build System
  - [x] 1.1 Run `npm init` and install core dependencies: `zod`, `pixi.js`, `delaunator`, `electron`, `electron-builder`, `sharp`, `@napi-rs/canvas`. Install dev dependencies: `typescript`, `vitest`, `electron-vite`.
  - [x] 1.2 Create `tsconfig.json` with `strict: true`, `target: ES2022`, `module: NodeNext`. Configure separate tsconfig for main process and renderer process if needed by electron-vite.
  - [x] 1.3 Create `vitest.config.ts` — configure to find `*.test.ts` files, set up any path aliases matching tsconfig.
  - [x] 1.4 Create the full directory structure under `/src` as specified in the PRD: `/src/main/`, `/src/renderer/engine/`, `/src/renderer/ai/`, `/src/renderer/ui/`, `/src/renderer/animation/`, `/test/fixtures/`.
  - [x] 1.5 Create `src/main/main.ts` — minimal Electron app that opens a BrowserWindow loading `src/renderer/index.html`. Disable `nodeIntegration`, enable `contextIsolation`, set up preload script if needed.
  - [x] 1.6 Create `src/renderer/index.html` — bare HTML page with a `<div id="app">` container and a `<script>` tag loading the renderer entry point. No framework, no JSX.
  - [x] 1.7 Create `src/renderer/styles.css` — initial CSS with a CSS Grid layout defining areas for: menu-bar, part-tree, viewport, param-panel, timeline. Use `grid-template-areas` for clarity.
  - [x] 1.8 Configure `electron-vite` or equivalent bundler to compile TypeScript for both main and renderer processes. Verify `npm run dev` launches the Electron window with the HTML page.
  - [x] 1.9 Verify the full build+launch cycle: `npm run dev` opens an Electron window showing the empty layout grid. Add a smoke test script if helpful.

- [x] 2.0 Rig Data Model
  - [x] 2.1 Create `src/renderer/engine/rig.ts`. Define Zod schemas for: `MeshSchema` (vertices as `[number, number][]`, uvs as `[number, number][]`, triangles as `[number, number, number][]`), `DeformerSchema` (discriminated union on `type: "warp" | "rotate"`), `PartSchema` (id, zIndex, texture, mesh, deformers array), `ParameterSchema` (id, range, default, keys), `PhysicsSchema` (target, type, length, damping, paramBinding), `RigSchema` (version, canvas, parts, parameters, physics).
  - [x] 2.2 Infer TypeScript types from each Zod schema using `z.infer<typeof Schema>`. Export both schemas and types.
  - [x] 2.3 Implement `loadRig(jsonString: string): Rig` — parse JSON string, validate with Zod schema, return typed Rig object. Throw descriptive errors on validation failure.
  - [x] 2.4 Implement `saveRig(rig: Rig): string` — serialize Rig object to formatted JSON string.
  - [x] 2.5 Add cross-field validation: vertex count must equal UV count per mesh, all triangle indices must be within vertex array bounds, all `paramBinding` references in deformers must match a parameter id.
  - [x] 2.6 Create `test/fixtures/test-rig.json` — a hand-crafted valid rig file with at least 2 parts (e.g., a face and an eye), 1 warp deformer, 1 rotate deformer, 2 parameters, and 1 physics entry.
  - [x] 2.7 Write `src/renderer/engine/rig.test.ts` — tests: valid JSON parses successfully, invalid JSON (missing field) throws, mismatched vertex/UV count throws, out-of-range triangle index throws, round-trip (load → save → load) produces identical output.

- [ ] 3.0 Deformation Engine
  - [x] 3.1 Create `src/renderer/engine/deformer.ts`. Define a `Deformer` interface with method `apply(vertices: Float32Array, paramValue: number): Float32Array`.
  - [x] 3.2 Implement `WarpDeformer` class: constructor takes grid size (e.g., 4×4) and part bounding box. Stores control points as a flat Float32Array. The `apply` method: for a param value `t`, compute control point offsets based on the warp mode, then for each vertex find containing grid cell and bilinear-interpolate the offset.
  - [x] 3.3 Implement warp modes as pure functions: `squeezeCenter(grid, t)` — moves top/bottom rows toward center; `stretchBottom(grid, t)` — moves bottom row down; `curveEndsUp(grid, t)` — moves corner points up; `scaleY(grid, t)` — scales all y-offsets by `(1 + t * 0.02)`. Each returns a modified copy of the control point grid.
  - [ ] 3.4 Implement `RotateDeformer` class: constructor takes origin point `[x, y]`. The `apply` method: for param value `θ` (degrees), rotate each vertex around origin using 2D rotation matrix. Include a `childrenFollow` flag that, when true, outputs the transform to be applied to child parts.
  - [ ] 3.5 Implement `createDeformer(config: Deformer, partBbox: BBox): DeformerInstance` factory — reads the deformer config from the rig JSON and returns the appropriate WarpDeformer or RotateDeformer instance.
  - [ ] 3.6 Write `src/renderer/engine/deformer.test.ts` — tests: RotateDeformer with 90° rotates vertex (1,0) to (0,1) around origin (0,0); WarpDeformer squeezeCenter with t=1 moves top/bottom rows inward by expected amount; identity (t=0) returns original vertices unchanged; all warp modes produce expected output for known inputs.

- [ ] 4.0 PixiJS Renderer
  - [ ] 4.1 Create `src/renderer/engine/renderer.ts`. Implement `RigRenderer` class that takes a container DOM element. On init, create a `PIXI.Application` and mount it to the container.
  - [ ] 4.2 Implement `loadRig(rig: Rig, textureBasePath: string): void` — for each part in the rig (sorted by zIndex), load its texture via `PIXI.Texture.from()`, create a `PIXI.Mesh` with `PIXI.MeshGeometry` from the part's vertices, UVs, and triangles, and add it to the stage.
  - [ ] 4.3 Implement `setParameter(paramId: string, value: number): void` — given a parameter change, find all deformers bound to that parameter, run their `apply()` on the affected parts' vertices, and update the PIXI.Mesh geometry buffers (call `geometry.getBuffer('aVertexPosition').update()`).
  - [ ] 4.4 Implement `setAllParameters(params: Record<string, number>): void` — batch update all parameters in a single frame. Ensure deformation order respects the part hierarchy (parent before children, apply parent transforms to children if `childrenFollow` is true).
  - [ ] 4.5 Implement basic camera controls: pan (middle-mouse drag or Ctrl+drag), zoom (scroll wheel). Store a `PIXI.Container` as the root that gets translated/scaled.
  - [ ] 4.6 Implement part selection: on pointer click, raycast against part meshes (check which mesh contains the clicked point via triangle hit-testing). Emit a `partSelected` event. Draw a wireframe overlay on the selected part using `PIXI.Graphics`.
  - [ ] 4.7 Create a manual test: load `test-rig.json` with a simple test PNG texture, render it, verify the character displays. Add a few hardcoded parameter changes and confirm deformation is visible.

- [ ] 5.0 EventBus & Application State
  - [ ] 5.1 Create `src/renderer/ui/events.ts`. Implement a generic typed `EventBus<T>` class where `T` is a record of event names to payload types. Methods: `on(event, callback)`, `off(event, callback)`, `emit(event, data)`. Keep it under 30 lines.
  - [ ] 5.2 Define the `AppEvents` type: `{ paramChanged: { paramId: string, value: number }, partSelected: { partId: string | null }, rigLoaded: { rig: Rig }, animationTick: { time: number }, rigUpdated: void }`.
  - [ ] 5.3 Create `AppState` class that holds: the current `Rig | null`, current parameter values as `Map<string, number>`, selected part ID, animation playback state. Expose getters and setters that emit events via the EventBus on change.
  - [ ] 5.4 Write `src/renderer/ui/events.test.ts` — tests: subscribe receives emitted events, unsubscribe stops receiving, multiple listeners all fire, emitting unknown event does nothing.

- [ ] 6.0 Electron IPC & File Operations
  - [ ] 6.1 Create `src/main/ipc.ts`. Register IPC handlers for: `dialog:openFile` (shows native file open dialog, returns file path), `dialog:saveFile` (shows native save dialog), `fs:readFile` (reads file at path, returns buffer), `fs:writeFile` (writes buffer to path), `fs:readDir` (lists directory contents).
  - [ ] 6.2 Create a preload script that exposes these IPC channels to the renderer via `contextBridge.exposeInMainWorld`. The renderer should access them through a `window.api` object, not via direct `ipcRenderer` calls.
  - [ ] 6.3 Wire the Electron `Menu` API in `main.ts` — create a native menu bar with: File → Open Image, File → Open Rig, File → Save Rig, File → Export, Edit → Undo (placeholder), View → Toggle Part Tree, View → Toggle Timeline, Help → About.
  - [ ] 6.4 Test: launch app, use File → Open Image to select a PNG, verify the file path is received in the renderer process via IPC.

- [ ] 7.0 Keypoint Detection
  - [ ] 7.1 Install `@mediapipe/tasks-vision`. Create `src/renderer/ai/keypoint.ts`.
  - [ ] 7.2 Implement `detectFaceLandmarks(imageData: ImageData): Promise<Record<string, [number, number]>>` — load MediaPipe Face Landmarker WASM model, run detection, extract key points: face center, left eye, right eye, mouth center, nose tip, left ear, right ear. Return as named coordinate map.
  - [ ] 7.3 Implement `detectBodyJoints(imageData: ImageData): Promise<Record<string, [number, number]>>` — load MediaPipe Pose Landmarker WASM model, run detection, extract: left/right shoulder, left/right elbow, left/right wrist, torso center. Return as named coordinate map.
  - [ ] 7.4 Implement `estimateKeypointsHeuristic(imageRgba: ImageData): Record<string, [number, number]>` — fallback when MediaPipe fails on illustrated characters. Extract bounding box from alpha channel, then estimate keypoint positions using standard body proportions (head = top 20%, face center at 12% from top, eyes at face ± 8% width, body = middle 40%, arms = side 20% strips).
  - [ ] 7.5 Implement `detectKeypoints(imageData: ImageData): Promise<Record<string, [number, number]>>` — orchestrator that tries MediaPipe first, falls back to heuristic if MediaPipe returns zero/low-confidence landmarks.
  - [ ] 7.6 Create `models/README.md` with download instructions for MediaPipe WASM model files and where to place them in the project.
  - [ ] 7.7 Write `src/renderer/ai/keypoint.test.ts` — test heuristic keypoint estimation: given a known bounding box, verify face center, eye positions, body center are at expected proportional offsets. Test fallback triggers when MediaPipe returns empty results.

- [ ] 8.0 SAM ONNX Part Segmentation
  - [ ] 8.1 Install `onnxruntime-node`. Create `src/renderer/ai/segmenter.ts`.
  - [ ] 8.2 Add download instructions to `models/README.md` for SAM ViT-B ONNX models (encoder + decoder). Link to HuggingFace pre-exported models.
  - [ ] 8.3 Implement `loadSAMModel(encoderPath: string, decoderPath: string): Promise<SAMSession>` — create ONNX InferenceSessions for both encoder and decoder. Return a session object that caches the encoder embedding.
  - [ ] 8.4 Implement `encodeImage(session: SAMSession, imageData: ImageData): Promise<Float32Array>` — preprocess image (resize to 1024×1024, normalize), run through encoder ONNX session, return the image embedding tensor.
  - [ ] 8.5 Implement `segmentWithPrompt(session: SAMSession, embedding: Float32Array, points: [number, number][], labels: number[], box?: [number, number, number, number]): Promise<ImageData>` — create decoder input tensors (point coords, point labels, optional box), run decoder ONNX session, extract highest-confidence mask from output, return as binary ImageData.
  - [ ] 8.6 Implement `segmentCharacter(imagePath: string, keypoints: Record<string, [number, number]>): Promise<Map<string, ImageData>>` — for each keypoint region (face center → face, left eye → eye_left, etc.), construct the appropriate SAM prompt and run segmentation. Return map of part name to binary mask.
  - [ ] 8.7 Implement `resolveOverlaps(masks: Map<string, ImageData>, priorityOrder: string[]): Map<string, ImageData>` — iterate masks in priority order (eyes > mouth > face > hair > arms > body). For each pixel claimed by multiple masks, assign to the highest-priority part. Ensure no pixel is in two masks.
  - [ ] 8.8 Implement `exportPartTextures(originalImage: ImageData, masks: Map<string, ImageData>, outputDir: string): Promise<Map<string, { path: string, offset: [number, number] }>>` — for each mask, crop the original image to the mask region using `sharp`, save as RGBA PNG with tight bounding box, record the (x, y) offset for rig positioning.
  - [ ] 8.9 Write `src/renderer/ai/segmenter.test.ts` — test overlap resolution: given two overlapping masks with known priority, verify the higher-priority mask wins. Test that total mask coverage ≥ 95% of character alpha for a test image. Test that exported PNGs have correct dimensions matching their mask bounding boxes.

- [ ] 9.0 Mesh Generation
  - [ ] 9.1 Install `delaunator`. Create `src/renderer/ai/meshGen.ts`.
  - [ ] 9.2 Implement `extractContour(mask: ImageData): [number, number][]` — walk the alpha boundary of the mask using marching squares to produce an ordered list of boundary points.
  - [ ] 9.3 Implement `simplifyContour(contour: [number, number][], epsilon: number): [number, number][]` — Douglas-Peucker polyline simplification to reduce vertex count while preserving shape. The epsilon parameter controls aggressiveness.
  - [ ] 9.4 Implement `sampleInterior(mask: ImageData, density: number): [number, number][]` — Poisson disk sampling of points inside the mask region. Apply higher density (2×) near boundaries (within N pixels of contour) and lower density in the interior.
  - [ ] 9.5 Implement `triangulate(boundaryPts: [number, number][], interiorPts: [number, number][]): { vertices: [number, number][], triangles: [number, number, number][] }` — combine boundary and interior points, run `delaunator`, convert the half-edge output to triangle index arrays. Discard any triangles whose centroid falls outside the mask.
  - [ ] 9.6 Implement `computeUVs(vertices: [number, number][], textureBbox: { x: number, y: number, w: number, h: number }): Float32Array` — normalize each vertex position relative to the texture bounding box to produce UV coordinates in [0, 1] range.
  - [ ] 9.7 Implement `validateMesh(mesh: Mesh): { valid: boolean, errors: string[] }` — check: vertex count ≥ 50 and ≤ 500, no degenerate triangles (aspect ratio > threshold), all triangles inside mask bounds. Return list of specific errors if invalid.
  - [ ] 9.8 Implement `generateMesh(mask: ImageData, textureBbox: BBox): Mesh` — orchestrator that calls extractContour → simplifyContour → sampleInterior → triangulate → computeUVs → validateMesh. Adjusts density automatically if validation fails (too few/many vertices).
  - [ ] 9.9 Write `src/renderer/ai/meshGen.test.ts` — tests: triangulate a circle mask (200×200), verify no degenerate triangles, vertex count within range; triangulate a very small mask, verify minimum vertex count is enforced; verify UVs are in [0,1] range for all vertices.

- [ ] 10.0 Auto-Rigging Rules Engine
  - [ ] 10.1 Create `src/renderer/ai/autoRig.ts`. Define `RigRule` interface with fields: `affects` (part IDs), `deformer` type, `range`, `origin` (keypoint reference), `warpAxis`, `warpMode`, `childrenFollow`, `autoAnimate`.
  - [ ] 10.2 Implement the `RIG_RULES` constant as defined in the PRD — all 10 rules: `head_angle_x`, `head_angle_y`, `eye_open_left`, `eye_open_right`, `mouth_open`, `mouth_smile`, `body_angle_x`, `arm_L_angle`, `arm_R_angle`, `breathing`.
  - [ ] 10.3 Implement `buildHierarchy(partNames: string[], keypoints: Record<string, [number, number]>): PartTree` — create a tree structure: root → head (face, eye_left, eye_right, mouth, hair_*) + body (arm_upper_L, arm_lower_L, arm_upper_R, arm_lower_R). Assign parent-child relationships based on part name patterns and spatial proximity to keypoints.
  - [ ] 10.4 Implement `applyRules(hierarchy: PartTree, keypoints: Record<string, [number, number]>, meshes: Map<string, Mesh>, rules: Record<string, RigRule>): { parameters: Parameter[], deformers: Map<string, DeformerConfig[]> }` — for each rule, resolve the `origin` keypoint reference to actual coordinates, compute warp grid control points for the affected parts' bounding boxes, and produce the parameter + deformer configs.
  - [ ] 10.5 Implement `generateKeyframes(parameters: Parameter[], meshes: Map<string, Mesh>): KeyframeData[]` — for each parameter, generate deformation data at 3 key values: min, default (0), max. This pre-computes the control point offsets at each extreme.
  - [ ] 10.6 Implement `addPhysics(partNames: string[], keypoints: Record<string, [number, number]>): PhysicsConfig[]` — detect parts whose names contain "hair" or "cloth", create pendulum physics configs with appropriate anchor points (derived from keypoints), damping (0.9), and parameter bindings.
  - [ ] 10.7 Implement `generateIdle(parameters: Parameter[]): AnimationClip` — generate an idle animation clip with: breathing (sine wave, 3s period), gentle head sway (sine, 6s period, small amplitude), and auto-blink (every 3–5 seconds, 0.15s duration).
  - [ ] 10.8 Implement `autoRig(imagePath: string): Promise<Rig>` — the top-level orchestrator. Calls: detectKeypoints → segmentCharacter → exportPartTextures → generateMesh (per part) → buildHierarchy → applyRules → generateKeyframes → addPhysics → generateIdle → assembles and returns the complete Rig object.
  - [ ] 10.9 Write `src/renderer/ai/autoRig.test.ts` — end-to-end test: run `autoRig` on `test/fixtures/test-character.png`, verify output rig has all expected parameters, all parts have meshes, all deformer origins are within part bounding boxes, idle animation clip has correct structure.

- [ ] 11.0 Physics Simulation
  - [ ] 11.1 Create `src/renderer/engine/physics.ts`. Implement the `PhysicsChain` class as specified in the PRD: constructor takes anchor, length, segments, damping, gravity. Stores points and oldPoints as Float64Arrays.
  - [ ] 11.2 Implement `PhysicsChain.update(dt, anchorPos)` — pin first point to anchor, Verlet integration for remaining points (velocity = current - old, apply damping, add gravity), then satisfy distance constraints (5 iterations of constraint relaxation).
  - [ ] 11.3 Implement `PhysicsChain.constrain(i, j)` — standard Verlet distance constraint: compute current distance between points i and j, compare with rest distance, push/pull points equally to satisfy constraint.
  - [ ] 11.4 Implement `PhysicsChain.getAngle()` — returns `Math.atan2(dx, dy)` between first and last point for parameter binding.
  - [ ] 11.5 Implement `PhysicsEngine` class that manages multiple `PhysicsChain` instances. Method `step(dt, paramValues)`: get anchor positions from current rig deformation state, update all chains, write resulting angles back to the parameter map. This creates the head-movement → hair-swings feedback loop.
  - [ ] 11.6 Write `src/renderer/engine/physics.test.ts` — tests: a chain with gravity should fall downward over multiple steps; a chain at rest should maintain its rest length; getAngle returns 0 for a vertical chain; damping reduces oscillation amplitude over time.

- [ ] 12.0 User Interface — Layout Shell
  - [ ] 12.1 Create `src/renderer/ui/app.ts`. Implement `initApp(container: HTMLElement, eventBus: EventBus): void` — creates the main layout DOM structure using CSS Grid. Create `<div>` elements for each panel area: part-tree, viewport, param-panel, timeline, and a toolbar/menu area.
  - [ ] 12.2 Implement resizable panels: attach pointer event listeners to panel borders. On drag, update `flex-basis` or `grid-template-columns`/`grid-template-rows` CSS values. Store panel sizes in localStorage for persistence.
  - [ ] 12.3 Add a top toolbar row with buttons: "Open Image" (triggers IPC file open), "Auto Rig" (triggers the auto-rig pipeline), "Save Rig", "Play Idle", "Export". Style with basic CSS.
  - [ ] 12.4 Wire the "Open Image" button: on click, call `window.api.openFile({ filters: [{ name: 'Images', extensions: ['png'] }] })`, then load the selected image into the viewport as a preview.
  - [ ] 12.5 Wire the "Auto Rig" button: on click, show a loading indicator, call `autoRig(imagePath)`, on completion emit `rigLoaded` event with the rig, clear loading indicator. Handle errors with an alert.

- [ ] 13.0 User Interface — Viewport Panel
  - [ ] 13.1 Create `src/renderer/ui/viewport.ts`. Implement `initViewport(container: HTMLElement, eventBus: EventBus): RigRenderer` — create a `<canvas>` element, append to container, instantiate PIXI.Application mounted to the canvas, return the RigRenderer instance from task 4.
  - [ ] 13.2 Listen to `rigLoaded` event on EventBus → call `renderer.loadRig()` with the new rig data, display the character.
  - [ ] 13.3 Listen to `paramChanged` event on EventBus → call `renderer.setParameter()` to update deformations in real-time.
  - [ ] 13.4 Handle canvas resize: use `ResizeObserver` on the container div, call `renderer.resize()` to update PIXI viewport dimensions when the panel is resized.

- [ ] 14.0 User Interface — Parameter Panel
  - [ ] 14.1 Create `src/renderer/ui/paramPanel.ts`. Implement `initParamPanel(container: HTMLElement, eventBus: EventBus): void`.
  - [ ] 14.2 Listen to `rigLoaded` event: clear the container, then for each parameter in the rig, create a `<details>` group (grouped by category — face params, body params, physics params), containing `<label>` + `<input type="range">` elements. Set `min`, `max`, `step`, and `value` attributes from the parameter's range and default.
  - [ ] 14.3 On each slider's `input` event, emit `paramChanged` with the parameter ID and new value (parsed as float). Add a numeric readout `<span>` next to each slider showing the current value.
  - [ ] 14.4 Add a "Reset All" button that sets all sliders back to their parameter defaults and emits the corresponding events.

- [ ] 15.0 User Interface — Part Tree Panel
  - [ ] 15.1 Create `src/renderer/ui/partTree.ts`. Implement `initPartTree(container: HTMLElement, eventBus: EventBus): void`.
  - [ ] 15.2 Listen to `rigLoaded` event: clear the container, build a nested `<ul>` / `<li>` structure from the part hierarchy. Each item shows: a visibility checkbox, the part name, and the part's zIndex.
  - [ ] 15.3 On checkbox toggle, show/hide the corresponding part in the renderer (set `PIXI.Mesh.visible`). On item click, emit `partSelected` event. Highlight the selected item with a CSS class.
  - [ ] 15.4 Implement z-index reordering: use native HTML5 drag-and-drop API (`draggable`, `dragstart`, `dragover`, `drop` events) to allow reordering parts. On drop, update the part's zIndex in the rig and re-sort renderer draw order.

- [ ] 16.0 User Interface — Animation Timeline
  - [ ] 16.1 Create `src/renderer/ui/timeline.ts`. Implement `initTimeline(container: HTMLElement, eventBus: EventBus): void` — create a `<canvas>` element for the timeline drawing area and transport control buttons (play, pause, stop).
  - [ ] 16.2 Implement timeline rendering: draw horizontal tracks (one per parameter) with a time ruler at the top. Draw keyframe markers as small diamonds at their time positions. Draw a vertical playhead line at the current time.
  - [ ] 16.3 Implement playhead scrubbing: on mouse drag on the timeline canvas, move the playhead to the cursor x position, convert to time, emit `animationTick` with the new time. The renderer should evaluate the animation at that time and update.
  - [ ] 16.4 Implement keyframe editing: on double-click at a position on a parameter track, insert a new keyframe at that time with the current parameter value. On right-click a keyframe, show a context menu to delete it or change easing.
  - [ ] 16.5 Implement playback: on play button, start a `requestAnimationFrame` loop that advances time and emits `animationTick` each frame. Stop on pause. Loop back to 0 when reaching clip duration.

- [ ] 17.0 Animation Player & Presets
  - [ ] 17.1 Create `src/renderer/animation/player.ts`. Implement the `Keyframe` interface, `AnimationClip` interface, and `AnimationPlayer` class as defined in the PRD.
  - [ ] 17.2 Implement `interpolate(keyframes: Keyframe[], time: number): number` — find the two surrounding keyframes, compute interpolation `t` between them, apply the easing function, return the interpolated value. Handle edge cases: time before first keyframe (clamp), time after last keyframe (clamp), single keyframe (constant).
  - [ ] 17.3 Implement easing functions: `linear(t)`, `easeIn(t)` (quadratic), `easeOut(t)` (quadratic), `easeInOut(t)` (cubic). Each takes `t` in [0, 1] and returns eased `t`.
  - [ ] 17.4 Implement `AnimationPlayer.evaluate(clip, time)` — iterates all tracks, calls `interpolate` for each, returns a `Record<string, number>` of parameter values. This is called every frame during playback.
  - [ ] 17.5 Create `src/renderer/animation/presets.ts`. Implement generator functions for each pre-built animation: `createIdleClip(params)` (4s loop: sine breathing + gentle head sway + periodic blink), `createTalkClip(params)` (looping mouth noise + head movement), `createBlinkClip()` (0.15s one-shot), `createNodClip()` (1s one-shot), `createShakeClip()` (0.8s one-shot), `createSurpriseClip()` (0.5s one-shot). Each returns an `AnimationClip`.
  - [ ] 17.6 Write `src/renderer/animation/player.test.ts` — tests: interpolate at exact keyframe time returns keyframe value; interpolate midway between two linear keyframes returns average; easeIn at t=0 returns 0, at t=1 returns 1; evaluate returns values for all tracks; clamping at boundaries works.

- [ ] 18.0 Export Pipeline
  - [ ] 18.1 Create `src/renderer/animation/exporter.ts`.
  - [ ] 18.2 Implement `renderFrames(renderer: RigRenderer, clip: AnimationClip, fps: number): ImageData[]` — step through the animation at the given FPS, evaluate all parameters at each timestep, apply to renderer, capture the PixiJS canvas as ImageData per frame.
  - [ ] 18.3 Install `gifenc`. Implement `exportGif(frames: ImageData[], fps: number, outputPath: string): Promise<void>` — encode frames as animated GIF using gifenc, write to disk via IPC.
  - [ ] 18.4 Implement `exportSpritesheet(frames: ImageData[], outputPath: string): Promise<{ imagePath: string, jsonPath: string }>` — pack frames into a single atlas image (grid layout), generate a JSON descriptor with frame coordinates, write both to disk.
  - [ ] 18.5 Install `fluent-ffmpeg`. Implement `exportVideo(frames: ImageData[], fps: number, outputPath: string): Promise<void>` — write frames as temporary PNGs, invoke ffmpeg to encode as MP4 (H.264), clean up temp files.
  - [ ] 18.6 Implement `exportRig(rig: Rig, outputDir: string): Promise<void>` — save the rig JSON and all part texture PNGs to the output directory. This is the "save project" format.
  - [ ] 18.7 Implement `exportWebBundle(rig: Rig, clip: AnimationClip, outputDir: string): Promise<void>` — generate a self-contained HTML page with embedded PixiJS runtime, rig JSON, and textures (base64-encoded) that plays the animation in a browser.

- [ ] 19.0 Integration & End-to-End Testing
  - [ ] 19.1 Create `test/fixtures/test-character.png` — a simple anime-style character illustration (RGBA, transparent background) to use as the test input. Can be any CC0/public domain character art.
  - [ ] 19.2 Write an end-to-end integration test: load test-character.png → run autoRig → verify rig JSON is valid (passes Zod validation) → load into renderer → set each parameter to min and max → verify no NaN/Infinity in vertex positions → play idle animation for 100 frames → verify no errors.
  - [ ] 19.3 Write a performance test: load a rig with 20+ parts, run 1000 frames of animation, measure average frame time. Assert < 16ms (60fps target).
  - [ ] 19.4 Test the full UI workflow manually: launch app → open image → click Auto Rig → verify character appears in viewport → move sliders → verify deformation → play idle → verify animation → export GIF → verify GIF file is created and plays.

- [ ] 20.0 Electron Packaging & Distribution
  - [ ] 20.1 Create `electron-builder.yml` with configuration for Linux (AppImage), macOS (DMG), and Windows (NSIS installer). Configure `files` to include compiled JS, ONNX models, and MediaPipe WASM files.
  - [ ] 20.2 Add npm scripts: `"build"` (compile TS), `"package"` (run electron-builder), `"dev"` (electron-vite dev mode with hot reload).
  - [ ] 20.3 Test packaging on the current platform: run `npm run package`, verify the output binary launches and the full workflow works (open image → auto rig → animate → export).
  - [ ] 20.4 Add a `README.md` to the project root with: project description, screenshot, installation instructions, development setup, build instructions, and model download instructions.
