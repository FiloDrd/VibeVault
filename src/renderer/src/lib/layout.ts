import type { GridItem } from '@shared/types'
import { dayKey, dayLabel, monthKey, monthLabel } from './format'

export interface Tile {
  index: number
  x: number
  w: number
}

export type Row =
  | { type: 'header'; key: string; label: string; count: number; indices: number[]; height: number }
  | { type: 'tiles'; key: string; tiles: Tile[]; height: number }

export const HEADER_H = 52
export const GAP = 4

function aspect(it: GridItem): number {
  if (!it.w || !it.h) return 1
  return Math.min(2.4, Math.max(0.45, it.w / it.h))
}

/**
 * Layout "justified": ogni riga riempie la larghezza mantenendo le proporzioni,
 * con altezza vicina a quella target. L'ultima riga di ogni gruppo non viene stirata.
 * O(n): regge 100k elementi.
 */
export function buildRows(items: GridItem[], width: number, targetH: number, groupBy: 'day' | 'month' | 'none', squares = false): Row[] {
  const rows: Row[] = []
  if (width <= 0 || !items.length) return rows
  const keyFn = groupBy === 'day' ? dayKey : groupBy === 'month' ? monthKey : () => 'all'
  const labelFn = groupBy === 'day' ? dayLabel : monthLabel

  let i = 0
  while (i < items.length) {
    const gk = keyFn(items[i].t)
    const start = i
    while (i < items.length && keyFn(items[i].t) === gk) i++
    const indices: number[] = []
    for (let k = start; k < i; k++) indices.push(k)
    if (groupBy !== 'none') rows.push({ type: 'header', key: `h-${gk}-${start}`, label: labelFn(items[start].t), count: i - start, indices, height: HEADER_H })
    if (squares) packSquares(rows, start, i, width, targetH)
    else packJustified(rows, items, start, i, width, targetH)
  }
  return rows
}

function packJustified(rows: Row[], items: GridItem[], from: number, to: number, width: number, targetH: number): void {
  let rowStart = from
  let sumAspect = 0
  for (let k = from; k < to; k++) {
    sumAspect += aspect(items[k])
    const n = k - rowStart + 1
    const rowW = sumAspect * targetH + GAP * (n - 1)
    if (rowW >= width) {
      const h = (width - GAP * (n - 1)) / sumAspect
      rows.push(makeRow(items, rowStart, k + 1, h))
      rowStart = k + 1
      sumAspect = 0
    }
  }
  if (rowStart < to) rows.push(makeRow(items, rowStart, to, Math.min(targetH, targetH * 1.15)))
}

function makeRow(items: GridItem[], from: number, to: number, h: number): Row {
  const tiles: Tile[] = []
  let x = 0
  for (let k = from; k < to; k++) {
    const w = aspect(items[k]) * h
    tiles.push({ index: k, x, w })
    x += w + GAP
  }
  return { type: 'tiles', key: `r-${from}`, tiles, height: h + GAP }
}

function packSquares(rows: Row[], from: number, to: number, width: number, targetH: number): void {
  const cols = Math.max(2, Math.round((width + GAP) / (targetH + GAP)))
  const size = (width - GAP * (cols - 1)) / cols
  for (let k = from; k < to; k += cols) {
    const tiles: Tile[] = []
    for (let c = 0; c < cols && k + c < to; c++) tiles.push({ index: k + c, x: c * (size + GAP), w: size })
    rows.push({ type: 'tiles', key: `s-${k}`, tiles, height: size + GAP })
  }
}

export const TARGET_H: Record<'s' | 'm' | 'l', number> = { s: 130, m: 200, l: 300 }
