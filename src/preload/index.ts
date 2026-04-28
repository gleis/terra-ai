import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const OLLAMA_STREAM_EVENT = 'ollama:stream-event'

// Custom APIs for renderer
const api = {
  selectDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
  getTerraformGraph: (cwd: string) => ipcRenderer.invoke('terraform:graph', cwd),
  readWorkspaceFiles: (cwd: string) => ipcRenderer.invoke('workspace:readFiles', cwd),
  writeWorkspaceFile: (cwd: string, filename: string, content: string) => ipcRenderer.invoke('workspace:writeFile', { cwd, filename, content }),
  listOllamaModels: () => ipcRenderer.invoke('ollama:listModels'),
  streamOllama: (payload: any) => ipcRenderer.invoke('ollama:stream', payload),
  onOllamaStreamEvent: (callback: (event: any) => void) => {
    const listener = (_event, data) => callback(data)
    ipcRenderer.on(OLLAMA_STREAM_EVENT, listener)
    return () => ipcRenderer.removeListener(OLLAMA_STREAM_EVENT, listener)
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
