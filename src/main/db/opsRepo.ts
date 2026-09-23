import type { DB } from './database'
import type { OperationRecord, TrashEntry } from '@shared/types'

export interface OperationRow {
  id: number
  type: string
  label: string
  payload_json: string
  status: OperationRecord['status']
  created_at: number
  undo_data_json: string | null
  item_count: number
}

/** Tipi di operazione annullabili. */
export const UNDOABLE = new Set([
  'media.rate', 'media.flag', 'media.favorite', 'media.color', 'media.notes', 'media.archive',
  'tags.add', 'tags.remove', 'tags.rename', 'tags.delete',
  'albums.create', 'albums.rename', 'albums.delete', 'albums.addItems', 'albums.removeItems',
  'files.move', 'files.rename', 'files.copy', 'files.trash', 'trash.restore'
])

export class OperationsRepo {
  constructor(private db: DB) {}

  record(type: string, label: string, payload: unknown, undo: unknown, count: number, status: OperationRecord['status'] = 'done'): number {
    const info = this.db
      .prepare(`INSERT INTO operations (type, label, payload_json, status, created_at, undo_data_json, item_count) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(type, label, JSON.stringify(payload ?? {}), status, Date.now(), undo === undefined ? null : JSON.stringify(undo), count)
    return Number(info.lastInsertRowid)
  }

  get(id: number): OperationRow | undefined {
    return this.db.prepare(`SELECT * FROM operations WHERE id = ?`).get(id) as OperationRow | undefined
  }

  /** Ultima operazione annullabile ancora 'done'/'partial'. */
  latestUndoable(): OperationRow | undefined {
    const types = [...UNDOABLE]
    return this.db
      .prepare(`SELECT * FROM operations WHERE status IN ('done','partial') AND undo_data_json IS NOT NULL
        AND type IN (${types.map(() => '?').join(',')}) ORDER BY id DESC LIMIT 1`)
      .get(...types) as OperationRow | undefined
  }

  setStatus(id: number, status: OperationRecord['status']): void {
    this.db.prepare(`UPDATE operations SET status = ? WHERE id = ?`).run(status, id)
  }

  list(limit = 100): OperationRecord[] {
    const rows = this.db.prepare(`SELECT * FROM operations ORDER BY id DESC LIMIT ?`).all(limit) as OperationRow[]
    return rows.map(toRecord)
  }
}

export function toRecord(r: OperationRow): OperationRecord {
  return {
    id: r.id,
    type: r.type,
    label: r.label,
    status: r.status,
    createdAt: r.created_at,
    count: r.item_count,
    undoable: UNDOABLE.has(r.type) && r.undo_data_json !== null && (r.status === 'done' || r.status === 'partial')
  }
}

export class TrashRepo {
  constructor(private db: DB) {}

  add(mediaId: number, originalPath: string, trashPath: string, restoreInfo: unknown): number {
    return Number(
      this.db
        .prepare(`INSERT INTO trash_items (media_id, original_path, trash_path, deleted_at, restore_info_json) VALUES (?, ?, ?, ?, ?)`)
        .run(mediaId, originalPath, trashPath, Date.now(), JSON.stringify(restoreInfo ?? {})).lastInsertRowid
    )
  }

  list(): TrashEntry[] {
    return this.db
      .prepare(`SELECT ti.id, ti.media_id mediaId, ti.original_path originalPath, ti.trash_path trashPath, ti.deleted_at deletedAt,
          COALESCE(m.file_name, '') fileName, COALESCE(m.size_bytes, 0) sizeBytes, COALESCE(m.kind, 'unsupported') kind
        FROM trash_items ti LEFT JOIN media m ON m.id = ti.media_id WHERE ti.purged_at IS NULL ORDER BY ti.deleted_at DESC`)
      .all() as TrashEntry[]
  }

  get(id: number): (TrashEntry & { purgedAt: number | null }) | undefined {
    return this.db
      .prepare(`SELECT id, media_id mediaId, original_path originalPath, trash_path trashPath, deleted_at deletedAt, purged_at purgedAt, '' fileName, 0 sizeBytes, 'unsupported' kind FROM trash_items WHERE id = ?`)
      .get(id) as never
  }

  activeForMedia(mediaId: number): { id: number; trashPath: string; originalPath: string } | undefined {
    return this.db
      .prepare(`SELECT id, trash_path trashPath, original_path originalPath FROM trash_items WHERE media_id = ? AND purged_at IS NULL ORDER BY id DESC LIMIT 1`)
      .get(mediaId) as never
  }

  remove(id: number): void {
    this.db.prepare(`DELETE FROM trash_items WHERE id = ?`).run(id)
  }

  markPurged(id: number): void {
    this.db.prepare(`UPDATE trash_items SET purged_at = ? WHERE id = ?`).run(Date.now(), id)
  }
}
