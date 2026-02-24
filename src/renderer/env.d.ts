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
  writeRgbaPng(filePath: string, rgbaBuffer: ArrayBuffer, width: number, height: number): Promise<void>
}

declare global {
  interface Window {
    api: ElectronApi
  }
}

export {}
