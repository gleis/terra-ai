export type ProcessFailure = Error & { code?: string; stdout?: string; stderr?: string }
export function processFailure(error: unknown): ProcessFailure {
  if (error instanceof Error) return error as ProcessFailure
  return new Error(String(error))
}
