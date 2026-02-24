/**
 * SAM inference worker — runs in a child process to avoid blocking
 * the Electron main process event loop.
 *
 * Communication: JSON messages over process IPC.
 * - Parent sends: { type, id, ...payload }
 * - Worker replies: { id, result } or { id, error }
 *
 * ArrayBuffers are sent as base64 strings to avoid serialization issues.
 */

import * as ort from 'onnxruntime-node'
import { readFile } from 'fs/promises'

interface SAMSessionState {
  encoder: ort.InferenceSession
  decoder: ort.InferenceSession
}

const sessions = new Map<string, SAMSessionState>()
let nextId = 0

function toBase64(buf: ArrayBuffer): string {
  return Buffer.from(buf).toString('base64')
}

function fromBase64(b64: string): Buffer {
  return Buffer.from(b64, 'base64')
}

/** Convert base64 string to a clean Float32Array (avoids Node Buffer pool issues) */
function float32FromBase64(b64: string): Float32Array {
  const buf = fromBase64(b64)
  // Copy to a dedicated ArrayBuffer — Buffer.buffer is a shared pool
  const ab = new ArrayBuffer(buf.byteLength)
  new Uint8Array(ab).set(buf)
  return new Float32Array(ab)
}

async function handleMessage(msg: Record<string, unknown>): Promise<unknown> {
  switch (msg.type) {
    case 'loadModel': {
      const encoderPath = msg.encoderPath as string
      const decoderPath = msg.decoderPath as string

      const encoderBuf = await readFile(encoderPath)
      const decoderBuf = await readFile(decoderPath)

      const opts: ort.InferenceSession.SessionOptions = {
        executionProviders: ['cpu'],
        intraOpNumThreads: 4,
        interOpNumThreads: 1,
      }

      const encoder = await ort.InferenceSession.create(encoderBuf, opts)
      const decoder = await ort.InferenceSession.create(decoderBuf, opts)

      const id = `sam-${nextId++}`
      sessions.set(id, { encoder, decoder })
      console.log(`SAM worker: loaded session ${id}`)
      return { sessionId: id }
    }

    case 'encode': {
      const sessionId = msg.sessionId as string
      const session = sessions.get(sessionId)
      if (!session) throw new Error(`SAM session ${sessionId} not found`)

      const inputFloat = float32FromBase64(msg.inputData as string)
      const inputTensor = new ort.Tensor('float32', inputFloat, [1024, 1024, 3])

      console.log('SAM worker: running encoder...')
      const t0 = Date.now()
      const results = await session.encoder.run({ input_image: inputTensor })
      console.log(`SAM worker: encoder done in ${((Date.now() - t0) / 1000).toFixed(1)}s`)

      const embedding = results['image_embeddings'].data as Float32Array
      const buf = new ArrayBuffer(embedding.byteLength)
      new Float32Array(buf).set(embedding)
      return { embedding: toBase64(buf) }
    }

    case 'decode': {
      const sessionId = msg.sessionId as string
      const session = sessions.get(sessionId)
      if (!session) throw new Error(`SAM session ${sessionId} not found`)

      const embeddingData = float32FromBase64(msg.embeddingData as string)
      const coordsData = float32FromBase64(msg.coordsData as string)
      const labelsData = float32FromBase64(msg.labelsData as string)
      const numPoints = msg.numPoints as number

      const embeddingTensor = new ort.Tensor('float32', embeddingData, [1, 256, 64, 64])
      const pointCoords = new ort.Tensor('float32', coordsData, [1, numPoints, 2])
      const pointLabels = new ort.Tensor('float32', labelsData, [1, numPoints])
      const maskInput = new ort.Tensor('float32', new Float32Array(256 * 256), [1, 1, 256, 256])
      const hasMask = new ort.Tensor('float32', new Float32Array([0]), [1])
      const origImSize = new ort.Tensor('float32', new Float32Array([1024, 1024]), [2])

      const results = await session.decoder.run({
        image_embeddings: embeddingTensor,
        point_coords: pointCoords,
        point_labels: pointLabels,
        mask_input: maskInput,
        has_mask_input: hasMask,
        orig_im_size: origImSize,
      })

      const masksData = results['masks'].data as Float32Array
      const maskDims = results['masks'].dims as readonly number[] // e.g. [1, 3, 1024, 1024]
      const iouData = results['iou_predictions'].data as Float32Array

      console.log(`SAM worker: mask output shape: [${maskDims.join(', ')}]`)

      const masksBuf = new ArrayBuffer(masksData.byteLength)
      new Float32Array(masksBuf).set(masksData)
      const iouBuf = new ArrayBuffer(iouData.byteLength)
      new Float32Array(iouBuf).set(iouData)

      return {
        masks: toBase64(masksBuf),
        iou: toBase64(iouBuf),
        numMasks: maskDims[1],
        maskHeight: maskDims[2],
        maskWidth: maskDims[3],
      }
    }

    case 'unloadModel': {
      const sessionId = msg.sessionId as string
      const session = sessions.get(sessionId)
      if (session) {
        await session.encoder.release()
        await session.decoder.release()
        sessions.delete(sessionId)
        console.log(`SAM worker: unloaded session ${sessionId}`)
      }
      return {}
    }

    default:
      throw new Error(`Unknown message type: ${msg.type}`)
  }
}

// Listen for messages from the parent process
process.on('message', async (msg: Record<string, unknown>) => {
  const id = msg.id as number
  try {
    const result = await handleMessage(msg)
    process.send!({ id, result })
  } catch (err) {
    process.send!({ id, error: err instanceof Error ? err.message : String(err) })
  }
})

// Signal readiness
process.send!({ type: 'ready' })
