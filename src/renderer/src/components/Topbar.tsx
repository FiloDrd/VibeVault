import { useEffect, useRef, useState } from 'react'
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Command, Grid2x2, Grid3x3, LayoutGrid, PanelRight, RefreshCw, Search, X, ImageDown } from 'lucide-react'
import type { MediaKind, SortField } from '@shared/types'
import { useApp, isGridView, LIBRARY_VIEWS } from '@/store/app'
import { api } from '@/lib/api'
import { formatCount, plural } from '@/lib/format'
import { cx, IconButton, Kbd, Spinner } from './ui'

const KINDS: { k: MediaKind; label: string }[] = [
  { k: 'photo', label: 'Foto' },
  { k: 'video', label: 'Video' },
  { k: 'gif', label: 'GIF' },
  { k: 'raw', label: 'Raw' }
]

const SORTS: { v: SortField; label: string }[] = [
  { v: 'date', label: 'Data' },
  { v: 'name', label: 'Nome' },
  { v: 'size', label: 'Dimensione' },
  { v: 'added', label: 'Aggiunta' },
  { v: 'rating', label: 'Valutazione' },
  { v: 'duration', label: 'Durata' }
]

function viewTitle(): string {
  const s = useApp.getState()
  const v = s.view
  switch (v.kind) {
    case 'library': return LIBRARY_VIEWS[v.id].label
    case 'album': return s.albums.find((a) => a.id === v.id)?.name ?? 'Album'
    case 'tag': return `#${s.tags.find((t) => t.id === v.id)?.name ?? 'tag'}`
    case 'folder': return v.path.split('/').pop() || s.vault?.name || 'Cartella'
    case 'year': return String(v.year)
    case 'review': return 'Review'
    case 'duplicates': return 'Duplicati'
    case 'trash': return 'Cestino'
    case 'stats': return 'Statistiche'
    case 'settings': return 'Impostazioni'
  }
}

export function Topbar() {
  const view = useApp((s) => s.view)
  const search = useApp((s) => s.search)
  const setSearch = useApp((s) => s.setSearch)
  const sort = useApp((s) => s.sort)
  const order = useApp((s) => s.order)
  const setSort = useApp((s) => s.setSort)
  const kindFilter = useApp((s) => s.kindFilter)
  const toggleKind = useApp((s) => s.toggleKindFilter)
  const items = useApp((s) => s.items)
  const loading = useApp((s) => s.loading)
  const settings = useApp((s) => s.settings)
  const updateSettings = useApp((s) => s.updateSettings)
  const scan = useApp((s) => s.scan)
  const thumbs = useApp((s) => s.thumbs)
  const setPalette = useApp((s) => s.setPalette)
  useApp((s) => s.albums) // ri-render sul nome album
  const [q, setQ] = useState(search)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => setQ(search), [search])
  useEffect(() => {
    if (q === search) return
    const t = setTimeout(() => setSearch(q), 220)
    return () => clearTimeout(t)
  }, [q, search, setSearch])

  useEffect(() => {
    const onFocus = () => inputRef.current?.focus()
    window.addEventListener('vv:focus-search', onFocus)
    return () => window.removeEventListener('vv:focus-search', onFocus)
  }, [])

  const grid = isGridView(view)
  const scanning = scan && ['walking', 'indexing', 'reconciling'].includes(scan.phase)
  const isWin = window.vv.platform === 'win32'

  return (
    <header className={cx('drag-region flex h-11 shrink-0 items-center gap-3 border-b border-line bg-bg/80 pl-4 backdrop-blur', isWin ? 'pr-[150px]' : 'pr-3')}>
      <div className="flex min-w-0 shrink-0 items-baseline gap-2" style={{ maxWidth: 280 }}>
        <h1 className="truncate font-display text-[15px] font-semibold tracking-tight">{viewTitle()}</h1>
        {grid && <span className="shrink-0 text-[12px] tabular-nums text-faint">{loading ? '…' : plural(items.length, 'elemento', 'elementi')}</span>}
      </div>

      <div className="mx-auto flex w-full min-w-[160px] max-w-[480px] items-center">
        <label className="group relative flex h-8 w-full items-center">
          <Search size={15} className="pointer-events-none absolute left-2.5 text-faint group-focus-within:text-accent" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { setQ(''); setSearch(''); (e.target as HTMLInputElement).blur() } }}
            placeholder="Cerca…   tag:mare  ext:jpg  year:2023  is:fav"
            className="h-8 w-full rounded-lg border border-transparent bg-elev-2 pl-8 pr-8 text-[13px] text-fg outline-none transition-colors placeholder:text-faint focus:border-accent/60 focus:bg-elev"
          />
          {q ? (
            <button className="absolute right-2 text-faint hover:text-fg" onClick={() => { setQ(''); setSearch('') }} aria-label="Pulisci ricerca"><X size={14} /></button>
          ) : (
            <span className="pointer-events-none absolute right-2 hidden items-center gap-0.5 md:flex"><Kbd>Ctrl</Kbd><Kbd>F</Kbd></span>
          )}
        </label>
      </div>

      {grid && (
        <div className="flex shrink-0 items-center gap-1">
          <div className="hidden items-center gap-0.5 rounded-lg bg-elev-2 p-0.5 lg:flex">
            {KINDS.map((k) => (
              <button
                key={k.k}
                onClick={() => toggleKind(k.k)}
                className={cx('h-7 rounded-md px-2 text-[12px] font-medium transition-colors', kindFilter.includes(k.k) ? 'bg-accent text-accent-fg' : 'text-dim hover:text-fg')}
              >
                {k.label}
              </button>
            ))}
          </div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortField)}
            className="h-8 rounded-lg bg-elev-2 px-2 text-[12.5px] text-fg outline-none"
            title="Ordina per"
          >
            {SORTS.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
          </select>
          <IconButton label={order === 'desc' ? 'Decrescente' : 'Crescente'} onClick={() => setSort(sort, order === 'desc' ? 'asc' : 'desc')}>
            {order === 'desc' ? <ArrowDownWideNarrow size={16} /> : <ArrowUpNarrowWide size={16} />}
          </IconButton>
          <IconButton
            label="Dimensione griglia (G)"
            onClick={() => void updateSettings({ gridSize: settings.gridSize === 's' ? 'm' : settings.gridSize === 'm' ? 'l' : 's' })}
          >
            {settings.gridSize === 's' ? <Grid3x3 size={16} /> : settings.gridSize === 'm' ? <LayoutGrid size={16} /> : <Grid2x2 size={16} />}
          </IconButton>
          <IconButton label="Pannello info (I)" active={settings.showInspector} onClick={() => void updateSettings({ showInspector: !settings.showInspector })}>
            <PanelRight size={16} />
          </IconButton>
        </div>
      )}

      <div className="flex shrink-0 items-center gap-1">
        {thumbs && thumbs.queued > 0 && (
          <span className="hidden items-center gap-1.5 rounded-lg px-2 text-[11.5px] tabular-nums text-faint xl:flex" title="Miniature in generazione">
            <ImageDown size={14} /> {formatCount(thumbs.queued)}
          </span>
        )}
        <button
          onClick={() => void (scanning ? api('library.cancelScan') : api('library.scan'))}
          title={scanning ? `Scansione: ${scan?.currentPath ?? ''} — clic per fermare` : 'Scansiona libreria'}
          className={cx('flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12px] transition-colors', scanning ? 'bg-accent-soft text-accent' : 'text-dim hover:bg-hover hover:text-fg')}
        >
          {scanning ? <Spinner size={13} /> : <RefreshCw size={15} />}
          {scanning && <span className="tabular-nums">{formatCount(scan!.scanned)}</span>}
        </button>
        <IconButton label="Comandi (Ctrl+K)" onClick={() => setPalette(true)}><Command size={16} /></IconButton>
      </div>
    </header>
  )
}
