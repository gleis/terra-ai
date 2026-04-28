import { ElectronAPI } from '@electron-toolkit/preload'

interface OllamaStreamEvent {
  requestId: string
  type: 'chunk' | 'done' | 'error'
  content?: string
  error?: string
}

interface TerraApi {
  selectDirectory: () => Promise<string | null>
  getTerraformGraph: (cwd: string) => Promise<{ success: boolean; data?: string; error?: string }>
  readWorkspaceFiles: (cwd: string) => Promise<{ success: boolean; data?: string; error?: string }>
  writeWorkspaceFile: (cwd: string, filename: string, content: string) => Promise<{ success: boolean; error?: string }>
  listOllamaModels: () => Promise<{ success: boolean; data?: string[]; error?: string }>
  generateOllama: (payload: Record<string, unknown>) => Promise<{ success: boolean; data?: any; error?: string }>
  streamOllama: (payload: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>
  onOllamaStreamEvent: (callback: (event: OllamaStreamEvent) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: TerraApi
  }
}
