/**
 * Image export IPC handlers — writes RGBA pixel data as PNG via sharp.
 */

import { ipcMain } from 'electron'
import { dirname } from 'path'
import { mkdir } from 'fs/promises'

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
}
