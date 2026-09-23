import { Album as AlbumIcon, Archive, Check, Copy, FolderInput, Heart, HelpCircle, PenLine, Tag, Trash2, X } from 'lucide-react'
import { useApp } from '@/store/app'
import { api } from '@/lib/api'
import { formatCount } from '@/lib/format'
import { IconButton } from './ui'

/** Barra azioni per la selezione multipla (appare in basso, stile "floating"). */
export function BatchBar() {
  const selection = useApp((s) => s.selection)
  const clear = useApp((s) => s.clearSelection)
  const runOp = useApp((s) => s.runOp)
  const openDialog = useApp((s) => s.openDialog)
  const view = useApp((s) => s.view)
  if (selection.size === 0) return null
  const ids = () => useApp.getState().selectedIds()
  const inArchive = view.kind === 'library' && view.id === 'archive'

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-5 z-20 flex justify-center">
      <div className="pointer-events-auto flex items-center gap-1 rounded-2xl border border-line-strong bg-elev/95 p-1.5 shadow-pop backdrop-blur-xl anim-pop">
        <button onClick={clear} className="flex h-9 items-center gap-2 rounded-xl pl-2.5 pr-3 text-[13px] font-medium hover:bg-hover" title="Deseleziona (Esc)">
          <X size={16} className="text-dim" />
          <span className="tabular-nums">{formatCount(selection.size)} selezionati</span>
        </button>
        <span className="mx-1 h-5 w-px bg-line-strong" />
        <IconButton label="Preferiti (F)" onClick={() => void runOp(api('media.favorite', ids(), true))}><Heart size={17} /></IconButton>
        <IconButton label="Tieni (K)" onClick={() => void runOp(api('media.flag', ids(), 'keep'))}><Check size={17} className="text-ok" /></IconButton>
        <IconButton label="Forse (M)" onClick={() => void runOp(api('media.flag', ids(), 'maybe'))}><HelpCircle size={17} className="text-warn" /></IconButton>
        <IconButton label="Scarta (X)" onClick={() => void runOp(api('media.flag', ids(), 'trash'))}><X size={17} className="text-danger" /></IconButton>
        <span className="mx-1 h-5 w-px bg-line-strong" />
        <IconButton label="Aggiungi tag (T)" onClick={() => openDialog({ type: 'tags', ids: ids() })}><Tag size={17} /></IconButton>
        <IconButton label="Aggiungi ad album (A)" onClick={() => openDialog({ type: 'album', ids: ids() })}><AlbumIcon size={17} /></IconButton>
        <IconButton label="Sposta in cartella" onClick={() => openDialog({ type: 'move', ids: ids(), mode: 'move' })}><FolderInput size={17} /></IconButton>
        <IconButton label="Copia in cartella" onClick={() => openDialog({ type: 'move', ids: ids(), mode: 'copy' })}><Copy size={17} /></IconButton>
        <IconButton label="Rinomina (F2)" onClick={() => openDialog({ type: 'rename', ids: ids() })}><PenLine size={17} /></IconButton>
        <IconButton label={inArchive ? 'Togli dall\'archivio' : 'Archivia'} onClick={() => void runOp(api('media.archive', ids(), !inArchive))}><Archive size={17} /></IconButton>
        {view.kind === 'album' && (
          <IconButton label="Rimuovi dall'album" onClick={() => void runOp(api('albums.removeItems', view.id, ids()))}><AlbumIcon size={17} className="text-danger" /></IconButton>
        )}
        <span className="mx-1 h-5 w-px bg-line-strong" />
        <IconButton label="Sposta nel cestino (Canc)" onClick={() => void runOp(api('files.trash', ids()))}><Trash2 size={17} className="text-danger" /></IconButton>
      </div>
    </div>
  )
}
