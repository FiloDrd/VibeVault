import fs from 'node:fs'
import { Worker } from 'node:worker_threads'
import type { AppContext } from '../context'
import type { ScannerInput, ScannerMessage } from '../workers/scanner.worker'
import type { ScanErrorEntry, ScanProgress } from '@shared/types'
import { normalizeRel } from '../vault'

const IDLE: ScanProgress = { phase: 'idle', scanned: 0, added: 0, updated: 0, unchanged: 0, missing: 0, moved: 0, errors: 0 }

export class ScanService {
  private worker: Worker | null = null
  private progress: ScanProgress = { ...IDLE }
  private errors: ScanErrorEntry[] = []
  private donePromise: Promise<ScanProgress> | null = null

  constructor(
    private ctx: AppContext,
    private workerPath: string,
    private onIndexed: (ids: number[]) => void = () => {}
  ) {}

  status(): ScanProgress { return this.progress }
  errorList(): ScanErrorEntry[] { return this.errors }
  get running(): boolean { return this.worker !== null }
  /** Attende la fine della scansione in corso (usato dai test). */
  wait(): Promise<ScanProgress> { return this.donePromise ?? Promise.resolve(this.progress) }

  start(opts: { folders?: string[]; full?: boolean } = {}): { started: boolean; message?: string } {
    if (this.worker) return { started: false, message: 'Scansione già in corso' }
    const settings = this.ctx.settings.getAll()
    const folders = (opts.folders ?? settings.scanFolders).map((f) => normalizeRel(f)).filter((f) => !this.ctx.vault.isReserved(f))
    if (!folders.length) return { started: false, message: 'Nessuna cartella da scansionare' }

    const scanId = Date.now()
    const known = this.ctx.media.knownFiles()
    const input: ScannerInput = {
      root: this.ctx.vault.root,
      folders,
      known: [...known].map(([p, v]) => [p, v.size, v.mtime]),
      includeAudio: settings.includeAudio,
      ffprobe: this.ctx.tools.ffprobe,
      full: !!opts.full,
      reserved: [...this.ctx.vault.reservedNames]
    }
    this.errors = []
    this.progress = { ...IDLE, phase: 'walking', startedAt: Date.now() }
    const addedIds: number[] = []
    const albumFolders: { folder: string; title: string }[] = []
    this.ctx.log.info('scan.start', { folders, full: !!opts.full })

    const worker = new Worker(this.workerPath, { workerData: input })
    this.worker = worker
    let lastEmit = 0
    const emit = (force = false) => {
      const now = Date.now()
      if (force || now - lastEmit > 200) {
        lastEmit = now
        this.ctx.emit('scan:progress', this.progress)
      }
    }

    this.donePromise = new Promise<ScanProgress>((resolve) => {
      let finished = false
      const finish = (cancelled: boolean, message?: string) => {
        // stato locale: un 'exit' tardivo di questo worker non deve toccare scansioni successive
        if (finished) return
        finished = true
        if (this.worker === worker) this.worker = null
        try {
          if (!cancelled) {
            this.progress.phase = 'reconciling'
            emit(true)
            this.progress.missing = this.ctx.media.markMissing(scanId, folders, (rel) => {
              try { return fs.existsSync(this.ctx.vault.toAbs(rel)) } catch { return false }
            })
            this.progress.moved = this.ctx.media.reconcileMoves(addedIds)
            this.progress.missing -= this.progress.moved
            this.progress.added -= this.progress.moved
            // Google Takeout: album dalle cartelle album, copie doppie e originali "-edited" nascosti
            const sources = new Set([...this.ctx.albums.folderAlbumSources(), ...albumFolders.map((a) => a.folder)])
            this.ctx.media.resolveShadows([...sources])
            const created = this.ctx.albums.syncFolderAlbums(albumFolders, new Set(addedIds))
            if (created) this.ctx.log.info('scan.takeoutAlbums', { created })
          }
          this.ctx.media.rebuildFolders(folders)
        } catch (e) {
          message = (e as Error).message
        }
        this.progress = {
          ...this.progress,
          phase: message ? 'error' : cancelled ? 'cancelled' : 'done',
          finishedAt: Date.now(),
          currentPath: undefined,
          message
        }
        this.ctx.log.info('scan.end', { ...this.progress })
        emit(true)
        this.ctx.emit('library:changed', { reason: 'scan' })
        resolve(this.progress)
      }

      worker.on('message', (msg: ScannerMessage) => {
        try {
          switch (msg.type) {
            case 'batch': {
              const s = this.ctx.media.upsertScanned(msg.records, scanId)
              addedIds.push(...s.added)
              this.progress.added += s.added.length
              this.progress.updated += s.updated
              this.progress.unchanged += s.unchanged
              if (s.added.length || s.updated) this.onIndexed(s.added)
              emit()
              break
            }
            case 'seen':
              this.ctx.media.markSeen(msg.rels, scanId)
              this.progress.unchanged += msg.rels.length
              emit()
              break
            case 'progress':
              this.progress.scanned = msg.scanned
              this.progress.currentPath = msg.currentPath
              this.progress.phase = msg.phase
              emit()
              break
            case 'album':
              albumFolders.push({ folder: msg.folder, title: msg.title })
              break
            case 'error':
              this.progress.errors++
              if (this.errors.length < 1000) this.errors.push({ path: msg.path, message: msg.message })
              break
            case 'done':
              this.progress.scanned = msg.scanned
              void worker.terminate()
              finish(msg.cancelled)
              break
          }
        } catch (e) {
          this.progress.errors++
          this.errors.push({ path: '', message: (e as Error).message })
        }
      })
      worker.on('error', (e) => {
        this.errors.push({ path: '', message: e.message })
        finish(true, `Errore scanner: ${e.message}`)
      })
      worker.on('exit', () => finish(true))
    })
    return { started: true }
  }

  cancel(): void {
    this.worker?.postMessage('cancel')
  }
}
