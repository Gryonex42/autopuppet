/**
 * Image export & inpainting IPC handlers.
 *
 * - image:writeRgbaPng — writes RGBA pixel data as PNG via sharp
 * - inpaint:loadModel — loads LaMa ONNX model in a child process worker
 * - inpaint:run — runs inpainting on an image + mask
 * - inpaint:unloadModel — releases the model
 */

import { ipcMain } from 'electron'
import { dirname, join } from 'path'
import { mkdir } from 'fs/promises'
import { fork, type ChildProcess } from 'child_process'

let inpaintWorker: ChildProcess | null = null

/**
 * Send a message to the inpaint worker and wait for a response.
 */
function workerRequest(msg: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    if (!inpaintWorker) {
      reject(new Error('Inpaint worker not started'))
      return
    }
    const onMessage = (response: Record<string, unknown>): void => {
      inpaintWorker?.removeListener('message', onMessage)
      if (response.type === 'error') {
        reject(new Error(response.message as string))
      } else {
        resolve(response)
      }
    }
    inpaintWorker.on('message', onMessage)
    inpaintWorker.send(msg)
  })
}

export function registerSamIpcHandlers(): void {
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

  // --- Inpaint IPC handlers ---

  ipcMain.handle(
    'inpaint:loadModel',
    async (_event, modelPath: string): Promise<void> => {
      // Fork the worker process
      const workerPath = join(__dirname, 'inpaint-worker.js')
      inpaintWorker = fork(workerPath, [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] })

      inpaintWorker.on('exit', (code) => {
        console.log(`Inpaint worker exited with code ${code}`)
        inpaintWorker = null
      })

      await workerRequest({ type: 'load', modelPath })
    },
  )

  ipcMain.handle(
    'inpaint:run',
    async (
      _event,
      imageRgba: ArrayBuffer,
      width: number,
      height: number,
      maskAlpha: ArrayBuffer,
      maskWidth: number,
      maskHeight: number,
    ): Promise<{ imageRgba: ArrayBuffer; width: number; height: number }> => {
      const result = await workerRequest({
        type: 'run',
        imageRgba: Array.from(new Uint8Array(imageRgba)),
        width,
        height,
        maskAlpha: Array.from(new Uint8Array(maskAlpha)),
        maskWidth,
        maskHeight,
      })
      // Convert number[] back to ArrayBuffer for IPC transfer
      const rgbaArray = new Uint8Array(result.imageRgba as number[])
      return {
        imageRgba: rgbaArray.buffer.slice(rgbaArray.byteOffset, rgbaArray.byteOffset + rgbaArray.byteLength),
        width: result.width as number,
        height: result.height as number,
      }
    },
  )

  ipcMain.handle(
    'inpaint:unloadModel',
    async (): Promise<void> => {
      if (inpaintWorker) {
        await workerRequest({ type: 'unload' })
        inpaintWorker.kill()
        inpaintWorker = null
      }
    },
  )
}
