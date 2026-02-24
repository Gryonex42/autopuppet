interface FileFilter {
  name: string
  extensions: string[]
}

interface DirEntry {
  name: string
  isDirectory: boolean
}

interface ElectronApi {
  ping(): Promise<string>
  openFile(options?: { filters?: FileFilter[] }): Promise<string | null>
  saveFile(options?: { filters?: FileFilter[]; defaultPath?: string }): Promise<string | null>
  readFile(filePath: string): Promise<ArrayBuffer>
  writeFile(filePath: string, data: ArrayBuffer): Promise<void>
  readDir(dirPath: string): Promise<DirEntry[]>
  onMenuAction(callback: (action: string) => void): () => void
  writeRgbaPng(filePath: string, rgbaBuffer: ArrayBuffer, width: number, height: number): Promise<void>
  samLoadModel(encoderPath: string, decoderPath: string): Promise<string>
  samEncode(sessionId: string, inputData: ArrayBuffer): Promise<ArrayBuffer>
  samDecode(
    sessionId: string,
    embeddingData: ArrayBuffer,
    coordsData: ArrayBuffer,
    labelsData: ArrayBuffer,
    numPoints: number,
  ): Promise<{ masks: ArrayBuffer; iou: ArrayBuffer; numMasks: number; maskHeight: number; maskWidth: number }>
  samUnloadModel(sessionId: string): Promise<void>
}

declare global {
  interface Window {
    api: ElectronApi
  }
}

export {}
