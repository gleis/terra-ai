export type PlanChange = {
  address: string
  action: string
}

export type SecurityFinding = {
  ruleId: string
  severity: string
  description: string
  resource: string
  file: string
  line: number
}

export type ValidationResult = {
  formatted: boolean
  valid: boolean
  diagnostics: string[]
}
