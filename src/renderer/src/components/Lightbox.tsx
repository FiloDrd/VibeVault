import { useEffect, useState } from 'react'
import { ArrowLeft, ChevronLeft, ChevronRight, ExternalLink, FolderOpen, Heart, Info, Trash2 } from 'lucide-react'
import { useApp } from '@/store/app'
import { api, thumbUrl } from '@/lib/api'
import { formatDate, formatCount } from '@/lib/format'
import { MediaViewer } from './MediaViewer'
import { FlagButtons, Inspector } from './Inspector'
import { cx, IconButton, RatingStars } from './ui'

export function Lightbox() {
  const index = useApp((s) => s.lightboxIndex)
  const items = useApp((s) => s.items)
  const open = useApp((s) => s.openLightbox)
  const runOp = useApp((s) => s.runOp)
  const setSelection = useApp((s) => s.setSelection)
  const [info, setInfo] = useState(false)
  const [chrome, setChrome] = useState(true)

  const item = index !== null ? items[index] : null

  useEffect(() => { if (item) setSelection([item.id]) }, [item, setSelection])

  // pre-carica le miniature vicine
  useEffect(() => {
    if (index === null) return
    for (const d of [1, -1, 2]) {
      const n = items[index + d]
      if (n) { const img = new Image(); img.src = thumbUrl(n.id) }
    }
  }, [index, items])

  useEffect(() => {
    let t: ReturnType<typeof setTimeout>
    const onMove = () => { setChrome(true); clearTimeout(t); t = setTimeout(() => setChrome(false), 2500) }
    window.addEventListener('mousemove', onMove)
    onMove()
    return () => { window.removeEventListener('mousemove', onMove); clearTimeout(t) }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) return
      if (e.key === 'i' || e.key === 'I') { setInfo((v) => !v); e.stopPropagation() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  if (index === null || !item) return null
  const go = (d: number) => { const n = index + d; if (n >= 0 && n < items.length) open(n) }

  return (
    <div className="fixed inset-0 z-40 flex bg-scrim anim-fade" role="dialog" aria-label="Visualizzatore">
      <div className="relative min-w-0 flex-1">
        <div className="absolute inset-0 px-16 pb-20 pt-14">
          <MediaViewer item={item} />
        </div>

        {/* barra superiore */}
        <div className={cx('drag-region absolute inset-x-0 top-0 flex h-12 items-center gap-2 bg-gradient-to-b from-black/70 to-transparent pl-3 text-white transition-opacity duration-300', window.vv.platform === 'win32' ? 'pr-[150px]' : 'pr-3', chrome ? 'opacity-100' : 'opacity-0')}>
          <IconButton label="Chiudi (Esc)" className="text-white/80 hover:bg-white/10 hover:text-white" onClick={() => open(null)}><ArrowLeft size={18} /></IconButton>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium">{item.n}</p>
            <p className="text-[11.5px] text-white/55">{formatDate(item.t)} · {formatCount(index + 1)} di {formatCount(items.length)}</p>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <IconButton label="Preferito (F)" className="text-white/80 hover:bg-white/10 hover:text-white" onClick={() => void runOp(api('media.favorite', [item.id], !item.fav))}>
              <Heart size={18} className={item.fav ? 'fill-white' : ''} />
            </IconButton>
            <IconButton label="Mostra nella cartella" className="text-white/80 hover:bg-white/10 hover:text-white" onClick={() => void api('media.showInFolder', item.id)}><FolderOpen size={18} /></IconButton>
            <IconButton label="Apri con app predefinita" className="text-white/80 hover:bg-white/10 hover:text-white" onClick={() => void api('media.openExternal', item.id)}><ExternalLink size={18} /></IconButton>
            <IconButton label="Info (I)" className={cx('text-white/80 hover:bg-white/10 hover:text-white', info && 'bg-white/15')} onClick={() => setInfo(!info)}><Info size={18} /></IconButton>
            <IconButton label="Cestino (Canc)" className="text-white/80 hover:bg-white/10 hover:text-danger" onClick={() => void runOp(api('files.trash', [item.id]))}><Trash2 size={18} /></IconButton>
          </div>
        </div>

        {/* frecce */}
        {index > 0 && (
          <button onClick={() => go(-1)} aria-label="Precedente" className={cx('absolute left-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white/80 backdrop-blur transition-opacity hover:bg-black/60 hover:text-white', chrome ? 'opacity-100' : 'opacity-0')}>
            <ChevronLeft size={22} />
          </button>
        )}
        {index < items.length - 1 && (
          <button onClick={() => go(1)} aria-label="Successivo" className={cx('absolute right-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white/80 backdrop-blur transition-opacity hover:bg-black/60 hover:text-white', chrome ? 'opacity-100' : 'opacity-0')}>
            <ChevronRight size={22} />
          </button>
        )}

        {/* barra inferiore: review rapida */}
        <div className={cx('absolute inset-x-0 bottom-0 flex items-center justify-center gap-4 bg-gradient-to-t from-black/70 to-transparent pb-4 pt-8 transition-opacity duration-300', chrome ? 'opacity-100' : 'opacity-0')}>
          <div className="w-[320px]"><FlagButtons value={item.fl} onChange={(f) => void runOp(api('media.flag', [item.id], f))} /></div>
          <RatingStars value={item.r} onChange={(r) => void runOp(api('media.rate', [item.id], r))} size={20} />
        </div>
      </div>
      {info && <div className="dark-panel"><Inspector /></div>}
    </div>
  )
}
