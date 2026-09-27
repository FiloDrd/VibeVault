import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, RotateCcw, Trash2, CheckCircle2, Circle } from 'lucide-react'
import type { TrashEntry } from '@shared/types'
import { EMPTY_TRASH_CONFIRM } from '@shared/ipc'
import { useApp } from '@/store/app'
import { api, thumbUrl } from '@/lib/api'
import { formatBytes, formatCount, formatDate } from '@/lib/format'
import { Button, cx, Empty, Spinner } from '@/components/ui'

export function TrashView() {
  const [entries, setEntries] = useState<TrashEntry[] | null>(null)
  const [sel, setSel] = useState<Set<number>>(new Set())
  const runOp = useApp((s) => s.runOp)
  const openDialog = useApp((s) => s.openDialog)
  const refreshMeta = useApp((s) => s.refreshMeta)

  const load = async () => { setEntries(await api('trash.list')); setSel(new Set()); void refreshMeta() }
  useEffect(() => { void load() }, [])

  const total = useMemo(() => (entries ?? []).reduce((a, e) => a + e.sizeBytes, 0), [entries])
  const targets = () => (sel.size ? [...sel] : (entries ?? []).map((e) => e.id))

  const restore = async () => { await runOp(api('trash.restore', targets())); await load() }

  const purge = () => {
    const ids = targets()
    const bytes = (entries ?? []).filter((e) => ids.includes(e.id)).reduce((a, e) => a + e.sizeBytes, 0)
    // doppia conferma: prima dialog, poi digitazione della parola chiave
    openDialog({
      type: 'confirm',
      title: `Eliminare definitivamente ${formatCount(ids.length)} file?`,
      message: `Libererai ${formatBytes(bytes)}. Questa è l'unica operazione irreversibile di VibeVault: i file vengono cancellati dal disco e non potranno essere ripristinati né annullati.`,
      confirmText: 'Continua',
      danger: true,
      onConfirm: () => {
        openDialog({
          type: 'confirm',
          title: 'Conferma finale',
          message: `Scrivi ELIMINA per cancellare per sempre ${formatCount(ids.length)} file.`,
          typeToConfirm: 'ELIMINA',
          confirmText: 'Elimina per sempre',
          danger: true,
          onConfirm: async () => {
            await runOp(api('trash.empty', { trashIds: ids, confirmToken: EMPTY_TRASH_CONFIRM }))
            await load()
          }
        })
      }
    })
  }

  if (entries === null) return <div className="flex h-full items-center justify-center text-dim"><Spinner size={22} /></div>
  if (!entries.length) return <Empty icon={<Trash2 size={26} />} title="Il cestino è vuoto">Gli elementi eliminati finiscono qui, nel cestino interno di VibeVault (dentro la cartella foto, non nel Cestino di Windows). Puoi ripristinarli in qualsiasi momento.</Empty>

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-line px-5 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-[13px]">{formatCount(entries.length)} elementi · {formatBytes(total)}</p>
          <p className="text-[12px] text-faint">I file restano nel cestino interno finché non lo svuoti. Lo svuotamento automatico è disattivato.</p>
        </div>
        <Button variant="soft" icon={<RotateCcw size={15} />} onClick={() => void restore()}>{sel.size ? `Ripristina ${sel.size}` : 'Ripristina tutto'}</Button>
        <Button variant="danger" icon={<AlertTriangle size={15} />} onClick={purge}>{sel.size ? `Elimina ${sel.size} per sempre` : 'Svuota cestino'}</Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
          {entries.map((e) => {
            const on = sel.has(e.id)
            return (
              <button
                key={e.id}
                onClick={() => { const n = new Set(sel); if (on) n.delete(e.id); else n.add(e.id); setSel(n) }}
                className={cx('group overflow-hidden rounded-xl border bg-elev text-left transition-colors', on ? 'border-accent ring-2 ring-accent/40' : 'border-line hover:border-line-strong')}
              >
                <div className="relative aspect-square bg-elev-2">
                  <img src={thumbUrl(e.mediaId)} className="h-full w-full object-cover opacity-80" alt="" onError={(ev) => { (ev.target as HTMLImageElement).style.display = 'none' }} />
                  <span className={cx('absolute left-2 top-2', on ? 'text-accent' : 'text-white/80 opacity-0 group-hover:opacity-100')}>{on ? <CheckCircle2 size={20} className="fill-bg" /> : <Circle size={20} />}</span>
                </div>
                <div className="p-2.5">
                  <p className="truncate text-[12.5px] font-medium">{e.fileName || e.originalPath.split('/').pop()}</p>
                  <p className="truncate text-[11px] text-faint" title={e.originalPath}>da {e.originalPath.split('/').slice(0, -1).join('/') || 'root'}</p>
                  <p className="mt-0.5 text-[11px] text-faint">{formatDate(e.deletedAt)} · {formatBytes(e.sizeBytes)}</p>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
