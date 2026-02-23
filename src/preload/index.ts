import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  ping: (): Promise<string> => ipcRenderer.invoke('ping'),
})
