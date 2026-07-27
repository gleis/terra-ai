import { useEffect, useRef, useState } from 'react'
import type { SecurityFinding } from '../types'
import { estimateMonthlyCost } from '../utils/costEstimates'

type NodeDetailPanelProps = {
  label: string
  file: string | null
  snippet: string | null
  loading: boolean
  saving: boolean
  saveError: string | null
  planAction: string | null
  findings: SecurityFinding[]
  onExplain: () => void
  onSave: (snippet: string) => Promise<boolean>
  onDismissError: () => void
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
// security findings for a clicked graph node. The source block is editable
// in place and written back to its file on save.
export default function NodeDetailPanel({
  label,
  file,
  snippet,
  loading,
  saving,
  saveError,
  planAction,
  findings,
  onExplain,
  onSave,
  onDismissError,
  onClose
}: NodeDetailPanelProps): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(snippet || '')
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const cost = estimateMonthlyCost(label)
  const action = planAction ? ACTION_LABELS[planAction] : null
  const isDirty = editing && draft !== (snippet || '')

  // Reset the editor whenever a different node is opened or the source reloads
  useEffect(() => {
    setEditing(false)
    setDraft(snippet || '')
  }, [label, snippet])

  useEffect(() => {
    if (editing) textareaRef.current?.focus()
  }, [editing])

  const startEditing = (): void => {
    onDismissError()
    setDraft(snippet || '')
    setEditing(true)
  }

  const cancelEditing = (): void => {
    onDismissError()
    setDraft(snippet || '')
    setEditing(false)
  }

  const save = async (): Promise<void> => {
    if (!isDirty) {
      setEditing(false)
      return
    }
    const ok = await onSave(draft)
    if (ok) setEditing(false)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      cancelEditing()
      return
    }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      void save()
      return
    }
    // Keep Tab inside the editor and insert two spaces, HCL style
    if (event.key === 'Tab') {
      event.preventDefault()
      const target = event.currentTarget
      const { selectionStart, selectionEnd, value } = target
      const next = `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`
      setDraft(next)
      requestAnimationFrame(() => {
        target.selectionStart = target.selectionEnd = selectionStart + 2
      })
    }
  }

  return (
    <div className="absolute top-16 left-4 z-40 w-[460px] max-w-[calc(100%-2rem)] max-h-[calc(100%-6rem)] flex flex-col rounded-xl border border-slate-700 bg-slate-900/95 backdrop-blur shadow-2xl overflow-hidden">
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
            {isDirty && (
              <span className="text-[11px] text-amber-300 border border-amber-500/40 bg-amber-500/10 rounded px-1.5 py-0.5">
                unsaved changes
              </span>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-slate-200 shrink-0"
          title={isDirty ? 'Close (unsaved changes will be discarded)' : 'Close'}
        >
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {loading ? (
          <p className="p-3 text-xs text-slate-500">Loading source…</p>
        ) : editing ? (
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            disabled={saving}
            rows={Math.min(24, Math.max(8, draft.split('\n').length + 1))}
            className="w-full resize-y bg-slate-950 p-3 text-xs text-slate-200 font-mono leading-relaxed outline-none border-0 focus:ring-1 focus:ring-inset focus:ring-indigo-500 disabled:opacity-60"
          />
        ) : snippet ? (
          <pre className="p-3 text-xs text-slate-300 font-mono leading-relaxed whitespace-pre overflow-x-auto">
            {snippet}
          </pre>
        ) : (
          <p className="p-3 text-xs text-slate-500">
            Source block not found in workspace files (it may come from a module or be generated). Editing is
            unavailable for this node.
          </p>
        )}

        {saveError && (
          <div className="mx-3 mb-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-2">
            <p className="text-xs text-rose-200 whitespace-pre-wrap">{saveError}</p>
          </div>
        )}

        {findings.length > 0 && !editing && (
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

      <div className="p-3 border-t border-slate-800 flex items-center gap-2">
        {editing ? (
          <>
            <button
              onClick={cancelEditing}
              disabled={saving}
              className="bg-slate-800 border border-slate-700 text-slate-300 text-sm rounded-md px-3 py-1.5 hover:bg-slate-700 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={() => void save()}
              disabled={saving || !isDirty}
              className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white text-sm rounded-md px-3 py-1.5 font-medium disabled:opacity-50"
              title="Save (⌘/Ctrl + Enter)"
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </>
        ) : (
          <>
            <button
              onClick={startEditing}
              disabled={!snippet || !file}
              className="bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-md px-3 py-1.5 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
              title={snippet && file ? 'Edit this block' : 'Source block not available for editing'}
            >
              Edit
            </button>
            <button
              onClick={onExplain}
              className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded-md px-3 py-1.5 font-medium"
            >
              Explain with AI
            </button>
          </>
        )}
      </div>
    </div>
  )
}
