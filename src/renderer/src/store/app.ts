import { create } from 'zustand'
import type {
  Album, AppSettings, FolderNode, GridItem, MediaKind, MediaQuery, OpResult, ScanProgress, SortField, Tag, ThumbStatus, VaultInfo
} from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'
import { api } from '@/lib/api'

export type LibraryViewId =
  | 'all' | 'photos' | 'videos' | 'gif' | 'raw' | 'screenshots' | 'favorites' | 'recent' | 'large' | 'nodate' | 'archive' | 'missing' | 'vertical'

export type View =
  | { kind: 'library'; id: LibraryViewId }
  | { kind: 'album'; id: number }
  | { kind: 'tag'; id: number }
  | { kind: 'folder'; path: string }
  | { kind: 'review' }
  | { kind: 'duplicates' }
  | { kind: 'trash' }
  | { kind: 'stats' }
  | { kind: 'settings' }

export const LIBRARY_VIEWS: Record<LibraryViewId, { label: string; query: MediaQuery }> = {
  all: { label: 'Tutti i media', query: {} },
  photos: { label: 'Foto', query: { kinds: ['photo'] } },
  videos: { label: 'Video', query: { kinds: ['video'] } },
  gif: { label: 'GIF', query: { kinds: ['gif'] } },
  raw: { label: 'Raw', query: { kinds: ['raw'] } },
  screenshots: { label: 'Screenshot', query: { screenshots: true } },
  favorites: { label: 'Preferiti', query: { favorite: true } },
  recent: { label: 'Aggiunti di recente', query: { recent: true, sort: 'added' } },
  large: { label: 'File grandi', query: { largeFiles: true, sort: 'size' } },
  nodate: { label: 'Senza data EXIF', query: { noDate: true } },
  archive: { label: 'Archivio', query: { archived: true } },
  missing: { label: 'File mancanti', query: { missing: true } },
  vertical: { label: 'Video verticali', query: { kinds: ['video'], orientation: 'portrait' } }
}

export function isGridView(v: View): boolean {
  return v.kind === 'library' || v.kind === 'album' || v.kind === 'tag' || v.kind === 'folder'
}

export interface Toast {
  id: number
  text: string
  tone: 'info' | 'ok' | 'error'
  operationId?: number
  details?: string[]
}

export type DialogState =
  | { type: 'prompt'; title: string; label?: string; initial?: string; placeholder?: string; confirmText?: string; onSubmit: (v: string) => void | Promise<void> }
  | { type: 'confirm'; title: string; message: string; confirmText?: string; danger?: boolean; typeToConfirm?: string; onConfirm: () => void | Promise<void> }
  | { type: 'move'; ids: number[]; mode: 'move' | 'copy' }
  | { type: 'album'; ids: number[] }
  | { type: 'tags'; ids: number[] }
  | { type: 'rename'; ids: number[] }

interface State {
  view: View
  search: string
  sort: SortField
  order: 'asc' | 'desc'
  kindFilter: MediaKind[]
  items: GridItem[]
  loading: boolean
  selection: Set<number>
  anchorId: number | null
  lightboxIndex: number | null
  settings: AppSettings
  vault: VaultInfo | null
  albums: Album[]
  tags: Tag[]
  folders: FolderNode[]
  scan: ScanProgress | null
  thumbs: ThumbStatus | null
  trashCount: number
  toasts: Toast[]
  dialog: DialogState | null
  paletteOpen: boolean
  detailsVersion: number

  setView: (v: View) => void
  setSearch: (s: string) => void
  setSort: (s: SortField, o?: 'asc' | 'desc') => void
  toggleKindFilter: (k: MediaKind | null) => void
  reload: () => Promise<void>
  refreshMeta: () => Promise<void>
  updateSettings: (p: Partial<AppSettings>) => Promise<void>

  select: (id: number, mode: 'single' | 'toggle' | 'range') => void
  selectAll: () => void
  clearSelection: () => void
  setSelection: (ids: number[]) => void
  selectedIds: () => number[]

  openLightbox: (index: number | null) => void
  toast: (t: Omit<Toast, 'id'>) => void
  dismissToast: (id: number) => void
  runOp: (p: Promise<OpResult>, fallbackLabel?: string) => Promise<OpResult>
  undo: (operationId?: number) => Promise<void>
  openDialog: (d: DialogState | null) => void
  setPalette: (open: boolean) => void
}

let toastSeq = 0
let queryToken = 0

export function queryFor(s: Pick<State, 'view' | 'search' | 'sort' | 'order' | 'kindFilter'>): MediaQuery | null {
  let base: MediaQuery
  switch (s.view.kind) {
    case 'library': base = { ...LIBRARY_VIEWS[s.view.id].query }; break
    case 'album': base = { albumId: s.view.id }; break
    case 'tag': base = { tagId: s.view.id }; break
    case 'folder': base = { folder: s.view.path, recursive: true }; break
    case 'review': base = {}; break
    default: return null
  }
  if (base.archived === undefined && !(s.view.kind === 'library' && s.view.id === 'missing')) base.archived = false
  if (s.kindFilter.length) base.kinds = base.kinds ? base.kinds.filter((k) => s.kindFilter.includes(k)) : s.kindFilter
  if (base.kinds && base.kinds.length === 0) base.kinds = ['unsupported']
  if (s.search.trim()) base.search = s.search.trim()
  const defaultSort = base.sort
  base.sort = s.sort !== 'date' ? s.sort : defaultSort ?? 'date'
  base.order = s.order
  if (s.view.kind === 'album' && s.sort === 'date' && s.order === 'desc') delete base.sort
  return base
}

export const useApp = create<State>((set, get) => ({
  view: { kind: 'library', id: 'all' },
  search: '',
  sort: 'date',
  order: 'desc',
  kindFilter: [],
  items: [],
  loading: true,
  selection: new Set(),
  anchorId: null,
  lightboxIndex: null,
  settings: DEFAULT_SETTINGS,
  vault: null,
  albums: [],
  tags: [],
  folders: [],
  scan: null,
  thumbs: null,
  trashCount: 0,
  toasts: [],
  dialog: null,
  paletteOpen: false,
  detailsVersion: 0,

  setView: (v) => {
    set({ view: v, selection: new Set(), anchorId: null, lightboxIndex: null, kindFilter: v.kind === 'review' ? get().kindFilter : [] })
    void get().reload()
  },
  setSearch: (s) => { set({ search: s }); void get().reload() },
  setSort: (sort, order) => { set({ sort, order: order ?? get().order }); void get().reload() },
  toggleKindFilter: (k) => {
    if (k === null) set({ kindFilter: [] })
    else {
      const cur = get().kindFilter
      set({ kindFilter: cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k] })
    }
    void get().reload()
  },

  reload: async () => {
    const q = queryFor(get())
    if (!q) { set({ loading: false }); return }
    const token = ++queryToken
    set({ loading: true })
    try {
      const items = await api('library.query', q)
      if (token !== queryToken) return
      const ids = new Set(items.map((i) => i.id))
      const sel = new Set([...get().selection].filter((id) => ids.has(id)))
      let lb = get().lightboxIndex
      if (lb !== null && lb >= items.length) lb = items.length ? items.length - 1 : null
      set({ items, loading: false, selection: sel, lightboxIndex: lb, detailsVersion: get().detailsVersion + 1 })
    } catch (e) {
      if (token === queryToken) set({ loading: false })
      get().toast({ text: `Errore caricamento: ${(e as Error).message}`, tone: 'error' })
    }
  },

  refreshMeta: async () => {
    const [albums, tags, folders, trash] = await Promise.all([api('albums.list'), api('tags.list'), api('library.folders'), api('trash.list')])
    set({ albums, tags, folders, trashCount: trash.length })
  },

  updateSettings: async (p) => {
    const settings = await api('settings.set', p)
    set({ settings })
  },

  select: (id, mode) => {
    const { selection, anchorId, items } = get()
    if (mode === 'single') { set({ selection: new Set([id]), anchorId: id }); return }
    if (mode === 'toggle') {
      const next = new Set(selection)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      set({ selection: next, anchorId: id })
      return
    }
    const a = items.findIndex((i) => i.id === (anchorId ?? id))
    const b = items.findIndex((i) => i.id === id)
    if (a < 0 || b < 0) { set({ selection: new Set([id]), anchorId: id }); return }
    const [from, to] = a < b ? [a, b] : [b, a]
    const next = new Set(selection)
    for (let i = from; i <= to; i++) next.add(items[i].id)
    set({ selection: next })
  },
  selectAll: () => set({ selection: new Set(get().items.map((i) => i.id)) }),
  clearSelection: () => set({ selection: new Set(), anchorId: null }),
  setSelection: (ids) => set({ selection: new Set(ids), anchorId: ids[ids.length - 1] ?? null }),
  selectedIds: () => {
    const sel = get().selection
    return get().items.filter((i) => sel.has(i.id)).map((i) => i.id)
  },

  openLightbox: (index) => set({ lightboxIndex: index }),

  toast: (t) => {
    const id = ++toastSeq
    set({ toasts: [...get().toasts.slice(-2), { ...t, id }] })
    setTimeout(() => get().dismissToast(id), t.operationId ? 7000 : t.tone === 'error' ? 8000 : 3500)
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),

  runOp: async (p, fallbackLabel) => {
    try {
      const r = await p
      const errors = r.errors.map((e) => `${e.path ?? ''} ${e.message}`.trim())
      if (r.affected > 0 || r.ok) {
        const ops = await api('operations.list', 1)
        const label = r.message ?? (r.operationId && ops[0]?.id === r.operationId ? ops[0].label : fallbackLabel ?? 'Fatto')
        get().toast({ text: errors.length ? `${label} · ${errors.length} errori` : label, tone: errors.length ? 'error' : 'ok', operationId: r.operationId, details: errors.slice(0, 5) })
      } else {
        get().toast({ text: errors[0] ?? 'Operazione non riuscita', tone: 'error', details: errors.slice(1, 5) })
      }
      await Promise.all([get().reload(), get().refreshMeta()])
      return r
    } catch (e) {
      get().toast({ text: (e as Error).message, tone: 'error' })
      return { ok: false, affected: 0, errors: [{ message: (e as Error).message }] }
    }
  },

  undo: async (operationId) => {
    const r = await api('operations.undo', operationId)
    if (r.ok || r.affected) get().toast({ text: r.message ?? 'Annullato', tone: 'info' })
    else get().toast({ text: r.errors[0]?.message ?? 'Niente da annullare', tone: 'error' })
    await Promise.all([get().reload(), get().refreshMeta()])
  },

  openDialog: (d) => set({ dialog: d }),
  setPalette: (open) => set({ paletteOpen: open })
}))
