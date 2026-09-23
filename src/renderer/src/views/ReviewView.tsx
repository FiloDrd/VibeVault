import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Heart, HelpCircle, PartyPopper, RotateCcw, SkipForward, Sparkles, Trash2, X } from 'lucide-react'
import type { Flag, GridItem, MediaKind, MediaQuery } from '@shared/types'
import { useApp } from '@/store/app'
import { api, thumbUrl } from '@/lib/api'
import { formatBytes, formatCount, formatDate, formatDuration } from '@/lib/format'
import { MediaViewer } from '@/components/MediaViewer'
import { Button, cx, Empty, Kbd, RatingStars, Segmented, Spinner } from '@/components/ui'

type Source = 'todo' | 'maybe' | 'all'

interface HistoryEntry { index: number; opId?: number; prev: Pick<GridItem, 'fl' | 'fav' | 'r'> }

export function ReviewView() {
  const [source, setSource] = useState<Source>('todo')
  const [kinds, setKinds] = useState<MediaKind[]>([])
  const [queue, setQueue] = useState<GridItem[] | null>(null)
  const [pos, setPos] = useState(0)
  const [flash, setFlash] = useState<{ key: number; flag: Flag | 'fav' } | null>(null)
  const history = useRef<HistoryEntry[]>([])
  const toast = useApp((s) => s.toast)
  const openDialog = useApp((s) => s.openDialog)
  const runOp = useApp((s) => s.runOp)
  const refreshMeta = useApp((s) => s.refreshMeta)
  const search = useApp((s) => s.search)

  const load = useCallback(async () => {
    setQueue(null)
    const q: MediaQuery = { archived: false, sort: 'date', order: 'desc' }
    if (source === 'todo') q.flags = ['none']
    if (source === 'maybe') q.flags = ['maybe']
    if (kinds.length) q.kinds = kinds
    if (search.trim()) q.search = search.trim()
    const items = await api('library.query', q)
    history.current = []
    setQueue(items)
    setPos(0)
  }, [source, kinds, search])

  useEffect(() => { void load() }, [load])

  const item = queue?.[pos] ?? null
  const done = queue !== null && pos >= queue.length

  // prefetch dei prossimi elementi
  useEffect(() => {
    if (!queue) return
    const ids = queue.slice(pos, pos + 8).map((i) => i.id)
    if (ids.length) void api('thumbs.prioritize', ids)
    for (const i of queue.slice(pos + 1, pos + 3)) { const img = new Image(); img.src = thumbUrl(i.id) }
  }, [queue, pos])

  const patch = (index: number, p: Partial<GridItem>) => setQueue((q) => q && q.map((it, i) => (i === index ? { ...it, ...p } : it)))

  const apply = useCallback(async (kind: 'flag' | 'fav' | 'rate', value?: Flag | number) => {
    if (!queue || !item) return
    const prev = { fl: item.fl, fav: item.fav, r: item.r }
    let r
    if (kind === 'flag') {
      const f = value as Flag
      r = await api('media.flag', [item.id], f)
      patch(pos, { fl: f })
      setFlash({ key: Date.now(), flag: f })
      history.current.push({ index: pos, opId: r.operationId, prev })
      setPos((p) => p + 1)
    } else if (kind === 'fav') {
      const v = !item.fav
      r = await api('media.favorite', [item.id], v)
      patch(pos, { fav: v ? 1 : 0 })
      if (v) setFlash({ key: Date.now(), flag: 'fav' })
      history.current.push({ index: pos, opId: r.operationId, prev })
    } else {
      r = await api('media.rate', [item.id], value as number)
      patch(pos, { r: value as number })
      history.current.push({ index: pos, opId: r.operationId, prev })
    }
    if (!r.ok) toast({ text: r.errors[0]?.message ?? 'Errore', tone: 'error' })
  }, [queue, item, pos, toast])

  const undo = useCallback(async () => {
    const h = history.current.pop()
    if (!h) { toast({ text: 'Niente da annullare in questa sessione', tone: 'info' }); return }
    if (h.opId) await api('operations.undo', h.opId)
    patch(h.index, h.prev)
    setPos(h.index)
  }, [toast])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select') || useApp.getState().dialog) return
      const k = e.key.toLowerCase()
      if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); void undo(); return }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (done && k !== 'z' && k !== 'arrowleft') return
      switch (k) {
        case 'k': void apply('flag', 'keep'); break
        case 'm': void apply('flag', 'maybe'); break
        case 'x': case 'delete': void apply('flag', 'trash'); break
        case 'f': void apply('fav'); break
        case 's': case 'arrowright': setPos((p) => Math.min((queue?.length ?? 0), p + 1)); break
        case 'arrowleft': setPos((p) => Math.max(0, p - 1)); break
        case 'z': case 'backspace': void undo(); break
        case ' ': e.preventDefault(); window.dispatchEvent(new Event('vv:toggle-play')); break
        case 'o': if (item) void api('media.showInFolder', item.id); break
        case '0': case '1': case '2': case '3': case '4': case '5': void apply('rate', Number(k)); break
        default: return
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [apply, undo, queue, item, done])

  const counts = useMemo(() => {
    const c = { keep: 0, maybe: 0, trash: 0, fav: 0 }
    for (const i of queue ?? []) { if (i.fl !== 'none') c[i.fl]++; if (i.fav) c.fav++ }
    return c
  }, [queue])

  const trashFlagged = async () => {
    const dry = await api('files.trashFlagged', { dryRun: true })
    if (!dry.affected) { toast({ text: 'Nessun elemento segnato come "Scarta"', tone: 'info' }); return }
    openDialog({
      type: 'confirm',
      title: `Spostare ${formatCount(dry.affected)} elementi nel cestino?`,
      message: `Anteprima: ${formatCount(dry.affected)} file segnati "Scarta" (${formatBytes(dry.bytes ?? 0)}) verranno spostati nel Cestino interno del vault. ${dry.message ?? ''} Potrai ripristinarli dal Cestino o annullare con Ctrl+Z.`,
      confirmText: 'Sposta nel cestino',
      danger: true,
      onConfirm: async () => { await runOp(api('files.trashFlagged', { dryRun: false })); await refreshMeta(); void load() }
    })
  }

  return (
    <div className="relative flex h-full flex-col bg-[#07080b]">
      {/* barra controlli */}
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-white/5 px-4">
        <Segmented<Source>
          size="sm"
          value={source}
          onChange={setSource}
          options={[{ value: 'todo', label: 'Da rivedere' }, { value: 'maybe', label: 'Forse' }, { value: 'all', label: 'Tutti' }]}
        />
        <div className="flex gap-0.5 rounded-lg bg-elev-2 p-0.5">
          {(['photo', 'video', 'gif'] as MediaKind[]).map((k) => (
            <button key={k} onClick={() => setKinds(kinds.includes(k) ? kinds.filter((x) => x !== k) : [...kinds, k])} className={cx('h-6 rounded-md px-2 text-[12px] font-medium', kinds.includes(k) ? 'bg-accent text-accent-fg' : 'text-dim hover:text-fg')}>
              {k === 'photo' ? 'Foto' : k === 'video' ? 'Video' : 'GIF'}
            </button>
          ))}
        </div>
        {queue && (
          <div className="ml-2 flex min-w-0 flex-1 items-center gap-3">
            <div className="h-1.5 min-w-[80px] flex-1 overflow-hidden rounded-full bg-white/8">
              <div className="h-full rounded-full bg-gradient-to-r from-accent to-[#b197fc] transition-all duration-300" style={{ width: `${queue.length ? (Math.min(pos, queue.length) / queue.length) * 100 : 0}%` }} />
            </div>
            <span className="shrink-0 text-[12px] tabular-nums text-dim">{formatCount(Math.min(pos + 1, queue.length))} / {formatCount(queue.length)}</span>
          </div>
        )}
        <div className="flex shrink-0 items-center gap-3 text-[12px] tabular-nums">
          <span className="flex items-center gap-1 text-ok"><Check size={13} />{counts.keep}</span>
          <span className="flex items-center gap-1 text-warn"><HelpCircle size={13} />{counts.maybe}</span>
          <span className="flex items-center gap-1 text-danger"><X size={13} />{counts.trash}</span>
          <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} onClick={() => void trashFlagged()}>Svuota scartati</Button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        {queue === null && <div className="flex h-full items-center justify-center text-dim"><Spinner size={22} /></div>}
        {queue !== null && queue.length === 0 && (
          <Empty icon={<Sparkles size={26} />} title="Niente da rivedere">
            {source === 'todo' ? 'Tutti gli elementi hanno già una decisione. Prova "Forse" o "Tutti".' : 'Nessun elemento corrisponde ai filtri.'}
          </Empty>
        )}
        {done && queue!.length > 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-5 text-center anim-pop">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-soft text-accent"><PartyPopper size={28} /></div>
            <div>
              <h2 className="font-display text-[22px] font-semibold">Review completata</h2>
              <p className="mt-1 text-[13px] text-dim">{formatCount(queue!.length)} elementi · {counts.keep} tenuti · {counts.maybe} forse · {counts.trash} scartati · {counts.fav} preferiti</p>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" icon={<RotateCcw size={15} />} onClick={() => setPos(Math.max(0, queue!.length - 1))}>Torna indietro</Button>
              {counts.trash > 0 && <Button variant="danger" icon={<Trash2 size={15} />} onClick={() => void trashFlagged()}>Sposta {counts.trash} scartati nel cestino</Button>}
              <Button variant="primary" onClick={() => void load()}>Nuova sessione</Button>
            </div>
          </div>
        )}
        {item && !done && (
          <>
            <div className="absolute inset-0 px-6 pb-4 pt-4">
              <MediaViewer key={item.id} item={item} />
            </div>
            {flash && (
              <div key={flash.key} className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className={cx('flex h-24 w-24 items-center justify-center rounded-full anim-flash', flash.flag === 'keep' ? 'bg-ok/90 text-black' : flash.flag === 'maybe' ? 'bg-warn/90 text-black' : flash.flag === 'trash' ? 'bg-danger/90 text-white' : 'bg-white/90 text-danger')}>
                  {flash.flag === 'keep' ? <Check size={44} strokeWidth={3} /> : flash.flag === 'maybe' ? <HelpCircle size={44} /> : flash.flag === 'trash' ? <X size={44} strokeWidth={3} /> : <Heart size={40} className="fill-danger" />}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {item && !done && (
        <div className="shrink-0 border-t border-white/5 px-4 py-3">
          <div className="mx-auto flex max-w-[980px] items-center gap-4">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-fg">{item.n}</p>
              <p className="text-[11.5px] text-faint">{formatDate(item.t)}{item.w ? ` · ${item.w}×${item.h}` : ''}{item.d ? ` · ${formatDuration(item.d)}` : ''}</p>
            </div>
            <div className="flex items-center gap-2">
              <ReviewBtn label="Indietro" k="←" onClick={() => setPos((p) => Math.max(0, p - 1))}><ArrowLeft size={18} /></ReviewBtn>
              <ReviewBtn label="Tieni" k="K" tone="ok" active={item.fl === 'keep'} onClick={() => void apply('flag', 'keep')}><Check size={20} strokeWidth={2.6} /></ReviewBtn>
              <ReviewBtn label="Forse" k="M" tone="warn" active={item.fl === 'maybe'} onClick={() => void apply('flag', 'maybe')}><HelpCircle size={20} /></ReviewBtn>
              <ReviewBtn label="Scarta" k="X" tone="danger" active={item.fl === 'trash'} onClick={() => void apply('flag', 'trash')}><X size={20} strokeWidth={2.6} /></ReviewBtn>
              <ReviewBtn label="Preferito" k="F" tone="accent" active={!!item.fav} onClick={() => void apply('fav')}><Heart size={19} className={item.fav ? 'fill-current' : ''} /></ReviewBtn>
              <ReviewBtn label="Salta" k="S" onClick={() => setPos((p) => p + 1)}><SkipForward size={18} /></ReviewBtn>
              <ReviewBtn label="Avanti" k="→" onClick={() => setPos((p) => p + 1)}><ArrowRight size={18} /></ReviewBtn>
            </div>
            <div className="flex flex-1 items-center justify-end gap-3">
              <RatingStars value={item.r} onChange={(r) => void apply('rate', r)} size={18} />
              <button onClick={() => void undo()} className="flex items-center gap-1.5 text-[12px] text-dim hover:text-fg" title="Annulla (Z)"><RotateCcw size={14} /> <Kbd>Z</Kbd></button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ReviewBtn({ children, label, k, tone, active, onClick }: { children: React.ReactNode; label: string; k: string; tone?: 'ok' | 'warn' | 'danger' | 'accent'; active?: boolean; onClick: () => void }) {
  const toneCls = {
    ok: active ? 'bg-ok text-black' : 'hover:bg-ok/15 hover:text-ok',
    warn: active ? 'bg-warn text-black' : 'hover:bg-warn/15 hover:text-warn',
    danger: active ? 'bg-danger text-white' : 'hover:bg-danger/15 hover:text-danger',
    accent: active ? 'bg-accent text-accent-fg' : 'hover:bg-accent-soft hover:text-accent'
  }
  return (
    <button onClick={onClick} title={`${label} (${k})`} className={cx('group flex flex-col items-center gap-1 rounded-xl px-3 py-1.5 text-dim transition-colors', tone ? toneCls[tone] : 'hover:bg-hover hover:text-fg')}>
      {children}
      <span className="text-[10.5px] font-medium">{label} <span className="opacity-60">{k}</span></span>
    </button>
  )
}
