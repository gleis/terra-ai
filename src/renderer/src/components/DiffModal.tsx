import { useMemo, useState } from 'react'
import { diffLines, diffStats } from '../utils/diff'

export type PendingEdit = {
  filename: string
  oldContent: string
  newContent: string
}

type DiffModalProps = {
  edits: PendingEdit[]
  busy: boolean
  onApply: (edit: PendingEdit) => Promise<boolean>
  onClose: () => void
}

// Review queue for AI-proposed edits. Shows a line diff per file; the user can
// apply or skip each file, or apply all remaining.
export default function DiffModal({ edits, busy, onApply, onClose }: DiffModalProps): React.JSX.Element {
  const [index, setIndex] = useState(0)
  const [applied, setApplied] = useState<Set<number>>(new Set())

  const current = edits[Math.min(index, edits.length - 1)]
  const lines = useMemo(
    () => diffLines(current.oldContent, current.newContent),
    [current.oldContent, current.newContent]
  )
  const stats = useMemo(() => diffStats(lines), [lines])
  const isNewFile = current.oldContent === ''

  const advance = (): void => {
    if (index < edits.length - 1) {
      setIndex(index + 1)
    } else {
      onClose()
    }
  }

  const applyCurrent = async (): Promise<void> => {
    const ok = await onApply(current)
    if (ok) {
      setApplied((prev) => new Set(prev).add(index))
      advance()
    }
  }

  const applyAllRemaining = async (): Promise<void> => {
    for (let i = index; i < edits.length; i += 1) {
      const ok = await onApply(edits[i])
      if (!ok) {
        setIndex(i)
        return
      }
      setApplied((prev) => new Set(prev).add(i))
    }
    onClose()
  }

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-6">
      <div className="bg-slate-900 border border-slate-700 w-full max-w-3xl max-h-[85vh] rounded-xl shadow-2xl overflow-hidden flex flex-col">
        <div className="p-4 border-b border-slate-800 flex justify-between items-center">
          <div className="min-w-0">
            <h3 className="text-slate-100 font-medium truncate">
              Review change: <span className="font-mono text-indigo-300">{current.filename}</span>
              {isNewFile && <span className="ml-2 text-xs text-emerald-300">(new file)</span>}
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              {edits.length > 1 && `File ${index + 1} of ${edits.length} · `}
              <span className="text-emerald-300">+{stats.added}</span>{' '}
              <span className="text-rose-300">-{stats.removed}</span>
              {applied.has(index) && <span className="ml-2 text-emerald-300">applied</span>}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 ml-4">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-auto bg-slate-950 font-mono text-xs leading-relaxed">
          <pre className="p-3 min-w-full">
            {lines.map((line, i) => (
              <div
                key={i}
                className={
                  line.type === 'add'
                    ? 'bg-emerald-500/10 text-emerald-200'
                    : line.type === 'del'
                      ? 'bg-rose-500/10 text-rose-300'
                      : 'text-slate-400'
                }
              >
                <span className="select-none inline-block w-5 text-slate-600">
                  {line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}
                </span>
                {line.text || ' '}
              </div>
            ))}
          </pre>
        </div>

        <div className="p-3 border-t border-slate-800 flex items-center justify-end gap-2">
          <button
            onClick={advance}
            disabled={busy}
            className="bg-slate-800 border border-slate-700 text-slate-300 text-sm rounded px-4 py-1.5 hover:bg-slate-700 disabled:opacity-50"
          >
            {index < edits.length - 1 ? 'Skip' : 'Close'}
          </button>
          {edits.length > 1 && (
            <button
              onClick={() => void applyAllRemaining()}
              disabled={busy}
              className="bg-slate-800 border border-emerald-700/50 text-emerald-200 text-sm rounded px-4 py-1.5 hover:bg-slate-700 disabled:opacity-50"
            >
              Apply All Remaining
            </button>
          )}
          <button
            onClick={() => void applyCurrent()}
            disabled={busy || applied.has(index)}
            className="bg-emerald-600 hover:bg-emerald-500 text-white text-sm rounded px-4 py-1.5 disabled:opacity-50 font-medium"
          >
            {busy ? 'Applying…' : 'Apply'}
          </button>
        </div>
      </div>
    </div>
  )
}
