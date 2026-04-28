/// <reference types="vite/client" />

interface Window {
  api: {
    selectDirectory: () => Promise<string | null>
    getTerraformGraph: (cwd: string) => Promise<{ success: boolean; data?: string; error?: string }>
    readWorkspaceFiles: (cwd: string) => Promise<{ success: boolean; data?: string; error?: string }>
    writeWorkspaceFile: (cwd: string, filename: string, content: string) => Promise<{ success: boolean; error?: string }>
    queryOllama: (payload: any) => Promise<{ success: boolean; data?: any; error?: string }>
  }
}
