import type { DB } from './database'
import type { Album, AppSettings, Tag } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'

export class TagRepo {
  constructor(private db: DB) {}

  list(): Tag[] {
    return this.db
      .prepare(`SELECT t.id, t.name, t.color, (SELECT COUNT(*) FROM media_tags mt JOIN media m ON m.id = mt.media_id
        WHERE mt.tag_id = t.id AND m.status NOT IN ('trashed','missing')) count FROM tags t ORDER BY t.name COLLATE NOCASE`)
      .all() as Tag[]
  }

  ensure(name: string): number {
    const clean = name.trim().replace(/\s+/g, ' ').slice(0, 80)
    if (!clean) throw new Error('Nome tag vuoto')
    const ex = this.db.prepare(`SELECT id FROM tags WHERE name = ? COLLATE NOCASE`).get(clean) as { id: number } | undefined
    if (ex) return ex.id
    return Number(this.db.prepare(`INSERT INTO tags (name) VALUES (?)`).run(clean).lastInsertRowid)
  }

  /** Aggiunge i tag; restituisce le coppie realmente inserite (per undo). */
  add(mediaIds: number[], names: string[]): { mediaId: number; tagId: number }[] {
    const ins = this.db.prepare(`INSERT OR IGNORE INTO media_tags (media_id, tag_id) VALUES (?, ?)`)
    const added: { mediaId: number; tagId: number }[] = []
    this.db.transaction(() => {
      const tagIds = names.map((n) => this.ensure(n))
      for (const m of mediaIds) for (const t of tagIds) if (ins.run(m, t).changes) added.push({ mediaId: m, tagId: t })
    })()
    return added
  }

  remove(mediaIds: number[], tagId: number): { mediaId: number; tagId: number }[] {
    const del = this.db.prepare(`DELETE FROM media_tags WHERE media_id = ? AND tag_id = ?`)
    const removed: { mediaId: number; tagId: number }[] = []
    this.db.transaction(() => {
      for (const m of mediaIds) if (del.run(m, tagId).changes) removed.push({ mediaId: m, tagId })
    })()
    return removed
  }

  removePairs(pairs: { mediaId: number; tagId: number }[]): void {
    const del = this.db.prepare(`DELETE FROM media_tags WHERE media_id = ? AND tag_id = ?`)
    this.db.transaction(() => { for (const p of pairs) del.run(p.mediaId, p.tagId) })()
  }

  addPairs(pairs: { mediaId: number; tagId: number }[]): void {
    const ins = this.db.prepare(`INSERT OR IGNORE INTO media_tags (media_id, tag_id) VALUES (?, ?)`)
    this.db.transaction(() => { for (const p of pairs) ins.run(p.mediaId, p.tagId) })()
  }

  rename(tagId: number, name: string): string {
    const prev = (this.db.prepare(`SELECT name FROM tags WHERE id = ?`).get(tagId) as { name: string } | undefined)?.name
    if (prev === undefined) throw new Error('Tag inesistente')
    this.db.prepare(`UPDATE tags SET name = ? WHERE id = ?`).run(name.trim(), tagId)
    return prev
  }

  /** Elimina un tag e restituisce ciò che serve per ricrearlo. */
  delete(tagId: number): { tag: { id: number; name: string; color: string | null }; mediaIds: number[] } | null {
    const tag = this.db.prepare(`SELECT id, name, color FROM tags WHERE id = ?`).get(tagId) as { id: number; name: string; color: string | null } | undefined
    if (!tag) return null
    const mediaIds = (this.db.prepare(`SELECT media_id m FROM media_tags WHERE tag_id = ?`).all(tagId) as { m: number }[]).map((r) => r.m)
    this.db.prepare(`DELETE FROM tags WHERE id = ?`).run(tagId)
    return { tag, mediaIds }
  }

  recreate(tag: { id: number; name: string; color: string | null }, mediaIds: number[]): void {
    this.db.transaction(() => {
      this.db.prepare(`INSERT OR IGNORE INTO tags (id, name, color) VALUES (?, ?, ?)`).run(tag.id, tag.name, tag.color)
      const ins = this.db.prepare(`INSERT OR IGNORE INTO media_tags (media_id, tag_id) VALUES (?, ?)`)
      for (const m of mediaIds) ins.run(m, tag.id)
    })()
  }
}

export class AlbumRepo {
  constructor(private db: DB) {}

  list(): Album[] {
    return this.db
      .prepare(`SELECT a.id, a.name, a.type, a.query, a.created_at createdAt,
          COALESCE(a.cover_media_id, (SELECT ai.media_id FROM album_items ai JOIN media m ON m.id = ai.media_id
            WHERE ai.album_id = a.id AND m.status = 'ok' ORDER BY ai.position LIMIT 1)) coverMediaId,
          (SELECT COUNT(*) FROM album_items ai JOIN media m ON m.id = ai.media_id WHERE ai.album_id = a.id AND m.status NOT IN ('trashed','missing')) count
        FROM albums a ORDER BY a.name COLLATE NOCASE`)
      .all() as Album[]
  }

  get(id: number): Album | undefined {
    return this.db.prepare(`SELECT id, name, type, query, cover_media_id coverMediaId, created_at createdAt FROM albums WHERE id = ?`).get(id) as Album | undefined
  }

  create(name: string, id?: number): Album {
    const clean = name.trim().slice(0, 120) || 'Nuovo album'
    const now = Date.now()
    const info = id
      ? this.db.prepare(`INSERT INTO albums (id, name, type, created_at) VALUES (?, ?, 'manual', ?)`).run(id, clean, now)
      : this.db.prepare(`INSERT INTO albums (name, type, created_at) VALUES (?, 'manual', ?)`).run(clean, now)
    return this.get(Number(info.lastInsertRowid))!
  }

  rename(id: number, name: string): string {
    const a = this.get(id)
    if (!a) throw new Error('Album inesistente')
    this.db.prepare(`UPDATE albums SET name = ? WHERE id = ?`).run(name.trim(), id)
    return a.name
  }

  delete(id: number): { album: Album; items: { mediaId: number; position: number }[] } | null {
    const album = this.get(id)
    if (!album) return null
    const items = this.db.prepare(`SELECT media_id mediaId, position FROM album_items WHERE album_id = ?`).all(id) as { mediaId: number; position: number }[]
    this.db.prepare(`DELETE FROM albums WHERE id = ?`).run(id)
    return { album, items }
  }

  restore(album: Album, items: { mediaId: number; position: number }[]): void {
    this.db.transaction(() => {
      this.db.prepare(`INSERT OR IGNORE INTO albums (id, name, type, query, cover_media_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(album.id, album.name, album.type, album.query, album.coverMediaId, album.createdAt)
      const ins = this.db.prepare(`INSERT OR IGNORE INTO album_items (album_id, media_id, position) VALUES (?, ?, ?)`)
      for (const it of items) ins.run(album.id, it.mediaId, it.position)
    })()
  }

  addItems(albumId: number, mediaIds: number[]): number[] {
    if (!this.get(albumId)) throw new Error('Album inesistente')
    const maxPos = (this.db.prepare(`SELECT COALESCE(MAX(position), -1) p FROM album_items WHERE album_id = ?`).get(albumId) as { p: number }).p
    const ins = this.db.prepare(`INSERT OR IGNORE INTO album_items (album_id, media_id, position) VALUES (?, ?, ?)`)
    const added: number[] = []
    let pos = maxPos + 1
    this.db.transaction(() => {
      for (const m of mediaIds) if (ins.run(albumId, m, pos).changes) { added.push(m); pos++ }
    })()
    return added
  }

  removeItems(albumId: number, mediaIds: number[]): { mediaId: number; position: number }[] {
    const get = this.db.prepare(`SELECT position FROM album_items WHERE album_id = ? AND media_id = ?`)
    const del = this.db.prepare(`DELETE FROM album_items WHERE album_id = ? AND media_id = ?`)
    const removed: { mediaId: number; position: number }[] = []
    this.db.transaction(() => {
      for (const m of mediaIds) {
        const r = get.get(albumId, m) as { position: number } | undefined
        if (r && del.run(albumId, m).changes) removed.push({ mediaId: m, position: r.position })
      }
    })()
    return removed
  }

  restoreItems(albumId: number, items: { mediaId: number; position: number }[]): void {
    const ins = this.db.prepare(`INSERT OR IGNORE INTO album_items (album_id, media_id, position) VALUES (?, ?, ?)`)
    this.db.transaction(() => { for (const it of items) ins.run(albumId, it.mediaId, it.position) })()
  }
}

export class SettingsRepo {
  constructor(private db: DB) {}

  getAll(): AppSettings {
    const rows = this.db.prepare(`SELECT key, value FROM settings`).all() as { key: string; value: string }[]
    const out: Record<string, unknown> = { ...DEFAULT_SETTINGS }
    for (const r of rows) {
      if (!(r.key in DEFAULT_SETTINGS)) continue
      try { out[r.key] = JSON.parse(r.value) } catch { /* valore non valido: default */ }
    }
    return out as unknown as AppSettings
  }

  set(patch: Partial<AppSettings>): AppSettings {
    const st = this.db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    this.db.transaction(() => {
      for (const [k, v] of Object.entries(patch)) {
        if (!(k in DEFAULT_SETTINGS) || v === undefined) continue
        st.run(k, JSON.stringify(v))
      }
    })()
    return this.getAll()
  }
}
