import { CheckCircle2, Info, RotateCcw, X, XCircle } from 'lucide-react'
import { useApp } from '@/store/app'
import { cx } from './ui'

export function Toasts() {
  const toasts = useApp((s) => s.toasts)
  const dismiss = useApp((s) => s.dismissToast)
  const undo = useApp((s) => s.undo)
  const hasSelection = useApp((s) => s.selection.size > 0)
  return (
    <div className={cx('pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2 transition-all', hasSelection ? 'bottom-24' : 'bottom-6')} aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto flex max-w-[560px] items-start gap-3 rounded-xl border border-line-strong bg-elev/95 py-2.5 pl-3.5 pr-2 shadow-pop backdrop-blur-xl anim-pop">
          <span className="mt-0.5">
            {t.tone === 'ok' ? <CheckCircle2 size={16} className="text-ok" /> : t.tone === 'error' ? <XCircle size={16} className="text-danger" /> : <Info size={16} className="text-accent" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] text-fg">{t.text}</p>
            {t.details?.map((d, i) => <p key={i} className="truncate text-[11.5px] text-faint">{d}</p>)}
          </div>
          {t.operationId && (
            <button onClick={() => { dismiss(t.id); void undo(t.operationId) }} className="flex h-7 items-center gap-1 rounded-lg px-2 text-[12.5px] font-semibold text-accent hover:bg-accent-soft">
              <RotateCcw size={13} /> Annulla
            </button>
          )}
          <button onClick={() => dismiss(t.id)} className="flex h-7 w-7 items-center justify-center rounded-lg text-faint hover:bg-hover hover:text-fg" aria-label="Chiudi"><X size={14} /></button>
        </div>
      ))}
    </div>
  )
}
