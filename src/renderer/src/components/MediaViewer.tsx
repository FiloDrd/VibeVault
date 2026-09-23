import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, ExternalLink } from 'lucide-react'
import type { GridItem } from '@shared/types'
import { fullImageUrl, mediaUrl, thumbUrl, api } from '@/lib/api'
import { Button, Spinner } from './ui'

/**
 * Viewer singolo media: immagine con zoom (rotella / doppio clic) e pan (trascina),
 * video in streaming locale (Range), GIF in loop. Gestisce file mancanti/non supportati.
 */
export function MediaViewer({ item, autoPlay = true }: { item: GridItem; autoPlay?: boolean }) {
  if (item.st === 'missing' || item.st === 'corrupt') return <Unavailable item={item} reason={item.st === 'missing' ? 'Il file non si trova più su disco.' : 'Il file sembra corrotto o illeggibile.'} />
  if (item.k === 'video' || item.k === 'audio') return <VideoView key={item.id} item={item} autoPlay={autoPlay} />
  return <ImageView key={item.id} item={item} />
}

function Unavailable({ item, reason }: { item: GridItem; reason: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-center">
      <AlertTriangle size={28} className="text-warn" />
      <p className="text-[14px] text-white/90">{item.n}</p>
      <p className="max-w-sm text-[13px] text-white/60">{reason}</p>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" className="border-white/20 text-white" onClick={() => void api('media.showInFolder', item.id)}>Mostra nella cartella</Button>
      </div>
    </div>
  )
}

function ImageView({ item }: { item: GridItem }) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [z, setZ] = useState({ scale: 1, x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const src = item.k === 'gif' ? mediaUrl(item.id) : fullImageUrl(item.id, item.n)

  useEffect(() => {
    const onReset = () => setZ({ scale: 1, x: 0, y: 0 })
    window.addEventListener('vv:zoom-reset', onReset)
    return () => window.removeEventListener('vv:zoom-reset', onReset)
  }, [])

  const onWheel = (e: React.WheelEvent) => {
    const rect = boxRef.current!.getBoundingClientRect()
    const cx = e.clientX - rect.left - rect.width / 2
    const cy = e.clientY - rect.top - rect.height / 2
    setZ((p) => {
      const scale = Math.min(12, Math.max(1, p.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15)))
      if (scale === 1) return { scale: 1, x: 0, y: 0 }
      const k = scale / p.scale
      return { scale, x: cx - (cx - p.x) * k, y: cy - (cy - p.y) * k }
    })
  }

  return (
    <div
      ref={boxRef}
      className="relative flex h-full w-full items-center justify-center overflow-hidden"
      onWheel={onWheel}
      onDoubleClick={(e) => {
        const rect = boxRef.current!.getBoundingClientRect()
        const cx = e.clientX - rect.left - rect.width / 2
        const cy = e.clientY - rect.top - rect.height / 2
        setZ((p) => (p.scale > 1 ? { scale: 1, x: 0, y: 0 } : { scale: 2.5, x: -cx * 1.5, y: -cy * 1.5 }))
      }}
      onMouseDown={(e) => { if (z.scale > 1) drag.current = { x: e.clientX, y: e.clientY, ox: z.x, oy: z.y } }}
      onMouseMove={(e) => { if (drag.current) setZ((p) => ({ ...p, x: drag.current!.ox + e.clientX - drag.current!.x, y: drag.current!.oy + e.clientY - drag.current!.y })) }}
      onMouseUp={() => { drag.current = null }}
      onMouseLeave={() => { drag.current = null }}
      style={{ cursor: z.scale > 1 ? (drag.current ? 'grabbing' : 'grab') : 'zoom-in' }}
    >
      {/* miniatura sfocata come placeholder immediato */}
      {!loaded && !failed && (
        <>
          <img src={thumbUrl(item.id)} className="absolute max-h-full max-w-full scale-[1.001] object-contain opacity-70 blur-sm" alt="" draggable={false} />
          <span className="absolute text-white/70"><Spinner size={22} /></span>
        </>
      )}
      {failed ? (
        <Unavailable item={item} reason="Formato non visualizzabile qui. Puoi aprirlo con l'app predefinita del sistema." />
      ) : (
        <img
          src={src}
          alt={item.n}
          draggable={false}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className="max-h-full max-w-full object-contain transition-opacity duration-200 will-change-transform"
          style={{ opacity: loaded ? 1 : 0, transform: `translate(${z.x}px, ${z.y}px) scale(${z.scale})`, transition: drag.current ? 'none' : 'transform 120ms ease-out, opacity 200ms' }}
        />
      )}
      {z.scale > 1 && <span className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-2.5 py-1 text-[11.5px] tabular-nums text-white/80">{Math.round(z.scale * 100)}%</span>}
    </div>
  )
}

function VideoView({ item, autoPlay }: { item: GridItem; autoPlay: boolean }) {
  const ref = useRef<HTMLVideoElement>(null)
  const [err, setErr] = useState(false)

  useEffect(() => {
    const onToggle = () => {
      const v = ref.current
      if (!v) return
      if (v.paused) void v.play()
      else v.pause()
    }
    window.addEventListener('vv:toggle-play', onToggle)
    return () => window.removeEventListener('vv:toggle-play', onToggle)
  }, [])

  if (err) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-center">
        <AlertTriangle size={28} className="text-warn" />
        <p className="max-w-sm text-[13px] text-white/70">Il codec di questo video non è supportato dal player interno.</p>
        <Button size="sm" variant="outline" className="border-white/20 text-white" icon={<ExternalLink size={14} />} onClick={() => void api('media.openExternal', item.id)}>Apri nel player di sistema</Button>
      </div>
    )
  }
  return (
    <video
      ref={ref}
      src={mediaUrl(item.id)}
      poster={thumbUrl(item.id)}
      controls
      autoPlay={autoPlay}
      playsInline
      onError={() => setErr(true)}
      className="max-h-full max-w-full rounded-sm bg-black outline-none"
    />
  )
}
