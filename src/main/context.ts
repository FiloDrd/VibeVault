import fs from 'node:fs'
import path from 'node:path'
import type { DB } from './db/database'
import { MediaRepo } from './db/mediaRepo'
import { AlbumRepo, SettingsRepo, TagRepo } from './db/orgRepo'
import { OperationsRepo, TrashRepo } from './db/opsRepo'
import type { Vault } from './vault'
import type { IpcEventName, IpcEvents } from '@shared/ipc'

export interface Tools {
  ffmpeg: string | null
  ffprobe: string | null
}

/** Log su file dentro <root>/Logs. Solo percorsi relativi, niente GPS né contenuti. */
export class Logger {
  constructor(private dir: string) {
    fs.mkdirSync(dir, { recursive: true })
  }

  private file(kind: string): string {
    const d = new Date()
    return path.join(this.dir, `${kind}-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}.jsonl`)
  }

  op(entry: Record<string, unknown>): void {
    this.write('operations', entry)
  }

  info(msg: string, extra?: Record<string, unknown>): void {
    this.write('app', { level: 'info', msg, ...extra })
  }

  error(msg: string, extra?: Record<string, unknown>): void {
    this.write('app', { level: 'error', msg, ...extra })
  }

  private write(kind: string, entry: Record<string, unknown>): void {
    try {
      fs.appendFileSync(this.file(kind), JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n')
    } catch {
      /* il log non deve mai bloccare l'app */
    }
  }
}

export class AppContext {
  readonly media: MediaRepo
  readonly tags: TagRepo
  readonly albums: AlbumRepo
  readonly settings: SettingsRepo
  readonly ops: OperationsRepo
  readonly trash: TrashRepo
  readonly log: Logger

  constructor(
    readonly vault: Vault,
    readonly db: DB,
    readonly tools: Tools,
    readonly emit: <E extends IpcEventName>(event: E, payload: IpcEvents[E]) => void = () => {}
  ) {
    this.media = new MediaRepo(db)
    this.tags = new TagRepo(db)
    this.albums = new AlbumRepo(db)
    this.settings = new SettingsRepo(db)
    this.ops = new OperationsRepo(db)
    this.trash = new TrashRepo(db)
    this.log = new Logger(vault.logsDir)
  }
}
