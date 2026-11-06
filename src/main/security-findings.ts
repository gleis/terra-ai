export type Finding = {
  ruleId: string
  severity: string
  description: string
  resource: string
  file: string
  line: number
}
type TrivyFinding = {
  ID?: string
  AVDID?: string
  Severity?: string
  Description?: string
  Title?: string
  CauseMetadata?: { Resource?: string; StartLine?: number }
}
type TfsecFinding = {
  rule_id?: string
  long_id?: string
  severity?: string
  description?: string
  rule_description?: string
  resource?: string
  location?: { filename?: string; start_line?: number }
}
export function parseSecurityFindings(report: {
  Results?: Array<{ Target?: string; Misconfigurations?: TrivyFinding[] }>
  results?: TfsecFinding[]
}): Finding[] {
  if (report.Results)
    return report.Results.flatMap((result) =>
      (result.Misconfigurations || []).map((item) => ({
        ruleId: item.AVDID || item.ID || 'unknown',
        severity: item.Severity || 'UNKNOWN',
        description: item.Description || item.Title || '',
        resource: item.CauseMetadata?.Resource || '',
        file: result.Target || '',
        line: item.CauseMetadata?.StartLine || 0
      }))
    )
  return (report.results || []).map((item) => ({
    ruleId: item.rule_id || item.long_id || 'unknown',
    severity: item.severity || 'UNKNOWN',
    description: item.description || item.rule_description || '',
    resource: item.resource || '',
    file: item.location?.filename || '',
    line: item.location?.start_line || 0
  }))
}
