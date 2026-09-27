import fs from 'node:fs'
import path from 'node:path'
import { parentPort, workerData } from 'node:worker_threads'
import { dateFromFileName, extOf, kindForFile, looksLikeScreenshot, mimeFor, originFor } from '@shared/formats'
import { ALBUM_METADATA_NAMES, SidecarIndex, isYearFolderName, parseAlbumMetadata, parseSidecar, type TakeoutMeta } from '@shared/takeout'
import type { ScannedRecord } from '../db/mediaRepo'
import { imageMeta, quickHash, videoMeta } from '../services/metadata'
import { isReservedName } from '../vault'

export interface ScannerInput {
  root: string
  folders: string[]
  known: [string, number, number][]
  includeAudio: boolean
  ffprobe: string | null
  full: boolean
  reserved: string[]
}

export type ScannerMessage =
  | { type: 'batch'; records: ScannedRecord[] }
  | { type: 'seen'; rels: string[] }
  | { type: 'progress'; scanned: number; currentPath: string; phase: 'walking' | 'indexing' }
  | { type: 'error'; path: string; message: string }
  | { type: 'album'; folder: string; title: string }
  | { type: 'done'; scanned: number; cancelled: boolean }

const input = workerData as ScannerInput
const port = parentPort!
let cancelled = false
port.on('message', (m) => { if (m === 'cancel') cancelled = true })

const SKIP_DIRS = new Set(['$recycle.bin', 'system volume information', 'node_modules', '@eadir', 'appdata', '#recycle', 'vibevault-dati'])
/** Cartelle di sistema saltate solo quando si trovano nella radice di un disco (es. C:\Windows). */
const SKIP_AT_DRIVE_ROOT = new Set(['windows', 'program files', 'program files (x86)', 'programdata', 'recovery', 'perflogs', 'msocache'])
const known = new Map<string, { size: number; mtime: number }>()
for (const [p, s, m] of input.known) known.set(p, { size: s, mtime: m })
const reserved = new Set(input.reserved)

const toRel = (abs: string) => path.relative(input.root, abs).split(path.sep).join('/')

let scanned = 0
let batch: ScannedRecord[] = []
let seen: string[] = []
let lastProgress = 0

function flush(force = false): void {
  if (batch.length && (force || batch.length >= 100)) { port.postMessage({ type: 'batch', records: batch } satisfies ScannerMessage); batch = [] }
  if (seen.length && (force || seen.length >= 2000)) { port.postMessage({ type: 'seen', rels: seen } satisfies ScannerMessage); seen = [] }
}

function progress(currentPath: string, phase: 'walking' | 'indexing'): void {
  const now = Date.now()
  if (now - lastProgress > 150) {
    lastProgress = now
    port.postMessage({ type: 'progress', scanned, currentPath, phase } satisfies ScannerMessage)
  }
}

/** JSON di Google Takeout della cartella corrente (letti una volta sola per cartella). */
class DirSidecars {
  private cache = new Map<string, Promise<TakeoutMeta | null>>()
  constructor(private dir: string, readonly index: SidecarIndex) {}

  private read(name: string): Promise<TakeoutMeta | null> {
    let p = this.cache.get(name)
    if (!p) {
      p = fs.promises.stat(path.join(this.dir, name))
        .then((st) => (st.size > 2 * 1024 * 1024 ? null : fs.promises.readFile(path.join(this.dir, name), 'utf8').then((t) => parseSidecar(t))))
        .catch(() => null)
      this.cache.set(name, p)
    }
    return p
  }

  async metaFor(mediaName: string): Promise<TakeoutMeta | null> {
    const hit = this.index.find(mediaName)
    if (!hit) return null
    if (hit.names.length === 1) return this.read(hit.names[0])
    // più JSON troncati possibili: vale quello con "title" uguale al nome del file
    const metas = await Promise.all(hit.names.map((n) => this.read(n)))
    const want = mediaName.toLowerCase()
    return metas.find((m) => m?.title?.toLowerCase() === want) ?? null
  }
}

async function processFile(abs: string, name: string, sidecars: DirSidecars | null): Promise<void> {
  const kind = kindForFile(name, input.includeAudio)
  if (!kind) return
  const rel = toRel(abs)
  let st: fs.Stats
  try {
    st = await fs.promises.stat(abs)
  } catch (e) {
    port.postMessage({ type: 'error', path: rel, message: (e as Error).message } satisfies ScannerMessage)
    return
  }
  scanned++
  const mtime = Math.round(st.mtimeMs)
  const k = known.get(rel)
  if (!input.full && k && k.size === st.size && k.mtime === mtime) {
    seen.push(rel)
    progress(rel, 'walking')
    flush()
    return
  }
  progress(rel, 'indexing')
  const ext = extOf(name)
  const folder = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
  const record: ScannedRecord = {
    rel, folder, name, ext, mime: mimeFor(ext), kind, size: st.size, mtime,
    birthtime: st.birthtimeMs > 0 ? Math.round(st.birthtimeMs) : null,
    exifDate: null, width: null, height: null, durationMs: null, orientation: null, make: null, model: null,
    lat: null, lon: null, hashQuick: null, isScreenshot: looksLikeScreenshot(name), status: 'ok', error: null,
    takeoutDate: null, nameDate: dateFromFileName(name), origin: 'unknown', takeout: null
  }
  try {
    if (st.size === 0) {
      record.status = 'corrupt'
      record.error = 'File vuoto (0 byte)'
    } else {
      record.hashQuick = await quickHash(abs, st.size)
      if (kind === 'video' || kind === 'audio') {
        const m = await videoMeta(abs, input.ffprobe)
        Object.assign(record, pickMeta(m))
        if (!m.ok && input.ffprobe) { record.status = 'corrupt'; record.error = 'ffprobe non riesce a leggere il file' }
      } else {
        Object.assign(record, pickMeta(await imageMeta(abs, kind, ext)))
      }
    }
  } catch (e) {
    record.status = 'corrupt'
    record.error = (e as Error).message.slice(0, 300)
  }
  if (sidecars) {
    const t = await sidecars.metaFor(name)
    if (t) {
      record.takeoutDate = t.takenAt
      if ((record.lat === null || record.lon === null) && t.lat !== null && t.lon !== null) { record.lat = t.lat; record.lon = t.lon }
      record.takeout = { description: t.description, favorited: t.favorited, people: t.people }
    }
  }
  record.origin = originFor(name, record.make, record.model)
  batch.push(record)
  flush()
}

function pickMeta(meta: object): Partial<ScannedRecord> {
  const m = meta as Record<string, unknown>
  const o: Partial<ScannedRecord> = {}
  for (const k of ['exifDate', 'width', 'height', 'durationMs', 'orientation', 'make', 'model', 'lat', 'lon'] as const) {
    if (m[k] !== null && m[k] !== undefined) (o as Record<string, unknown>)[k] = m[k]
  }
  return o
}

/** Cartella album di Takeout: contiene un metadata.json con il titolo (le cartelle per anno no). */
async function detectTakeoutAlbum(dir: string, jsons: string[]): Promise<void> {
  const meta = jsons.find((j) => ALBUM_METADATA_NAMES.has(j.toLowerCase()))
  if (!meta || isYearFolderName(path.basename(dir))) return
  const rel = toRel(dir)
  if (!rel) return
  try {
    const st = await fs.promises.stat(path.join(dir, meta))
    if (st.size > 1024 * 1024) return
    const title = parseAlbumMetadata(await fs.promises.readFile(path.join(dir, meta), 'utf8'))
    if (title) port.postMessage({ type: 'album', folder: rel, title } satisfies ScannerMessage)
  } catch { /* metadata illeggibile: nessun album */ }
}

async function walk(startAbs: string): Promise<void> {
  const stack = [startAbs]
  const CONCURRENCY = 4
  while (stack.length && !cancelled) {
    const dir = stack.pop()!
    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true })
    } catch (e) {
      port.postMessage({ type: 'error', path: toRel(dir) || '.', message: (e as Error).message } satisfies ScannerMessage)
      continue
    }
    const files: fs.Dirent[] = []
    const jsons: string[] = []
    const atDriveRoot = path.parse(dir).root === dir
    for (const ent of entries) {
      if (ent.name.startsWith('.')) continue
      if (ent.isDirectory()) {
        const lower = ent.name.toLowerCase()
        if (SKIP_DIRS.has(lower)) continue
        if (atDriveRoot && SKIP_AT_DRIVE_ROOT.has(lower)) continue
        const abs = path.join(dir, ent.name)
        const rel = toRel(abs)
        if (!rel.includes('/') && isReservedName(rel, reserved)) continue
        stack.push(abs)
      } else if (ent.isFile()) {
        if (/\.json$/i.test(ent.name)) jsons.push(ent.name)
        else files.push(ent)
      }
    }
    const sidecars = jsons.length && files.length ? new DirSidecars(dir, new SidecarIndex(jsons)) : null
    if (sidecars) await detectTakeoutAlbum(dir, jsons)
    for (let i = 0; i < files.length && !cancelled; i += CONCURRENCY) {
      await Promise.all(files.slice(i, i + CONCURRENCY).map((f) => processFile(path.join(dir, f.name), f.name, sidecars)))
    }
  }
}

async function main(): Promise<void> {
  const roots = input.folders.length ? input.folders : ['']
  for (const f of roots) {
    if (cancelled) break
    await walk(path.join(input.root, ...f.split('/').filter(Boolean)))
  }
  flush(true)
  port.postMessage({ type: 'done', scanned, cancelled } satisfies ScannerMessage)
}

main().catch((e) => {
  port.postMessage({ type: 'error', path: '', message: String((e as Error)?.stack ?? e) } satisfies ScannerMessage)
  flush(true)
  port.postMessage({ type: 'done', scanned, cancelled: true } satisfies ScannerMessage)
})
