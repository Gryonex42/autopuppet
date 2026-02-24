/**
 * LaMa inpainting child-process worker.
 *
 * Runs in a forked child process (Node.js) so ONNX Runtime native bindings
 * don't block the main Electron process. Accepts JSON messages over IPC:
 *
 *   { type: 'load', modelPath: string }
 *   { type: 'run', imageRgba: number[], width: number, height: number,
 *                   maskAlpha: number[], maskWidth: number, maskHeight: number }
 *   { type: 'unload' }
 *
 * Replies with:
 *   { type: 'loaded' }
 *   { type: 'result', imageRgba: number[], width: number, height: number }
 *   { type: 'error', message: string }
 */

import * as ort from 'onnxruntime-node'

let session: ort.InferenceSession | null = null

/**
 * Pad a dimension up to the next multiple of 8, as required by LaMa.
 */
function padTo8(n: number): number {
  return Math.ceil(n / 8) * 8
}

/**
 * Run LaMa inference.
 *
 * LaMa expects:
 *   image: [1, 3, H, W] float32  (RGB, 0–1)
 *   mask:  [1, 1, H, W] float32  (0 = keep, 1 = inpaint)
 *
 * H and W must be multiples of 8. We pad if necessary and crop back.
 *
 * Returns RGBA pixels at the original resolution.
 */
async function runInpaint(
  imageRgba: Uint8ClampedArray,
  width: number,
  height: number,
  maskAlpha: Uint8ClampedArray,
  maskWidth: number,
  maskHeight: number,
): Promise<{ rgba: Uint8ClampedArray; width: number; height: number }> {
  if (!session) throw new Error('Model not loaded')

  // Padded dimensions
  const pH = padTo8(height)
  const pW = padTo8(width)

  // Build image tensor [1, 3, pH, pW]
  const imgTensor = new Float32Array(3 * pH * pW)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4
      const dstIdx = y * pW + x
      imgTensor[0 * pH * pW + dstIdx] = imageRgba[srcIdx] / 255     // R
      imgTensor[1 * pH * pW + dstIdx] = imageRgba[srcIdx + 1] / 255 // G
      imgTensor[2 * pH * pW + dstIdx] = imageRgba[srcIdx + 2] / 255 // B
    }
  }

  // Build mask tensor [1, 1, pH, pW]
  // mask may differ in size from image — scale if needed using nearest-neighbor
  const maskTensor = new Float32Array(pH * pW)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Map (x,y) in image space to mask space
      const mx = Math.min(Math.floor((x / width) * maskWidth), maskWidth - 1)
      const my = Math.min(Math.floor((y / height) * maskHeight), maskHeight - 1)
      const maskIdx = (my * maskWidth + mx) * 4
      // alpha > 127 means this pixel should be inpainted
      maskTensor[y * pW + x] = maskAlpha[maskIdx + 3] > 127 ? 1.0 : 0.0
    }
  }

  const imageFeed = new ort.Tensor('float32', imgTensor, [1, 3, pH, pW])
  const maskFeed = new ort.Tensor('float32', maskTensor, [1, 1, pH, pW])

  const results = await session.run({ image: imageFeed, mask: maskFeed })

  // Output is [1, 3, pH, pW] float32 RGB in 0–1
  const outKey = Object.keys(results)[0]
  const outData = results[outKey].data as Float32Array

  // Convert back to RGBA at original resolution
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcIdx = y * pW + x
      const dstIdx = (y * width + x) * 4
      rgba[dstIdx] = Math.round(Math.max(0, Math.min(1, outData[0 * pH * pW + srcIdx])) * 255)
      rgba[dstIdx + 1] = Math.round(Math.max(0, Math.min(1, outData[1 * pH * pW + srcIdx])) * 255)
      rgba[dstIdx + 2] = Math.round(Math.max(0, Math.min(1, outData[2 * pH * pW + srcIdx])) * 255)
      rgba[dstIdx + 3] = 255
    }
  }

  return { rgba, width, height }
}

// --- Message handling ---

interface LoadMsg { type: 'load'; modelPath: string }
interface RunMsg {
  type: 'run'
  imageRgba: number[]
  width: number
  height: number
  maskAlpha: number[]
  maskWidth: number
  maskHeight: number
}
interface UnloadMsg { type: 'unload' }

type WorkerMsg = LoadMsg | RunMsg | UnloadMsg

process.on('message', async (msg: WorkerMsg) => {
  try {
    switch (msg.type) {
      case 'load': {
        session = await ort.InferenceSession.create(msg.modelPath, {
          executionProviders: ['cpu'],
        })
        process.send!({ type: 'loaded' })
        break
      }
      case 'run': {
        const imageRgba = new Uint8ClampedArray(msg.imageRgba)
        const maskAlpha = new Uint8ClampedArray(msg.maskAlpha)
        const result = await runInpaint(
          imageRgba, msg.width, msg.height,
          maskAlpha, msg.maskWidth, msg.maskHeight,
        )
        process.send!({
          type: 'result',
          imageRgba: Array.from(result.rgba),
          width: result.width,
          height: result.height,
        })
        break
      }
      case 'unload': {
        if (session) {
          await session.release()
          session = null
        }
        process.send!({ type: 'unloaded' })
        break
      }
    }
  } catch (err) {
    process.send!({ type: 'error', message: (err as Error).message })
  }
})
