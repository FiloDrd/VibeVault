import type { DB } from './database'
import type {
  ColorLabel, DuplicateGroup, Flag, FolderNode, GridItem, LibraryStats, MediaDetails, MediaKind, MediaQuery, MediaStatus
} from '@shared/types'

/** Record prodotto dallo scanner worker per ogni file. */
export interface ScannedRecord {
  rel: string
  folder: string
  name: string
  ext: string
  mime: string
  kind: MediaKind
  size: number
  mtime: number
  birthtime: number | null
  exifDate: number | null
  width: number | null
  height: number | null
  durationMs: number | null
  orientation: number | null
  make: string | null
  model: string | null
  lat: number | null
  lon: number | null
  hashQuick: string | null
  isScreenshot: boolean
  status: MediaStatus
  error: string | null
}

export interface UpsertStats {
  added: number[]
  updated: number
  unchanged: number
}

const GRID_COLS = `m.id AS id, m.kind AS k, m.effective_date AS t, COALESCE(m.width,0) AS w, COALESCE(m.height,0) AS h,
  m.favorite AS fav, m.flag AS fl, m.rating AS r, m.duration_ms AS d, m.file_name AS n, m.status AS st`

export function effectiveDate(r: Pick<ScannedRecord, 'exifDate' | 'birthtime' | 'mtime'>): { date: number; source: 'exif' | 'file' | 'none' } {
  if (r.exifDate && r.exifDate > 0) return { date: r.exifDate, source: 'exif' }
  const cands = [r.birthtime, r.mtime].filter((x): x is number => typeof x === 'number' && x > 0)
  if (cands.length) return { date: Math.min(...cands), source: 'file' }
  return { date: 0, source: 'none' }
}

export class MediaRepo {
  constructor(private db: DB) {}

  // ---------------------------------------------------------------- scan

  knownFiles(): Map<string, { size: number; mtime: number }> {
    const rows = this.db
      .prepare(`SELECT file_path_relative p, size_bytes s, modified_at m FROM media WHERE status != 'trashed'`)
      .all() as { p: string; s: number; m: number | null }[]
    const map = new Map<string, { size: number; mtime: number }>()
    for (const r of rows) map.set(r.p, { size: r.s, mtime: r.m ?? 0 })
    return map
  }

  markSeen(rels: string[], scanId: number): void {
    const st = this.db.prepare(
      `UPDATE media SET last_seen_scan = ?, status = CASE WHEN status = 'missing' THEN 'ok' ELSE status END WHERE file_path_relative = ?`
    )
    this.db.transaction(() => { for (const r of rels) st.run(scanId, r) })()
  }

  upsertScanned(records: ScannedRecord[], scanId: number): UpsertStats {
    const find = this.db.prepare(`SELECT id, size_bytes s, modified_at m FROM media WHERE file_path_relative = ?`)
    const insert = this.db.prepare(`INSERT INTO media (
      file_path_relative, folder_path_relative, file_name, extension, mime_type, kind, size_bytes, created_at, modified_at,
      exif_date, effective_date, date_source, width, height, duration_ms, orientation, camera_make, camera_model,
      gps_lat, gps_lon, hash_quick, status, is_screenshot, added_at, last_seen_scan, error, thumb_state
    ) VALUES (
      @rel, @folder, @name, @ext, @mime, @kind, @size, @birthtime, @mtime,
      @exifDate, @effDate, @dateSource, @width, @height, @durationMs, @orientation, @make, @model,
      @lat, @lon, @hashQuick, @status, @isScreenshot, @now, @scanId, @error, @thumbState
    )`)
    const update = this.db.prepare(`UPDATE media SET
      folder_path_relative=@folder, file_name=@name, extension=@ext, mime_type=@mime, kind=@kind, size_bytes=@size,
      created_at=@birthtime, modified_at=@mtime, exif_date=@exifDate, effective_date=@effDate, date_source=@dateSource,
      width=@width, height=@height, duration_ms=@durationMs, orientation=@orientation, camera_make=@make,
      camera_model=@model, gps_lat=@lat, gps_lon=@lon, hash_quick=@hashQuick, hash_sha256=NULL, status=@status,
      is_screenshot=@isScreenshot, last_seen_scan=@scanId, error=@error, thumb_state=@thumbState
      WHERE id=@id`)
    const touch = this.db.prepare(`UPDATE media SET last_seen_scan=?, status = CASE WHEN status='missing' THEN 'ok' ELSE status END WHERE id=?`)

    const stats: UpsertStats = { added: [], updated: 0, unchanged: 0 }
    const now = Date.now()
    this.db.transaction(() => {
      for (const r of records) {
        const eff = effectiveDate(r)
        const params = {
          ...r,
          isScreenshot: r.isScreenshot ? 1 : 0,
          effDate: eff.date,
          dateSource: eff.source,
          now,
          scanId,
          thumbState: r.status === 'ok' ? 'pending' : 'failed'
        }
        const ex = find.get(r.rel) as { id: number; s: number; m: number | null } | undefined
        if (!ex) {
          const info = insert.run(params)
          stats.added.push(Number(info.lastInsertRowid))
        } else if (ex.s === r.size && (ex.m ?? 0) === r.mtime) {
          touch.run(scanId, ex.id)
          stats.unchanged++
        } else {
          update.run({ ...params, id: ex.id })
          stats.updated++
        }
      }
    })()
    return stats
  }

  /**
   * Marca come 'missing' i media sotto le cartelle scansionate non visti in questa
   * scansione E che non esistono davvero su disco (protegge da file spostati durante
   * la scansione, cartelle illeggibili per un errore temporaneo, differenze di maiuscole).
   */
  markMissing(scanId: number, folders: string[], existsOnDisk: (rel: string) => boolean): number {
    const all = folders.length === 0 || folders.includes('')
    const cands: { id: number; p: string; f: string }[] = this.db
      .prepare(`SELECT id, file_path_relative p, folder_path_relative f FROM media WHERE last_seen_scan != ? AND status IN ('ok','corrupt','unsupported')`)
      .all(scanId) as never
    const under = (f: string) => all || folders.some((root) => f === root || f.startsWith(root + '/'))
    const set = this.db.prepare(`UPDATE media SET status='missing' WHERE id = ?`)
    let n = 0
    this.db.transaction(() => {
      for (const c of cands) {
        if (!under(c.f)) continue
        if (existsOnDisk(c.p)) continue
        set.run(c.id)
        n++
      }
    })()
    return n
  }

  /**
   * Riconcilia file spostati fuori dall'app: un nuovo record con stessa
   * dimensione + hash rapido di un record 'missing' eredita l'id (e quindi
   * tag, album, rating, note, miniature) del vecchio.
   */
  reconcileMoves(newIds: number[]): number {
    if (!newIds.length) return 0
    const getNew = this.db.prepare(`SELECT * FROM media WHERE id = ?`)
    // solo se c'è UN unico candidato: con più copie identiche mancanti non si indovina
    const findMissing = this.db.prepare(
      `SELECT id FROM media WHERE status='missing' AND size_bytes = ? AND hash_quick = ? LIMIT 2`
    )
    const del = this.db.prepare(`DELETE FROM media WHERE id = ?`)
    const move = this.db.prepare(`UPDATE media SET file_path_relative=@file_path_relative, folder_path_relative=@folder_path_relative,
      file_name=@file_name, extension=@extension, modified_at=@modified_at, created_at=@created_at, status='ok',
      last_seen_scan=@last_seen_scan, is_screenshot=@is_screenshot,
      flag = CASE WHEN flag = 'trash' THEN 'none' ELSE flag END WHERE id=@oldId`)
    let moved = 0
    this.db.transaction(() => {
      for (const id of newIds) {
        const row = getNew.get(id) as Record<string, unknown> | undefined
        if (!row || !row.hash_quick) continue
        const olds = findMissing.all(row.size_bytes, row.hash_quick) as { id: number }[]
        if (olds.length !== 1) continue
        const old = olds[0]
        del.run(id)
        move.run({ ...row, oldId: old.id })
        moved++
      }
    })()
    return moved
  }

  /** Ricostruisce la tabella folders a partire dai media indicizzati + cartelle vuote note. */
  rebuildFolders(extraFolders: string[] = []): void {
    const rows = this.db
      .prepare(`SELECT folder_path_relative f, COUNT(*) c, SUM(size_bytes) s FROM media WHERE status NOT IN ('trashed','missing') GROUP BY folder_path_relative`)
      .all() as { f: string; c: number; s: number }[]
    const agg = new Map<string, { c: number; s: number }>()
    const ensure = (p: string) => { if (!agg.has(p)) agg.set(p, { c: 0, s: 0 }) }
    const existing = this.db.prepare(`SELECT path_relative p FROM folders`).all() as { p: string }[]
    for (const e of existing) ensure(e.p)
    for (const f of extraFolders) ensure(f)
    for (const r of rows) {
      ensure(r.f)
      const parts = r.f.split('/').filter(Boolean)
      for (let i = 1; i <= parts.length; i++) {
        const p = parts.slice(0, i).join('/')
        ensure(p)
        const a = agg.get(p)!
        a.c += r.c
        a.s += r.s
      }
    }
    agg.delete('')
    const upsert = this.db.prepare(`INSERT INTO folders (path_relative, name, parent_id, file_count, size_bytes, last_scanned_at)
      VALUES (?, ?, NULL, ?, ?, ?) ON CONFLICT(path_relative) DO UPDATE SET file_count=excluded.file_count, size_bytes=excluded.size_bytes, last_scanned_at=excluded.last_scanned_at`)
    const setParent = this.db.prepare(`UPDATE folders SET parent_id = (SELECT id FROM folders WHERE path_relative = ?) WHERE path_relative = ?`)
    const now = Date.now()
    this.db.transaction(() => {
      for (const [p, a] of agg) upsert.run(p, p.split('/').pop()!, a.c, a.s, now)
      for (const p of agg.keys()) {
        const i = p.lastIndexOf('/')
        if (i > 0) setParent.run(p.slice(0, i), p)
      }
    })()
  }

  removeFolderRecord(pathRel: string): void {
    this.db.prepare(`DELETE FROM folders WHERE path_relative = ?`).run(pathRel)
  }

  folders(): FolderNode[] {
    return this.db
      .prepare(`SELECT id, path_relative pathRelative, name, parent_id parentId, file_count fileCount, size_bytes sizeBytes FROM folders ORDER BY path_relative COLLATE NOCASE`)
      .all() as FolderNode[]
  }

  // ---------------------------------------------------------------- query

  query(q: MediaQuery, opts: { largeThresholdBytes: number }): GridItem[] {
    const where: string[] = []
    const params: unknown[] = []
    let join = ''

    if (q.trashed) where.push(`m.status = 'trashed'`)
    else if (q.missing) where.push(`m.status = 'missing'`)
    else where.push(`m.status NOT IN ('trashed','missing')`)

    if (q.archived === true) where.push(`m.archived = 1`)
    else if (!q.trashed && !q.missing && q.archived !== undefined) where.push(`m.archived = 0`)

    if (q.kinds?.length) {
      where.push(`m.kind IN (${q.kinds.map(() => '?').join(',')})`)
      params.push(...q.kinds)
    }
    if (q.favorite) where.push(`m.favorite = 1`)
    if (q.flags?.length) {
      where.push(`m.flag IN (${q.flags.map(() => '?').join(',')})`)
      params.push(...q.flags)
    }
    if (q.minRating) { where.push(`m.rating >= ?`); params.push(q.minRating) }
    if (q.colorLabel && q.colorLabel !== 'none') { where.push(`m.color_label = ?`); params.push(q.colorLabel) }
    if (q.noDate) where.push(`m.date_source != 'exif'`)
    if (q.largeFiles) { where.push(`m.size_bytes >= ?`); params.push(opts.largeThresholdBytes) }
    if (q.screenshots) where.push(`m.is_screenshot = 1`)
    if (q.orientation === 'portrait') where.push(`m.height > m.width`)
    if (q.orientation === 'landscape') where.push(`m.width > m.height`)
    if (q.orientation === 'square') where.push(`m.width = m.height AND m.width > 0`)
    if (q.dateFrom) { where.push(`m.effective_date >= ?`); params.push(q.dateFrom) }
    if (q.dateTo) { where.push(`m.effective_date < ?`); params.push(q.dateTo) }
    if (q.recent) { where.push(`m.added_at >= ?`); params.push(Date.now() - 30 * 86400000) }
    if (q.albumId) {
      join += ` JOIN album_items ai ON ai.media_id = m.id AND ai.album_id = ?`
      params.unshift(q.albumId)
    }
    if (q.tagId) {
      where.push(`EXISTS (SELECT 1 FROM media_tags mt WHERE mt.media_id = m.id AND mt.tag_id = ?)`)
      params.push(q.tagId)
    }
    if (q.folder !== undefined && q.folder !== null) {
      if (q.recursive) {
        if (q.folder) {
          where.push(`(m.folder_path_relative = ? OR m.folder_path_relative LIKE ? ESCAPE '\\')`)
          params.push(q.folder, likePrefix(q.folder) + '/%')
        }
      } else {
        where.push(`m.folder_path_relative = ?`)
        params.push(q.folder)
      }
    }
    if (q.search?.trim()) applySearch(q.search, where, params)

    const dir = q.order === 'asc' ? 'ASC' : 'DESC'
    const sortCol: Record<string, string> = {
      date: 'm.effective_date', name: 'm.file_name COLLATE NOCASE', size: 'm.size_bytes', added: 'm.added_at',
      rating: 'm.rating', duration: 'COALESCE(m.duration_ms,0)'
    }
    const orderBy = q.albumId && !q.sort ? `ai.position ASC` : `${sortCol[q.sort ?? 'date']} ${dir}, m.id ${dir}`
    const limit = q.limit ? ` LIMIT ${Math.max(1, Math.floor(q.limit))}` : ''
    const sql = `SELECT ${GRID_COLS} FROM media m${join} WHERE ${where.join(' AND ')} ORDER BY ${orderBy}${limit}`
    return this.db.prepare(sql).all(...params) as GridItem[]
  }

  details(id: number, toAbs: (rel: string) => string): MediaDetails | null {
    const r = this.db.prepare(`SELECT * FROM media WHERE id = ?`).get(id) as Record<string, any> | undefined
    if (!r) return null
    const tags = this.db
      .prepare(`SELECT t.id, t.name, t.color FROM tags t JOIN media_tags mt ON mt.tag_id = t.id WHERE mt.media_id = ? ORDER BY t.name`)
      .all(id) as MediaDetails['tags']
    const albums = this.db
      .prepare(`SELECT a.id, a.name, a.type, a.query, a.cover_media_id coverMediaId, a.created_at createdAt FROM albums a JOIN album_items ai ON ai.album_id = a.id WHERE ai.media_id = ? ORDER BY a.name`)
      .all(id) as MediaDetails['albums']
    let absolutePath = ''
    try { absolutePath = toAbs(r.file_path_relative) } catch { absolutePath = '' }
    return {
      id: r.id,
      filePathRelative: r.file_path_relative,
      fileName: r.file_name,
      extension: r.extension,
      mimeType: r.mime_type,
      kind: r.kind,
      sizeBytes: r.size_bytes,
      createdAt: r.created_at,
      modifiedAt: r.modified_at,
      exifDate: r.exif_date,
      effectiveDate: r.effective_date,
      dateSource: r.date_source,
      width: r.width,
      height: r.height,
      durationMs: r.duration_ms,
      orientation: r.orientation,
      cameraMake: r.camera_make,
      cameraModel: r.camera_model,
      gpsLat: r.gps_lat,
      gpsLon: r.gps_lon,
      placeName: r.place_name,
      hashQuick: r.hash_quick,
      hashSha256: r.hash_sha256,
      rating: r.rating,
      flag: r.flag,
      colorLabel: r.color_label,
      favorite: !!r.favorite,
      archived: !!r.archived,
      deletedAt: r.deleted_at,
      notes: r.notes,
      status: r.status,
      tags,
      albums,
      absolutePath
    }
  }

  getRow(id: number): Record<string, any> | undefined {
    return this.db.prepare(`SELECT * FROM media WHERE id = ?`).get(id) as Record<string, any> | undefined
  }

  getRows(ids: number[]): Record<string, any>[] {
    const out: Record<string, any>[] = []
    for (const chunk of chunks(ids, 500)) {
      out.push(...(this.db.prepare(`SELECT * FROM media WHERE id IN (${chunk.map(() => '?').join(',')})`).all(...chunk) as Record<string, any>[]))
    }
    return out
  }

  /** Esiste un media con questo percorso (senza distinzione maiuscole, come Windows)? */
  pathExists(rel: string, excludeId?: number): boolean {
    return !!this.db.prepare(`SELECT 1 FROM media WHERE file_path_relative = ? COLLATE NOCASE AND id != ?`).get(rel, excludeId ?? -1)
  }

  // ------------------------------------------------------- campi utente

  /** Imposta un campo semplice e restituisce i valori precedenti (per undo). */
  setField(ids: number[], field: 'rating' | 'flag' | 'favorite' | 'color_label' | 'archived' | 'notes', value: unknown): { id: number; prev: unknown }[] {
    const allowed = ['rating', 'flag', 'favorite', 'color_label', 'archived', 'notes']
    if (!allowed.includes(field)) throw new Error('campo non consentito')
    const get = this.db.prepare(`SELECT ${field} v FROM media WHERE id = ?`)
    const set = this.db.prepare(`UPDATE media SET ${field} = ? WHERE id = ?`)
    const prev: { id: number; prev: unknown }[] = []
    this.db.transaction(() => {
      for (const id of ids) {
        const row = get.get(id) as { v: unknown } | undefined
        if (!row) continue
        prev.push({ id, prev: row.v })
        set.run(value, id)
      }
    })()
    return prev
  }

  restoreField(field: string, prev: { id: number; prev: unknown }[]): void {
    const allowed = ['rating', 'flag', 'favorite', 'color_label', 'archived', 'notes']
    if (!allowed.includes(field)) throw new Error('campo non consentito')
    const set = this.db.prepare(`UPDATE media SET ${field} = ? WHERE id = ?`)
    this.db.transaction(() => { for (const p of prev) set.run(p.prev as never, p.id) })()
  }

  updatePath(id: number, rel: string, folder: string, name: string): void {
    this.db.prepare(`UPDATE media SET file_path_relative = ?, folder_path_relative = ?, file_name = ? WHERE id = ?`).run(rel, folder, name, id)
  }

  setStatus(id: number, status: MediaStatus, deletedAt: number | null = null): void {
    this.db.prepare(`UPDATE media SET status = ?, deleted_at = ? WHERE id = ?`).run(status, deletedAt, id)
  }

  // ------------------------------------------------------- thumbnails

  pendingThumbs(limit: number): { id: number; rel: string; kind: MediaKind; ext: string; orientation: number | null; durationMs: number | null }[] {
    return this.db
      .prepare(`SELECT id, file_path_relative rel, kind, extension ext, orientation, duration_ms durationMs FROM media
        WHERE thumb_state = 'pending' AND status = 'ok' ORDER BY effective_date DESC LIMIT ?`)
      .all(limit) as never
  }

  thumbInfo(id: number): { id: number; rel: string; kind: MediaKind; ext: string; orientation: number | null; durationMs: number | null; thumbState: string; thumb: string | null; status: string } | undefined {
    return this.db
      .prepare(`SELECT id, file_path_relative rel, kind, extension ext, orientation, duration_ms durationMs, thumb_state thumbState, thumbnail_path thumb, status FROM media WHERE id = ?`)
      .get(id) as never
  }

  setThumb(id: number, state: 'done' | 'failed' | 'pending', thumbRel: string | null): void {
    this.db.prepare(`UPDATE media SET thumb_state = ?, thumbnail_path = ? WHERE id = ?`).run(state, thumbRel, id)
  }

  setPreview(id: number, rel: string | null): void {
    this.db.prepare(`UPDATE media SET preview_path = ? WHERE id = ?`).run(rel, id)
  }

  resetAllThumbs(): void {
    this.db.prepare(`UPDATE media SET thumb_state = CASE WHEN status='ok' THEN 'pending' ELSE thumb_state END, thumbnail_path = NULL, preview_path = NULL`).run()
  }

  thumbCounts(): { pending: number; done: number; failed: number } {
    const rows = this.db.prepare(`SELECT thumb_state s, COUNT(*) c FROM media WHERE status='ok' GROUP BY thumb_state`).all() as { s: string; c: number }[]
    const o = { pending: 0, done: 0, failed: 0 }
    for (const r of rows) (o as Record<string, number>)[r.s] = r.c
    return o
  }

  // ------------------------------------------------------- duplicati & stats

  duplicateCandidates(): { key: string; size: number; ids: number[] }[] {
    const rows = this.db
      .prepare(`SELECT size_bytes s, hash_quick q, GROUP_CONCAT(id) ids FROM media
        WHERE status = 'ok' AND hash_quick IS NOT NULL GROUP BY size_bytes, hash_quick HAVING COUNT(*) > 1 ORDER BY size_bytes DESC`)
      .all() as { s: number; q: string; ids: string }[]
    return rows.map((r) => ({ key: `${r.s}:${r.q}`, size: r.s, ids: r.ids.split(',').map(Number) }))
  }

  setSha(id: number, sha: string): void {
    this.db.prepare(`UPDATE media SET hash_sha256 = ? WHERE id = ?`).run(sha, id)
  }

  gridItems(ids: number[]): GridItem[] {
    const out: GridItem[] = []
    for (const chunk of chunks(ids, 500)) {
      out.push(...(this.db.prepare(`SELECT ${GRID_COLS} FROM media m WHERE m.id IN (${chunk.map(() => '?').join(',')})`).all(...chunk) as GridItem[]))
    }
    return out
  }

  duplicates(verified: Map<string, string>): DuplicateGroup[] {
    const groups: DuplicateGroup[] = []
    for (const c of this.duplicateCandidates()) {
      const items = this.gridItems(c.ids)
      if (verified.size === 0) {
        groups.push({ key: c.key, sizeBytes: c.size, items, verified: false })
        continue
      }
      const bySha = new Map<string, GridItem[]>()
      for (const it of items) {
        const sha = verified.get(String(it.id))
        if (!sha) continue
        if (!bySha.has(sha)) bySha.set(sha, [])
        bySha.get(sha)!.push(it)
      }
      for (const [sha, list] of bySha) if (list.length > 1) groups.push({ key: sha, sizeBytes: c.size, items: list, verified: true })
    }
    return groups
  }

  stats(): Omit<LibraryStats, 'thumbsPending'> {
    const base = `status NOT IN ('trashed','missing')`
    const one = <T>(sql: string, ...p: unknown[]) => this.db.prepare(sql).get(...p) as T
    const tot = one<{ c: number; b: number | null }>(`SELECT COUNT(*) c, SUM(size_bytes) b FROM media WHERE ${base}`)
    const byKind = this.db.prepare(`SELECT kind, COUNT(*) count, SUM(size_bytes) bytes FROM media WHERE ${base} GROUP BY kind ORDER BY count DESC`).all() as LibraryStats['byKind']
    const byYear = this.db.prepare(`SELECT CASE WHEN effective_date > 0 THEN strftime('%Y', effective_date/1000, 'unixepoch') ELSE '—' END year, COUNT(*) count FROM media WHERE ${base} GROUP BY year ORDER BY year`).all() as LibraryStats['byYear']
    const byExt = this.db.prepare(`SELECT extension ext, COUNT(*) count, SUM(size_bytes) bytes FROM media WHERE ${base} GROUP BY extension ORDER BY count DESC LIMIT 20`).all() as LibraryStats['byExt']
    const flagsRows = this.db.prepare(`SELECT flag, COUNT(*) c FROM media WHERE ${base} GROUP BY flag`).all() as { flag: Flag; c: number }[]
    const flags: Record<Flag, number> = { none: 0, keep: 0, maybe: 0, trash: 0 }
    for (const f of flagsRows) flags[f.flag] = f.c
    return {
      total: tot.c,
      totalBytes: tot.b ?? 0,
      byKind,
      byYear,
      byExt,
      noDate: one<{ c: number }>(`SELECT COUNT(*) c FROM media WHERE ${base} AND date_source != 'exif'`).c,
      missing: one<{ c: number }>(`SELECT COUNT(*) c FROM media WHERE status = 'missing'`).c,
      corrupt: one<{ c: number }>(`SELECT COUNT(*) c FROM media WHERE status = 'corrupt'`).c,
      trashed: one<{ c: number }>(`SELECT COUNT(*) c FROM media WHERE status = 'trashed'`).c,
      favorites: one<{ c: number }>(`SELECT COUNT(*) c FROM media WHERE ${base} AND favorite = 1`).c,
      flags
    }
  }

  colorOf(id: number): ColorLabel {
    return (this.db.prepare(`SELECT color_label c FROM media WHERE id = ?`).get(id) as { c: ColorLabel } | undefined)?.c ?? 'none'
  }
}

export function likePrefix(s: string): string {
  return s.replace(/[\\%_]/g, (c) => '\\' + c)
}

export function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/**
 * Ricerca testuale avanzata:
 *   parole libere → nome file, note, tag
 *   tag:mare  ext:jpg  year:2023  camera:canon  folder:Viaggi  is:fav  is:video  rating:>=4
 */
export function applySearch(search: string, where: string[], params: unknown[]): void {
  const tokens = search.match(/(\w+:"[^"]*"|\w+:\S+|"[^"]*"|\S+)/g) ?? []
  for (const raw of tokens) {
    const m = raw.match(/^(\w+):(.*)$/)
    const key = m ? m[1].toLowerCase() : ''
    const val = (m ? m[2] : raw).replace(/^"|"$/g, '')
    if (!val) continue
    switch (key) {
      case 'tag':
        where.push(`EXISTS (SELECT 1 FROM media_tags mt JOIN tags t ON t.id = mt.tag_id WHERE mt.media_id = m.id AND t.name LIKE ? ESCAPE '\\')`)
        params.push(`%${likePrefix(val)}%`)
        break
      case 'ext':
        where.push(`m.extension = ?`)
        params.push(val.toLowerCase().replace(/^\./, ''))
        break
      case 'year':
        where.push(`strftime('%Y', m.effective_date/1000, 'unixepoch') = ?`)
        params.push(val)
        break
      case 'camera':
        where.push(`(COALESCE(m.camera_make,'') || ' ' || COALESCE(m.camera_model,'')) LIKE ? ESCAPE '\\'`)
        params.push(`%${likePrefix(val)}%`)
        break
      case 'folder':
        where.push(`m.folder_path_relative LIKE ? ESCAPE '\\'`)
        params.push(`%${likePrefix(val)}%`)
        break
      case 'rating': {
        const rm = val.match(/^(>=|<=|>|<|=)?(\d)$/)
        if (rm) { where.push(`m.rating ${rm[1] ?? '='} ?`); params.push(Number(rm[2])) }
        break
      }
      case 'is': {
        const v = val.toLowerCase()
        if (v === 'fav' || v === 'favorite' || v === 'preferito') where.push(`m.favorite = 1`)
        else if (['photo', 'video', 'gif', 'raw', 'foto'].includes(v)) { where.push(`m.kind = ?`); params.push(v === 'foto' ? 'photo' : v) }
        else if (['keep', 'maybe', 'trash'].includes(v)) { where.push(`m.flag = ?`); params.push(v) }
        else if (v === 'screenshot') where.push(`m.is_screenshot = 1`)
        else if (v === 'gps') where.push(`m.gps_lat IS NOT NULL`)
        break
      }
      default:
        where.push(`(m.file_name LIKE ? ESCAPE '\\' OR m.notes LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM media_tags mt JOIN tags t ON t.id = mt.tag_id WHERE mt.media_id = m.id AND t.name LIKE ? ESCAPE '\\'))`)
        {
          const like = `%${likePrefix(raw.replace(/^"|"$/g, ''))}%`
          params.push(like, like, like)
        }
    }
  }
}
