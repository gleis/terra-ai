import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { delimiter } from 'node:path'
import { parseSecurityFindings, type Finding } from './security-findings'
const run = promisify(execFile)
export async function scanWorkspaceSecurity(cwd: string): Promise<Finding[]> {
  const env = {
    ...process.env,
    PATH: [process.env.PATH, '/opt/homebrew/bin', '/usr/local/bin'].filter(Boolean).join(delimiter)
  }
  const options = { cwd, env, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8' as const }
  let stdout: string
  try {
    ;({ stdout } = await run(
      'trivy',
      ['config', '.', '--format', 'json', '--exit-code', '0'],
      options
    ))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    try {
      ;({ stdout } = await run('tfsec', ['.', '--format', 'json', '--no-color'], options))
    } catch (failure) {
      const details = failure as NodeJS.ErrnoException & { stdout?: string }
      if (details.code === 'ENOENT')
        throw new Error('Install Trivy (recommended) or tfsec to scan Terraform configuration.')
      if (!details.stdout?.trim().startsWith('{')) throw failure
      stdout = details.stdout
    }
  }
  return parseSecurityFindings(JSON.parse(stdout))
}
