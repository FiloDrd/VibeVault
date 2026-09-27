import { useEffect, useMemo, useState } from 'react'
import { Check, ExternalLink, FolderOpen, Heart, HelpCircle, MapPin, Plus, X, Album as AlbumIcon, Info } from 'lucide-react'
import type { Flag, MediaDetails } from '@shared/types'
import { ORIGIN_LABELS } from '@shared/formats'
import { useApp } from '@/store/app'
import { api, thumbUrl } from '@/lib/api'
import { formatBytes, formatDate, formatDuration, plural } from '@/lib/format'
import { Button, ColorLabelPicker, cx, IconButton, RatingStars } from './ui'

export function FlagButtons({ value, onChange, size = 'md' }: { value: Flag; onChange: (f: Flag) => void; size?: 'md' | 'lg' }) {
  const opts: { f: Flag; label: string; key: string; icon: React.ReactNode; cls: string }[] = [
    { f: 'keep', label: 'Tieni', key: 'K', icon: <Check size={size === 'lg' ? 18 : 14} strokeWidth={2.6} />, cls: 'data-[on=true]:bg-ok data-[on=true]:text-black' },
    { f: 'maybe', label: 'Forse', key: 'M', icon: <HelpCircle size={size === 'lg' ? 18 : 14} strokeWidth={2.4} />, cls: 'data-[on=true]:bg-warn data-[on=true]:text-black' },
    { f: 'trash', label: 'Scarta', key: 'X', icon: <X size={size === 'lg' ? 18 : 14} strokeWidth={2.6} />, cls: 'data-[on=true]:bg-danger data-[on=true]:text-white' }
  ]
  return (
    <div className="flex gap-1.5">
      {opts.map((o) => (
        <button
          key={o.f}
          data-on={value === o.f}
          title={`${o.label} (${o.key})`}
          onClick={() => onChange(value === o.f ? 'none' : o.f)}
          className={cx('flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-elev-2 font-medium text-dim transition-colors hover:text-fg', size === 'lg' ? 'h-11 px-4 text-[14px]' : 'h-8 px-2 text-[12.5px]', o.cls)}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[92px_1fr] gap-2 py-1 text-[12.5px]">
      <span className="text-faint">{label}</span>
      <span className="min-w-0 break-words text-fg">{children}</span>
    </div>
  )
}

function TagEditor({ ids, tags }: { ids: number[]; tags: MediaDetails['tags'] }) {
  const all = useApp((s) => s.tags)
  const runOp = useApp((s) => s.runOp)
  const [v, setV] = useState('')
  const suggestions = useMemo(() => {
    const q = v.trim().toLowerCase()
    if (!q) return []
    return all.filter((t) => t.name.toLowerCase().includes(q) && !tags.some((x) => x.id === t.id)).slice(0, 6)
  }, [v, all, tags])
  const add = (name: string) => {
    const names = name.split(',').map((n) => n.trim()).filter(Boolean)
    if (!names.length) return
    setV('')
    void runOp(api('tags.add', ids, names))
  }
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {tags.map((t) => (
          <span key={t.id} className="group inline-flex h-6 items-center gap-1 rounded-full bg-accent-soft pl-2.5 pr-1 text-[12px] text-accent">
            {t.name}
            <button className="rounded-full p-0.5 opacity-60 hover:bg-accent/20 hover:opacity-100" onClick={() => void runOp(api('tags.remove', ids, t.id))} aria-label={`Rimuovi ${t.name}`}><X size={11} /></button>
          </span>
        ))}
      </div>
      <div className="relative mt-2">
        <input
          value={v}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') add(suggestions[0] && !v.includes(',') && suggestions[0].name.toLowerCase() === v.trim().toLowerCase() ? suggestions[0].name : v) }}
          placeholder="Aggiungi tag… (Invio)"
          className="h-8 w-full rounded-lg border border-line bg-elev-2 px-2.5 text-[12.5px] outline-none placeholder:text-faint focus:border-accent/60"
        />
        {suggestions.length > 0 && (
          <div className="absolute inset-x-0 top-9 z-10 overflow-hidden rounded-lg border border-line-strong bg-elev shadow-pop anim-pop">
            {suggestions.map((s) => (
              <button key={s.id} onMouseDown={(e) => { e.preventDefault(); add(s.name) }} className="flex w-full items-center justify-between px-2.5 py-1.5 text-left text-[12.5px] hover:bg-hover">
                {s.name}<span className="text-[11px] text-faint">{s.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function Inspector() {
  const selection = useApp((s) => s.selection)
  const items = useApp((s) => s.items)
  const version = useApp((s) => s.detailsVersion)
  const runOp = useApp((s) => s.runOp)
  const openDialog = useApp((s) => s.openDialog)
  const [d, setD] = useState<MediaDetails | null>(null)
  const [notes, setNotes] = useState('')

  const ids = useMemo(() => items.filter((i) => selection.has(i.id)).map((i) => i.id), [items, selection])
  const single = ids.length === 1 ? ids[0] : null

  useEffect(() => {
    let alive = true
    if (single === null) { setD(null); return }
    void api('media.details', single).then((r) => { if (alive) { setD(r); setNotes(r?.notes ?? '') } })
    return () => { alive = false }
  }, [single, version])

  if (!ids.length) {
    return (
      <aside className="flex h-full w-[300px] shrink-0 flex-col items-center justify-center gap-2 border-l border-line bg-panel p-6 text-center">
        <Info size={20} className="text-faint" />
        <p className="text-[12.5px] leading-relaxed text-faint">Seleziona un elemento per vedere dettagli, tag e azioni.<br />Doppio clic o <b>Invio</b> per aprirlo.</p>
      </aside>
    )
  }

  if (ids.length > 1) {
    const sel = items.filter((i) => selection.has(i.id))
    return (
      <aside className="flex h-full w-[300px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-line bg-panel p-4">
        <div>
          <h3 className="font-display text-[15px] font-semibold">{plural(ids.length, 'elemento selezionato', 'elementi selezionati')}</h3>
          <p className="mt-0.5 text-[12px] text-faint">{sel.filter((i) => i.k === 'photo').length} foto · {sel.filter((i) => i.k === 'video').length} video · {sel.filter((i) => i.k === 'gif').length} GIF</p>
        </div>
        <div className="grid grid-cols-4 gap-1">
          {sel.slice(0, 8).map((i) => <img key={i.id} src={thumbUrl(i.id)} className="aspect-square w-full rounded object-cover" alt="" />)}
        </div>
        <section className="space-y-2">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-faint">Valuta tutti</h4>
          <RatingStars value={0} onChange={(r) => void runOp(api('media.rate', ids, r))} size={18} />
          <FlagButtons value="none" onChange={(f) => void runOp(api('media.flag', ids, f))} />
        </section>
        <section className="space-y-2">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-faint">Tag</h4>
          <TagEditor ids={ids} tags={[]} />
        </section>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" icon={<AlbumIcon size={14} />} onClick={() => openDialog({ type: 'album', ids })}>Aggiungi ad album</Button>
          <Button size="sm" icon={<Heart size={14} />} onClick={() => void runOp(api('media.favorite', ids, true))}>Preferiti</Button>
        </div>
      </aside>
    )
  }

  if (!d) return <aside className="h-full w-[300px] shrink-0 border-l border-line bg-panel" />

  const dims = d.width && d.height ? `${d.width} × ${d.height}` : '—'
  const mp = d.width && d.height ? ` · ${((d.width * d.height) / 1e6).toFixed(1).replace('.', ',')} MP` : ''

  return (
    <aside className="flex h-full w-[300px] shrink-0 flex-col overflow-y-auto border-l border-line bg-panel">
      <div className="relative aspect-[4/3] w-full shrink-0 bg-elev-2">
        <img key={d.id} src={thumbUrl(d.id)} className="h-full w-full object-contain" alt="" />
      </div>
      <div className="space-y-4 p-4">
        <div>
          <button
            className="block w-full break-all text-left font-display text-[14.5px] font-semibold leading-snug hover:text-accent"
            title="Rinomina (F2)"
            onClick={() => openDialog({ type: 'rename', ids: [d.id] })}
          >
            {d.fileName}
          </button>
          <p className="mt-1 text-[12px] text-faint" title="Da dove viene la data">
            {formatDate(d.effectiveDate)}
            {d.dateSource === 'takeout' && ' · da Google Foto'}
            {d.dateSource === 'filename' && ' · dal nome del file'}
            {d.dateSource === 'file' && ' · data del file'}
            {d.dateSource === 'none' && ' · senza data'}
          </p>
          {d.status !== 'ok' && <p className="mt-2 rounded-md bg-warn/15 px-2 py-1 text-[12px] text-warn">Stato: {d.status === 'missing' ? 'file mancante su disco' : d.status === 'corrupt' ? 'file corrotto o illeggibile' : d.status}</p>}
        </div>

        <div className="flex items-center justify-between">
          <RatingStars value={d.rating} onChange={(r) => void runOp(api('media.rate', [d.id], r))} size={18} />
          <IconButton label={d.favorite ? 'Togli dai preferiti (F)' : 'Preferito (F)'} active={d.favorite} onClick={() => void runOp(api('media.favorite', [d.id], !d.favorite))}>
            <Heart size={17} className={d.favorite ? 'fill-accent' : ''} />
          </IconButton>
        </div>
        <FlagButtons value={d.flag} onChange={(f) => void runOp(api('media.flag', [d.id], f))} />
        <ColorLabelPicker value={d.colorLabel} onChange={(c) => void runOp(api('media.color', [d.id], c))} />

        <section className="space-y-2">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-faint">Tag</h4>
          <TagEditor ids={[d.id]} tags={d.tags} />
        </section>

        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-faint">Album</h4>
            <IconButton size="sm" label="Aggiungi ad album" onClick={() => openDialog({ type: 'album', ids: [d.id] })}><Plus size={14} /></IconButton>
          </div>
          {d.albums.length === 0 ? <p className="text-[12px] text-faint">In nessun album</p> : (
            <div className="flex flex-wrap gap-1.5">
              {d.albums.map((a) => (
                <span key={a.id} className="inline-flex h-6 items-center gap-1 rounded-full bg-elev-2 pl-2.5 pr-1 text-[12px]">
                  {a.name}
                  <button className="rounded-full p-0.5 text-faint hover:bg-active hover:text-fg" onClick={() => void runOp(api('albums.removeItems', a.id, [d.id]))} aria-label="Rimuovi dall'album"><X size={11} /></button>
                </span>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-2">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-faint">Note</h4>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            onBlur={() => { if (notes !== d.notes) void runOp(api('media.notes', d.id, notes)) }}
            rows={3}
            placeholder="Scrivi una nota…"
            className="w-full resize-none rounded-lg border border-line bg-elev-2 p-2.5 text-[12.5px] outline-none placeholder:text-faint focus:border-accent/60"
          />
        </section>

        <section>
          <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-faint">Dettagli</h4>
          <Row label="Dimensioni">{dims}{mp}</Row>
          <Row label="Peso">{formatBytes(d.sizeBytes)}</Row>
          {d.durationMs ? <Row label="Durata">{formatDuration(d.durationMs)}</Row> : null}
          <Row label="Formato">{d.extension.toUpperCase()} · {d.mimeType}</Row>
          {(d.cameraMake || d.cameraModel) && <Row label="Fotocamera">{[d.cameraMake, d.cameraModel].filter(Boolean).join(' ')}</Row>}
          {d.origin !== 'unknown' && <Row label="Provenienza">{ORIGIN_LABELS[d.origin]}</Row>}
          {d.gpsLat !== null && d.gpsLon !== null && (
            <Row label="Posizione"><span className="inline-flex items-center gap-1"><MapPin size={12} className="text-accent" />{d.gpsLat.toFixed(5)}, {d.gpsLon.toFixed(5)}</span></Row>
          )}
          {d.exifDate && <Row label="Scattata">{formatDate(d.exifDate)}</Row>}
          <Row label="Modificato">{formatDate(d.modifiedAt)}</Row>
          <Row label="Percorso"><span className="font-mono text-[11.5px] text-dim">{d.filePathRelative}</span></Row>
          {d.hashSha256 && <Row label="SHA-256"><span className="font-mono text-[10.5px] text-dim">{d.hashSha256.slice(0, 24)}…</span></Row>}
        </section>

        {d.copies.length > 0 && (
          <section>
            <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-faint">Altre copie ({d.copies.length})</h4>
            <p className="mb-1.5 text-[11.5px] text-faint">Nascoste nella timeline per non vedere doppioni (originale non modificato o copia in un album di Google Foto).</p>
            {d.copies.map((c) => (
              <div key={c.id} className="flex items-center gap-2 py-0.5 text-[12px]">
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-dim" title={`${c.folder}/${c.fileName}`}>{c.folder ? `${c.folder}/` : ''}{c.fileName}</span>
                <IconButton size="sm" label="Mostra nella cartella" onClick={() => void api('media.showInFolder', c.id)}><FolderOpen size={13} /></IconButton>
              </div>
            ))}
          </section>
        )}

        <div className="flex gap-2">
          <Button size="sm" variant="soft" icon={<FolderOpen size={14} />} onClick={() => void api('media.showInFolder', d.id)}>Mostra</Button>
          <Button size="sm" variant="soft" icon={<ExternalLink size={14} />} onClick={() => void api('media.openExternal', d.id)}>Apri con…</Button>
        </div>
      </div>
    </aside>
  )
}
