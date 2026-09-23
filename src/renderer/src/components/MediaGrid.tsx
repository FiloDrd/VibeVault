import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { CheckCircle2, Circle } from 'lucide-react'
import type { GridItem } from '@shared/types'
import { useApp } from '@/store/app'
import { api } from '@/lib/api'
import { buildRows, GAP, TARGET_H } from '@/lib/layout'
import { plural } from '@/lib/format'
import { MediaCard } from './MediaCard'
import { cx } from './ui'

export const DRAG_MIME = 'application/x-vibevault-ids'

export function MediaGrid() {
  const items = useApp((s) => s.items)
  const selection = useApp((s) => s.selection)
  const settings = useApp((s) => s.settings)
  const view = useApp((s) => s.view)
  const sort = useApp((s) => s.sort)
  const select = useApp((s) => s.select)
  const setSelection = useApp((s) => s.setSelection)
  const openLightbox = useApp((s) => s.openLightbox)

  const scrollRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth - 32))
    ro.observe(el)
    setWidth(el.clientWidth - 32)
    return () => ro.disconnect()
  }, [])

  // ordinamenti non cronologici: niente intestazioni per giorno
  const groupBy = sort === 'date' || (sort === 'added' && view.kind === 'library' && view.id === 'recent') ? settings.groupBy : 'none'
  const rows = useMemo(() => buildRows(items, width, TARGET_H[settings.gridSize], sort === 'date' ? groupBy : 'none', settings.gridSize === 's'), [items, width, settings.gridSize, groupBy, sort])

  const virt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => rows[i]?.height ?? 200,
    overscan: 4,
    getItemKey: (i) => rows[i]?.key ?? i
  })

  useEffect(() => { virt.measure() }, [rows, virt])
  useEffect(() => { scrollRef.current?.scrollTo({ top: 0 }) }, [view])

  // Le miniature visibili passano in testa alla coda di generazione
  const vItems = virt.getVirtualItems()
  const first = vItems[0]?.index ?? 0
  const last = vItems[vItems.length - 1]?.index ?? 0
  useEffect(() => {
    const t = setTimeout(() => {
      const ids: number[] = []
      for (let r = first; r <= last; r++) {
        const row = rows[r]
        if (row?.type === 'tiles') for (const t of row.tiles) ids.push(items[t.index].id)
      }
      if (ids.length) void api('thumbs.prioritize', ids)
    }, 120)
    return () => clearTimeout(t)
  }, [first, last, rows, items])

  const selectionMode = selection.size > 0

  const onClick = useCallback((e: React.MouseEvent, item: GridItem) => {
    // stile desktop: clic = seleziona solo questo, Ctrl = aggiungi/togli, Shift = intervallo
    if (e.shiftKey) select(item.id, 'range')
    else if (e.ctrlKey || e.metaKey) select(item.id, 'toggle')
    else select(item.id, 'single')
  }, [select])

  const onOpen = useCallback((item: GridItem) => {
    const idx = useApp.getState().items.findIndex((i) => i.id === item.id)
    if (idx >= 0) openLightbox(idx)
  }, [openLightbox])

  const onToggle = useCallback((item: GridItem) => select(item.id, 'toggle'), [select])

  const onDragStart = useCallback((e: React.DragEvent, item: GridItem) => {
    const st = useApp.getState()
    const ids = st.selection.has(item.id) ? st.selectedIds() : [item.id]
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(ids))
    e.dataTransfer.effectAllowed = 'copyMove'
    const ghost = document.createElement('div')
    ghost.textContent = ids.length === 1 ? item.n : `${ids.length} elementi`
    ghost.style.cssText = 'position:absolute;top:-100px;padding:6px 12px;border-radius:8px;background:#8b93ff;color:#0b0d16;font:600 12px system-ui'
    document.body.appendChild(ghost)
    e.dataTransfer.setDragImage(ghost, 10, 10)
    setTimeout(() => ghost.remove(), 0)
  }, [])

  const blur = settings.hideSensitiveThumbs

  return (
    <div
      ref={scrollRef}
      className="h-full overflow-y-auto overflow-x-hidden px-4 pb-24"
      onClick={(e) => { if (e.target === e.currentTarget) useApp.getState().clearSelection() }}
      role="grid"
      aria-label="Media"
    >
      <div style={{ height: virt.getTotalSize(), position: 'relative', width: '100%' }}>
        {vItems.map((vr) => {
          const row = rows[vr.index]
          if (!row) return null
          if (row.type === 'header') {
            const allSel = row.indices.every((i) => selection.has(items[i].id))
            return (
              <div key={vr.key} className="group/h absolute left-0 flex w-full items-end pb-2.5" style={{ top: vr.start, height: row.height }}>
                <button
                  onClick={() => {
                    const ids = row.indices.map((i) => items[i].id)
                    const cur = new Set(useApp.getState().selection)
                    if (allSel) ids.forEach((id) => cur.delete(id))
                    else ids.forEach((id) => cur.add(id))
                    setSelection([...cur])
                  }}
                  className="flex items-center gap-2 text-left"
                  title={allSel ? 'Deseleziona il gruppo' : 'Seleziona il gruppo'}
                >
                  <span className={cx('text-accent transition-opacity', allSel || selectionMode ? 'opacity-100' : 'opacity-0 group-hover/h:opacity-100')}>
                    {allSel ? <CheckCircle2 size={18} /> : <Circle size={18} />}
                  </span>
                  <span className="font-display text-[15px] font-semibold tracking-tight text-fg">{row.label}</span>
                  <span className="text-[12px] text-faint">{plural(row.count, 'elemento', 'elementi')}</span>
                </button>
              </div>
            )
          }
          return (
            <div key={vr.key} className="absolute left-0 w-full" style={{ top: vr.start, height: row.height }}>
              {row.tiles.map((t) => {
                const it = items[t.index]
                return (
                  <div key={it.id} className="absolute top-0" style={{ left: t.x, width: t.w, height: row.height - GAP }}>
                    <MediaCard
                      item={it}
                      width={t.w}
                      height={row.height - GAP}
                      selected={selection.has(it.id)}
                      selectionMode={selectionMode}
                      blur={blur}
                      onClick={onClick}
                      onOpen={onOpen}
                      onToggle={onToggle}
                      onDragStart={onDragStart}
                    />
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
