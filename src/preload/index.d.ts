import { ElectronAPI } from '@electron-toolkit/preload'

interface OllamaStreamEvent {
  requestId: string
  type: 'chunk' | 'done' | 'error'
  content?: string
  error?: string
  doneReason?: string
}

interface PlanChange {
  address: string
  action: string
}

interface ValidationResult {
  formatted: boolean
  valid: boolean
  diagnostics: string[]
}

interface SecurityFinding {
  ruleId: string
  severity: string
  description: string
  resource: string
  file: string
  line: number
}

type ScaffoldProvider = 'aws' | 'gcp' | 'azure'

interface TerraApi {
  selectDirectory: () => Promise<string | null>
  isWorkspaceEmpty: (cwd: string) => Promise<{ success: boolean; data?: boolean; error?: string }>
  scaffoldWorkspace: (payload: {
    cwd: string
    projectName: string
    provider: ScaffoldProvider
    environments: string[]
    force?: boolean
  }) => Promise<{ success: boolean; data?: { files: string[] }; error?: string }>
  getTerraformGraph: (cwd: string) => Promise<{ success: boolean; data?: string; error?: string }>
  readWorkspaceFiles: (cwd: string) => Promise<{ success: boolean; data?: string; error?: string }>
  readWorkspaceFile: (cwd: string, filename: string) => Promise<{ success: boolean; data?: string; error?: string }>
  writeWorkspaceFile: (cwd: string, filename: string, content: string) => Promise<{ success: boolean; error?: string }>
  findResource: (cwd: string, label: string) => Promise<{ success: boolean; data?: { file: string; snippet: string } | null; error?: string }>
  updateResource: (cwd: string, file: string, label: string, snippet: string) => Promise<{ success: boolean; error?: string }>
  getResourceAttributes: (cwd: string) => Promise<{ success: boolean; data?: Array<{ address: string; type: string; attributes: Record<string, string> }>; error?: string }>
  runTerraformPlan: (cwd: string, refreshOnly: boolean) => Promise<{ success: boolean; data?: { changes: PlanChange[]; summary: string }; error?: string }>
  validateTerraform: (cwd: string, filename?: string) => Promise<{ success: boolean; data?: ValidationResult; error?: string }>
  runSecurityScan: (cwd: string) => Promise<{ success: boolean; data?: SecurityFinding[]; error?: string }>
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
