import { useEffect, useState } from 'react'
import { AlertTriangle, CalendarOff, FileQuestion, Heart, HardDrive, Images, ImageDown } from 'lucide-react'
import type { LibraryStats, ScanErrorEntry } from '@shared/types'
import { ORIGIN_LABELS } from '@shared/formats'
import type { LibraryViewId } from '@/store/app'
import { useApp } from '@/store/app'
import { api } from '@/lib/api'
import { formatBytes, formatCount } from '@/lib/format'
import { Spinner } from '@/components/ui'

const KIND_LABEL: Record<string, string> = { photo: 'Foto', video: 'Video', gif: 'GIF', raw: 'Raw', audio: 'Audio', unsupported: 'Altro' }
const KIND_COLOR: Record<string, string> = { photo: '#8b93ff', video: '#ff8fab', gif: '#ffd23f', raw: '#3ddc97', audio: '#4dabf7', unsupported: '#626b7d' }

function Card({ icon, label, value, sub, onClick }: { icon: React.ReactNode; label: string; value: string; sub?: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} disabled={!onClick} className="rounded-xl border border-line bg-panel p-4 text-left transition-colors enabled:hover:border-line-strong">
      <div className="flex items-center gap-2 text-[12px] text-faint">{icon}{label}</div>
      <div className="mt-2 font-display text-[24px] font-semibold tabular-nums tracking-tight">{value}</div>
      {sub && <div className="mt-0.5 text-[12px] text-dim">{sub}</div>}
    </button>
  )
}

export function StatsView() {
  const [s, setS] = useState<LibraryStats | null>(null)
  const [errors, setErrors] = useState<ScanErrorEntry[]>([])
  const setView = useApp((st) => st.setView)
  useEffect(() => { void api('library.stats').then(setS); void api('library.scanErrors').then(setErrors) }, [])
  if (!s) return <div className="flex h-full items-center justify-center text-dim"><Spinner size={22} /></div>
  const maxYear = Math.max(1, ...s.byYear.map((y) => y.count))

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-[1100px] space-y-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Card icon={<Images size={14} />} label="Elementi" value={formatCount(s.total)} sub={formatBytes(s.totalBytes)} />
          <Card icon={<Heart size={14} />} label="Preferiti" value={formatCount(s.favorites)} onClick={() => setView({ kind: 'library', id: 'favorites' })} />
          <Card icon={<CalendarOff size={14} />} label="Senza data" value={formatCount(s.noDate)} onClick={() => setView({ kind: 'library', id: 'nodate' })} />
          <Card icon={<ImageDown size={14} />} label="Miniature in coda" value={formatCount(s.thumbsPending)} />
        </div>

        <section className="rounded-xl border border-line bg-panel p-5">
          <h3 className="mb-4 font-display text-[14px] font-semibold">Per tipo</h3>
          <div className="mb-4 flex h-3 overflow-hidden rounded-full bg-elev-2">
            {s.byKind.map((k) => <div key={k.kind} style={{ width: `${(k.bytes / Math.max(1, s.totalBytes)) * 100}%`, background: KIND_COLOR[k.kind] }} title={`${KIND_LABEL[k.kind]}: ${formatBytes(k.bytes)}`} />)}
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {s.byKind.map((k) => (
              <div key={k.kind} className="flex items-center gap-2.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: KIND_COLOR[k.kind] }} />
                <div>
                  <div className="text-[13px]">{KIND_LABEL[k.kind] ?? k.kind} <span className="tabular-nums text-dim">{formatCount(k.count)}</span></div>
                  <div className="text-[11.5px] text-faint">{formatBytes(k.bytes)}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {s.byOrigin.length > 0 && (
          <section className="rounded-xl border border-line bg-panel p-5">
            <h3 className="mb-3 font-display text-[14px] font-semibold">Provenienza</h3>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
              {s.byOrigin.map((o) => (
                <button
                  key={o.origin}
                  disabled={o.origin === 'unknown'}
                  onClick={() => setView({ kind: 'library', id: (o.origin === 'screenshot' ? 'screenshots' : o.origin) as LibraryViewId })}
                  className="rounded-lg bg-elev-2 px-3 py-2 text-left enabled:hover:bg-hover"
                >
                  <div className="text-[12px] text-faint">{ORIGIN_LABELS[o.origin]}</div>
                  <div className="font-display text-[18px] font-semibold tabular-nums">{formatCount(o.count)}</div>
                </button>
              ))}
            </div>
          </section>
        )}

        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <section className="rounded-xl border border-line bg-panel p-5">
            <h3 className="mb-4 font-display text-[14px] font-semibold">Per anno</h3>
            <div className="flex h-44 items-end gap-1.5">
              {s.byYear.map((y) => (
                <div key={y.year} className="group flex min-w-0 flex-1 flex-col items-center gap-1.5">
                  <span className="text-[10.5px] tabular-nums text-faint opacity-0 group-hover:opacity-100">{formatCount(y.count)}</span>
                  <div className="w-full rounded-t-md bg-accent/80 transition-colors group-hover:bg-accent" style={{ height: `${Math.max(3, (y.count / maxYear) * 140)}px` }} />
                  <span className="truncate text-[10.5px] text-faint">{y.year}</span>
                </div>
              ))}
            </div>
          </section>
          <section className="rounded-xl border border-line bg-panel p-5">
            <h3 className="mb-3 font-display text-[14px] font-semibold">Formati</h3>
            <div className="space-y-1.5">
              {s.byExt.slice(0, 10).map((e) => (
                <div key={e.ext} className="flex items-center justify-between text-[12.5px]">
                  <span className="font-mono uppercase text-dim">{e.ext}</span>
                  <span className="tabular-nums text-faint">{formatCount(e.count)} · {formatBytes(e.bytes)}</span>
                </div>
              ))}
            </div>
          </section>
        </div>

        <section className="rounded-xl border border-line bg-panel p-5">
          <h3 className="mb-3 font-display text-[14px] font-semibold">Salute della libreria</h3>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Card icon={<FileQuestion size={14} />} label="Mancanti" value={formatCount(s.missing)} onClick={() => setView({ kind: 'library', id: 'missing' })} />
            <Card icon={<AlertTriangle size={14} />} label="Danneggiati" value={formatCount(s.corrupt)} onClick={() => setView({ kind: 'library', id: 'corrupt' })} />
            <Card icon={<HardDrive size={14} />} label="Nel cestino" value={formatCount(s.trashed)} onClick={() => setView({ kind: 'trash' })} />
            <Card icon={<AlertTriangle size={14} />} label="Errori ultima scansione" value={formatCount(errors.length)} />
          </div>
          {errors.length > 0 && (
            <div className="mt-4 max-h-56 overflow-y-auto rounded-lg bg-elev-2 p-3 font-mono text-[11.5px] text-dim">
              {errors.slice(0, 200).map((e, i) => <div key={i} className="truncate"><span className="text-warn">{e.path || '—'}</span> {e.message}</div>)}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
