import { useEffect } from 'react'
import { FolderOpen, FolderPlus, Images, RefreshCw, SearchX } from 'lucide-react'
import { useApp, isGridView } from '@/store/app'
import { api, onEvent, bumpThumbVersion } from '@/lib/api'
import { Sidebar } from '@/components/Sidebar'
import { Topbar } from '@/components/Topbar'
import { MediaGrid } from '@/components/MediaGrid'
import { Inspector } from '@/components/Inspector'
import { BatchBar } from '@/components/BatchBar'
import { Lightbox } from '@/components/Lightbox'
import { Dialogs } from '@/components/Dialogs'
import { CommandPalette } from '@/components/CommandPalette'
import { Toasts } from '@/components/Toasts'
import { Button, Empty, Spinner } from '@/components/ui'
import { ReviewView } from '@/views/ReviewView'
import { TrashView } from '@/views/TrashView'
import { DuplicatesView } from '@/views/DuplicatesView'
import { StatsView } from '@/views/StatsView'
import { SettingsView } from '@/views/SettingsView'

/** Appunti interni per Ctrl+C / Ctrl+X → Ctrl+V su una cartella. */
let clipboard: { ids: number[]; mode: 'copy' | 'move' } | null = null

function useTheme() {
  const theme = useApp((s) => s.settings.theme)
  const reduced = useApp((s) => s.settings.reducedMotion)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const t = theme === 'auto' ? (mq.matches ? 'dark' : 'light') : theme
      document.documentElement.dataset.theme = t
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])
  useEffect(() => { document.documentElement.dataset.motion = reduced ? 'reduced' : 'full' }, [reduced])
}

function useBackendEvents() {
  useEffect(() => {
    const st = useApp.getState
    let reloadTimer: ReturnType<typeof setTimeout> | undefined
    const softReload = () => {
      clearTimeout(reloadTimer)
      reloadTimer = setTimeout(() => { if (isGridView(st().view)) void st().reload(); void st().refreshMeta() }, 400)
    }
    let lastIndexed = 0
    const offs = [
      onEvent('scan:progress', (p) => {
        useApp.setState({ scan: p })
        // durante la scansione aggiorna la griglia al massimo ogni 3 s
        if (p.phase === 'indexing' && Date.now() - lastIndexed > 3000) { lastIndexed = Date.now(); softReload() }
        if (p.phase === 'done' && (p.added || p.updated || p.missing || p.moved)) {
          st().toast({ text: `Scansione completata: ${p.added} nuovi, ${p.updated} aggiornati${p.moved ? `, ${p.moved} spostati` : ''}${p.missing ? `, ${p.missing} mancanti` : ''}`, tone: 'ok' })
        }
      }),
      onEvent('thumbs:status', (t) => useApp.setState({ thumbs: t })),
      onEvent('library:changed', (e) => { if (e.reason === 'scan' || e.reason === 'cache') { if (e.reason === 'cache') bumpThumbVersion(); softReload() } }),
      onEvent('vault:changed', (v) => useApp.setState({ vault: v }))
    ]
    return () => { offs.forEach((o) => o()); clearTimeout(reloadTimer) }
  }, [])
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useApp.getState()
      const target = e.target as HTMLElement
      const typing = !!target?.closest('input, textarea, select, [contenteditable=true]')
      const mod = e.ctrlKey || e.metaKey
      const k = e.key.toLowerCase()

      if (mod && k === 'k') { e.preventDefault(); st.setPalette(!st.paletteOpen); return }
      if (st.dialog || st.paletteOpen) return
      if (mod && k === 'f') { e.preventDefault(); window.dispatchEvent(new Event('vv:focus-search')); return }
      if (typing) return
      if (st.view.kind === 'review') return // la Review gestisce i propri tasti

      const lb = st.lightboxIndex
      const ids = lb !== null && st.items[lb] ? [st.items[lb].id] : st.selectedIds()
      const one = ids.length ? st.items.find((i) => i.id === ids[0]) : undefined

      if (mod && k === 'z') { e.preventDefault(); void st.undo(); return }
      if (mod && k === 'a' && isGridView(st.view) && lb === null) { e.preventDefault(); st.selectAll(); return }
      if (mod && (k === 'c' || k === 'x') && ids.length) {
        clipboard = { ids, mode: k === 'c' ? 'copy' : 'move' }
        st.toast({ text: `${ids.length} elementi ${k === 'c' ? 'copiati' : 'tagliati'}: apri una cartella e premi Ctrl+V`, tone: 'info' })
        return
      }
      if (mod && k === 'v' && clipboard) {
        if (st.view.kind !== 'folder') { st.toast({ text: 'Apri una cartella nella sidebar per incollare', tone: 'info' }); return }
        const c = clipboard
        if (c.mode === 'move') clipboard = null
        void st.runOp(api(c.mode === 'copy' ? 'files.copy' : 'files.move', c.ids, st.view.path))
        return
      }
      if (mod || e.altKey) return

      switch (k) {
        case 'escape':
          if (lb !== null) st.openLightbox(null)
          else if (st.selection.size) st.clearSelection()
          break
        case 'arrowright':
        case 'arrowleft': {
          const d = k === 'arrowright' ? 1 : -1
          if (lb !== null) { const n = lb + d; if (n >= 0 && n < st.items.length) st.openLightbox(n) }
          else if (isGridView(st.view) && st.items.length) {
            const cur = st.anchorId !== null ? st.items.findIndex((i) => i.id === st.anchorId) : -1
            const n = Math.max(0, Math.min(st.items.length - 1, cur + d))
            st.select(st.items[n].id, e.shiftKey ? 'range' : 'single')
          }
          break
        }
        case 'enter':
          if (lb === null && one) st.openLightbox(st.items.findIndex((i) => i.id === one.id))
          break
        case ' ':
          if (lb !== null) { e.preventDefault(); window.dispatchEvent(new Event('vv:toggle-play')) }
          break
        case 'delete':
          if (ids.length) void st.runOp(api('files.trash', ids))
          break
        case 'f':
          if (ids.length) { const all = st.items.filter((i) => ids.includes(i.id)).every((i) => i.fav); void st.runOp(api('media.favorite', ids, !all)) }
          break
        case 'k': if (ids.length) void st.runOp(api('media.flag', ids, one?.fl === 'keep' && ids.length === 1 ? 'none' : 'keep')); break
        case 'm': if (ids.length) void st.runOp(api('media.flag', ids, one?.fl === 'maybe' && ids.length === 1 ? 'none' : 'maybe')); break
        case 'x': if (ids.length) void st.runOp(api('media.flag', ids, one?.fl === 'trash' && ids.length === 1 ? 'none' : 'trash')); break
        case 'd': st.setView({ kind: 'duplicates' }); break
        case '0': case '1': case '2': case '3': case '4': case '5':
          if (ids.length) void st.runOp(api('media.rate', ids, Number(k)))
          break
        case 'g': { const g = st.settings.gridSize; void st.updateSettings({ gridSize: g === 's' ? 'm' : g === 'm' ? 'l' : 's' }); break }
        case 'i': if (lb === null) void st.updateSettings({ showInspector: !st.settings.showInspector }); break
        case 't': if (ids.length) st.openDialog({ type: 'tags', ids }); break
        case 'a': if (ids.length) st.openDialog({ type: 'album', ids }); break
        case 'f2': if (ids.length) st.openDialog({ type: 'rename', ids }); break
        case 'r': if (lb === null) st.setView({ kind: 'review' }); break
        default: return
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

function Welcome() {
  const vault = useApp((s) => s.vault)
  const scan = useApp((s) => s.scan)
  const toast = useApp((s) => s.toast)
  const scanning = scan && ['walking', 'indexing', 'reconciling'].includes(scan.phase)
  return (
    <div className="flex h-full items-center justify-center p-10 anim-fade">
      <div className="max-w-[520px] text-center">
        <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-[#8b93ff] via-[#b197fc] to-[#ff8fab] shadow-[0_8px_40px_rgba(139,147,255,0.35)]">
          <Images size={34} className="text-white" />
        </div>
        <h2 className="font-display text-[24px] font-semibold tracking-tight">Benvenuto in VibeVault</h2>
        <p className="mt-2 text-[13.5px] leading-relaxed text-dim">
          Copia foto, video e GIF nella cartella <b className="text-fg">Library</b> del vault, poi avvia la scansione.
          Tutto resta qui: niente cloud, niente account, nessun file originale modificato.
        </p>
        <p className="mt-3 rounded-lg bg-elev-2 px-3 py-2 font-mono text-[11.5px] text-faint">{vault?.libraryDir}</p>
        <div className="mt-5 flex justify-center gap-2">
          <Button variant="soft" icon={<FolderOpen size={15} />} onClick={() => void api('vault.revealRoot')}>Apri cartella vault</Button>
          <Button variant="soft" icon={<FolderPlus size={15} />} onClick={async () => { const r = await api('library.addScanFolderDialog'); if (!r.ok && r.message) toast({ text: r.message, tone: 'error' }) }}>Scegli cartella…</Button>
          <Button variant="primary" icon={scanning ? <Spinner /> : <RefreshCw size={15} />} disabled={!!scanning} onClick={() => void api('library.scan')}>{scanning ? `Scansione… ${scan?.scanned ?? 0}` : 'Scansiona ora'}</Button>
        </div>
      </div>
    </div>
  )
}

function GridArea() {
  const items = useApp((s) => s.items)
  const loading = useApp((s) => s.loading)
  const search = useApp((s) => s.search)
  const view = useApp((s) => s.view)
  const showInspector = useApp((s) => s.settings.showInspector)

  let body
  if (loading && !items.length) body = <div className="flex h-full items-center justify-center text-dim"><Spinner size={22} /></div>
  else if (!items.length && search) body = <Empty icon={<SearchX size={26} />} title="Nessun risultato">Prova altre parole o i filtri avanzati: <code>tag:</code> <code>ext:</code> <code>year:</code> <code>camera:</code> <code>is:fav</code></Empty>
  else if (!items.length && view.kind === 'library' && view.id === 'all') body = <Welcome />
  else if (!items.length) body = <Empty icon={<Images size={26} />} title="Niente qui">Questa vista è vuota.{view.kind === 'album' && ' Trascina elementi sull\'album nella sidebar per aggiungerli.'}</Empty>
  else body = <MediaGrid />

  return (
    <div className="flex min-h-0 flex-1">
      <div className="relative min-w-0 flex-1">
        {body}
        <BatchBar />
      </div>
      {showInspector && items.length > 0 && <Inspector />}
    </div>
  )
}

export default function App() {
  const view = useApp((s) => s.view)
  useTheme()
  useBackendEvents()
  useShortcuts()

  useEffect(() => {
    const st = useApp.getState()
    void (async () => {
      const [settings, vault, scan, thumbs] = await Promise.all([api('settings.get'), api('vault.info'), api('library.scanStatus'), api('thumbs.status')])
      useApp.setState({ settings, vault, scan, thumbs })
      await Promise.all([st.reload(), st.refreshMeta()])
      if (vault.rootChanged) st.toast({ text: `Vault aperto da un nuovo percorso (${vault.root}). Tutto a posto: i percorsi sono relativi.`, tone: 'info' })
    })()
  }, [])

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <div className="flex min-h-0 flex-1">
          {isGridView(view) && <GridArea />}
          {view.kind === 'review' && <div className="min-w-0 flex-1"><ReviewView /></div>}
          {view.kind === 'trash' && <div className="min-w-0 flex-1"><TrashView /></div>}
          {view.kind === 'duplicates' && <div className="min-w-0 flex-1"><DuplicatesView /></div>}
          {view.kind === 'stats' && <div className="min-w-0 flex-1"><StatsView /></div>}
          {view.kind === 'settings' && <div className="min-w-0 flex-1"><SettingsView /></div>}
        </div>
      </main>
      <Lightbox />
      <Dialogs />
      <CommandPalette />
      <Toasts />
    </div>
  )
}
