import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Folder, FolderPlus, Plus, Album as AlbumIcon, AlertTriangle } from 'lucide-react'
import { useApp, type DialogState } from '@/store/app'
import { api } from '@/lib/api'
import { formatCount } from '@/lib/format'
import { Button, cx } from './ui'

function Modal({ title, children, footer, onClose, width = 440 }: { title: ReactNode; children: ReactNode; footer?: ReactNode; onClose: () => void; width?: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-6 backdrop-blur-[2px] anim-fade" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="flex max-h-[80vh] w-full flex-col overflow-hidden rounded-2xl border border-line-strong bg-elev shadow-pop anim-pop" style={{ maxWidth: width }} role="dialog" aria-modal="true" onKeyDown={(e) => e.stopPropagation()}>
        <div className="px-5 pb-2 pt-4 font-display text-[15.5px] font-semibold">{title}</div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4 text-[13px] text-dim">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line bg-panel/60 px-5 py-3">{footer}</div>}
      </div>
    </div>
  )
}

const inputCls = 'h-9 w-full rounded-lg border border-line-strong bg-elev-2 px-3 text-[13px] text-fg outline-none placeholder:text-faint focus:border-accent'

function PromptDialog({ d, close }: { d: Extract<DialogState, { type: 'prompt' }>; close: () => void }) {
  const [v, setV] = useState(d.initial ?? '')
  const [busy, setBusy] = useState(false)
  const submit = async () => { if (!v.trim()) return; setBusy(true); try { await d.onSubmit(v.trim()); close() } finally { setBusy(false) } }
  return (
    <Modal title={d.title} onClose={close} footer={<><Button variant="ghost" onClick={close}>Annulla</Button><Button variant="primary" disabled={!v.trim() || busy} onClick={() => void submit()}>{d.confirmText ?? 'OK'}</Button></>}>
      {d.label && <label className="mb-1.5 block text-[12px]">{d.label}</label>}
      <input autoFocus className={inputCls} value={v} placeholder={d.placeholder} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void submit() }} />
    </Modal>
  )
}

function ConfirmDialog({ d, close }: { d: Extract<DialogState, { type: 'confirm' }>; close: () => void }) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const ok = !d.typeToConfirm || typed.trim().toUpperCase() === d.typeToConfirm
  const run = async () => {
    if (!ok) return
    setBusy(true)
    // chiude prima: onConfirm può aprire un secondo dialog (doppia conferma)
    close()
    try { await d.onConfirm() } finally { setBusy(false) }
  }
  return (
    <Modal
      title={<span className="flex items-center gap-2">{d.danger && <AlertTriangle size={17} className="text-danger" />}{d.title}</span>}
      onClose={close}
      footer={<><Button variant="ghost" onClick={close}>Annulla</Button><Button variant={d.danger ? 'danger' : 'primary'} disabled={!ok || busy} onClick={() => void run()} autoFocus={!d.typeToConfirm}>{d.confirmText ?? 'Conferma'}</Button></>}
    >
      <p className="leading-relaxed">{d.message}</p>
      {d.typeToConfirm && <input autoFocus className={cx(inputCls, 'mt-3 font-mono')} placeholder={d.typeToConfirm} value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void run() }} />}
    </Modal>
  )
}

function MoveDialog({ d, close }: { d: Extract<DialogState, { type: 'move' }>; close: () => void }) {
  const folders = useApp((s) => s.folders)
  const vault = useApp((s) => s.vault)
  const runOp = useApp((s) => s.runOp)
  const refreshMeta = useApp((s) => s.refreshMeta)
  // cartella radice: Library/ nei vault v0.1, altrimenti la cartella aperta
  const rootPath = vault?.layout === 'legacy' ? 'Library' : ''
  const rootName = vault?.layout === 'legacy' ? 'Library' : vault?.name ?? 'Cartella'
  const [dest, setDest] = useState<string>(rootPath)
  const [filter, setFilter] = useState('')
  const [newName, setNewName] = useState('')
  const destLabel = dest === rootPath ? rootName : dest
  const list = useMemo(() => {
    const all = [{ pathRelative: rootPath, name: rootName, fileCount: 0 }, ...folders.filter((f) => f.pathRelative !== rootPath)]
    const q = filter.toLowerCase()
    return all.filter((f) => !q || f.pathRelative.toLowerCase().includes(q))
  }, [folders, filter, rootPath, rootName])

  const createAndSelect = async () => {
    if (!newName.trim()) return
    const r = await api('files.createFolder', dest, newName.trim())
    if (r.ok && r.path) { await refreshMeta(); setDest(r.path); setNewName('') }
    else useApp.getState().toast({ text: r.message ?? 'Errore', tone: 'error' })
  }
  const go = async () => {
    close()
    await runOp(api(d.mode === 'move' ? 'files.move' : 'files.copy', d.ids, dest))
  }
  return (
    <Modal
      width={520}
      title={`${d.mode === 'move' ? 'Sposta' : 'Copia'} ${formatCount(d.ids.length)} ${d.ids.length === 1 ? 'file' : 'file'}`}
      onClose={close}
      footer={<><span className="mr-auto self-center font-mono text-[11.5px] text-faint">→ {destLabel}</span><Button variant="ghost" onClick={close}>Annulla</Button><Button variant="primary" onClick={() => void go()}>{d.mode === 'move' ? 'Sposta qui' : 'Copia qui'}</Button></>}
    >
      <input autoFocus className={inputCls} placeholder="Filtra cartelle…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <div className="mt-2 max-h-[300px] overflow-y-auto rounded-lg border border-line">
        {list.map((f) => {
          const depth = f.pathRelative === '' ? 0 : f.pathRelative.split('/').length - (rootPath === '' ? 0 : 1)
          return (
            <button key={f.pathRelative} onClick={() => setDest(f.pathRelative)} onDoubleClick={() => { setDest(f.pathRelative); void go() }} className={cx('flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px]', dest === f.pathRelative ? 'bg-accent-soft text-fg' : 'hover:bg-hover')} style={{ paddingLeft: 12 + (filter ? 0 : depth * 14) }}>
              <Folder size={14} className={dest === f.pathRelative ? 'text-accent' : 'text-faint'} />
              <span className="truncate">{filter && f.pathRelative ? f.pathRelative : f.name}</span>
            </button>
          )
        })}
      </div>
      <div className="mt-3 flex gap-2">
        <input className={inputCls} placeholder={`Nuova cartella in ${destLabel}`} value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void createAndSelect() }} />
        <Button icon={<FolderPlus size={14} />} onClick={() => void createAndSelect()} disabled={!newName.trim()}>Crea</Button>
      </div>
      <p className="mt-3 text-[12px] text-faint">I file con lo stesso nome non vengono mai sovrascritti: si aggiunge un suffisso "(1)". Puoi annullare con Ctrl+Z.</p>
    </Modal>
  )
}

function AlbumDialog({ d, close }: { d: Extract<DialogState, { type: 'album' }>; close: () => void }) {
  const albums = useApp((s) => s.albums)
  const runOp = useApp((s) => s.runOp)
  const refreshMeta = useApp((s) => s.refreshMeta)
  const [name, setName] = useState('')
  const add = async (id: number) => { close(); await runOp(api('albums.addItems', id, d.ids)) }
  const create = async () => {
    if (!name.trim()) return
    close()
    await api('albums.create', name.trim(), d.ids)
    await refreshMeta()
    useApp.getState().toast({ text: `Album "${name.trim()}" creato con ${d.ids.length} elementi`, tone: 'ok' })
  }
  return (
    <Modal title={`Aggiungi ${formatCount(d.ids.length)} ad album`} onClose={close}>
      <div className="flex gap-2">
        <input autoFocus className={inputCls} placeholder="Nuovo album…" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void create() }} />
        <Button variant="primary" icon={<Plus size={14} />} disabled={!name.trim()} onClick={() => void create()}>Crea</Button>
      </div>
      <div className="mt-3 max-h-[300px] space-y-px overflow-y-auto">
        {albums.map((a) => (
          <button key={a.id} onClick={() => void add(a.id)} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-fg hover:bg-hover">
            <AlbumIcon size={15} className="text-faint" />
            <span className="flex-1 truncate">{a.name}</span>
            <span className="text-[11px] text-faint">{a.count}</span>
          </button>
        ))}
        {!albums.length && <p className="py-2 text-[12px] text-faint">Nessun album ancora: creane uno qui sopra.</p>}
      </div>
      <p className="mt-2 text-[12px] text-faint">Gli album sono virtuali: i file non vengono spostati.</p>
    </Modal>
  )
}

function TagsDialog({ d, close }: { d: Extract<DialogState, { type: 'tags' }>; close: () => void }) {
  const tags = useApp((s) => s.tags)
  const runOp = useApp((s) => s.runOp)
  const [v, setV] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const toggle = (n: string) => setPicked(picked.includes(n) ? picked.filter((x) => x !== n) : [...picked, n])
  const names = [...new Set([...picked, ...v.split(',').map((x) => x.trim()).filter(Boolean)])]
  const go = async () => { if (!names.length) return; close(); await runOp(api('tags.add', d.ids, names)) }
  return (
    <Modal title={`Tag per ${formatCount(d.ids.length)} elementi`} onClose={close} footer={<><Button variant="ghost" onClick={close}>Annulla</Button><Button variant="primary" disabled={!names.length} onClick={() => void go()}>Aggiungi {names.length > 0 && names.length}</Button></>}>
      <input autoFocus className={inputCls} placeholder="Nuovi tag separati da virgola…" value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void go() }} />
      {tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <button key={t.id} onClick={() => toggle(t.name)} className={cx('h-7 rounded-full px-3 text-[12px] transition-colors', picked.includes(t.name) ? 'bg-accent text-accent-fg' : 'bg-elev-2 text-dim hover:text-fg')}>{t.name}</button>
          ))}
        </div>
      )}
    </Modal>
  )
}

function RenameDialog({ d, close }: { d: Extract<DialogState, { type: 'rename' }>; close: () => void }) {
  const items = useApp((s) => s.items)
  const runOp = useApp((s) => s.runOp)
  const single = d.ids.length === 1
  const current = items.find((i) => i.id === d.ids[0])
  const base = current ? current.n.replace(/\.[^.]+$/, '') : ''
  const [v, setV] = useState(single ? base : '{YYYY}-{MM}-{DD}_{nnn}')
  const [preview, setPreview] = useState<{ id: number; from: string; to: string }[]>([])
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (single) ref.current?.select() }, [single])
  useEffect(() => {
    if (single) return
    const t = setTimeout(() => void api('files.renameTemplate', d.ids, v).then((r) => setPreview(r.preview)), 150)
    return () => clearTimeout(t)
  }, [v, d.ids, single])
  const go = async () => {
    close()
    if (single) await runOp(api('files.rename', [{ id: d.ids[0], newName: v }]))
    else await runOp(api('files.rename', preview.map((p) => ({ id: p.id, newName: p.to }))))
  }
  return (
    <Modal width={single ? 440 : 560} title={single ? 'Rinomina' : `Rinomina ${formatCount(d.ids.length)} file`} onClose={close} footer={<><Button variant="ghost" onClick={close}>Annulla</Button><Button variant="primary" disabled={!v.trim()} onClick={() => void go()}>Rinomina</Button></>}>
      <input ref={ref} autoFocus className={cx(inputCls, 'font-mono')} value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void go() }} />
      {single ? (
        <p className="mt-2 text-[12px] text-faint">L'estensione resta invariata. Se il nome esiste già nella cartella, la rinomina viene rifiutata.</p>
      ) : (
        <>
          <p className="mt-2 text-[12px] text-faint">Segnaposto: <code>{'{name}'}</code> <code>{'{n}'}</code> <code>{'{nnn}'}</code> <code>{'{YYYY}'}</code> <code>{'{MM}'}</code> <code>{'{DD}'}</code> <code>{'{hh}'}</code> <code>{'{mm}'}</code> <code>{'{ss}'}</code></p>
          <div className="mt-3 max-h-[240px] overflow-y-auto rounded-lg border border-line font-mono text-[11.5px]">
            {preview.slice(0, 200).map((p) => (
              <div key={p.id} className="flex gap-2 border-b border-line px-3 py-1 last:border-0">
                <span className="w-1/2 truncate text-faint">{p.from}</span>
                <span className="w-1/2 truncate text-fg">→ {p.to}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  )
}

export function Dialogs() {
  const d = useApp((s) => s.dialog)
  const open = useApp((s) => s.openDialog)
  if (!d) return null
  const close = () => { if (useApp.getState().dialog === d) open(null) }
  switch (d.type) {
    case 'prompt': return <PromptDialog key={d.title} d={d} close={close} />
    case 'confirm': return <ConfirmDialog key={d.title} d={d} close={close} />
    case 'move': return <MoveDialog d={d} close={close} />
    case 'album': return <AlbumDialog d={d} close={close} />
    case 'tags': return <TagsDialog d={d} close={close} />
    case 'rename': return <RenameDialog d={d} close={close} />
  }
}
