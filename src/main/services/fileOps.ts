import fs from 'node:fs'
import path from 'node:path'
import type { AppContext } from '../context'
import { backupDatabase } from '../db/database'
import { relBasename, relDirname, relJoin, normalizeRel, sanitizeFileName } from '../vault'
import type { OpResult } from '@shared/types'
import { EMPTY_TRASH_CONFIRM } from '@shared/ipc'
import { extOf } from '@shared/formats'
import { SidecarIndex, sidecarNameFor } from '@shared/takeout'

// ----------------------------------------------------------------- primitive

function splitName(name: string): { base: string; ext: string } {
  const i = name.lastIndexOf('.')
  return i > 0 ? { base: name.slice(0, i), ext: name.slice(i) } : { base: name, ext: '' }
}

/** Nome libero nella cartella: "foto.jpg" → "foto (1).jpg" se occupato (su disco o nel DB). */
export function uniqueName(ctx: AppContext, dirRel: string, name: string, ignoreRel?: string): string {
  const { base, ext } = splitName(name)
  for (let i = 0; i < 10000; i++) {
    const candidate = i === 0 ? name : `${base} (${i})${ext}`
    const rel = relJoin(dirRel, candidate)
    if (ignoreRel && rel.toLowerCase() === ignoreRel.toLowerCase()) return candidate
    if (!fs.existsSync(ctx.vault.toAbs(rel)) && !ctx.media.pathExists(rel)) return candidate
  }
  throw new Error('Impossibile trovare un nome libero')
}

/** True se due percorsi indicano lo stesso file su disco (es. "a.jpg" e "A.jpg" su NTFS/exFAT/APFS). */
export function sameFile(a: string, b: string): boolean {
  try {
    const sa = fs.statSync(a, { bigint: true })
    const sb = fs.statSync(b, { bigint: true })
    if (sa.ino !== 0n && sa.ino === sb.ino && sa.dev === sb.dev) return true
    // fallback per filesystem senza inode stabili (es. exFAT): percorso reale su disco
    return fs.realpathSync.native(a) === fs.realpathSync.native(b)
  } catch {
    return false
  }
}

function fsyncFile(p: string): void {
  const fd = fs.openSync(p, 'r+')
  try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
}

/** Confronto rapido di contenuto (dimensione + primi/ultimi 64 KB). */
function quickEqual(a: string, b: string): boolean {
  const sa = fs.statSync(a).size
  if (sa !== fs.statSync(b).size) return false
  const CH = 64 * 1024
  const read = (p: string, pos: number, len: number) => {
    const fd = fs.openSync(p, 'r')
    try { const buf = Buffer.alloc(len); fs.readSync(fd, buf, 0, len, pos); return buf } finally { fs.closeSync(fd) }
  }
  const head = Math.min(CH, sa)
  if (!read(a, 0, head).equals(read(b, 0, head))) return false
  if (sa > CH) {
    const tail = Math.min(CH, sa)
    if (!read(a, sa - tail, tail).equals(read(b, sa - tail, tail))) return false
  }
  return true
}

/**
 * Copia sicura: file temporaneo accanto alla destinazione → fsync → verifica
 * contenuto → rename nel nome finale (che non deve esistere). Mai sovrascrive.
 */
function copyVerified(srcAbs: string, destAbs: string): void {
  fs.mkdirSync(path.dirname(destAbs), { recursive: true })
  const tmp = `${destAbs}.vv-partial-${process.pid}-${Date.now()}`
  try {
    fs.copyFileSync(srcAbs, tmp, fs.constants.COPYFILE_EXCL)
    fsyncFile(tmp)
    if (!quickEqual(srcAbs, tmp)) throw new Error('Verifica copia fallita: contenuto diverso')
    if (fs.existsSync(destAbs)) throw new Error('Esiste già un file con questo nome nella destinazione')
    fs.renameSync(tmp, destAbs)
  } catch (e) {
    // rimuove solo il proprio file temporaneo parziale
    try { if (fs.existsSync(tmp)) fs.rmSync(tmp) } catch { /* ignora */ }
    throw e
  }
  try {
    const st = fs.statSync(srcAbs)
    fs.utimesSync(destAbs, st.atime, st.mtime)
  } catch { /* data di modifica: best effort */ }
}

/**
 * Sposta un file senza mai sovrascrivere.
 *   - stesso volume: rename atomico
 *   - solo maiuscole/minuscole diverse sullo STESSO file (FS case-insensitive): via nome temporaneo, con rollback
 *   - volumi diversi (EXDEV): copia verificata + fsync, poi rimozione della sorgente
 */
export function safeMove(srcAbs: string, destAbs: string): void {
  if (!fs.existsSync(srcAbs)) throw new Error('File sorgente non trovato')
  if (srcAbs === destAbs) return
  if (fs.existsSync(destAbs)) {
    if (!sameFile(srcAbs, destAbs)) throw new Error('Esiste già un file con questo nome nella destinazione')
    // stesso file, cambia solo il case: il nome temporaneo mantiene l'estensione media
    const ext = path.extname(srcAbs)
    const tmp = path.join(path.dirname(srcAbs), `${path.basename(srcAbs, ext)}.vv-rename-${Date.now()}${ext}`)
    fs.renameSync(srcAbs, tmp)
    try {
      fs.renameSync(tmp, destAbs)
    } catch (e) {
      try { fs.renameSync(tmp, srcAbs) } catch { /* resta come .vv-rename-*: la scansione lo riconcilia per hash */ }
      throw e
    }
    return
  }
  fs.mkdirSync(path.dirname(destAbs), { recursive: true })
  try {
    fs.renameSync(srcAbs, destAbs)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e
    copyVerified(srcAbs, destAbs)
    fs.rmSync(srcAbs)
  }
}

/** Copia esclusiva verificata, mantiene la data di modifica. */
export function safeCopy(srcAbs: string, destAbs: string): void {
  if (!fs.existsSync(srcAbs)) throw new Error('File sorgente non trovato')
  if (fs.existsSync(destAbs)) throw new Error('Esiste già un file con questo nome nella destinazione')
  copyVerified(srcAbs, destAbs)
}

// ----------------------------------------------------------------- JSON di Google Takeout

type DirCache = Map<string, string[]>

function jsonsIn(dir: string, cache?: DirCache): string[] {
  const hit = cache?.get(dir)
  if (hit) return hit
  let names: string[] = []
  try { names = fs.readdirSync(dir).filter((n) => /\.json$/i.test(n)) } catch { names = [] }
  cache?.set(dir, names)
  return names
}

/** Il JSON di Takeout che appartiene a questo file (non quello dell'originale di una copia "-edited"). */
function ownSidecar(mediaAbs: string, cache?: DirCache): string | null {
  const names = jsonsIn(path.dirname(mediaAbs), cache)
  if (!names.length) return null
  const hit = new SidecarIndex(names).find(path.basename(mediaAbs))
  return hit && hit.direct && hit.names.length === 1 ? path.join(path.dirname(mediaAbs), hit.names[0]) : null
}

/** Porta con sé il JSON di Takeout quando un file viene spostato o rinominato (best effort, mai sovrascrive). */
function moveSidecar(srcAbs: string, destAbs: string, cache?: DirCache): void {
  try {
    const sc = ownSidecar(srcAbs, cache)
    if (!sc || !fs.existsSync(sc)) return
    const dest = path.join(path.dirname(destAbs), sidecarNameFor(path.basename(sc), path.basename(srcAbs), path.basename(destAbs)))
    if (fs.existsSync(dest)) return
    safeMove(sc, dest)
    cache?.delete(path.dirname(srcAbs))
    cache?.delete(path.dirname(destAbs))
  } catch { /* il JSON non è indispensabile: i suoi dati sono già nel database */ }
}

function result(ctx: AppContext, affected: number, errors: OpResult['errors'], operationId?: number, message?: string): OpResult {
  if (operationId !== undefined) ctx.ops.setStatus(operationId, affected === 0 && errors.length ? 'failed' : errors.length ? 'partial' : 'done')
  return { ok: errors.length === 0, affected, errors, operationId, message }
}

async function maybeBackup(ctx: AppContext, count: number, label: string): Promise<void> {
  if (count < 50 || !ctx.settings.getAll().backupBeforeBatch) return
  try { await backupDatabase(ctx.db, ctx.vault.backupsDir, 10, label) } catch (e) { ctx.log.error('backup.failed', { message: (e as Error).message }) }
}

// ----------------------------------------------------------------- move / copy

export interface MoveUndo { moves: { id: number; from: string; to: string }[] }

export async function moveFiles(ctx: AppContext, ids: number[], destFolderRel: string): Promise<OpResult> {
  const dest = normalizeRel(destFolderRel)
  if (ctx.vault.isReserved(dest)) return { ok: false, affected: 0, errors: [{ message: 'Destinazione non consentita (cartella di sistema del vault)' }] }
  await maybeBackup(ctx, ids.length, 'before-move')
  const errors: OpResult['errors'] = []
  const moves: MoveUndo['moves'] = []
  const dirs: DirCache = new Map()
  for (const row of ctx.media.getRows(ids)) {
    if (row.status === 'trashed') { errors.push({ id: row.id, message: 'Il file è nel cestino' }); continue }
    if (row.folder_path_relative === dest) continue
    try {
      const name = uniqueName(ctx, dest, row.file_name)
      const to = relJoin(dest, name)
      const srcAbs = ctx.vault.toAbs(row.file_path_relative)
      safeMove(srcAbs, ctx.vault.toAbs(to))
      try {
        ctx.media.updatePath(row.id, to, dest, name)
      } catch (dbErr) {
        safeMove(ctx.vault.toAbs(to), srcAbs) // rollback del file se il DB fallisce
        throw dbErr
      }
      moveSidecar(srcAbs, ctx.vault.toAbs(to), dirs)
      moves.push({ id: row.id, from: row.file_path_relative, to })
    } catch (e) {
      errors.push({ id: row.id, path: row.file_path_relative, message: (e as Error).message })
    }
  }
  ctx.media.rebuildFolders([dest])
  const opId = ctx.ops.record('files.move', `Spostati ${moves.length} file in ${dest || 'root'}`, { dest, count: ids.length }, { moves } satisfies MoveUndo, moves.length)
  ctx.log.op({ op: 'files.move', dest, moved: moves.length, errors: errors.length, moves })
  return result(ctx, moves.length, errors, opId)
}

export function undoMoves(ctx: AppContext, u: MoveUndo): OpResult {
  const errors: OpResult['errors'] = []
  let n = 0
  for (const m of [...u.moves].reverse()) {
    try {
      const row = ctx.media.getRow(m.id)
      if (!row || row.file_path_relative !== m.to) throw new Error('Il file è stato modificato dopo lo spostamento')
      const dir = relDirname(m.from)
      const name = uniqueName(ctx, dir, relBasename(m.from), m.to)
      const back = relJoin(dir, name)
      safeMove(ctx.vault.toAbs(m.to), ctx.vault.toAbs(back))
      try { ctx.media.updatePath(m.id, back, dir, name) } catch (dbErr) { safeMove(ctx.vault.toAbs(back), ctx.vault.toAbs(m.to)); throw dbErr }
      moveSidecar(ctx.vault.toAbs(m.to), ctx.vault.toAbs(back))
      n++
    } catch (e) {
      errors.push({ id: m.id, path: m.to, message: (e as Error).message })
    }
  }
  ctx.media.rebuildFolders()
  return { ok: errors.length === 0, affected: n, errors }
}

export async function copyFiles(ctx: AppContext, ids: number[], destFolderRel: string): Promise<OpResult> {
  const dest = normalizeRel(destFolderRel)
  if (ctx.vault.isReserved(dest)) return { ok: false, affected: 0, errors: [{ message: 'Destinazione non consentita' }] }
  const errors: OpResult['errors'] = []
  const created: { id: number; path: string }[] = []
  for (const row of ctx.media.getRows(ids)) {
    try {
      const name = uniqueName(ctx, dest, row.file_name)
      const to = relJoin(dest, name)
      safeCopy(ctx.vault.toAbs(row.file_path_relative), ctx.vault.toAbs(to))
      let info
      try {
        info = ctx.db.prepare(`INSERT INTO media (file_path_relative, folder_path_relative, file_name, extension, mime_type, kind, size_bytes,
          created_at, modified_at, exif_date, effective_date, date_source, width, height, duration_ms, orientation, camera_make, camera_model,
          gps_lat, gps_lon, hash_quick, hash_sha256, status, is_screenshot, added_at, last_seen_scan, thumb_state, origin)
        SELECT ?, ?, ?, extension, mime_type, kind, size_bytes, created_at, modified_at, exif_date, effective_date, date_source, width, height,
          duration_ms, orientation, camera_make, camera_model, gps_lat, gps_lon, hash_quick, hash_sha256, 'ok', is_screenshot, ?, last_seen_scan, 'pending', origin
        FROM media WHERE id = ?`).run(to, dest, name, Date.now(), row.id)
      } catch (dbErr) {
        // rimuove solo la copia appena creata da questa operazione
        try { fs.rmSync(ctx.vault.toAbs(to)) } catch { /* ignora */ }
        throw dbErr
      }
      created.push({ id: Number(info.lastInsertRowid), path: to })
    } catch (e) {
      errors.push({ id: row.id, path: row.file_path_relative, message: (e as Error).message })
    }
  }
  ctx.media.rebuildFolders([dest])
  const opId = ctx.ops.record('files.copy', `Copiati ${created.length} file in ${dest || 'root'}`, { dest }, { created }, created.length)
  ctx.log.op({ op: 'files.copy', dest, copied: created.length, errors: errors.length })
  return result(ctx, created.length, errors, opId)
}

// ----------------------------------------------------------------- rename

export interface RenameUndo { renames: { id: number; from: string; to: string }[] }

export function renameFiles(ctx: AppContext, items: { id: number; newName: string }[]): OpResult {
  const errors: OpResult['errors'] = []
  const renames: RenameUndo['renames'] = []
  for (const it of items) {
    const row = ctx.media.getRow(it.id)
    if (!row) { errors.push({ id: it.id, message: 'Media non trovato' }); continue }
    if (row.status === 'trashed') { errors.push({ id: it.id, message: 'Il file è nel cestino: ripristinalo prima di rinominarlo' }); continue }
    try {
      let name = sanitizeFileName(it.newName.trim())
      // l'estensione non si cambia con la rinomina (servirebbe una conversione)
      if (extOf(name) !== row.extension) name = `${name}.${row.extension}`
      if (name === row.file_name) continue
      const dir = row.folder_path_relative as string
      const to = relJoin(dir, name)
      // il DB non deve contenere un altro media con lo stesso nome (anche solo per maiuscole);
      // il disco viene verificato da safeMove, che distingue "stesso file" da "file diverso"
      if (ctx.media.pathExists(to, row.id)) throw new Error(`"${name}" esiste già in questa cartella`)
      const srcAbs = ctx.vault.toAbs(row.file_path_relative)
      const destAbs = ctx.vault.toAbs(to)
      if (fs.existsSync(destAbs) && !sameFile(srcAbs, destAbs)) throw new Error(`"${name}" esiste già in questa cartella`)
      safeMove(srcAbs, destAbs)
      try { ctx.media.updatePath(row.id, to, dir, name) } catch (dbErr) { safeMove(destAbs, srcAbs); throw dbErr }
      moveSidecar(srcAbs, destAbs)
      renames.push({ id: row.id, from: row.file_path_relative, to })
    } catch (e) {
      errors.push({ id: it.id, path: row.file_path_relative, message: (e as Error).message })
    }
  }
  const opId = ctx.ops.record('files.rename', renames.length === 1 ? `Rinominato ${relBasename(renames[0].from)}` : `Rinominati ${renames.length} file`, {}, { renames } satisfies RenameUndo, renames.length)
  ctx.log.op({ op: 'files.rename', renames })
  return result(ctx, renames.length, errors, opId)
}

export function undoRenames(ctx: AppContext, u: RenameUndo): OpResult {
  const errors: OpResult['errors'] = []
  let n = 0
  for (const r of [...u.renames].reverse()) {
    try {
      const row = ctx.media.getRow(r.id)
      if (!row || row.file_path_relative !== r.to) throw new Error('Il file è stato modificato dopo la rinomina')
      const cur = ctx.vault.toAbs(r.to)
      const orig = ctx.vault.toAbs(r.from)
      if ((fs.existsSync(orig) && !sameFile(cur, orig)) || ctx.media.pathExists(r.from, r.id)) throw new Error('Il nome originale è ora occupato')
      safeMove(cur, orig)
      try { ctx.media.updatePath(r.id, r.from, relDirname(r.from), relBasename(r.from)) } catch (dbErr) { safeMove(orig, cur); throw dbErr }
      moveSidecar(cur, orig)
      n++
    } catch (e) {
      errors.push({ id: r.id, message: (e as Error).message })
    }
  }
  return { ok: errors.length === 0, affected: n, errors }
}

/** Anteprima rinomina con template: {name} {n} {nn} {nnn} {YYYY} {MM} {DD} {hh} {mm} {ss} {ext} */
export function renameTemplatePreview(ctx: AppContext, ids: number[], template: string): { id: number; from: string; to: string }[] {
  const rows = ctx.media.getRows(ids)
  const order = new Map(ids.map((id, i) => [id, i]))
  rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!)
  return rows.map((row, i) => {
    const d = new Date(row.effective_date || row.modified_at || Date.now())
    const p2 = (x: number) => String(x).padStart(2, '0')
    const base = splitName(row.file_name).base
    const out = template
      .replace(/\{name\}/g, base)
      .replace(/\{nnnn\}/g, String(i + 1).padStart(4, '0'))
      .replace(/\{nnn\}/g, String(i + 1).padStart(3, '0'))
      .replace(/\{nn\}/g, String(i + 1).padStart(2, '0'))
      .replace(/\{n\}/g, String(i + 1))
      .replace(/\{YYYY\}/g, String(d.getFullYear()))
      .replace(/\{MM\}/g, p2(d.getMonth() + 1))
      .replace(/\{DD\}/g, p2(d.getDate()))
      .replace(/\{hh\}/g, p2(d.getHours()))
      .replace(/\{mm\}/g, p2(d.getMinutes()))
      .replace(/\{ss\}/g, p2(d.getSeconds()))
      .replace(/\{ext\}/g, row.extension)
    return { id: row.id, from: row.file_name, to: `${sanitizeFileName(out)}.${row.extension}` }
  })
}

export function createFolder(ctx: AppContext, parentRel: string, name: string): { ok: boolean; path?: string; message?: string } {
  try {
    const clean = sanitizeFileName(name.trim())
    if (clean.startsWith('.')) return { ok: false, message: 'Il nome non può iniziare con un punto (le cartelle nascoste non vengono lette)' }
    const rel = relJoin(normalizeRel(parentRel), clean)
    if (!rel || ctx.vault.isReserved(rel)) return { ok: false, message: 'Nome o posizione non consentiti' }
    const abs = ctx.vault.toAbs(rel)
    if (fs.existsSync(abs)) return { ok: false, message: 'Esiste già una cartella con questo nome' }
    fs.mkdirSync(abs, { recursive: true })
    ctx.media.rebuildFolders([rel])
    ctx.log.op({ op: 'files.createFolder', path: rel })
    return { ok: true, path: rel }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

// ----------------------------------------------------------------- trash

export interface TrashUndo { trashIds: number[] }

/** Per l'undo: cestina solo gli id il cui percorso è ancora quello registrato. */
export async function trashIfUnchanged(ctx: AppContext, items: ({ id: number; path: string } | number)[]): Promise<OpResult> {
  const ok: number[] = []
  const errors: OpResult['errors'] = []
  for (const it of items) {
    if (typeof it === 'number') { errors.push({ id: it, message: 'Dati di annullamento obsoleti: operazione saltata per sicurezza' }); continue }
    const row = ctx.media.getRow(it.id)
    if (!row || row.file_path_relative !== it.path || row.status === 'trashed') { errors.push({ id: it.id, path: it.path, message: 'Il file è cambiato dopo l\'operazione: saltato' }); continue }
    ok.push(it.id)
  }
  const r = ok.length ? await trashFiles(ctx, ok, { allowFavorites: true, record: false }) : { ok: true, affected: 0, errors: [] }
  return { ...r, ok: r.ok && errors.length === 0, errors: [...r.errors, ...errors] }
}

export async function trashFiles(ctx: AppContext, ids: number[], opts: { allowFavorites?: boolean; record?: boolean } = {}): Promise<OpResult> {
  await maybeBackup(ctx, ids.length, 'before-trash')
  const errors: OpResult['errors'] = []
  const trashIds: number[] = []
  const dirs: DirCache = new Map()
  const day = new Date().toISOString().slice(0, 10)
  for (const row of ctx.media.getRows(ids)) {
    if (row.status === 'trashed') continue
    if (row.favorite && !opts.allowFavorites) { errors.push({ id: row.id, path: row.file_path_relative, message: 'Preferito protetto: togli il preferito o conferma' }); continue }
    try {
      const srcAbs = ctx.vault.toAbs(row.file_path_relative)
      const dirRel = relJoin(ctx.vault.trashRel, day)
      const name = uniqueName(ctx, dirRel, `${row.id}__${row.file_name}`)
      const trashRel = relJoin(dirRel, name)
      let moved = false
      if (fs.existsSync(srcAbs)) {
        safeMove(srcAbs, ctx.vault.toAbs(trashRel))
        moved = true
      } else if (row.status !== 'missing') {
        throw new Error('File non trovato su disco')
      }
      try {
        const tid = ctx.db.transaction(() => {
          const id = ctx.trash.add(row.id, row.file_path_relative, trashRel, { folder: row.folder_path_relative, name: row.file_name, wasMissing: !moved })
          // il record punta ora al file nel cestino: il percorso originale resta libero
          ctx.media.updatePath(row.id, trashRel, dirRel, row.file_name)
          ctx.media.setStatus(row.id, 'trashed', Date.now())
          return id
        })()
        trashIds.push(tid)
      } catch (dbErr) {
        if (moved) safeMove(ctx.vault.toAbs(trashRel), srcAbs)
        throw dbErr
      }
      if (moved) moveSidecar(srcAbs, ctx.vault.toAbs(trashRel), dirs)
    } catch (e) {
      errors.push({ id: row.id, path: row.file_path_relative, message: (e as Error).message })
    }
  }
  ctx.media.rebuildFolders()
  const opId = opts.record === false
    ? undefined
    : ctx.ops.record('files.trash', `Spostati ${trashIds.length} file nel cestino`, { count: ids.length }, { trashIds } satisfies TrashUndo, trashIds.length)
  ctx.log.op({ op: 'files.trash', trashed: trashIds.length, errors: errors.length })
  return result(ctx, trashIds.length, errors, opId)
}

export function restoreFromTrash(ctx: AppContext, trashIds: number[], record = true): OpResult & { mediaIds: number[] } {
  const errors: OpResult['errors'] = []
  const mediaIds: number[] = []
  const restored: { id: number; path: string }[] = []
  for (const tid of trashIds) {
    const t = ctx.trash.get(tid)
    if (!t || t.purgedAt) { errors.push({ message: `Elemento ${tid} non presente nel cestino` }); continue }
    try {
      const dir = relDirname(t.originalPath)
      // se nel frattempo il percorso originale è stato occupato, si usa "nome (1).ext"
      const name = uniqueName(ctx, dir, relBasename(t.originalPath))
      const back = relJoin(dir, name)
      const trashAbs = ctx.vault.toAbs(t.trashPath)
      const media = t.mediaId ? ctx.media.getRow(t.mediaId) : undefined
      const restoreInfo = JSON.parse((ctx.db.prepare(`SELECT restore_info_json j FROM trash_items WHERE id = ?`).get(tid) as { j: string }).j || '{}')
      let moved = false
      if (fs.existsSync(trashAbs)) {
        safeMove(trashAbs, ctx.vault.toAbs(back))
        moved = true
      } else if (!restoreInfo.wasMissing) {
        throw new Error('File non trovato nel cestino')
      }
      try {
        ctx.db.transaction(() => {
          if (t.mediaId && media) {
            ctx.media.updatePath(t.mediaId, back, dir, name)
            ctx.media.setStatus(t.mediaId, moved ? 'ok' : 'missing', null)
            ctx.db.prepare(`UPDATE media SET flag = CASE WHEN flag = 'trash' THEN 'none' ELSE flag END WHERE id = ?`).run(t.mediaId)
          }
          ctx.trash.remove(tid)
        })()
      } catch (dbErr) {
        if (moved) safeMove(ctx.vault.toAbs(back), trashAbs)
        throw dbErr
      }
      if (moved) moveSidecar(trashAbs, ctx.vault.toAbs(back))
      if (t.mediaId && media) { mediaIds.push(t.mediaId); restored.push({ id: t.mediaId, path: back }) }
    } catch (e) {
      errors.push({ id: t.mediaId ?? undefined, path: t.originalPath, message: (e as Error).message })
    }
  }
  ctx.media.rebuildFolders()
  let opId: number | undefined
  if (record) opId = ctx.ops.record('trash.restore', `Ripristinati ${mediaIds.length} file`, {}, { items: restored }, mediaIds.length)
  ctx.log.op({ op: 'trash.restore', restored: mediaIds.length, errors: errors.length })
  return { ...result(ctx, mediaIds.length, errors, opId), mediaIds }
}

/** Eliminazione DEFINITIVA: solo dal cestino e solo con token di conferma. */
export function emptyTrash(ctx: AppContext, opts: { trashIds?: number[]; confirmToken: string }, onPurged: (mediaId: number) => void): OpResult {
  if (opts.confirmToken !== EMPTY_TRASH_CONFIRM) return { ok: false, affected: 0, errors: [{ message: 'Conferma mancante: eliminazione annullata' }] }
  const list = ctx.trash.list().filter((t) => !opts.trashIds || opts.trashIds.includes(t.id))
  const errors: OpResult['errors'] = []
  let n = 0
  let bytes = 0
  for (const t of list) {
    try {
      if (!t.trashPath.startsWith(ctx.vault.trashRel + '/')) throw new Error('Percorso fuori dal cestino: rifiutato')
      const abs = ctx.vault.toAbs(t.trashPath)
      const sc = ownSidecar(abs)
      if (fs.existsSync(abs)) fs.rmSync(abs)
      // il JSON di Takeout finito nel cestino insieme alla foto (solo dentro il cestino)
      if (sc && ctx.vault.toRel(sc).startsWith(ctx.vault.trashRel + '/')) { try { fs.rmSync(sc) } catch { /* ignora */ } }
      ctx.trash.markPurged(t.id)
      if (t.mediaId) {
        onPurged(t.mediaId)
        ctx.db.prepare(`DELETE FROM media WHERE id = ? AND status = 'trashed'`).run(t.mediaId)
      }
      bytes += t.sizeBytes
      n++
    } catch (e) {
      errors.push({ path: t.originalPath, message: (e as Error).message })
    }
  }
  ctx.ops.record('trash.empty', `Eliminati definitivamente ${n} file`, { bytes }, undefined, n, errors.length ? 'partial' : 'done')
  ctx.log.op({ op: 'trash.empty', purged: n, bytes, errors: errors.length })
  return { ok: errors.length === 0, affected: n, errors }
}
