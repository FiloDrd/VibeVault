import type { AppContext } from '../context'
import type { Album, ColorLabel, Flag, OpResult } from '@shared/types'
import { toRecord } from '../db/opsRepo'
import { restoreFromTrash, trashIfUnchanged, undoMoves, undoRenames, type MoveUndo, type RenameUndo, type TrashUndo } from './fileOps'

type FieldName = 'rating' | 'flag' | 'favorite' | 'color_label' | 'archived' | 'notes'

const FLAG_LABEL: Record<Flag, string> = { none: 'Nessuno', keep: 'Tieni', maybe: 'Forse', trash: 'Scarta' }

function done(ctx: AppContext, opId: number, affected: number): OpResult {
  const rec = ctx.ops.get(opId)
  if (rec) ctx.emit('operations:changed', { latest: toRecord(rec) })
  return { ok: true, affected, errors: [], operationId: opId }
}

function setField(ctx: AppContext, type: string, label: string, ids: number[], field: FieldName, value: unknown): OpResult {
  const prev = ctx.media.setField(ids, field, value)
  const opId = ctx.ops.record(type, label, { ids: ids.length > 200 ? `${ids.length} ids` : ids, value }, { field, prev }, prev.length)
  ctx.log.op({ op: type, count: prev.length, value: field === 'notes' ? '[testo]' : value })
  ctx.emit('library:changed', { reason: type, ids })
  return done(ctx, opId, prev.length)
}

export const actions = {
  rate: (ctx: AppContext, ids: number[], rating: number) =>
    setField(ctx, 'media.rate', rating ? `Valutazione ${rating}★ su ${ids.length}` : `Valutazione rimossa da ${ids.length}`, ids, 'rating', Math.max(0, Math.min(5, Math.round(rating)))),
  flag: (ctx: AppContext, ids: number[], flag: Flag) =>
    setField(ctx, 'media.flag', `${FLAG_LABEL[flag]}: ${ids.length} elementi`, ids, 'flag', flag),
  favorite: (ctx: AppContext, ids: number[], v: boolean) =>
    setField(ctx, 'media.favorite', v ? `Aggiunti ${ids.length} ai preferiti` : `Rimossi ${ids.length} dai preferiti`, ids, 'favorite', v ? 1 : 0),
  color: (ctx: AppContext, ids: number[], c: ColorLabel) =>
    setField(ctx, 'media.color', `Etichetta colore su ${ids.length}`, ids, 'color_label', c),
  archive: (ctx: AppContext, ids: number[], v: boolean) =>
    setField(ctx, 'media.archive', v ? `Archiviati ${ids.length}` : `Tolti dall'archivio ${ids.length}`, ids, 'archived', v ? 1 : 0),
  notes: (ctx: AppContext, id: number, notes: string) =>
    setField(ctx, 'media.notes', 'Note modificate', [id], 'notes', notes.slice(0, 10000)),

  tagsAdd(ctx: AppContext, ids: number[], names: string[]): OpResult {
    const clean = names.map((n) => n.trim()).filter(Boolean)
    if (!clean.length) return { ok: false, affected: 0, errors: [{ message: 'Nessun tag' }] }
    const pairs = ctx.tags.add(ids, clean)
    const opId = ctx.ops.record('tags.add', `Tag ${clean.join(', ')} su ${ids.length}`, { names: clean }, { pairs }, pairs.length)
    ctx.emit('library:changed', { reason: 'tags', ids })
    return done(ctx, opId, pairs.length)
  },
  tagsRemove(ctx: AppContext, ids: number[], tagId: number): OpResult {
    const pairs = ctx.tags.remove(ids, tagId)
    const opId = ctx.ops.record('tags.remove', `Tag rimosso da ${pairs.length}`, { tagId }, { pairs }, pairs.length)
    ctx.emit('library:changed', { reason: 'tags', ids })
    return done(ctx, opId, pairs.length)
  },
  tagsRename(ctx: AppContext, tagId: number, name: string): OpResult {
    try {
      const prev = ctx.tags.rename(tagId, name)
      const opId = ctx.ops.record('tags.rename', `Tag "${prev}" → "${name}"`, { tagId, name }, { tagId, prev }, 1)
      ctx.emit('library:changed', { reason: 'tags' })
      return done(ctx, opId, 1)
    } catch (e) {
      return { ok: false, affected: 0, errors: [{ message: (e as Error).message }] }
    }
  },
  tagsDelete(ctx: AppContext, tagId: number): OpResult {
    const d = ctx.tags.delete(tagId)
    if (!d) return { ok: false, affected: 0, errors: [{ message: 'Tag inesistente' }] }
    const opId = ctx.ops.record('tags.delete', `Tag "${d.tag.name}" eliminato`, { tagId }, d, d.mediaIds.length)
    ctx.emit('library:changed', { reason: 'tags' })
    return done(ctx, opId, 1)
  },

  albumCreate(ctx: AppContext, name: string, mediaIds: number[] = []): Album {
    const a = ctx.albums.create(name)
    if (mediaIds.length) ctx.albums.addItems(a.id, mediaIds)
    ctx.ops.record('albums.create', `Album "${a.name}" creato`, { name }, { albumId: a.id }, mediaIds.length)
    ctx.emit('library:changed', { reason: 'albums' })
    return a
  },
  albumRename(ctx: AppContext, id: number, name: string): OpResult {
    try {
      const prev = ctx.albums.rename(id, name)
      const opId = ctx.ops.record('albums.rename', `Album "${prev}" → "${name}"`, { id, name }, { id, prev }, 1)
      ctx.emit('library:changed', { reason: 'albums' })
      return done(ctx, opId, 1)
    } catch (e) {
      return { ok: false, affected: 0, errors: [{ message: (e as Error).message }] }
    }
  },
  albumDelete(ctx: AppContext, id: number): OpResult {
    const d = ctx.albums.delete(id)
    if (!d) return { ok: false, affected: 0, errors: [{ message: 'Album inesistente' }] }
    const opId = ctx.ops.record('albums.delete', `Album "${d.album.name}" eliminato (i file restano)`, { id }, d, d.items.length)
    ctx.emit('library:changed', { reason: 'albums' })
    return done(ctx, opId, 1)
  },
  albumAdd(ctx: AppContext, id: number, mediaIds: number[]): OpResult {
    try {
      const added = ctx.albums.addItems(id, mediaIds)
      const a = ctx.albums.get(id)
      const opId = ctx.ops.record('albums.addItems', `Aggiunti ${added.length} a "${a?.name}"`, { id }, { id, added }, added.length)
      ctx.emit('library:changed', { reason: 'albums', ids: mediaIds })
      return done(ctx, opId, added.length)
    } catch (e) {
      return { ok: false, affected: 0, errors: [{ message: (e as Error).message }] }
    }
  },
  albumRemove(ctx: AppContext, id: number, mediaIds: number[]): OpResult {
    const removed = ctx.albums.removeItems(id, mediaIds)
    const a = ctx.albums.get(id)
    const opId = ctx.ops.record('albums.removeItems', `Rimossi ${removed.length} da "${a?.name}"`, { id }, { id, removed }, removed.length)
    ctx.emit('library:changed', { reason: 'albums', ids: mediaIds })
    return done(ctx, opId, removed.length)
  }
}

/** Annulla un'operazione (l'ultima annullabile se `operationId` non è indicato). */
export async function undoOperation(ctx: AppContext, operationId?: number): Promise<OpResult> {
  const op = operationId ? ctx.ops.get(operationId) : ctx.ops.latestUndoable()
  if (!op) return { ok: false, affected: 0, errors: [{ message: 'Niente da annullare' }] }
  if (op.status === 'undone') return { ok: false, affected: 0, errors: [{ message: 'Operazione già annullata' }] }
  if (!op.undo_data_json) return { ok: false, affected: 0, errors: [{ message: 'Questa operazione non è annullabile' }] }
  const u = JSON.parse(op.undo_data_json)
  let res: OpResult
  try {
    switch (op.type) {
      case 'media.rate': case 'media.flag': case 'media.favorite': case 'media.color': case 'media.archive': case 'media.notes':
        ctx.media.restoreField(u.field, u.prev)
        res = { ok: true, affected: u.prev.length, errors: [] }
        break
      case 'tags.add': ctx.tags.removePairs(u.pairs); res = { ok: true, affected: u.pairs.length, errors: [] }; break
      case 'tags.remove': ctx.tags.addPairs(u.pairs); res = { ok: true, affected: u.pairs.length, errors: [] }; break
      case 'tags.rename': ctx.tags.rename(u.tagId, u.prev); res = { ok: true, affected: 1, errors: [] }; break
      case 'tags.delete': ctx.tags.recreate(u.tag, u.mediaIds); res = { ok: true, affected: 1, errors: [] }; break
      case 'albums.create': ctx.albums.delete(u.albumId); res = { ok: true, affected: 1, errors: [] }; break
      case 'albums.rename': ctx.albums.rename(u.id, u.prev); res = { ok: true, affected: 1, errors: [] }; break
      case 'albums.delete': ctx.albums.restore(u.album, u.items); res = { ok: true, affected: 1, errors: [] }; break
      case 'albums.addItems': ctx.albums.removeItems(u.id, u.added); res = { ok: true, affected: u.added.length, errors: [] }; break
      case 'albums.removeItems': ctx.albums.restoreItems(u.id, u.removed); res = { ok: true, affected: u.removed.length, errors: [] }; break
      case 'files.move': res = undoMoves(ctx, u as MoveUndo); break
      case 'files.rename': res = undoRenames(ctx, u as RenameUndo); break
      case 'files.trash': res = restoreFromTrash(ctx, (u as TrashUndo).trashIds, false); break
      case 'files.copy': res = await trashIfUnchanged(ctx, u.created); break
      case 'trash.restore': res = await trashIfUnchanged(ctx, u.items ?? u.mediaIds ?? []); break
      default:
        return { ok: false, affected: 0, errors: [{ message: `Tipo non annullabile: ${op.type}` }] }
    }
  } catch (e) {
    return { ok: false, affected: 0, errors: [{ message: (e as Error).message }] }
  }
  // annullata del tutto → 'undone'; in parte → 'partial' (ritentabile: gli elementi già invertiti vengono saltati)
  ctx.ops.setStatus(op.id, res.errors.length === 0 ? 'undone' : res.affected > 0 ? 'partial' : op.status)
  ctx.ops.record('operations.undo', `Annullato: ${op.label}`, { operationId: op.id }, undefined, res.affected, res.errors.length ? 'partial' : 'done')
  ctx.log.op({ op: 'operations.undo', target: op.id, type: op.type, affected: res.affected, errors: res.errors.length })
  ctx.emit('library:changed', { reason: 'undo' })
  ctx.emit('operations:changed', {})
  return { ...res, message: `Annullato: ${op.label}` }
}
