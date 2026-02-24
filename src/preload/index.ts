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
  /** Write RGBA pixel data as PNG using sharp */
  writeRgbaPng(filePath: string, rgbaBuffer: ArrayBuffer, width: number, height: number): Promise<void>
  /** Load the LaMa inpainting model */
  inpaintLoadModel(modelPath: string): Promise<void>
  /** Run LaMa inpainting: fill masked regions of the image */
  inpaintRun(
    imageRgba: ArrayBuffer, width: number, height: number,
    maskAlpha: ArrayBuffer, maskWidth: number, maskHeight: number,
  ): Promise<{ imageRgba: ArrayBuffer; width: number; height: number }>
  /** Unload the LaMa model and kill the worker */
  inpaintUnloadModel(): Promise<void>
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
  writeRgbaPng: (filePath, rgbaBuffer, width, height) =>
    ipcRenderer.invoke('image:writeRgbaPng', filePath, rgbaBuffer, width, height),
  inpaintLoadModel: (modelPath) =>
    ipcRenderer.invoke('inpaint:loadModel', modelPath),
  inpaintRun: (imageRgba, width, height, maskAlpha, maskWidth, maskHeight) =>
    ipcRenderer.invoke('inpaint:run', imageRgba, width, height, maskAlpha, maskWidth, maskHeight),
  inpaintUnloadModel: () =>
    ipcRenderer.invoke('inpaint:unloadModel'),
}

contextBridge.exposeInMainWorld('api', api)
