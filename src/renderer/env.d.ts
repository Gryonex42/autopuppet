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
}

declare global {
  interface Window {
    api: ElectronApi
  }
}

export {}
