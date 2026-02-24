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
  /** SAM ONNX model operations */
  samLoadModel(encoderPath: string, decoderPath: string): Promise<string>
  samEncode(sessionId: string, inputBuffer: ArrayBuffer): Promise<ArrayBuffer>
  samDecode(
    sessionId: string,
    embeddingBuffer: ArrayBuffer,
    points: [number, number][],
    labels: number[],
    box?: [number, number, number, number],
  ): Promise<ArrayBuffer>
  samUnloadModel(sessionId: string): Promise<void>
  /** Write RGBA pixel data as PNG using sharp */
  writeRgbaPng(filePath: string, rgbaBuffer: ArrayBuffer, width: number, height: number): Promise<void>
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
  samLoadModel: (encoderPath, decoderPath) =>
    ipcRenderer.invoke('sam:loadModel', encoderPath, decoderPath),
  samEncode: (sessionId, inputBuffer) =>
    ipcRenderer.invoke('sam:encode', sessionId, inputBuffer),
  samDecode: (sessionId, embeddingBuffer, points, labels, box) =>
    ipcRenderer.invoke('sam:decode', sessionId, embeddingBuffer, points, labels, box),
  samUnloadModel: (sessionId) =>
    ipcRenderer.invoke('sam:unloadModel', sessionId),
  writeRgbaPng: (filePath, rgbaBuffer, width, height) =>
    ipcRenderer.invoke('image:writeRgbaPng', filePath, rgbaBuffer, width, height),
}

contextBridge.exposeInMainWorld('api', api)
