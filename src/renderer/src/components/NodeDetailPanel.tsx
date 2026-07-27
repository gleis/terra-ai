import type { SecurityFinding } from '../types'
import { estimateMonthlyCost } from '../utils/costEstimates'

type NodeDetailPanelProps = {
  label: string
  file: string | null
  snippet: string | null
  loading: boolean
  planAction: string | null
  findings: SecurityFinding[]
  onExplain: () => void
  onClose: () => void
}

const ACTION_LABELS: Record<string, { text: string; className: string }> = {
  create: { text: 'will be created', className: 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10' },
  update: { text: 'will be updated', className: 'text-amber-300 border-amber-500/40 bg-amber-500/10' },
  delete: { text: 'will be destroyed', className: 'text-rose-300 border-rose-500/40 bg-rose-500/10' },
  replace: { text: 'will be replaced', className: 'text-rose-300 border-rose-500/40 bg-rose-500/10' },
  drift: { text: 'has drifted from config', className: 'text-fuchsia-300 border-fuchsia-500/40 bg-fuchsia-500/10' }
}

// Slide-over panel showing the HCL source, plan status, rough cost, and
// security findings for a clicked graph node.
export default function NodeDetailPanel({
  label,
  file,
  snippet,
  loading,
  planAction,
  findings,
  onExplain,
  onClose
}: NodeDetailPanelProps): React.JSX.Element {
  const cost = estimateMonthlyCost(label)
  const action = planAction ? ACTION_LABELS[planAction] : null

  return (
    <div className="absolute top-16 left-4 z-40 w-[420px] max-w-[calc(100%-2rem)] max-h-[calc(100%-6rem)] flex flex-col rounded-xl border border-slate-700 bg-slate-900/95 backdrop-blur shadow-2xl overflow-hidden">
      <div className="p-3 border-b border-slate-800 flex justify-between items-start gap-2">
        <div className="min-w-0">
          <h3 className="text-slate-100 font-mono text-sm break-all">{label}</h3>
          <div className="flex flex-wrap gap-2 mt-2">
            {file && (
              <span className="text-[11px] text-slate-400 border border-slate-700 rounded px-1.5 py-0.5 font-mono">
                {file}
              </span>
            )}
            {action && (
              <span className={`text-[11px] border rounded px-1.5 py-0.5 ${action.className}`}>{action.text}</span>
            )}
            {cost !== null && (
              <span
                className="text-[11px] text-sky-300 border border-sky-500/40 bg-sky-500/10 rounded px-1.5 py-0.5"
                title="Very rough estimate, small/default sizing, us-east-1. Not real pricing."
              >
                ~${cost}/mo (rough)
              </span>
            )}
            {findings.length > 0 && (
              <span className="text-[11px] text-rose-300 border border-rose-500/40 bg-rose-500/10 rounded px-1.5 py-0.5">
                {findings.length} security finding{findings.length > 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-200 shrink-0">
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {loading ? (
          <p className="p-3 text-xs text-slate-500">Loading source…</p>
        ) : snippet ? (
          <pre className="p-3 text-xs text-slate-300 font-mono leading-relaxed whitespace-pre overflow-x-auto">
            {snippet}
          </pre>
        ) : (
          <p className="p-3 text-xs text-slate-500">
            Source block not found in workspace files (it may come from a module or be generated).
          </p>
        )}

        {findings.length > 0 && (
          <div className="border-t border-slate-800 p-3 space-y-2">
            {findings.map((finding, i) => (
              <div key={i} className="rounded-lg border border-rose-500/20 bg-rose-500/5 px-2.5 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-mono text-rose-300">{finding.ruleId}</span>
                  <span className="text-[10px] uppercase tracking-wide text-rose-400">{finding.severity}</span>
                </div>
                <p className="text-xs text-slate-300 mt-1">{finding.description}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="p-3 border-t border-slate-800">
        <button
          onClick={onExplain}
          className="w-full bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded-md px-3 py-1.5 font-medium"
        >
          Explain with AI
        </button>
      </div>
    </div>
  )
}
