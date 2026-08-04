import { useState } from 'react'

export type ScaffoldProvider = 'aws' | 'gcp' | 'azure'

export type ScaffoldFormValues = {
  projectName: string
  provider: ScaffoldProvider
  environments: string[]
  description: string
}

type ScaffoldWizardProps = {
  targetPath: string
  targetEmpty: boolean
  busy: boolean
  error: string | null
  onCreate: (values: ScaffoldFormValues, force: boolean) => void
  onClose: () => void
}

const ALL_ENVIRONMENTS = ['dev', 'staging', 'prod']

const PROVIDER_LABELS: Record<ScaffoldProvider, string> = {
  aws: 'AWS',
  gcp: 'Google Cloud',
  azure: 'Azure'
}

// Collects the inputs needed to scaffold a new production-ready Terraform
// root module: name, provider, environments, and a free-text description of
// the infrastructure to hand off to the AI once the skeleton is written.
export default function ScaffoldWizard({
  targetPath,
  targetEmpty,
  busy,
  error,
  onCreate,
  onClose
}: ScaffoldWizardProps): React.JSX.Element {
  const [projectName, setProjectName] = useState('')
  const [provider, setProvider] = useState<ScaffoldProvider>('aws')
  const [environments, setEnvironments] = useState<string[]>(['dev', 'staging', 'prod'])
  const [description, setDescription] = useState('')
  const [acknowledgeNonEmpty, setAcknowledgeNonEmpty] = useState(false)

  const toggleEnvironment = (env: string): void => {
    setEnvironments((prev) => (prev.includes(env) ? prev.filter((e) => e !== env) : [...prev, env]))
  }

  const canSubmit =
    projectName.trim().length > 0 &&
    environments.length > 0 &&
    (targetEmpty || acknowledgeNonEmpty) &&
    !busy

  const submit = (): void => {
    if (!canSubmit) return
    onCreate(
      {
        projectName: projectName.trim(),
        provider,
        environments,
        description: description.trim()
      },
      !targetEmpty
    )
  }

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-6">
      <div className="bg-slate-900 border border-slate-700 w-full max-w-xl max-h-[85vh] rounded-xl shadow-2xl overflow-hidden flex flex-col">
        <div className="p-4 border-b border-slate-800 flex justify-between items-start">
          <div className="min-w-0">
            <h3 className="text-slate-100 font-medium">New Workspace</h3>
            <p className="text-xs text-slate-400 mt-1 font-mono truncate">{targetPath}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 ml-4 shrink-0">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {!targetEmpty && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
              This folder is not empty. Scaffolded files will be added alongside what is already
              there — existing files with the same name will be overwritten.
              <label className="mt-2 flex items-center gap-2 text-amber-100">
                <input
                  type="checkbox"
                  checked={acknowledgeNonEmpty}
                  onChange={(e) => setAcknowledgeNonEmpty(e.target.checked)}
                  className="accent-amber-400"
                />
                Use this folder anyway
              </label>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Project name</label>
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="e.g. payments-platform"
              className="w-full bg-slate-950 border border-slate-700 text-slate-200 text-sm rounded-md px-3 py-2 outline-none focus:border-indigo-500 placeholder:text-slate-600"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Cloud provider</label>
            <div className="flex gap-2">
              {(Object.keys(PROVIDER_LABELS) as ScaffoldProvider[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setProvider(p)}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                    provider === p
                      ? 'border-indigo-500 bg-indigo-600/20 text-indigo-200'
                      : 'border-slate-700 bg-slate-950 text-slate-400 hover:border-slate-600'
                  }`}
                >
                  {PROVIDER_LABELS[p]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Environments</label>
            <div className="flex gap-2">
              {ALL_ENVIRONMENTS.map((env) => (
                <label
                  key={env}
                  className={`flex-1 flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer transition-colors ${
                    environments.includes(env)
                      ? 'border-indigo-500 bg-indigo-600/20 text-indigo-200'
                      : 'border-slate-700 bg-slate-950 text-slate-400 hover:border-slate-600'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={environments.includes(env)}
                    onChange={() => toggleEnvironment(env)}
                    className="accent-indigo-500"
                  />
                  {env}
                </label>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              Each environment gets its own backend config and tfvars, sharing one root module.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">
              What should this workspace deploy?{' '}
              <span className="text-slate-600 font-normal">
                (optional — used to prompt the AI after scaffolding)
              </span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder="e.g. A 3-tier web app: VPC with public/private subnets, an ALB, an ECS Fargate service, and a private RDS Postgres instance."
              className="w-full bg-slate-950 border border-slate-700 text-slate-200 text-sm rounded-md px-3 py-2 outline-none focus:border-indigo-500 placeholder:text-slate-600 resize-none"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
              {error}
            </div>
          )}
        </div>

        <div className="p-3 border-t border-slate-800 flex justify-between items-center gap-3">
          <p className="text-[11px] text-slate-500 leading-snug">
            Writes version pinning, provider config, a remote backend, and shared variables/tags. No
            resources are created without review.
          </p>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="shrink-0 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors disabled:opacity-50"
          >
            {busy ? 'Creating…' : 'Create Workspace'}
          </button>
        </div>
      </div>
    </div>
  )
}
