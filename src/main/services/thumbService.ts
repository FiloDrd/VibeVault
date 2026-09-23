import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import type { AppContext } from '../context'
import type { ThumbJob, ThumbResult } from '../workers/thumb.worker'
import type { ThumbStatus } from '@shared/types'

const THUMB_SIZE = 512
const PREVIEW_SIZE = 2560

type Kind = 'thumb' | 'preview'

interface Pending {
  resolve: (ok: boolean) => void
}

/**
 * Coda miniature con priorità:
 *   1. richieste esplicite (elementi visibili nella griglia) — LIFO: l'ultimo scroll vince
 *   2. riempimento in background dai media 'pending' nel DB
 * Pool di worker_threads con sharp/FFmpeg: la UI non viene mai bloccata.
 */
export class ThumbService {
  private workers: { w: Worker; busy: boolean }[] = []
  private high: number[] = []
  private highSet = new Set<number>()
  private background: number[] = []
  private inflight = new Map<number, { id: number; kind: Kind }>()
  private inflightIds = new Set<string>()
  private waiters = new Map<string, Pending[]>()
  private previewQueue: number[] = []
  private jobSeq = 0
  private readyBuffer: number[] = []
  private readyTimer: NodeJS.Timeout | null = null
  private stats: ThumbStatus = { queued: 0, done: 0, failed: 0 }
  private paused = false
  private bgExhausted = false

  constructor(private ctx: AppContext, private workerPath: string, poolSize = Math.max(1, Math.min(4, Math.floor(os.cpus().length / 2)))) {
    for (let i = 0; i < poolSize; i++) this.spawn()
  }

  private spawn(): void {
    const w = new Worker(this.workerPath, { workerData: { ffmpeg: this.ctx.tools.ffmpeg } })
    const slot = { w, busy: false }
    w.on('message', (r: ThumbResult) => this.onResult(slot, r))
    w.on('error', (e) => {
      this.ctx.log.error('thumb.worker.error', { message: e.message })
    })
    w.on('exit', () => {
      if (this.paused) return
      // il worker è morto (es. crash su file malformato): libera il job e ricrea
      this.workers = this.workers.filter((s) => s !== slot)
      for (const [jobId, job] of this.inflight) {
        if ((job as { slot?: unknown }).slot === slot) {
          this.inflight.delete(jobId)
          this.finishJob(job.id, job.kind, false, 'worker terminato')
        }
      }
      if (!this.paused) { this.spawn(); this.pump() }
    })
    this.workers.push(slot)
  }

  thumbAbs(id: number): string {
    return path.join(this.ctx.vault.thumbsDir, String(Math.floor(id / 1000)).padStart(4, '0'), `${id}.webp`)
  }

  previewAbs(id: number): string {
    return path.join(this.ctx.vault.previewsDir, String(Math.floor(id / 1000)).padStart(4, '0'), `${id}.jpg`)
  }

  status(): ThumbStatus {
    const c = this.ctx.media.thumbCounts()
    return { queued: c.pending, done: c.done, failed: c.failed }
  }

  /** Porta in testa alla coda gli id visibili. */
  prioritize(ids: number[]): void {
    for (let i = ids.length - 1; i >= 0; i--) {
      const id = ids[i]
      if (this.highSet.has(id)) continue
      const info = this.ctx.media.thumbInfo(id)
      if (!info || info.thumbState !== 'pending' || info.status !== 'ok') continue
      this.high.push(id)
      this.highSet.add(id)
    }
    // limita la coda alta: gli elementi vecchi tornano in background
    if (this.high.length > 400) {
      const drop = this.high.splice(0, this.high.length - 400)
      for (const d of drop) this.highSet.delete(d)
    }
    this.pump()
  }

  /** Nuovi media indicizzati: sveglia il riempimento in background. */
  kick(): void {
    this.bgExhausted = false
    this.pump()
  }

  /** Attende che la miniatura di `id` sia pronta (o fallita). */
  ensure(id: number, kind: Kind = 'thumb', timeoutMs = 20000): Promise<boolean> {
    const key = `${kind}:${id}`
    const abs = kind === 'thumb' ? this.thumbAbs(id) : this.previewAbs(id)
    if (fs.existsSync(abs)) return Promise.resolve(true)
    const info = this.ctx.media.thumbInfo(id)
    if (!info || info.status !== 'ok') return Promise.resolve(false)
    if (kind === 'thumb' && info.thumbState === 'failed') return Promise.resolve(false)
    return new Promise<boolean>((resolve) => {
      const list = this.waiters.get(key) ?? []
      let done = false
      const t = setTimeout(() => { if (!done) { done = true; resolve(false) } }, timeoutMs)
      list.push({ resolve: (ok) => { if (!done) { done = true; clearTimeout(t); resolve(ok) } } })
      this.waiters.set(key, list)
      if (kind === 'thumb') {
        if (!this.highSet.has(id) && !this.inflightIds.has(key)) { this.high.push(id); this.highSet.add(id) }
      } else if (!this.inflightIds.has(key) && !this.previewQueue.includes(id)) {
        this.previewQueue.push(id)
      }
      this.pump()
    })
  }

  private nextJob(): { id: number; kind: Kind } | null {
    if (this.previewQueue.length) return { id: this.previewQueue.shift()!, kind: 'preview' }
    while (this.high.length) {
      const id = this.high.pop()!
      this.highSet.delete(id)
      if (!this.inflightIds.has(`thumb:${id}`)) return { id, kind: 'thumb' }
    }
    if (!this.background.length && !this.bgExhausted) {
      const busy = new Set([...this.inflight.values()].map((j) => j.id))
      this.background = this.ctx.media.pendingThumbs(300).map((r) => r.id).filter((id) => !busy.has(id))
      if (!this.background.length) this.bgExhausted = true
    }
    while (this.background.length) {
      const id = this.background.shift()!
      if (!this.inflightIds.has(`thumb:${id}`)) return { id, kind: 'thumb' }
    }
    return null
  }

  private pump(): void {
    if (this.paused) return
    for (const slot of this.workers) {
      if (slot.busy) continue
      let next: { id: number; kind: Kind } | null
      let info: ReturnType<AppContext['media']['thumbInfo']>
      let abs = ''
      for (;;) {
        next = this.nextJob()
        if (!next) return
        info = this.ctx.media.thumbInfo(next.id)
        const outAbs = next.kind === 'thumb' ? this.thumbAbs(next.id) : this.previewAbs(next.id)
        if (!info || info.status !== 'ok' || (next.kind === 'thumb' && info.thumbState !== 'pending' && fs.existsSync(outAbs))) {
          this.finishJob(next.id, next.kind, !!info && fs.existsSync(outAbs))
          continue
        }
        try { abs = this.ctx.vault.toAbs(info.rel) } catch { this.finishJob(next.id, next.kind, false, 'percorso non valido'); continue }
        break
      }
      if (!info) continue
      const job: ThumbJob = {
        jobId: ++this.jobSeq,
        id: next.id,
        abs,
        kind: info.kind,
        ext: info.ext,
        out: next.kind === 'thumb' ? this.thumbAbs(next.id) : this.previewAbs(next.id),
        size: next.kind === 'thumb' ? THUMB_SIZE : PREVIEW_SIZE,
        format: next.kind === 'thumb' ? 'webp' : 'jpeg',
        durationMs: info.durationMs
      }
      slot.busy = true
      this.inflight.set(job.jobId, Object.assign({ id: next.id, kind: next.kind }, { slot }))
      this.inflightIds.add(`${next.kind}:${next.id}`)
      slot.w.postMessage(job)
    }
  }

  private onResult(slot: { w: Worker; busy: boolean }, r: ThumbResult): void {
    slot.busy = false
    if (this.paused) return
    const job = this.inflight.get(r.jobId)
    this.inflight.delete(r.jobId)
    if (job) this.finishJob(job.id, job.kind, r.ok, r.error)
    this.pump()
  }

  private finishJob(id: number, kind: Kind, ok: boolean, error?: string): void {
    const key = `${kind}:${id}`
    this.inflightIds.delete(key)
    if (kind === 'thumb') {
      try {
        const rel = ok ? this.ctx.vault.toRel(this.thumbAbs(id)) : null
        this.ctx.media.setThumb(id, ok ? 'done' : 'failed', rel)
      } catch { /* media eliminato nel frattempo */ }
      if (ok) {
        this.stats.done++
        this.readyBuffer.push(id)
        this.scheduleReady()
      } else {
        this.stats.failed++
        if (error) this.ctx.log.error('thumb.failed', { id, error })
      }
    } else if (ok) {
      try { this.ctx.media.setPreview(id, this.ctx.vault.toRel(this.previewAbs(id))) } catch { /* ignora */ }
    }
    const ws = this.waiters.get(key)
    if (ws) {
      this.waiters.delete(key)
      for (const w of ws) w.resolve(ok)
    }
  }

  private scheduleReady(): void {
    if (this.readyTimer) return
    this.readyTimer = setTimeout(() => {
      this.readyTimer = null
      const ids = this.readyBuffer
      this.readyBuffer = []
      if (ids.length) this.ctx.emit('thumbs:ready', { ids })
      this.ctx.emit('thumbs:status', this.status())
    }, 300)
  }

  /** Invalida le miniature (es. dopo svuotamento cache). */
  invalidate(id: number): void {
    for (const p of [this.thumbAbs(id), this.previewAbs(id)]) {
      try { fs.rmSync(p, { force: true }) } catch { /* ignora */ }
    }
    this.ctx.media.setThumb(id, 'pending', null)
    this.ctx.media.setPreview(id, null)
  }

  /** Idle: nessun job in corso né in coda. */
  get idle(): boolean {
    return this.inflight.size === 0 && this.high.length === 0 && this.previewQueue.length === 0 && this.ctx.media.pendingThumbs(1).length === 0
  }

  async shutdown(): Promise<void> {
    this.paused = true
    if (this.readyTimer) { clearTimeout(this.readyTimer); this.readyTimer = null }
    for (const ws of this.waiters.values()) for (const w of ws) w.resolve(false)
    this.waiters.clear()
    await Promise.all(this.workers.map((s) => s.w.terminate()))
    this.workers = []
  }
}
