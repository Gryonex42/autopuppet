# Copilot Instructions — Live2D Clone with AI-Powered Rigging

## Project Context

This is a desktop application that clones Live2D's 2D character animation system, with AI-powered automatic rigging. A user drops in a static character PNG, and the app segments it into parts, generates meshes, assigns deformers and parameters, and produces a rigged model that animates in real-time.

The full design document is in `live2d.md`. The task list is in `tasks-live2d.md`.

### Tech Stack

- **Language:** TypeScript (everything — engine, AI, UI)
- **Desktop shell:** Electron (no framework — no React, no Angular, no Vue)
- **UI:** Vanilla TypeScript + DOM APIs. Plain `document.createElement`, `addEventListener`, CSS Grid. A 20-line `EventBus` class handles state propagation.
- **Rendering:** PixiJS (WebGL) for the 2D viewport — textured triangle meshes, deformation via vertex buffer updates
- **AI — Part segmentation:** ONNX Runtime (`onnxruntime-node`) running a SAM (Segment Anything) model exported to ONNX
- **AI — Keypoint detection:** MediaPipe JS/WASM (`@mediapipe/tasks-vision`) with a heuristic fallback for illustrated/anime characters
- **Mesh generation:** `delaunator` for Delaunay triangulation
- **Image processing:** `sharp` (libvips) + `@napi-rs/canvas`
- **Validation:** Zod schemas for the rig JSON format
- **Physics:** Custom Verlet integration (no library)
- **Testing:** Vitest
- **Build:** `electron-vite`, plain `tsc`
- **Packaging:** `electron-builder`

### What This Project Is NOT

- Not a web app. It's an Electron desktop app.
- Not using any UI framework. No React, no Angular, no Vue, no Svelte, no Solid. Do not introduce one.
- Not using Python. All AI inference runs via ONNX Runtime in Node.js or MediaPipe WASM in the renderer.
- Not using LLMs anywhere in the pipeline. Rigging is done by a deterministic rules engine. Segmentation is done by SAM (a vision model). Keypoints are from MediaPipe or heuristics.

---

## Core Principles

**Solve the actual problem.** Before writing code, confirm you understand the business intent. Ask what the feature is *for*, not just what it should *do*. If a request is vague, decompose it into concrete requirements before producing anything.

**Keep it simple.** Do not over-engineer. No abstraction layers "for future flexibility." No design patterns unless they solve a present problem. Prefer flat structures, direct function calls, and obvious code paths. If a junior developer would struggle to follow it, simplify it.

**Fewer files, less indirection.** Don't split code across multiple files unless there's a clear structural reason. Avoid unnecessary interfaces, wrapper types, or service layers. One well-structured file beats five thin abstractions.

## Code Quality

- Write code that reads like prose. Naming matters more than comments.
- Handle errors explicitly. Don't swallow them, don't over-abstract them. A try/catch with a clear error message is fine. Don't build an error hierarchy.
- Prefer the standard library and platform APIs. Only reach for third-party dependencies when they genuinely solve a hard problem (e.g., `delaunator` for triangulation, `sharp` for image processing). Don't add a library for something TypeScript or the DOM can do natively.
- No premature optimisation. Write correct, readable code first. Optimise when there's evidence of a problem (e.g., profiler shows a hot loop, frame rate drops below 60fps).
- Tests should verify *behaviour*, not implementation. Don't mock everything. Don't test private internals. Test that `autoRig` produces a valid rig from a PNG, not that it called `buildHierarchy` with the right arguments.

## Architecture

- Make design decisions explicit. When you choose a pattern or structure, state *why* briefly.
- Flag trade-offs. If a decision has downsides, say so — don't silently pick one path.
- Think about what changes. Structure code so the *likely* changes are easy and the unlikely ones are possible. Don't defend against every hypothetical.
- Prefer boring technology. Well-understood, well-documented, widely-adopted tools over novel ones.

## Communication

- Be direct. Say what the code does and why, in plain language.
- When reviewing or refactoring, explain what's wrong with the current approach before proposing a new one.
- If a request would lead to a bad outcome, say so clearly and suggest an alternative. Don't just comply.
- Don't pad responses. No filler, no preamble — just the answer.

## What Not To Do

- Don't generate code "just in case." Every line should have a reason to exist.
- Don't add logging, metrics, or observability scaffolding unless asked.
- Don't introduce config files, environment variable layers, or DI containers. This is a single-process desktop app. Configuration is hardcoded or in the rig JSON.
- Don't refactor working code to match a pattern you prefer unless asked.
- Don't produce a mountain of plausible-looking code that hasn't been thought through. Less, correct code beats more, impressive code.
- Don't introduce a UI framework. The UI is vanilla TS + DOM. This is intentional. The app has 5 panels — it doesn't need a virtual DOM.
- Don't introduce Python or a Python subprocess. All inference runs in-process via ONNX Runtime or MediaPipe WASM.
- Don't use `any`. Use proper TypeScript types. Zod schemas already define the rig format — infer types from them.
- Don't create wrapper classes around PixiJS. Use PIXI directly. A `PIXI.Mesh` is already the right abstraction for a textured triangle mesh.

---

## Project-Specific Guidance

### File Structure

```
src/
  main/           ← Electron main process (Node.js)
    main.ts        Entry point, BrowserWindow creation
    ipc.ts         IPC handlers for file I/O
  renderer/        ← Electron renderer process (browser context)
    engine/        Core animation engine
      rig.ts        Rig data model (Zod schemas, load/save)
      deformer.ts   Warp grid + rotation deformers
      renderer.ts   PixiJS mesh rendering
      physics.ts    Verlet physics chains
    ai/            AI inference pipeline
      keypoint.ts   MediaPipe + heuristic keypoint detection
      segmenter.ts  SAM ONNX segmentation
      meshGen.ts    Contour → Delaunay mesh generation
      autoRig.ts    Orchestrator: PNG → complete rig
    ui/            UI panels (vanilla DOM)
      app.ts        Layout shell, toolbar, panel wiring
      events.ts     Typed EventBus
      viewport.ts   PixiJS canvas mount
      paramPanel.ts Parameter sliders
      partTree.ts   Part hierarchy tree
      timeline.ts   Animation timeline (canvas-drawn)
    animation/     Animation system
      player.ts     Clip evaluation, interpolation, easing
      presets.ts    Pre-built animations (idle, blink, talk)
      exporter.ts   Export to GIF, spritesheet, MP4, web
test/
  fixtures/        Test character PNGs, hand-crafted rig JSONs
models/            ONNX + MediaPipe WASM model files (not in git)
```

Keep this structure. Don't add directories without a reason. Don't create a `utils/` folder — put helper functions in the file that uses them. If two files need the same helper, pick the more logical home and export it.

### Rig Data Model

The rig format is defined by Zod schemas in `rig.ts`. All types are inferred from these schemas using `z.infer<>`. When you need a type, import it from `rig.ts` — don't create a parallel type definition.

### Deformers

There are exactly two deformer types: **warp** (bilinear grid distortion) and **rotate** (2D rotation around a point). The warp deformer has modes: `squeeze_center`, `stretch_bottom`, `curve_ends_up`, `scale_y`. Don't add deformer types unless explicitly asked.

### Auto-Rigging

The auto-rig pipeline uses a **deterministic rules engine** (`RIG_RULES` constant), not an LLM. Each rule maps a parameter name to the parts it affects, the deformer type, and the origin keypoint. Don't introduce neural networks or generative AI for rigging decisions.

### Physics

Physics uses Verlet integration with distance constraints. The `PhysicsChain` class is self-contained. Physics chains map to rig parameters via `getAngle()` → parameter binding. Keep it simple — this just makes hair swing.

### UI Patterns

- State flows through `EventBus`. A UI panel emits an event, other panels listen. No global state object, no store, no signals.
- DOM elements are created imperatively. `const slider = document.createElement('input'); slider.type = 'range';` is the pattern. No templating.
- The timeline is drawn on a `<canvas>`, not with DOM elements. This is because it needs pixel-level control for keyframe markers and playhead rendering.
- Electron IPC: the renderer accesses file system operations through `window.api` (exposed via `contextBridge` in a preload script). Never import `electron` or `fs` directly in renderer code.

### Performance

- Deformer math uses `Float32Array` for vertex data. Don't use plain arrays for vertex positions.
- The render loop targets 60fps with 20+ parts. If performance degrades, profile first — don't speculate.
- ONNX and MediaPipe inference only runs once per image import, not per frame. The runtime path is: parameter change → deformer `apply()` → PIXI geometry buffer update. Keep this path allocation-free.

### Testing

- Use Vitest. Test files live next to source files: `rig.ts` → `rig.test.ts`.
- Focus on: rig JSON parsing/validation, deformer math correctness (known input → known output), end-to-end auto-rig pipeline (PNG → valid rig), animation interpolation.
- Don't mock PixiJS or ONNX Runtime in unit tests. Test the math and data flow. Use integration tests for the full pipeline.

---

## Task List Management

The task list lives in `.github/tasks.md`. A shared memory file lives in `.github/memory.md` — use it to record important context, decisions, gotchas, or anything that future tasks might need. Follow these rules when working through tasks.

### Task Implementation

- **One sub-task at a time.** Do **NOT** start the next sub-task until you ask the user for permission and they say "yes" or "y".
- **Completion protocol:**
  1. When you finish a **sub-task**, immediately mark it as completed by changing `[ ]` to `[x]`.
  2. If **all** sub-tasks underneath a parent task are now `[x]`, follow this sequence:
     - **First:** Run the full test suite (`npx vitest run`).
     - **Only if all tests pass:** Stage changes (`git add .`).
     - **Clean up:** Remove any temporary files and temporary code before committing.
     - **Commit:** Use a descriptive commit message that:
       - Uses conventional commit format (`feat:`, `fix:`, `refactor:`, etc.)
       - Summarises what was accomplished in the parent task
       - Lists key changes and additions
       - References the task number
       - Formats the message as a single-line command using `-m` flags, e.g.:
         ```
         git commit -m "feat: implement rig data model" -m "- Zod schemas for Part, Mesh, Deformer, Parameter, Physics" -m "- Load/save with cross-field validation" -m "- Task 2.0"
         ```
  3. Once all sub-tasks are marked completed and changes have been committed, mark the **parent task** as completed.
- Stop after each sub-task and wait for the user's go-ahead.

### Task List Maintenance

1. **Update the task list as you work:**
   - Mark tasks and sub-tasks as completed (`[x]`) per the protocol above.
   - Add new tasks as they emerge.

2. **Maintain the "Relevant Files" section:**
   - List every file created or modified.
   - Give each file a one-line description of its purpose.

### AI Instructions

When working with the task list, you must:

1. Regularly update `.github/tasks.md` after finishing any significant work.
2. Follow the completion protocol:
   - Mark each finished **sub-task** `[x]`.
   - Mark the **parent task** `[x]` once **all** its sub-tasks are `[x]`.
3. Add newly discovered tasks.
4. Keep "Relevant Files" accurate and up to date.
5. Before starting work, **read `.github/memory.md`** first, then check which sub-task is next.
6. After implementing a sub-task, update the task file and then pause for user approval.
7. If you discover anything that would be useful for future tasks — edge cases, non-obvious decisions, environment quirks, workarounds — write it to `.github/memory.md` before pausing.
