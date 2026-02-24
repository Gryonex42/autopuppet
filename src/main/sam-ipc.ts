/**
 * SAM ONNX IPC handlers — proxies inference to a forked child process
 * running onnxruntime-node, so the Electron main process event loop
 * stays responsive and doesn't get killed by Chromium watchdogs.
 */

import { ipcMain } from 'electron'
import { fork, type ChildProcess } from 'child_process'
import { join, dirname } from 'path'
import { mkdir } from 'fs/promises'

let worker: ChildProcess | null = null
let workerReady = false
let msgId = 0
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

function ensureWorker(): ChildProcess {
  if (worker && !worker.killed) return worker

  const workerPath = join(__dirname, 'sam-worker.js')
  worker = fork(workerPath, [], { stdio: ['pipe', 'inherit', 'inherit', 'ipc'] })

  worker.on('message', (msg: { id?: number; type?: string; result?: unknown; error?: string }) => {
    if (msg.type === 'ready') {
      workerReady = true
      console.log('SAM worker: ready')
      return
    }
    if (msg.id !== undefined) {
      const p = pending.get(msg.id)
      if (p) {
        pending.delete(msg.id)
        if (msg.error) {
          p.reject(new Error(msg.error))
        } else {
          p.resolve(msg.result)
        }
      }
    }
  })

  worker.on('exit', (code) => {
    console.error(`SAM worker exited with code ${code}`)
    workerReady = false
    // Reject all pending requests
    for (const [id, p] of pending) {
      p.reject(new Error(`SAM worker exited (code ${code})`))
      pending.delete(id)
    }
    worker = null
  })

  return worker
}

function sendToWorker(msg: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const w = ensureWorker()
    const id = msgId++
    pending.set(id, { resolve, reject })
    w.send({ ...msg, id })
  })
}

function toBase64(buf: ArrayBuffer): string {
  return Buffer.from(buf).toString('base64')
}

function fromBase64(b64: string): Buffer {
  return Buffer.from(b64, 'base64')
}

export function registerSamIpcHandlers(): void {
  // Write RGBA pixel data as PNG using sharp
  const sharp = require('sharp') as typeof import('sharp')

  ipcMain.handle(
    'image:writeRgbaPng',
    async (_event, filePath: string, rgbaBuffer: ArrayBuffer, width: number, height: number): Promise<void> => {
      await mkdir(dirname(filePath), { recursive: true })
      await sharp(Buffer.from(rgbaBuffer), {
        raw: { width, height, channels: 4 },
      })
        .png()
        .toFile(filePath)
    },
  )

  ipcMain.handle(
    'sam:loadModel',
    async (_event, encoderPath: string, decoderPath: string): Promise<string> => {
      const result = (await sendToWorker({
        type: 'loadModel',
        encoderPath,
        decoderPath,
      })) as { sessionId: string }
      return result.sessionId
    },
  )

  ipcMain.handle(
    'sam:encode',
    async (_event, sessionId: string, inputData: ArrayBuffer): Promise<ArrayBuffer> => {
      const result = (await sendToWorker({
        type: 'encode',
        sessionId,
        inputData: toBase64(inputData),
      })) as { embedding: string }
      const embBuf = fromBase64(result.embedding)
      return (embBuf.buffer as ArrayBuffer).slice(embBuf.byteOffset, embBuf.byteOffset + embBuf.byteLength)
    },
  )

  ipcMain.handle(
    'sam:decode',
    async (
      _event,
      sessionId: string,
      embeddingData: ArrayBuffer,
      coordsData: ArrayBuffer,
      labelsData: ArrayBuffer,
      numPoints: number,
    ): Promise<{ masks: ArrayBuffer; iou: ArrayBuffer; numMasks: number; maskHeight: number; maskWidth: number }> => {
      const result = (await sendToWorker({
        type: 'decode',
        sessionId,
        embeddingData: toBase64(embeddingData),
        coordsData: toBase64(coordsData),
        labelsData: toBase64(labelsData),
        numPoints,
      })) as { masks: string; iou: string; numMasks: number; maskHeight: number; maskWidth: number }
      const masksBuf = fromBase64(result.masks)
      const iouBuf = fromBase64(result.iou)
      return {
        masks: (masksBuf.buffer as ArrayBuffer).slice(masksBuf.byteOffset, masksBuf.byteOffset + masksBuf.byteLength),
        iou: (iouBuf.buffer as ArrayBuffer).slice(iouBuf.byteOffset, iouBuf.byteOffset + iouBuf.byteLength),
        numMasks: result.numMasks,
        maskHeight: result.maskHeight,
        maskWidth: result.maskWidth,
      }
    },
  )

  ipcMain.handle('sam:unloadModel', async (_event, sessionId: string): Promise<void> => {
    await sendToWorker({ type: 'unloadModel', sessionId })
  })
}
