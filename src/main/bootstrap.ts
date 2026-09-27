import { AppContext, type Tools } from './context'
import { openDatabase } from './db/database'
import { execFile } from 'node:child_process'
import { Vault, type VaultLayout } from './vault'
import { ScanService } from './services/scanService'
import { ThumbService } from './services/thumbService'
import { ActionHandlers, createHandlers } from './handlers'
import type { IpcEventName, IpcEvents } from '@shared/ipc'

export interface VaultSession {
  ctx: AppContext
  scan: ScanService
  thumbs: ThumbService
  handlers: ActionHandlers
  rootChanged: { from: string; to: string } | null
  vaultId: string
  dbMessage?: string
  close: () => Promise<void>
}

/** Apre un vault (senza dipendenze Electron: usato anche dai test). */
export function openVault(opts: {
  root: string
  tools: Tools
  workerDir: string
  appVersion: string
  emit?: <E extends IpcEventName>(event: E, payload: IpcEvents[E]) => void
  thumbPool?: number
  /** Forza il layout (i test del formato v0.1 usano 'legacy'); di norma viene rilevato. */
  layout?: VaultLayout
}): VaultSession {
  const vault = new Vault(opts.root, opts.layout)
  vault.ensureStructure()
  // Windows: la cartella dati .vibevault/ resta nascosta in Esplora risorse
  if (vault.layout === 'folder' && process.platform === 'win32') {
    execFile('attrib', ['+h', vault.dataDir], { windowsHide: true }, () => { /* best effort */ })
  }
  const { marker, rootChanged } = vault.touchMarker(opts.appVersion)
  const { db, message } = openDatabase(vault.dbPath)
  const ctx = new AppContext(vault, db, opts.tools, opts.emit)
  if (rootChanged) ctx.log.info('vault.rootChanged', rootChanged)
  if (message) ctx.log.error('db.recovered', { message })
  const thumbs = new ThumbService(ctx, `${opts.workerDir}/thumb.worker.js`, opts.thumbPool)
  const scan = new ScanService(ctx, `${opts.workerDir}/scanner.worker.js`, () => thumbs.kick())
  const handlers = createHandlers({ ctx, scan, thumbs })
  // Riprende le miniature rimaste in sospeso da una sessione precedente
  thumbs.kick()
  return {
    ctx, scan, thumbs, handlers, rootChanged, vaultId: marker.vaultId, dbMessage: message,
    close: async () => {
      if (scan.running) { scan.cancel(); await scan.wait() }
      await thumbs.shutdown()
      try { db.pragma('wal_checkpoint(TRUNCATE)') } catch { /* ignora */ }
      db.close()
    }
  }
}
