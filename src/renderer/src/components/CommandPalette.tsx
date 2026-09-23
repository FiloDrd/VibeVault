import { useEffect, useMemo, useState } from 'react'
import { Command as CmdIcon, Search } from 'lucide-react'
import type { ThemeName } from '@shared/types'
import { useApp, type LibraryViewId } from '@/store/app'
import { api, bumpThumbVersion } from '@/lib/api'
import { cx, Kbd } from './ui'

interface Cmd { id: string; label: string; hint?: string; keys?: string; run: () => void | Promise<void>; when?: () => boolean }

export function CommandPalette() {
  const open = useApp((s) => s.paletteOpen)
  const setOpen = useApp((s) => s.setPalette)
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)

  const commands = useMemo<Cmd[]>(() => {
    const st = () => useApp.getState()
    const sel = () => st().selectedIds()
    const hasSel = () => st().selection.size > 0
    const lib = (id: LibraryViewId) => () => st().setView({ kind: 'library', id })
    const theme = (t: ThemeName) => () => void st().updateSettings({ theme: t })
    return [
      { id: 'review', label: 'Apri Review', hint: 'Decidi velocemente cosa tenere', run: () => st().setView({ kind: 'review' }) },
      { id: 'scan', label: 'Scansiona libreria', run: async () => { await api('library.scan') } },
      { id: 'dups', label: 'Trova duplicati', run: () => st().setView({ kind: 'duplicates' }) },
      { id: 'large', label: 'File più grandi', run: lib('large') },
      { id: 'vvert', label: 'Video verticali', run: lib('vertical') },
      { id: 'nodate', label: 'File senza data', run: lib('nodate') },
      { id: 'fav', label: 'Vai ai preferiti', run: lib('favorites') },
      { id: 'trash', label: 'Apri cestino', run: () => st().setView({ kind: 'trash' }) },
      { id: 'stats', label: 'Statistiche libreria', run: () => st().setView({ kind: 'stats' }) },
      { id: 'newalbum', label: 'Crea album', hint: 'con la selezione corrente', run: () => st().openDialog({ type: 'prompt', title: 'Nuovo album', label: 'Nome', confirmText: 'Crea', onSubmit: async (n) => { const a = await api('albums.create', n, sel()); await st().refreshMeta(); st().setView({ kind: 'album', id: a.id }) } }) },
      { id: 'tag', label: 'Aggiungi tag ai selezionati', keys: 'T', when: hasSel, run: () => st().openDialog({ type: 'tags', ids: sel() }) },
      { id: 'album', label: 'Aggiungi selezionati ad album', keys: 'A', when: hasSel, run: () => st().openDialog({ type: 'album', ids: sel() }) },
      { id: 'move', label: 'Sposta selezionati in cartella', when: hasSel, run: () => st().openDialog({ type: 'move', ids: sel(), mode: 'move' }) },
      { id: 'copy', label: 'Copia selezionati in cartella', when: hasSel, run: () => st().openDialog({ type: 'move', ids: sel(), mode: 'copy' }) },
      { id: 'rename', label: 'Rinomina selezionati', keys: 'F2', when: hasSel, run: () => st().openDialog({ type: 'rename', ids: sel() }) },
      { id: 'trashsel', label: 'Sposta selezionati nel cestino', keys: 'Canc', when: hasSel, run: () => void st().runOp(api('files.trash', sel())) },
      { id: 'undo', label: 'Annulla ultima operazione', keys: 'Ctrl+Z', run: () => st().undo() },
      { id: 'backup', label: 'Backup database', run: async () => { const r = await api('maintenance.backupDb'); st().toast({ text: r.ok ? `Backup: ${r.path}` : r.message ?? 'Errore', tone: r.ok ? 'ok' : 'error' }) } },
      { id: 'cache', label: 'Svuota cache miniature', run: async () => { const r = await api('maintenance.clearCache'); bumpThumbVersion(); st().toast({ text: `Cache svuotata (${r.removed})`, tone: 'ok' }); void st().reload() } },
      { id: 't-dark', label: 'Tema: scuro', run: theme('dark') },
      { id: 't-light', label: 'Tema: chiaro', run: theme('light') },
      { id: 't-auto', label: 'Tema: automatico', run: theme('auto') },
      { id: 't-hc', label: 'Tema: alto contrasto', run: theme('high-contrast') },
      { id: 'grid', label: 'Cambia dimensione griglia', keys: 'G', run: () => { const g = st().settings.gridSize; void st().updateSettings({ gridSize: g === 's' ? 'm' : g === 'm' ? 'l' : 's' }) } },
      { id: 'settings', label: 'Impostazioni', run: () => st().setView({ kind: 'settings' }) },
      { id: 'vault', label: 'Apri cartella del vault', run: () => void api('vault.revealRoot') },
      { id: 'logs', label: 'Apri log operazioni', run: () => void api('maintenance.openLogs') }
    ]
  }, [])

  const list = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    return commands.filter((c) => (!c.when || c.when()) && words.every((w) => `${c.label} ${c.hint ?? ''}`.toLowerCase().includes(w)))
  }, [q, commands, open])

  useEffect(() => { setIdx(0) }, [q])
  useEffect(() => { if (open) setQ('') }, [open])
  if (!open) return null

  const run = (c: Cmd) => { setOpen(false); void c.run() }

  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-black/45 pt-[14vh] anim-fade" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false) }}>
      <div className="h-fit w-full max-w-[560px] overflow-hidden rounded-2xl border border-line-strong bg-elev shadow-pop anim-pop" onKeyDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <Search size={16} className="text-faint" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(list.length - 1, i + 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)) }
              else if (e.key === 'Enter' && list[idx]) run(list[idx])
              else if (e.key === 'Escape') setOpen(false)
            }}
            placeholder="Cosa vuoi fare?"
            className="h-12 flex-1 bg-transparent text-[14px] outline-none placeholder:text-faint"
          />
          <Kbd>Esc</Kbd>
        </div>
        <div className="max-h-[50vh] overflow-y-auto p-1.5">
          {list.map((c, i) => (
            <button
              key={c.id}
              onMouseEnter={() => setIdx(i)}
              onClick={() => run(c)}
              className={cx('flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[13px]', i === idx ? 'bg-accent-soft text-fg' : 'text-dim')}
            >
              <CmdIcon size={14} className={i === idx ? 'text-accent' : 'text-faint'} />
              <span className="flex-1">{c.label}{c.hint && <span className="ml-2 text-[12px] text-faint">{c.hint}</span>}</span>
              {c.keys && <Kbd>{c.keys}</Kbd>}
            </button>
          ))}
          {!list.length && <p className="px-3 py-4 text-center text-[12.5px] text-faint">Nessun comando</p>}
        </div>
      </div>
    </div>
  )
}
