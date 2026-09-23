import fs from 'node:fs'
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import exifr from 'exifr'
import type { MediaKind } from '@shared/types'

/**
 * Modulo "puro Node" (nessun import Electron): usato dai worker.
 */

const QUICK_CHUNK = 64 * 1024

/** Hash rapido: dimensione + primi e ultimi 64 KB. Serve per riconciliare spostamenti e trovare candidati duplicati. */
export async function quickHash(file: string, size: number): Promise<string> {
  const h = crypto.createHash('sha1')
  h.update(String(size))
  const fh = await fs.promises.open(file, 'r')
  try {
    const len = Math.min(QUICK_CHUNK, size)
    const buf = Buffer.alloc(len)
    await fh.read(buf, 0, len, 0)
    h.update(buf)
    if (size > QUICK_CHUNK * 2) {
      await fh.read(buf, 0, QUICK_CHUNK, size - QUICK_CHUNK)
      h.update(buf)
    }
  } finally {
    await fh.close()
  }
  return h.digest('hex')
}

export function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256')
    fs.createReadStream(file, { highWaterMark: 1024 * 1024 })
      .on('data', (d) => h.update(d))
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex')))
  })
}

export interface ExtractedMeta {
  exifDate: number | null
  width: number | null
  height: number | null
  durationMs: number | null
  orientation: number | null
  make: string | null
  model: string | null
  lat: number | null
  lon: number | null
}

const EMPTY: ExtractedMeta = {
  exifDate: null, width: null, height: null, durationMs: null, orientation: null, make: null, model: null, lat: null, lon: null
}

function validDate(d: unknown): number | null {
  if (d instanceof Date) {
    const t = d.getTime()
    // scarta date assurde (0000:00:00, anni < 1971 o nel futuro di oltre un anno)
    if (Number.isFinite(t) && t > 31536000000 && t < Date.now() + 365 * 86400000) return t
  }
  if (typeof d === 'string') {
    const m = d.match(/^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/)
    if (m) return validDate(new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]))
    const p = Date.parse(d)
    if (Number.isFinite(p)) return validDate(new Date(p))
  }
  return null
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().replace(/\0/g, '').slice(0, 120) : null
}

export async function imageMeta(file: string, kind: MediaKind, ext: string): Promise<ExtractedMeta> {
  const out: ExtractedMeta = { ...EMPTY }
  try {
    const tags = await exifr.parse(file, {
      tiff: true, exif: true, gps: true, ifd1: false, xmp: false, icc: false, iptc: false, jfif: false,
      ihdr: ext === 'png', translateValues: false, reviveValues: true, mergeOutput: true
    })
    if (tags) {
      out.exifDate = validDate(tags.DateTimeOriginal) ?? validDate(tags.CreateDate) ?? validDate(tags.DateTimeDigitized)
      out.width = num(tags.ExifImageWidth) ?? num(tags.ImageWidth) ?? null
      out.height = num(tags.ExifImageHeight) ?? num(tags.ImageHeight) ?? null
      out.orientation = num(tags.Orientation)
      out.make = str(tags.Make)
      out.model = str(tags.Model)
      if (typeof tags.latitude === 'number' && typeof tags.longitude === 'number' && (tags.latitude !== 0 || tags.longitude !== 0)) {
        out.lat = tags.latitude
        out.lon = tags.longitude
      }
    }
  } catch {
    /* metadata assenti: si usa il fallback */
  }
  // Dimensioni affidabili (header) via sharp per i formati comuni
  if (kind === 'photo' || kind === 'gif') {
    try {
      const sharp = (await import('sharp')).default
      const md = await sharp(file, { failOn: 'none' }).metadata()
      if (md.width && md.height) {
        out.width = md.width
        out.height = md.pageHeight && md.pages && md.pages > 1 ? md.pageHeight : md.height
      }
      if (md.orientation) out.orientation = md.orientation
      if (kind === 'gif' && md.delay?.length) out.durationMs = md.delay.reduce((a, b) => a + (b || 100), 0)
    } catch {
      /* formato non leggibile da sharp (es. HEIC HEVC): restano i dati EXIF */
    }
  }
  // Orientamento EXIF 5-8 = ruotato di 90°: la griglia deve usare le dimensioni visualizzate
  if (out.orientation && out.orientation >= 5 && out.width && out.height) {
    ;[out.width, out.height] = [out.height, out.width]
  }
  return out
}

export function runFile(cmd: string, args: string[], opts: { timeoutMs?: number; maxBuffer?: number; encoding?: 'buffer' | 'utf8' } = {}): Promise<{ stdout: Buffer | string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { timeout: opts.timeoutMs ?? 30000, maxBuffer: opts.maxBuffer ?? 64 * 1024 * 1024, encoding: (opts.encoding ?? 'utf8') as BufferEncoding, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) reject(Object.assign(err, { stderr: String(stderr ?? '') }))
        else resolve({ stdout, stderr: String(stderr ?? '') })
      }
    )
  })
}

export async function videoMeta(file: string, ffprobe: string | null): Promise<ExtractedMeta & { ok: boolean }> {
  const out = { ...EMPTY, ok: false }
  if (!ffprobe) return out
  try {
    const { stdout } = await runFile(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { timeoutMs: 20000 })
    const j = JSON.parse(String(stdout)) as { format?: any; streams?: any[] }
    const v = j.streams?.find((s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1)
    out.ok = !!v || !!j.format
    const dur = num(j.format?.duration) ?? num(v?.duration)
    if (dur) out.durationMs = Math.round(dur * 1000)
    if (v) {
      out.width = num(v.width)
      out.height = num(v.height)
      let rot = num(v.tags?.rotate) ?? 0
      const dm = v.side_data_list?.find((s: any) => s.rotation !== undefined)
      if (dm) rot = num(dm.rotation) ?? rot
      if (Math.abs(rot) % 180 === 90 && out.width && out.height) [out.width, out.height] = [out.height, out.width]
    }
    const tags = { ...(j.format?.tags ?? {}), ...(v?.tags ?? {}) }
    out.exifDate = validDate(tags.creation_time) ?? validDate(tags['com.apple.quicktime.creationdate'])
    out.make = str(tags['com.apple.quicktime.make'])
    out.model = str(tags['com.apple.quicktime.model'])
    const loc = str(tags.location) ?? str(tags['com.apple.quicktime.location.ISO6709'])
    if (loc) {
      const m = loc.match(/([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)/)
      if (m) { out.lat = Number(m[1]); out.lon = Number(m[2]) }
    }
  } catch {
    out.ok = false
  }
  return out
}
