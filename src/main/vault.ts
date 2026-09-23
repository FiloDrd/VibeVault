import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

/**
 * Struttura portatile del vault (tutto dentro una cartella, es. sull'SSD):
 *
 *   <root>/App/            eseguibile portatile (opzionale)
 *   <root>/Library/        i media dell'utente
 *   <root>/VaultData/      database.sqlite, edits/, sidecar/, backups/, vault.json
 *   <root>/Cache/          thumbnails/, previews/ (rigenerabili)
 *   <root>/Trash/          cestino interno
 *   <root>/Exports/        Foto/, Video/, GIF/
 *   <root>/Logs/           log operazioni (JSONL)
 *
 * Nel database si salvano SOLO percorsi relativi alla root, con separatore '/'.
 */
export const VAULT_DIRS = [
  'Library',
  'Library/Foto',
  'Library/Video',
  'Library/GIF',
  'Library/Raw',
  'Library/Screenshots',
  'Library/Archivio',
  'VaultData',
  'VaultData/edits',
  'VaultData/sidecar',
  'VaultData/backups',
  'Cache',
  'Cache/thumbnails',
  'Cache/previews',
  'Trash',
  'Exports',
  'Exports/Foto',
  'Exports/Video',
  'Exports/GIF',
  'Logs'
] as const

/** Cartelle interne che lo scanner non deve mai indicizzare. */
export const RESERVED_TOP_LEVEL = new Set(['App', 'VaultData', 'Cache', 'Trash', 'Logs', 'Exports'])

/**
 * Confronto come fa Windows: senza distinzione maiuscole e ignorando punti/spazi
 * finali ("cache", "Cache." e "CACHE " aprono tutte la stessa cartella).
 */
export function isReservedName(segment: string): boolean {
  const n = segment.replace(/[. ]+$/g, '').toLowerCase()
  for (const r of RESERVED_TOP_LEVEL) if (r.toLowerCase() === n) return true
  return false
}

export interface VaultMarker {
  vaultId: string
  createdAt: number
  lastKnownRoot: string
  lastOpenedAt: number
  appVersion: string
}

export class Vault {
  readonly root: string

  constructor(rootAbs: string) {
    this.root = path.resolve(rootAbs)
  }

  get dataDir(): string { return path.join(this.root, 'VaultData') }
  get dbPath(): string { return path.join(this.dataDir, 'database.sqlite') }
  get backupsDir(): string { return path.join(this.dataDir, 'backups') }
  get thumbsDir(): string { return path.join(this.root, 'Cache', 'thumbnails') }
  get previewsDir(): string { return path.join(this.root, 'Cache', 'previews') }
  get trashDir(): string { return path.join(this.root, 'Trash') }
  get logsDir(): string { return path.join(this.root, 'Logs') }
  get libraryDir(): string { return path.join(this.root, 'Library') }
  get markerPath(): string { return path.join(this.dataDir, 'vault.json') }

  /** Crea la struttura cartelle (idempotente). */
  ensureStructure(): void {
    for (const d of VAULT_DIRS) fs.mkdirSync(path.join(this.root, d), { recursive: true })
  }

  /**
   * Legge/aggiorna il marker del vault. Restituisce la root precedente se è
   * cambiata (es. SSD montato su un'altra lettera di unità).
   */
  touchMarker(appVersion: string): { marker: VaultMarker; rootChanged: { from: string; to: string } | null } {
    let marker: VaultMarker | null = null
    try {
      marker = JSON.parse(fs.readFileSync(this.markerPath, 'utf8')) as VaultMarker
    } catch {
      marker = null
    }
    let rootChanged: { from: string; to: string } | null = null
    if (!marker) {
      marker = {
        vaultId: crypto.randomUUID(),
        createdAt: Date.now(),
        lastKnownRoot: this.root,
        lastOpenedAt: Date.now(),
        appVersion
      }
    } else if (path.resolve(marker.lastKnownRoot) !== this.root) {
      rootChanged = { from: marker.lastKnownRoot, to: this.root }
    }
    marker = { ...marker, lastKnownRoot: this.root, lastOpenedAt: Date.now(), appVersion }
    writeFileAtomic(this.markerPath, JSON.stringify(marker, null, 2))
    return { marker, rootChanged }
  }

  /** Assoluto → relativo alla root, con '/' come separatore. Lancia se fuori root. */
  toRel(abs: string): string {
    const rel = path.relative(this.root, path.resolve(abs))
    if (rel === '') return ''
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`Percorso fuori dal vault: ${abs}`)
    }
    return rel.split(path.sep).join('/')
  }

  /** Relativo → assoluto. Rifiuta traversal ('..') per sicurezza. */
  toAbs(rel: string): string {
    const clean = normalizeRel(rel)
    const abs = path.resolve(this.root, ...clean.split('/').filter(Boolean))
    const back = path.relative(this.root, abs)
    if (back.startsWith('..') || path.isAbsolute(back)) throw new Error(`Percorso non valido: ${rel}`)
    return abs
  }

  isInside(abs: string): boolean {
    const rel = path.relative(this.root, path.resolve(abs))
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
  }

  /** True se il relativo appartiene a una cartella interna (Cache, Trash, ...). */
  isReserved(rel: string): boolean {
    const top = normalizeRel(rel).split('/')[0]
    return isReservedName(top)
  }
}

export function normalizeRel(rel: string): string {
  const parts = rel.replace(/\\/g, '/').split('/').filter((p) => p !== '' && p !== '.')
  if (parts.some((p) => p === '..')) throw new Error(`Percorso relativo non valido: ${rel}`)
  return parts.join('/')
}

export function relDirname(rel: string): string {
  const i = rel.lastIndexOf('/')
  return i < 0 ? '' : rel.slice(0, i)
}

export function relBasename(rel: string): string {
  const i = rel.lastIndexOf('/')
  return i < 0 ? rel : rel.slice(i + 1)
}

export function relJoin(...parts: string[]): string {
  return normalizeRel(parts.filter(Boolean).join('/'))
}

/** Scrittura atomica: file temporaneo + rename. */
export function writeFileAtomic(file: string, data: string | Buffer): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tmp, data)
  fs.renameSync(tmp, file)
}

const INVALID_NAME = /[<>:"/\\|?*\u0000-\u001f]/g
const WIN_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i

/** Rende un nome file valido su Windows/macOS/Linux. */
export function sanitizeFileName(name: string): string {
  let n = name.replace(INVALID_NAME, '_').replace(/[. ]+$/g, '').trim()
  if (!n) n = 'senza_nome'
  if (WIN_RESERVED.test(n)) n = `_${n}`
  if (n.length > 200) {
    const dot = n.lastIndexOf('.')
    const ext = dot > 0 ? n.slice(dot) : ''
    n = n.slice(0, 200 - ext.length) + ext
  }
  return n
}
