import fs from 'node:fs'
import path from 'node:path'
import type { AppContext } from './context'
import type { IpcChannel, IpcContract } from '@shared/ipc'
import type { ScanService } from './services/scanService'
import type { ThumbService } from './services/thumbService'
import { actions, undoOperation } from './services/actions'
import {
  copyFiles, createFolder, emptyTrash, moveFiles, renameFiles, renameTemplatePreview, restoreFromTrash, trashFiles
} from './services/fileOps'
import { backupDatabase } from './db/database'
import { sha256File } from './services/metadata'
import { chunks } from './db/mediaRepo'

type Async<F> = F extends (...a: infer A) => infer R ? (...a: A) => R | Promise<R> : never
export type ActionHandlers = { [C in IpcChannel]?: Async<IpcContract[C]> }

/** Handler IPC indipendenti da Electron (dialog/shell vengono aggiunti in index.ts). */
export function createHandlers(s: { ctx: AppContext; scan: ScanService; thumbs: ThumbService }): ActionHandlers {
  const { ctx, scan, thumbs } = s
  const changed = (reason: string, ids?: number[]) => ctx.emit('library:changed', { reason, ids })
  const opsChanged = () => ctx.emit('operations:changed', {})

  return {
    'settings.get': () => ctx.settings.getAll(),
    'settings.set': (patch) => ctx.settings.set(patch),

    'library.scan': (opts) => scan.start(opts ?? {}),
    'library.cancelScan': () => scan.cancel(),
    'library.scanStatus': () => scan.status(),
    'library.scanErrors': () => scan.errorList(),
    'library.query': (q) => {
      const st = ctx.settings.getAll()
      return ctx.media.query(q, { largeThresholdBytes: st.largeFileThresholdMB * 1024 * 1024 })
    },
    'library.stats': () => ({ ...ctx.media.stats(), thumbsPending: ctx.media.thumbCounts().pending }),
    'library.folders': () => ctx.media.folders(),
    'library.duplicates': async (opts) => {
      const verified = new Map<string, string>()
      if (opts?.verify) {
        const cands = ctx.media.duplicateCandidates()
        const ids = cands.flatMap((c) => c.ids)
        for (const group of chunks(ids, 2)) {
          await Promise.all(group.map(async (id) => {
            const row = ctx.media.getRow(id)
            if (!row) return
            let sha = row.hash_sha256 as string | null
            if (!sha) {
              try { sha = await sha256File(ctx.vault.toAbs(row.file_path_relative)); ctx.media.setSha(id, sha) } catch { return }
            }
            verified.set(String(id), sha)
          }))
        }
      }
      return ctx.media.duplicates(verified)
    },
    'library.rebuildIndex': () => ({ started: scan.start({ full: true }).started }),

    'media.details': (id) => ctx.media.details(id, (rel) => ctx.vault.toAbs(rel)),
    'media.rate': (ids, r) => actions.rate(ctx, ids, r),
    'media.flag': (ids, f) => actions.flag(ctx, ids, f),
    'media.favorite': (ids, v) => actions.favorite(ctx, ids, v),
    'media.color': (ids, c) => actions.color(ctx, ids, c),
    'media.notes': (id, n) => actions.notes(ctx, id, n),
    'media.archive': (ids, v) => actions.archive(ctx, ids, v),

    'tags.list': () => ctx.tags.list(),
    'tags.add': (ids, names) => actions.tagsAdd(ctx, ids, names),
    'tags.remove': (ids, tagId) => actions.tagsRemove(ctx, ids, tagId),
    'tags.rename': (tagId, name) => actions.tagsRename(ctx, tagId, name),
    'tags.delete': (tagId) => actions.tagsDelete(ctx, tagId),

    'albums.list': () => ctx.albums.list(),
    'albums.create': (name, ids) => actions.albumCreate(ctx, name, ids),
    'albums.rename': (id, name) => actions.albumRename(ctx, id, name),
    'albums.delete': (id) => actions.albumDelete(ctx, id),
    'albums.addItems': (id, ids) => actions.albumAdd(ctx, id, ids),
    'albums.removeItems': (id, ids) => actions.albumRemove(ctx, id, ids),

    'files.move': async (ids, dest) => { const r = await moveFiles(ctx, ids, dest); changed('files.move', ids); opsChanged(); return r },
    'files.copy': async (ids, dest) => { const r = await copyFiles(ctx, ids, dest); changed('files.copy'); opsChanged(); thumbs.kick(); return r },
    'files.rename': (items) => { const r = renameFiles(ctx, items); changed('files.rename', items.map((i) => i.id)); opsChanged(); return r },
    'files.renameTemplate': (ids, tpl) => ({ preview: renameTemplatePreview(ctx, ids, tpl) }),
    'files.createFolder': (parent, name) => { const r = createFolder(ctx, parent, name); changed('folders'); return r },
    'files.trash': async (ids, opts) => { const r = await trashFiles(ctx, ids, opts); changed('files.trash', ids); opsChanged(); return r },
    'files.trashFlagged': async ({ dryRun }) => {
      const rows = ctx.db.prepare(`SELECT id, size_bytes s, favorite f FROM media WHERE flag = 'trash' AND status NOT IN ('trashed')`).all() as { id: number; s: number; f: number }[]
      const ids = rows.map((r) => r.id)
      const bytes = rows.reduce((a, r) => a + r.s, 0)
      if (dryRun) {
        const fav = rows.filter((r) => r.f).length
        return { ok: true, affected: ids.length, errors: [], ids, bytes, message: fav ? `${fav} preferiti verranno saltati (protetti)` : undefined }
      }
      const r = await trashFiles(ctx, ids)
      changed('files.trash', ids)
      opsChanged()
      return { ...r, ids, bytes }
    },

    'trash.list': () => ctx.trash.list(),
    'trash.restore': (trashIds) => { const r = restoreFromTrash(ctx, trashIds); changed('trash.restore'); opsChanged(); return r },
    'trash.empty': (opts) => {
      const r = emptyTrash(ctx, opts, (mediaId) => thumbs.invalidate(mediaId))
      changed('trash.empty')
      opsChanged()
      return r
    },

    'operations.list': (limit) => ctx.ops.list(limit ?? 100),
    'operations.undo': (id) => undoOperation(ctx, id),

    'thumbs.prioritize': (ids) => thumbs.prioritize(ids),
    'thumbs.status': () => thumbs.status(),

    'maintenance.backupDb': async () => {
      try { return { ok: true, path: ctx.vault.toRel(await backupDatabase(ctx.db, ctx.vault.backupsDir)) } } catch (e) { return { ok: false, message: (e as Error).message } }
    },
    'maintenance.clearCache': () => {
      // Solo file generati dall'app, riconosciuti dal nome (<4 cifre>/<id>.webp|jpg): mai altro
      let removed = 0
      const isRealDir = (p: string) => { try { const st = fs.lstatSync(p); return st.isDirectory() && !st.isSymbolicLink() } catch { return false } }
      const cacheRoot = ctx.vault.cacheDir
      if (isRealDir(cacheRoot)) {
        for (const dir of [ctx.vault.thumbsDir, ctx.vault.previewsDir]) {
          if (!isRealDir(dir)) continue
          for (const bucket of fs.readdirSync(dir)) {
            const bdir = path.join(dir, bucket)
            if (!/^\d{4}$/.test(bucket) || !isRealDir(bdir)) continue
            for (const f of fs.readdirSync(bdir)) {
              if (!/^\d+\.(webp|jpg)(\.tmp)?$/.test(f)) continue
              const fp = path.join(bdir, f)
              try { if (fs.lstatSync(fp).isFile()) { fs.rmSync(fp); removed++ } } catch { /* ignora */ }
            }
            try { if (fs.readdirSync(bdir).length === 0) fs.rmdirSync(bdir) } catch { /* ignora */ }
          }
        }
      }
      ctx.media.resetAllThumbs()
      ctx.log.op({ op: 'maintenance.clearCache', removed })
      thumbs.kick()
      changed('cache')
      return { ok: true, removed }
    }
  }
}
