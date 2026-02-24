/**
 * SAM ONNX IPC handlers — runs ONNX inference in the main process.
 */

import { ipcMain } from 'electron'
import * as ort from 'onnxruntime-node'
import sharp from 'sharp'

interface SAMSessionState {
  encoder: ort.InferenceSession
  decoder: ort.InferenceSession
}

const sessions = new Map<string, SAMSessionState>()
let nextSessionId = 1

export function registerSamIpcHandlers(): void {
  ipcMain.handle(
    'sam:loadModel',
    async (_event, encoderPath: string, decoderPath: string): Promise<string> => {
      const encoder = await ort.InferenceSession.create(encoderPath, {
        executionProviders: ['cpu'],
      })
      const decoder = await ort.InferenceSession.create(decoderPath, {
        executionProviders: ['cpu'],
      })

      const sessionId = `sam-${nextSessionId++}`
      sessions.set(sessionId, { encoder, decoder })
      return sessionId
    },
  )

  ipcMain.handle(
    'sam:encode',
    async (_event, sessionId: string, inputBuffer: ArrayBuffer): Promise<ArrayBuffer> => {
      const session = sessions.get(sessionId)
      if (!session) throw new Error(`SAM session ${sessionId} not found`)

      const inputTensor = new ort.Tensor('float32', new Float32Array(inputBuffer), [1, 3, 1024, 1024])
      const results = await session.encoder.run({ input_image: inputTensor })

      // SAM encoder output is typically named 'image_embeddings'
      const embeddingTensor = results['image_embeddings']
      const data = embeddingTensor.data as Float32Array
      // Copy to a plain ArrayBuffer for IPC transfer
      const out = new ArrayBuffer(data.byteLength)
      new Float32Array(out).set(data)
      return out
    },
  )

  ipcMain.handle(
    'sam:decode',
    async (
      _event,
      sessionId: string,
      embeddingBuffer: ArrayBuffer,
      points: [number, number][],
      labels: number[],
      box?: [number, number, number, number],
    ): Promise<ArrayBuffer> => {
      const session = sessions.get(sessionId)
      if (!session) throw new Error(`SAM session ${sessionId} not found`)

      const embedding = new ort.Tensor('float32', new Float32Array(embeddingBuffer), [1, 256, 64, 64])

      // Build point coordinate and label tensors
      // SAM decoder expects: point_coords [1, N, 2], point_labels [1, N]
      const numPoints = points.length + (box ? 2 : 0)
      const coordsData = new Float32Array(numPoints * 2)
      const labelsData = new Float32Array(numPoints)

      let idx = 0
      for (let i = 0; i < points.length; i++) {
        coordsData[idx * 2] = points[i][0]
        coordsData[idx * 2 + 1] = points[i][1]
        labelsData[idx] = labels[i]
        idx++
      }

      // If box prompt, add top-left (label=2) and bottom-right (label=3)
      if (box) {
        coordsData[idx * 2] = box[0]
        coordsData[idx * 2 + 1] = box[1]
        labelsData[idx] = 2
        idx++
        coordsData[idx * 2] = box[2]
        coordsData[idx * 2 + 1] = box[3]
        labelsData[idx] = 3
      }

      const pointCoords = new ort.Tensor('float32', coordsData, [1, numPoints, 2])
      const pointLabels = new ort.Tensor('float32', labelsData, [1, numPoints])

      // SAM decoder also requires mask_input and has_mask_input
      const maskInput = new ort.Tensor('float32', new Float32Array(256 * 256), [1, 1, 256, 256])
      const hasMask = new ort.Tensor('float32', new Float32Array([0]), [1])

      // Original image size for the decoder
      const origImSize = new ort.Tensor('float32', new Float32Array([1024, 1024]), [2])

      const feeds: Record<string, ort.Tensor> = {
        image_embeddings: embedding,
        point_coords: pointCoords,
        point_labels: pointLabels,
        mask_input: maskInput,
        has_mask_input: hasMask,
        orig_im_size: origImSize,
      }

      const results = await session.decoder.run(feeds)

      // SAM decoder outputs 'masks' [1, numMasks, 256, 256] and 'iou_predictions' [1, numMasks]
      const masksTensor = results['masks']
      const iouTensor = results['iou_predictions']

      // Pick the mask with highest IoU score
      const iouData = iouTensor.data as Float32Array
      let bestIdx = 0
      for (let i = 1; i < iouData.length; i++) {
        if (iouData[i] > iouData[bestIdx]) bestIdx = i
      }

      // Extract the best mask (256x256 float values)
      const allMasks = masksTensor.data as Float32Array
      const maskSize = 256 * 256
      const bestMask = allMasks.slice(bestIdx * maskSize, (bestIdx + 1) * maskSize)

      // Copy to a plain ArrayBuffer for IPC transfer
      const out = new ArrayBuffer(bestMask.byteLength)
      new Float32Array(out).set(bestMask)
      return out
    },
  )

  ipcMain.handle(
    'sam:unloadModel',
    async (_event, sessionId: string): Promise<void> => {
      const session = sessions.get(sessionId)
      if (session) {
        await session.encoder.release()
        await session.decoder.release()
        sessions.delete(sessionId)
      }
    },
  )

  // Write RGBA pixel data as PNG using sharp
  ipcMain.handle(
    'image:writeRgbaPng',
    async (_event, filePath: string, rgbaBuffer: ArrayBuffer, width: number, height: number): Promise<void> => {
      await sharp(Buffer.from(rgbaBuffer), {
        raw: { width, height, channels: 4 },
      })
        .png()
        .toFile(filePath)
    },
  )
}
