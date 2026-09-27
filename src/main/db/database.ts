import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { MIGRATIONS, POST_MIGRATIONS } from './schema'

export type DB = Database.Database

export interface OpenResult {
  db: DB
  recovered: boolean
  message?: string
}

/**
 * Apre (o crea) il database. Se il file è corrotto viene messo da parte
 * (mai cancellato) e ne viene creato uno nuovo: il DB è ricostruibile via scansione.
 */
export function openDatabase(dbPath: string): OpenResult {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  try {
    const db = connect(dbPath)
    const res = db.pragma('quick_check', { simple: true })
    if (res !== 'ok') throw new Error(`quick_check: ${String(res)}`)
    migrate(db)
    return { db, recovered: false }
  } catch (err) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const aside = `${dbPath}.corrupt-${stamp}`
    for (const suffix of ['', '-wal', '-shm']) {
      if (fs.existsSync(dbPath + suffix)) fs.renameSync(dbPath + suffix, aside + suffix)
    }
    const db = connect(dbPath)
    migrate(db)
    return {
      db,
      recovered: true,
      message: `Database non leggibile (${(err as Error).message}). Spostato in ${path.basename(aside)}; nuovo database creato. Esegui una scansione per ricostruire l'indice.`
    }
  }
}

function connect(dbPath: string): DB {
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  db.pragma('temp_store = MEMORY')
  db.pragma('cache_size = -32000')
  db.pragma('busy_timeout = 5000')
  return db
}

export function migrate(db: DB): number {
  const current = db.pragma('user_version', { simple: true }) as number
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v])
      POST_MIGRATIONS[v]?.(db)
      db.pragma(`user_version = ${v + 1}`)
    })()
  }
  return MIGRATIONS.length
}

/** Backup online consistente (API di backup di SQLite). Mantiene gli ultimi `keep`. */
export async function backupDatabase(db: DB, backupsDir: string, keep = 10, label = 'manual'): Promise<string> {
  fs.mkdirSync(backupsDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dest = path.join(backupsDir, `database-${stamp}-${label}.sqlite`)
  await db.backup(dest)
  const files = fs
    .readdirSync(backupsDir)
    .filter((f) => f.startsWith('database-') && f.endsWith('.sqlite'))
    .sort()
  while (files.length > keep) {
    const old = files.shift()!
    try { fs.unlinkSync(path.join(backupsDir, old)) } catch { /* ignora */ }
  }
  return dest
}
