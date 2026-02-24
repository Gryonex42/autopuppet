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
  /** SAM: load encoder + decoder models, returns session ID */
  samLoadModel(encoderPath: string, decoderPath: string): Promise<string>
  /** SAM: encode image tensor, returns embedding ArrayBuffer */
  samEncode(sessionId: string, inputData: ArrayBuffer): Promise<ArrayBuffer>
  /** SAM: decode with prompts, returns masks + IoU */
  samDecode(
    sessionId: string,
    embeddingData: ArrayBuffer,
    coordsData: ArrayBuffer,
    labelsData: ArrayBuffer,
    numPoints: number,
  ): Promise<{ masks: ArrayBuffer; iou: ArrayBuffer; numMasks: number; maskHeight: number; maskWidth: number }>
  /** SAM: release session resources */
  samUnloadModel(sessionId: string): Promise<void>
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
  samLoadModel: (encoderPath, decoderPath) =>
    ipcRenderer.invoke('sam:loadModel', encoderPath, decoderPath),
  samEncode: (sessionId, inputData) =>
    ipcRenderer.invoke('sam:encode', sessionId, inputData),
  samDecode: (sessionId, embeddingData, coordsData, labelsData, numPoints) =>
    ipcRenderer.invoke('sam:decode', sessionId, embeddingData, coordsData, labelsData, numPoints),
  samUnloadModel: (sessionId) =>
    ipcRenderer.invoke('sam:unloadModel', sessionId),
}

contextBridge.exposeInMainWorld('api', api)
