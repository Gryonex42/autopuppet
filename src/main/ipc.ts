import { ipcMain, dialog, BrowserWindow } from 'electron'
import { readFile, writeFile, readdir } from 'fs/promises'

export function registerIpcHandlers(): void {
  ipcMain.handle('ping', () => 'pong')

  ipcMain.handle(
    'dialog:openFile',
    async (_event, options: { filters?: { name: string; extensions: string[] }[] }) => {
      const win = BrowserWindow.getFocusedWindow()
      if (!win) return null
      const result = await dialog.showOpenDialog(win, {
        properties: ['openFile'],
        filters: options?.filters,
      })
      if (result.canceled || result.filePaths.length === 0) return null
      return result.filePaths[0]
    },
  )

  ipcMain.handle(
    'dialog:saveFile',
    async (_event, options: { filters?: { name: string; extensions: string[] }[]; defaultPath?: string }) => {
      const win = BrowserWindow.getFocusedWindow()
      if (!win) return null
      const result = await dialog.showSaveDialog(win, {
        filters: options?.filters,
        defaultPath: options?.defaultPath,
      })
      if (result.canceled || !result.filePath) return null
      return result.filePath
    },
  )

  ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
    const buffer = await readFile(filePath)
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  })

  ipcMain.handle('fs:writeFile', async (_event, filePath: string, data: ArrayBuffer) => {
    await writeFile(filePath, Buffer.from(data))
  })

  ipcMain.handle('fs:readDir', async (_event, dirPath: string) => {
    const entries = await readdir(dirPath, { withFileTypes: true })
    return entries.map((e) => ({ name: e.name, isDirectory: e.isDirectory() }))
  })
}
