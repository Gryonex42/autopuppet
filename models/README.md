# AI Model Files

This directory holds the binary model files used by the AI inference pipeline. These files are **not committed to git** — download them manually or run the setup script.

## MediaPipe WASM Runtime

The MediaPipe WASM files ship with `@mediapipe/tasks-vision` and are loaded automatically from the npm package or CDN at runtime. No manual download needed for the WASM runtime.

## MediaPipe Model Files

The app can load models from the network (default) or from local files for offline use. To use local models, download them to this directory:

### Face Landmarker

Detects 478 facial landmarks for keypoint extraction.

```bash
curl -L -o models/face_landmarker.task \
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
```

### Pose Landmarker

Detects 33 body pose landmarks for joint extraction.

```bash
curl -L -o models/pose_landmarker_lite.task \
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task"
```

## File Sizes

| Model | Size |
|-------|------|
| face_landmarker.task | ~5 MB |
| pose_landmarker_lite.task | ~6 MB |

## .gitignore

Ensure model files are excluded from version control:

```
models/*.task
```
