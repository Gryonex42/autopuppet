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

## LaMa Inpainting Model

LaMa (Large Mask Inpainting) fills in masked regions of an image with plausible content. Used during part extraction to inpaint holes left by higher-z-order parts on lower layers.

The model is optional — the pipeline falls back to colour-fill when it's absent.

### Download

```bash
curl -L -o models/big-lama.onnx \
  "https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx"
```

### Model Details

| Property | Value |
|----------|-------|
| Source | [saic-mdal/lama](https://github.com/advimman/lama) (Samsung AI Center) |
| ONNX export | [Carve/LaMa-ONNX](https://huggingface.co/Carve/LaMa-ONNX) (FP32, public, no auth) |
| Size | ~208 MB |
| Input image | `[1, 3, H, W]` float32, RGB, normalized to [0, 1] |
| Input mask | `[1, 1, H, W]` float32, 0 = keep, 1 = inpaint |
| Output | `[1, 3, H, W]` float32, inpainted RGB image, [0, 1] |
| Resolution | H and W must be multiples of 8 |

## File Sizes

| Model | Size |
|-------|------|
| face_landmarker.task | ~5 MB |
| pose_landmarker_lite.task | ~6 MB |
| big-lama.onnx | ~208 MB |

## .gitignore

Ensure model files are excluded from version control:

```
models/*.task
models/*.onnx
```
