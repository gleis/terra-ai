/// <reference types="vite/client" />

interface OllamaStreamEvent {
  requestId: string
  type: 'chunk' | 'done' | 'error'
  content?: string
  error?: string
}

interface Window {
  api: {
    selectDirectory: () => Promise<string | null>
    getTerraformGraph: (cwd: string) => Promise<{ success: boolean; data?: string; error?: string }>
    readWorkspaceFiles: (cwd: string) => Promise<{ success: boolean; data?: string; error?: string }>
    writeWorkspaceFile: (cwd: string, filename: string, content: string) => Promise<{ success: boolean; error?: string }>
    listOllamaModels: () => Promise<{ success: boolean; data?: string[]; error?: string }>
    streamOllama: (payload: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>
    onOllamaStreamEvent: (callback: (event: OllamaStreamEvent) => void) => () => void
  }
}
