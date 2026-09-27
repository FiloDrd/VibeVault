import { useMemo, useState, type ReactNode } from 'react'
import {
  Archive, BarChart3, Camera, ChevronRight, Clock, Copy, FileQuestion, Film, Folder, FolderPlus, Heart, Image, Images,
  LayoutGrid, Monitor, Plus, Settings, Sparkles, Tag as TagIcon, Trash2, HardDrive, CalendarOff, Album as AlbumIcon,
  Smartphone, MessageCircle, Share2, MapPin, RectangleVertical, Timer, Clapperboard, FileWarning, CalendarDays
} from 'lucide-react'
import type { FolderNode } from '@shared/types'
import { useApp, type LibraryViewId, type View } from '@/store/app'
import { api, thumbUrl } from '@/lib/api'
import { formatCount } from '@/lib/format'
import { DRAG_MIME } from './MediaGrid'
import { FolderSwitcher } from './FolderPicker'
import { cx, IconButton } from './ui'

function sameView(a: View, b: View): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'library' && b.kind === 'library') return a.id === b.id
  if ((a.kind === 'album' && b.kind === 'album') || (a.kind === 'tag' && b.kind === 'tag')) return a.id === b.id
  if (a.kind === 'folder' && b.kind === 'folder') return a.path === b.path
  if (a.kind === 'year' && b.kind === 'year') return a.year === b.year
  return true
}

function readIds(e: React.DragEvent): number[] | null {
  const raw = e.dataTransfer.getData(DRAG_MIME)
  if (!raw) return null
  try { return JSON.parse(raw) as number[] } catch { return null }
}

function Item({ icon, label, view, count, onDropIds, dropHint, indent = 0, trailing }: {
  icon: ReactNode; label: string; view: View; count?: number; onDropIds?: (ids: number[]) => void; dropHint?: string; indent?: number; trailing?: ReactNode
}) {
  const current = useApp((s) => s.view)
  const setView = useApp((s) => s.setView)
  const [over, setOver] = useState(false)
  const active = sameView(current, view)
  return (
    <div
      onDragOver={(e) => { if (onDropIds && e.dataTransfer.types.includes(DRAG_MIME)) { e.preventDefault(); setOver(true) } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { setOver(false); const ids = readIds(e); if (ids && onDropIds) { e.preventDefault(); onDropIds(ids) } }}
      className="relative"
    >
      <button
        onClick={() => setView(view)}
        title={over && dropHint ? dropHint : label}
        className={cx(
          'group flex h-8 w-full items-center gap-2.5 rounded-lg pr-2 text-left text-[13px] transition-colors duration-100',
          active ? 'bg-accent-soft text-fg font-medium' : 'text-dim hover:bg-hover hover:text-fg',
          over && 'ring-2 ring-accent bg-accent-soft'
        )}
        style={{ paddingLeft: 10 + indent * 14 }}
      >
        <span className={cx('shrink-0', active ? 'text-accent' : 'text-faint group-hover:text-dim')}>{icon}</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {trailing}
        {count !== undefined && count > 0 && <span className="text-[11px] tabular-nums text-faint">{formatCount(count)}</span>}
      </button>
    </div>
  )
}

function Section({ title, action, children, collapsible = false }: { title: string; action?: ReactNode; children: ReactNode; collapsible?: boolean }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="mt-4">
      <div className="group mb-1 flex h-6 items-center justify-between px-2.5">
        <button className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint hover:text-dim" onClick={() => collapsible && setOpen(!open)}>
          {collapsible && <ChevronRight size={12} className={cx('transition-transform', open && 'rotate-90')} />}
          {title}
        </button>
        {action}
      </div>
      {open && <div className="space-y-px">{children}</div>}
    </div>
  )
}

const LIB: { id: LibraryViewId; label: string; icon: ReactNode }[] = [
  { id: 'all', label: 'Tutti i media', icon: <LayoutGrid size={16} /> },
  { id: 'photos', label: 'Foto', icon: <Image size={16} /> },
  { id: 'videos', label: 'Video', icon: <Film size={16} /> },
  { id: 'gif', label: 'GIF', icon: <Sparkles size={16} /> },
  { id: 'raw', label: 'Raw', icon: <Camera size={16} /> },
  { id: 'screenshots', label: 'Screenshot', icon: <Monitor size={16} /> }
]

const ORG: { id: LibraryViewId; label: string; icon: ReactNode }[] = [
  { id: 'favorites', label: 'Preferiti', icon: <Heart size={16} /> },
  { id: 'recent', label: 'Aggiunti di recente', icon: <Clock size={16} /> },
  { id: 'archive', label: 'Archivio', icon: <Archive size={16} /> }
]

/** Viste automatiche: si riempiono da sole con i metadata letti dalla scansione. */
const ORIGINS: { id: LibraryViewId; origin: string; label: string; icon: ReactNode }[] = [
  { id: 'phone', origin: 'phone', label: 'Smartphone', icon: <Smartphone size={16} /> },
  { id: 'camera', origin: 'camera', label: 'Fotocamera', icon: <Camera size={16} /> },
  { id: 'whatsapp', origin: 'whatsapp', label: 'WhatsApp', icon: <MessageCircle size={16} /> },
  { id: 'social', origin: 'social', label: 'Social e messaggi', icon: <Share2 size={16} /> }
]

const DISCOVER: { id: LibraryViewId; label: string; icon: ReactNode }[] = [
  { id: 'gps', label: 'Con posizione', icon: <MapPin size={16} /> },
  { id: 'vertical', label: 'Video verticali', icon: <RectangleVertical size={16} /> },
  { id: 'short', label: 'Video brevi', icon: <Timer size={16} /> },
  { id: 'long', label: 'Video lunghi', icon: <Clapperboard size={16} /> },
  { id: 'large', label: 'File grandi', icon: <HardDrive size={16} /> },
  { id: 'nodate', label: 'Senza data', icon: <CalendarOff size={16} /> }
]

interface TreeNode { node: FolderNode; children: TreeNode[] }

function buildTree(folders: FolderNode[]): TreeNode[] {
  const byId = new Map<number, TreeNode>()
  for (const f of folders) byId.set(f.id, { node: f, children: [] })
  const roots: TreeNode[] = []
  for (const t of byId.values()) {
    const p = t.node.parentId ? byId.get(t.node.parentId) : undefined
    if (p) p.children.push(t)
    else roots.push(t)
  }
  return roots
}

function FolderTree({ nodes, depth }: { nodes: TreeNode[]; depth: number }) {
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const runOp = useApp((s) => s.runOp)
  return (
    <>
      {nodes.map((t) => {
        const isOpen = open[t.node.pathRelative] ?? depth < 1
        return (
          <div key={t.node.id}>
            <Item
              icon={<Folder size={15} />}
              label={t.node.name}
              count={t.node.fileCount}
              indent={depth}
              view={{ kind: 'folder', path: t.node.pathRelative }}
              dropHint={`Sposta in ${t.node.pathRelative}`}
              onDropIds={(ids) => void runOp(api('files.move', ids, t.node.pathRelative))}
              trailing={t.children.length > 0 && (
                <span
                  role="button"
                  onClick={(e) => { e.stopPropagation(); setOpen({ ...open, [t.node.pathRelative]: !isOpen }) }}
                  className="rounded p-0.5 text-faint hover:bg-active hover:text-fg"
                >
                  <ChevronRight size={12} className={cx('transition-transform', isOpen && 'rotate-90')} />
                </span>
              )}
            />
            {isOpen && t.children.length > 0 && <FolderTree nodes={t.children} depth={depth + 1} />}
          </div>
        )
      })}
    </>
  )
}

export function Sidebar() {
  const vault = useApp((s) => s.vault)
  const stats = useApp((s) => s.stats)
  const albums = useApp((s) => s.albums)
  const tags = useApp((s) => s.tags)
  const folders = useApp((s) => s.folders)
  const trashCount = useApp((s) => s.trashCount)
  const openDialog = useApp((s) => s.openDialog)
  const runOp = useApp((s) => s.runOp)
  const refreshMeta = useApp((s) => s.refreshMeta)
  const setView = useApp((s) => s.setView)
  const tree = useMemo(() => buildTree(folders), [folders])
  const originCount = (o: string) => stats?.byOrigin.find((x) => x.origin === o)?.count ?? 0
  const years = useMemo(() => (stats?.byYear ?? []).filter((y) => /^\d{4}$/.test(y.year)).sort((a, b) => Number(b.year) - Number(a.year)), [stats])

  const newAlbum = () => openDialog({
    type: 'prompt', title: 'Nuovo album', label: 'Nome album', placeholder: 'es. Estate 2024', confirmText: 'Crea',
    onSubmit: async (name) => {
      const ids = useApp.getState().selectedIds()
      const a = await api('albums.create', name, ids)
      await refreshMeta()
      setView({ kind: 'album', id: a.id })
    }
  })

  const rootFolder = vault?.layout === 'legacy' ? 'Library' : ''
  const newFolder = () => openDialog({
    type: 'prompt', title: `Nuova cartella in ${rootFolder || vault?.name || 'cartella'}`, label: 'Nome cartella', confirmText: 'Crea',
    onSubmit: async (name) => {
      const r = await api('files.createFolder', rootFolder, name)
      if (!r.ok) useApp.getState().toast({ text: r.message ?? 'Errore', tone: 'error' })
      await refreshMeta()
    }
  })

  return (
    <aside className="flex h-full w-[248px] shrink-0 flex-col border-r border-line bg-panel">
      <div className="drag-region flex h-11 shrink-0 items-center gap-2.5 px-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-[#8b93ff] via-[#b197fc] to-[#ff8fab] shadow-[0_2px_12px_rgba(139,147,255,0.35)]">
          <Images size={15} className="text-white" />
        </div>
        <span className="font-display text-[15px] font-semibold tracking-tight">VibeVault</span>
      </div>
      <FolderSwitcher />

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        <Section title="Libreria">
          {LIB.map((l) => <Item key={l.id} icon={l.icon} label={l.label} view={{ kind: 'library', id: l.id }} />)}
        </Section>

        {ORIGINS.some((o) => originCount(o.origin) > 0) && (
          <Section title="Provenienza" collapsible>
            {ORIGINS.filter((o) => originCount(o.origin) > 0).map((o) => (
              <Item key={o.id} icon={o.icon} label={o.label} count={originCount(o.origin)} view={{ kind: 'library', id: o.id }} />
            ))}
          </Section>
        )}

        {years.length > 0 && (
          <Section title="Anni" collapsible>
            {years.map((y) => <Item key={y.year} icon={<CalendarDays size={16} />} label={y.year} count={y.count} view={{ kind: 'year', year: Number(y.year) }} />)}
          </Section>
        )}

        <Section title="Scopri" collapsible>
          {DISCOVER.map((l) => (
            <Item key={l.id} icon={l.icon} label={l.label} count={l.id === 'gps' ? stats?.withGps : l.id === 'nodate' ? stats?.noDate : undefined} view={{ kind: 'library', id: l.id }} />
          ))}
        </Section>

        <Section title="Organizza">
          <Item icon={<Sparkles size={16} />} label="Review" view={{ kind: 'review' }} />
          <Item icon={<Copy size={16} />} label="Duplicati" view={{ kind: 'duplicates' }} />
          {ORG.map((l) => (
            <Item
              key={l.id}
              icon={l.icon}
              label={l.label}
              view={{ kind: 'library', id: l.id }}
              onDropIds={l.id === 'favorites' ? (ids) => void runOp(api('media.favorite', ids, true)) : l.id === 'archive' ? (ids) => void runOp(api('media.archive', ids, true)) : undefined}
              dropHint={l.id === 'favorites' ? 'Aggiungi ai preferiti' : l.id === 'archive' ? 'Archivia' : undefined}
            />
          ))}
        </Section>

        <Section title="Album" collapsible action={<IconButton size="sm" label="Nuovo album" onClick={newAlbum}><Plus size={14} /></IconButton>}>
          {albums.length === 0 && <p className="px-2.5 py-1 text-[12px] text-faint">Nessun album. Trascina qui i media dopo averne creato uno.</p>}
          {albums.map((a) => (
            <Item
              key={a.id}
              icon={a.coverMediaId ? <img src={thumbUrl(a.coverMediaId)} className="h-5 w-5 rounded object-cover" alt="" /> : <AlbumIcon size={16} />}
              label={a.name}
              count={a.count}
              view={{ kind: 'album', id: a.id }}
              dropHint={`Aggiungi a "${a.name}"`}
              onDropIds={(ids) => void runOp(api('albums.addItems', a.id, ids))}
            />
          ))}
        </Section>

        {tags.length > 0 && (
          <Section title="Tag" collapsible>
            {tags.map((t) => (
              <Item
                key={t.id}
                icon={<TagIcon size={15} />}
                label={t.name}
                count={t.count}
                view={{ kind: 'tag', id: t.id }}
                dropHint={`Aggiungi tag "${t.name}"`}
                onDropIds={(ids) => void runOp(api('tags.add', ids, [t.name]))}
              />
            ))}
          </Section>
        )}

        <Section title="Cartelle" collapsible action={<IconButton size="sm" label="Nuova cartella" onClick={newFolder}><FolderPlus size={14} /></IconButton>}>
          {tree.length === 0 && <p className="px-2.5 py-1 text-[12px] text-faint">Nessuna cartella indicizzata.</p>}
          <FolderTree nodes={tree} depth={0} />
        </Section>

        <Section title="Salute libreria" collapsible>
          <Item icon={<FileQuestion size={16} />} label="File mancanti" count={stats?.missing} view={{ kind: 'library', id: 'missing' }} />
          <Item icon={<FileWarning size={16} />} label="File danneggiati" count={stats?.corrupt} view={{ kind: 'library', id: 'corrupt' }} />
        </Section>
      </nav>

      <div className="space-y-px border-t border-line p-2">
        <Item
          icon={<Trash2 size={16} />}
          label="Cestino"
          count={trashCount}
          view={{ kind: 'trash' }}
          dropHint="Sposta nel cestino"
          onDropIds={(ids) => void runOp(api('files.trash', ids))}
        />
        <Item icon={<BarChart3 size={16} />} label="Statistiche" view={{ kind: 'stats' }} />
        <Item icon={<Settings size={16} />} label="Impostazioni" view={{ kind: 'settings' }} />
      </div>
    </aside>
  )
}
