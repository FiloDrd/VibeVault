import { useEffect, useState } from 'react'
import { Copy, ShieldCheck, Wand2, X } from 'lucide-react'
import type { DuplicateGroup, GridItem } from '@shared/types'
import { useApp } from '@/store/app'
import { api, thumbUrl } from '@/lib/api'
import { formatBytes, formatCount, formatDate } from '@/lib/format'
import { Button, cx, Empty, Spinner } from '@/components/ui'

export function DuplicatesView() {
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null)
  const [verifying, setVerifying] = useState(false)
  const runOp = useApp((s) => s.runOp)
  const toast = useApp((s) => s.toast)

  const load = async (verify: boolean) => {
    if (verify) setVerifying(true)
    else setGroups(null)
    try { setGroups(await api('library.duplicates', { verify })) } finally { setVerifying(false) }
  }
  useEffect(() => { void load(false) }, [])

  // il "migliore" di un gruppo: preferito > valutazione > nome senza "copia" > più vecchio
  const best = (items: GridItem[]) => [...items].sort((a, b) => b.fav - a.fav || b.r - a.r || Number(/cop(y|ia)|\(\d+\)/i.test(a.n)) - Number(/cop(y|ia)|\(\d+\)/i.test(b.n)) || a.t - b.t || a.id - b.id)[0]

  const autoFlag = async (list: DuplicateGroup[]) => {
    const toTrash = list.flatMap((g) => { const keep = best(g.items); return g.items.filter((i) => i.id !== keep.id).map((i) => i.id) })
    const toKeep = list.map((g) => best(g.items).id)
    if (!toTrash.length) return
    await api('media.flag', toKeep, 'keep')
    await runOp(api('media.flag', toTrash, 'trash'))
    toast({ text: `${formatCount(toTrash.length)} copie segnate "Scarta". Controlla in Review e poi usa "Svuota scartati".`, tone: 'info' })
    void load(false)
  }

  if (groups === null) return <div className="flex h-full items-center justify-center text-dim"><Spinner size={22} /></div>
  const wasted = groups.reduce((a, g) => a + g.sizeBytes * (g.items.length - 1), 0)

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-line px-5 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-[13px]">{formatCount(groups.length)} gruppi · {formatBytes(wasted)} recuperabili</p>
          <p className="text-[12px] text-faint">{groups.some((g) => g.verified) ? 'Verificati byte per byte con SHA-256.' : 'Candidati per dimensione + hash rapido. Verifica per la certezza assoluta.'} Nessun file viene eliminato: le copie vengono solo segnate "Scarta".</p>
        </div>
        <Button variant="soft" icon={verifying ? <Spinner /> : <ShieldCheck size={15} />} disabled={verifying} onClick={() => void load(true)}>Verifica SHA-256</Button>
        <Button variant="primary" icon={<Wand2 size={15} />} disabled={!groups.length} onClick={() => void autoFlag(groups)}>Tieni il migliore, scarta le copie</Button>
      </div>
      {!groups.length ? (
        <Empty icon={<Copy size={26} />} title="Nessun duplicato esatto">Ottimo: nessun file identico trovato nella libreria.</Empty>
      ) : (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {groups.map((g) => {
            const keep = best(g.items)
            return (
              <div key={g.key} className="rounded-xl border border-line bg-panel p-3">
                <div className="mb-2 flex items-center justify-between text-[12px] text-faint">
                  <span>{g.items.length} copie · {formatBytes(g.sizeBytes)} ciascuna {g.verified && <span className="ml-1 text-ok">· verificato</span>}</span>
                  <Button size="sm" variant="ghost" onClick={() => void autoFlag([g])}>Tieni il migliore</Button>
                </div>
                <div className="flex gap-3 overflow-x-auto">
                  {g.items.map((i) => (
                    <div key={i.id} className={cx('w-[170px] shrink-0 overflow-hidden rounded-lg border', i.id === keep.id ? 'border-ok/60' : 'border-line')}>
                      <div className="relative aspect-square bg-elev-2">
                        <img src={thumbUrl(i.id)} className="h-full w-full object-cover" alt="" />
                        {i.fl === 'trash' && <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-danger text-white"><X size={12} strokeWidth={3} /></span>}
                        {i.id === keep.id && <span className="absolute left-1.5 top-1.5 rounded bg-ok px-1.5 py-0.5 text-[10px] font-bold text-black">MIGLIORE</span>}
                      </div>
                      <div className="p-2">
                        <p className="truncate text-[12px]" title={i.n}>{i.n}</p>
                        <p className="text-[11px] text-faint">{formatDate(i.t)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
