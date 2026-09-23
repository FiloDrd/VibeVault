import { memo, useState } from 'react'
import { Check, Film, Heart, ImageOff, Play, HelpCircle, X, Camera, AlertTriangle } from 'lucide-react'
import type { GridItem } from '@shared/types'
import { thumbUrl } from '@/lib/api'
import { formatDuration } from '@/lib/format'
import { cx } from './ui'

interface Props {
  item: GridItem
  width: number
  height: number
  selected: boolean
  selectionMode: boolean
  blur: boolean
  onClick: (e: React.MouseEvent, item: GridItem) => void
  onOpen: (item: GridItem) => void
  onToggle: (item: GridItem) => void
  onDragStart: (e: React.DragEvent, item: GridItem) => void
}

function MediaCardImpl({ item, width, height, selected, selectionMode, blur, onClick, onOpen, onToggle, onDragStart }: Props) {
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading')
  const broken = item.st !== 'ok'

  return (
    <div
      role="gridcell"
      aria-selected={selected}
      tabIndex={-1}
      draggable
      onDragStart={(e) => onDragStart(e, item)}
      onClick={(e) => onClick(e, item)}
      onDoubleClick={() => onOpen(item)}
      className={cx('group relative cursor-pointer overflow-hidden', selected ? 'bg-accent-soft' : '')}
      style={{ width, height }}
    >
      <div
        className={cx(
          'absolute inset-0 overflow-hidden transition-all duration-150 ease-out',
          selected ? 'inset-[10px] rounded-lg' : 'rounded-[3px]',
          blur && 'sensitive-blur'
        )}
      >
        {state !== 'ok' && !broken && <div className={cx('absolute inset-0', state === 'loading' ? 'skeleton' : 'bg-elev-2')} />}
        {!broken && state !== 'error' && (
          <img
            src={thumbUrl(item.id)}
            alt={item.n}
            loading="lazy"
            decoding="async"
            draggable={false}
            onLoad={() => setState('ok')}
            onError={() => setState('error')}
            className={cx('h-full w-full object-cover transition-opacity duration-300', state === 'ok' ? 'opacity-100' : 'opacity-0')}
          />
        )}
        {(state === 'error' || broken) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-elev-2 p-2 text-faint">
            {item.st === 'corrupt' ? <AlertTriangle size={22} /> : item.k === 'video' ? <Film size={22} /> : item.k === 'raw' ? <Camera size={22} /> : <ImageOff size={22} />}
            <span className="line-clamp-2 break-all text-center text-[10.5px] leading-tight">{item.n}</span>
            {item.st === 'corrupt' && <span className="text-[10px] text-warn">corrotto</span>}
            {item.st === 'missing' && <span className="text-[10px] text-warn">mancante</span>}
          </div>
        )}

        {/* gradient per leggibilità dei badge */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-black/45 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
        {(item.k === 'video' || item.k === 'gif' || item.k === 'raw') && (
          <div className="pointer-events-none absolute bottom-0 inset-x-0 h-9 bg-gradient-to-t from-black/50 to-transparent" />
        )}

        {/* badge tipo */}
        {item.k === 'video' && (
          <span className="absolute bottom-1.5 right-1.5 flex items-center gap-1 rounded-md bg-black/55 px-1.5 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
            <Play size={10} className="fill-white" />
            {formatDuration(item.d)}
          </span>
        )}
        {item.k === 'gif' && <span className="absolute bottom-1.5 right-1.5 rounded-md bg-black/55 px-1.5 py-0.5 text-[10.5px] font-bold tracking-wide text-white">GIF</span>}
        {item.k === 'raw' && <span className="absolute bottom-1.5 right-1.5 rounded-md bg-black/55 px-1.5 py-0.5 text-[10.5px] font-bold tracking-wide text-white">RAW</span>}

        {/* stato review */}
        <div className="pointer-events-none absolute bottom-1.5 left-1.5 flex items-center gap-1">
          {item.fav === 1 && <Heart size={15} className="fill-white text-white drop-shadow" />}
          {item.fl === 'keep' && <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-ok text-black"><Check size={12} strokeWidth={3} /></span>}
          {item.fl === 'maybe' && <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-warn text-black"><HelpCircle size={12} strokeWidth={2.6} /></span>}
          {item.fl === 'trash' && <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-danger text-white"><X size={12} strokeWidth={3} /></span>}
          {item.r > 0 && <span className="rounded bg-black/55 px-1 text-[10.5px] font-semibold text-warn">{'★'.repeat(item.r)}</span>}
        </div>
      </div>

      {/* check di selezione stile Google Foto */}
      <button
        aria-label={selected ? 'Deseleziona' : 'Seleziona'}
        onClick={(e) => { e.stopPropagation(); onToggle(item) }}
        className={cx(
          'absolute left-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full border-2 transition-all duration-150',
          selected
            ? 'border-accent bg-accent text-accent-fg opacity-100 scale-100'
            : cx('border-white/85 bg-black/15 text-transparent hover:bg-white/25', selectionMode ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')
        )}
      >
        <Check size={14} strokeWidth={3} />
      </button>
    </div>
  )
}

export const MediaCard = memo(MediaCardImpl)
