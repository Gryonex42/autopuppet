import { ipcMain } from 'electron'

export function registerIpcHandlers(): void {
  // Placeholder — IPC handlers will be added in Task 6
  ipcMain.handle('ping', () => 'pong')
}
