import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Clock, FolderOpen, FolderSearch, HardDrive, Images, X } from 'lucide-react'
import { useApp } from '@/store/app'
import { api } from '@/lib/api'
import { Button, cx, Spinner } from './ui'

/** Schermata iniziale: nessuna cartella aperta. */
export function FolderPicker() {
  const recent = useApp((s) => s.recent)
  const opening = useApp((s) => s.opening)
  const openFolderDialog = useApp((s) => s.openFolderDialog)
  const openRecent = useApp((s) => s.openRecent)

  return (
    <div className="drag-region flex h-full w-full items-center justify-center overflow-y-auto p-10 anim-fade">
      <div className="no-drag w-full max-w-[560px] text-center">
        <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-[#8b93ff] via-[#b197fc] to-[#ff8fab] shadow-[0_8px_40px_rgba(139,147,255,0.35)]">
          <Images size={34} className="text-white" />
        </div>
        <h2 className="font-display text-[24px] font-semibold tracking-tight">Benvenuto in VibeVault</h2>
        <p className="mx-auto mt-2 max-w-[460px] text-[13.5px] leading-relaxed text-dim">
          Scegli la cartella che contiene le tue foto: VibeVault la legge così com'è, con tutte le sottocartelle,
          e la mostra come un'unica timeline ordinata per data. Nessun file viene spostato: indice e miniature
          finiscono in una cartella nascosta <code className="text-fg">.vibevault</code>.
        </p>
        <div className="mt-6 flex justify-center">
          <Button variant="primary" icon={opening ? <Spinner /> : <FolderSearch size={16} />} disabled={opening} onClick={() => void openFolderDialog()}>
            {opening ? 'Apertura…' : 'Scegli la cartella delle foto…'}
          </Button>
        </div>
        {recent.length > 0 && (
          <div className="mx-auto mt-8 max-w-[460px] text-left">
            <h3 className="mb-2 flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint"><Clock size={12} />Cartelle recenti</h3>
            <div className="overflow-hidden rounded-xl border border-line bg-panel">
              {recent.map((r) => (
                <div key={r.path} className="group flex items-center gap-3 border-b border-line px-3 py-2.5 last:border-b-0 hover:bg-hover">
                  <button
                    disabled={!r.exists || opening}
                    onClick={() => void openRecent(r.path)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-not-allowed"
                    title={r.exists ? `Apri ${r.path}` : 'Cartella non trovata: disco scollegato?'}
                  >
                    <HardDrive size={16} className={r.exists ? 'shrink-0 text-accent' : 'shrink-0 text-faint'} />
                    <span className="min-w-0">
                      <span className={cx('block truncate text-[13px] font-medium', !r.exists && 'text-faint')}>{r.name}</span>
                      <span className="block truncate font-mono text-[11px] text-faint">{r.exists ? r.path : `${r.path} · non trovata`}</span>
                    </span>
                  </button>
                  <button className="rounded p-1 text-faint opacity-0 hover:bg-active hover:text-fg group-hover:opacity-100" title="Togli dall'elenco (i file non vengono toccati)" onClick={async () => useApp.setState({ recent: await api('folder.forget', r.path) })}>
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** Nome della cartella aperta in cima alla sidebar, con menu per cambiarla. */
export function FolderSwitcher() {
  const vault = useApp((s) => s.vault)
  const recent = useApp((s) => s.recent)
  const opening = useApp((s) => s.opening)
  const openFolderDialog = useApp((s) => s.openFolderDialog)
  const openRecent = useApp((s) => s.openRecent)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    void api('folder.recent').then((r) => useApp.setState({ recent: r }))
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey, true) }
  }, [open])

  if (!vault) return null
  return (
    <div ref={ref} className="relative px-2 pt-1">
      <button
        onClick={() => setOpen(!open)}
        title={vault.root}
        className="flex h-10 w-full items-center gap-2.5 rounded-lg border border-line bg-elev-2 px-2.5 text-left transition-colors hover:border-line-strong"
      >
        {opening ? <Spinner /> : <FolderOpen size={16} className="shrink-0 text-accent" />}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium leading-tight">{vault.name}</span>
          <span className="block truncate text-[10.5px] leading-tight text-faint">{vault.layout === 'legacy' ? 'Vault v0.1' : 'Cartella foto'}</span>
        </span>
        <ChevronDown size={14} className={cx('shrink-0 text-faint transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute inset-x-2 top-12 z-30 overflow-hidden rounded-xl border border-line-strong bg-elev shadow-pop anim-pop">
          <div className="max-h-[300px] overflow-y-auto p-1">
            {recent.map((r) => (
              <button
                key={r.path}
                disabled={!r.exists || r.current}
                onClick={() => { setOpen(false); void openRecent(r.path) }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left enabled:hover:bg-hover disabled:cursor-default"
                title={r.path}
              >
                {r.current ? <Check size={14} className="shrink-0 text-accent" /> : <HardDrive size={14} className={r.exists ? 'shrink-0 text-dim' : 'shrink-0 text-faint'} />}
                <span className="min-w-0">
                  <span className={cx('block truncate text-[12.5px]', !r.exists && 'text-faint')}>{r.name}</span>
                  <span className="block truncate font-mono text-[10.5px] text-faint">{r.exists ? r.path : 'non trovata'}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="border-t border-line p-1">
            <button onClick={() => { setOpen(false); void openFolderDialog() }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12.5px] hover:bg-hover">
              <FolderSearch size={14} className="text-accent" />Apri un'altra cartella…
            </button>
            <button onClick={() => { setOpen(false); void api('vault.revealRoot') }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12.5px] hover:bg-hover">
              <FolderOpen size={14} className="text-dim" />Mostra in Esplora risorse
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
