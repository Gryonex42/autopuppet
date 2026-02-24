import { contextBridge, ipcRenderer } from 'electron'

export interface FileFilter {
  name: string
  extensions: string[]
}

export interface DirEntry {
  name: string
  isDirectory: boolean
}

export interface ElectronApi {
  ping(): Promise<string>
  openFile(options?: { filters?: FileFilter[] }): Promise<string | null>
  saveFile(options?: { filters?: FileFilter[]; defaultPath?: string }): Promise<string | null>
  readFile(filePath: string): Promise<ArrayBuffer>
  writeFile(filePath: string, data: ArrayBuffer): Promise<void>
  readDir(dirPath: string): Promise<DirEntry[]>
  /** Receive menu actions from the main process */
  onMenuAction(callback: (action: string) => void): () => void
}

const api: ElectronApi = {
  ping: () => ipcRenderer.invoke('ping'),
  openFile: (options) => ipcRenderer.invoke('dialog:openFile', options ?? {}),
  saveFile: (options) => ipcRenderer.invoke('dialog:saveFile', options ?? {}),
  readFile: (filePath) => ipcRenderer.invoke('fs:readFile', filePath),
  writeFile: (filePath, data) => ipcRenderer.invoke('fs:writeFile', filePath, data),
  readDir: (dirPath) => ipcRenderer.invoke('fs:readDir', dirPath),
  onMenuAction: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, action: string): void => {
      callback(action)
    }
    ipcRenderer.on('menu:action', handler)
    return () => ipcRenderer.removeListener('menu:action', handler)
  },
}

contextBridge.exposeInMainWorld('api', api)
