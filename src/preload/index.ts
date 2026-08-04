import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const OLLAMA_STREAM_EVENT = 'ollama:stream-event'

// Custom APIs for renderer
const api = {
  selectDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
  isWorkspaceEmpty: (cwd: string) => ipcRenderer.invoke('workspace:isEmpty', cwd),
  scaffoldWorkspace: (payload: {
    cwd: string
    projectName: string
    provider: 'aws' | 'gcp' | 'azure'
    environments: string[]
    force?: boolean
  }) => ipcRenderer.invoke('workspace:scaffold', payload),
  getTerraformGraph: (cwd: string) => ipcRenderer.invoke('terraform:graph', cwd),
  readWorkspaceFiles: (cwd: string) => ipcRenderer.invoke('workspace:readFiles', cwd),
  readWorkspaceFile: (cwd: string, filename: string) => ipcRenderer.invoke('workspace:readFile', { cwd, filename }),
  writeWorkspaceFile: (cwd: string, filename: string, content: string) => ipcRenderer.invoke('workspace:writeFile', { cwd, filename, content }),
  findResource: (cwd: string, label: string) => ipcRenderer.invoke('workspace:findResource', { cwd, label }),
  updateResource: (cwd: string, file: string, label: string, snippet: string) =>
    ipcRenderer.invoke('workspace:updateResource', { cwd, file, label, snippet }),
  getResourceAttributes: (cwd: string) => ipcRenderer.invoke('workspace:resourceAttributes', cwd),
  runTerraformPlan: (cwd: string, refreshOnly: boolean) => ipcRenderer.invoke('terraform:plan', { cwd, refreshOnly }),
  validateTerraform: (cwd: string, filename?: string) => ipcRenderer.invoke('terraform:validate', { cwd, filename }),
  runSecurityScan: (cwd: string) => ipcRenderer.invoke('security:scan', cwd),
  listOllamaModels: () => ipcRenderer.invoke('ollama:listModels'),
  generateOllama: (payload: any) => ipcRenderer.invoke('ollama:generate', payload),
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
