import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

/**
 * Due layout possibili per la root:
 *
 * "folder" (predefinito): la root è una cartella qualsiasi scelta dall'utente
 * (es. E:\Foto). Le foto restano dove sono; l'app scrive SOLO dentro la cartella
 * nascosta <root>/.vibevault/ (database, miniature, cestino, log, backup).
 *
 * "legacy" (vault v0.1): <root>/Library, <root>/VaultData, <root>/Cache, <root>/Trash,
 * <root>/Exports, <root>/Logs. Riconosciuto dalla presenza di VaultData/.
 *
 * Nel database si salvano SOLO percorsi relativi alla root, con separatore '/'.
 */
export type VaultLayout = 'folder' | 'legacy'

/** Nome della cartella dati nascosta nel layout "folder". */
export const DATA_DIR_NAME = '.vibevault'

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

const FOLDER_DIRS = [DATA_DIR_NAME, `${DATA_DIR_NAME}/cache/thumbnails`, `${DATA_DIR_NAME}/cache/previews`, `${DATA_DIR_NAME}/trash`, `${DATA_DIR_NAME}/logs`, `${DATA_DIR_NAME}/backups`]

/** Cartelle interne del layout legacy che lo scanner non deve mai indicizzare. */
export const RESERVED_TOP_LEVEL = new Set(['App', 'VaultData', 'Cache', 'Trash', 'Logs', 'Exports'])
/** Nel layout "folder" l'unica cartella riservata è quella dei dati dell'app. */
export const RESERVED_FOLDER_LAYOUT = new Set([DATA_DIR_NAME])

/**
 * Confronto come fa Windows: senza distinzione maiuscole e ignorando punti/spazi
 * finali ("cache", "Cache." e "CACHE " aprono tutte la stessa cartella).
 */
export function isReservedName(segment: string, reserved: Iterable<string> = RESERVED_TOP_LEVEL): boolean {
  const n = segment.replace(/[. ]+$/g, '').toLowerCase()
  for (const r of reserved) if (r.replace(/[. ]+$/g, '').toLowerCase() === n) return true
  return false
}

/** Il layout legacy si riconosce dalla cartella VaultData con database o marker. */
export function detectLayout(rootAbs: string): VaultLayout {
  const vd = path.join(rootAbs, 'VaultData')
  return fs.existsSync(path.join(vd, 'vault.json')) || fs.existsSync(path.join(vd, 'database.sqlite')) ? 'legacy' : 'folder'
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
  readonly layout: VaultLayout

  constructor(rootAbs: string, layout?: VaultLayout) {
    this.root = path.resolve(rootAbs)
    this.layout = layout ?? detectLayout(this.root)
  }

  private get legacy(): boolean { return this.layout === 'legacy' }
  get dataDir(): string { return this.legacy ? path.join(this.root, 'VaultData') : path.join(this.root, DATA_DIR_NAME) }
  get dbPath(): string { return path.join(this.dataDir, 'database.sqlite') }
  get backupsDir(): string { return path.join(this.dataDir, 'backups') }
  get cacheDir(): string { return this.legacy ? path.join(this.root, 'Cache') : path.join(this.dataDir, 'cache') }
  get thumbsDir(): string { return path.join(this.cacheDir, 'thumbnails') }
  get previewsDir(): string { return path.join(this.cacheDir, 'previews') }
  get trashDir(): string { return this.legacy ? path.join(this.root, 'Trash') : path.join(this.dataDir, 'trash') }
  /** Percorso relativo del cestino interno ('Trash' o '.vibevault/trash'). */
  get trashRel(): string { return this.legacy ? 'Trash' : `${DATA_DIR_NAME}/trash` }
  get logsDir(): string { return this.legacy ? path.join(this.root, 'Logs') : path.join(this.dataDir, 'logs') }
  /** Dove l'utente mette i media: Library/ nel layout legacy, la root stessa altrimenti. */
  get libraryDir(): string { return this.legacy ? path.join(this.root, 'Library') : this.root }
  get markerPath(): string { return path.join(this.dataDir, 'vault.json') }
  /** Nomi di primo livello che non contengono media dell'utente. */
  get reservedNames(): Set<string> { return this.legacy ? RESERVED_TOP_LEVEL : RESERVED_FOLDER_LAYOUT }
  /** Cartelle da scansionare di default. */
  get defaultScanFolders(): string[] { return this.legacy ? ['Library'] : [''] }

  /** Crea la struttura cartelle (idempotente). Nel layout "folder" solo .vibevault/. */
  ensureStructure(): void {
    for (const d of this.legacy ? VAULT_DIRS : FOLDER_DIRS) fs.mkdirSync(path.join(this.root, d), { recursive: true })
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
      throw new Error(`Percorso fuori dalla cartella: ${abs}`)
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

  /** True se il relativo appartiene a una cartella interna (Cache, Trash, .vibevault, ...). */
  isReserved(rel: string): boolean {
    const top = normalizeRel(rel).split('/')[0]
    return top !== '' && isReservedName(top, this.reservedNames)
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
