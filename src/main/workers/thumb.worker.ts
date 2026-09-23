import fs from 'node:fs'
import path from 'node:path'
import { parentPort, workerData } from 'node:worker_threads'
import sharp from 'sharp'
import exifr from 'exifr'
import { runFile } from '../services/metadata'

export interface ThumbJob {
  jobId: number
  id: number
  abs: string
  kind: string
  ext: string
  out: string
  /** lato lungo in pixel */
  size: number
  format: 'webp' | 'jpeg'
  durationMs: number | null
}

export interface ThumbResult {
  jobId: number
  id: number
  ok: boolean
  error?: string
}

const { ffmpeg } = workerData as { ffmpeg: string | null }
const port = parentPort!
sharp.cache(false)
sharp.concurrency(1)

async function encode(input: Buffer | string, job: ThumbJob): Promise<void> {
  let img = sharp(input, { failOn: 'none', animated: false, limitInputPixels: 268402689 * 2 })
    .rotate()
    .resize({ width: job.size, height: job.size, fit: 'inside', withoutEnlargement: true })
  img = job.format === 'webp' ? img.webp({ quality: 78, effort: 3 }) : img.jpeg({ quality: 88, mozjpeg: true })
  fs.mkdirSync(path.dirname(job.out), { recursive: true })
  const tmp = `${job.out}.tmp`
  await img.toFile(tmp)
  fs.renameSync(tmp, job.out)
}

async function ffmpegFrame(abs: string, atSec: number): Promise<Buffer> {
  if (!ffmpeg) throw new Error('FFmpeg non disponibile')
  const args = ['-hide_banner', '-loglevel', 'error', '-ss', atSec.toFixed(2), '-i', abs, '-frames:v', '1', '-vf', 'scale=1280:-2:flags=fast_bilinear', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-q:v', '4', '-']
  const { stdout } = await runFile(ffmpeg, args, { encoding: 'buffer', timeoutMs: 30000 })
  const buf = stdout as Buffer
  if (!buf.length) throw new Error('FFmpeg non ha prodotto frame')
  return buf
}

async function ffmpegImage(abs: string): Promise<Buffer> {
  if (!ffmpeg) throw new Error('FFmpeg non disponibile')
  const { stdout } = await runFile(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', abs, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-'], { encoding: 'buffer', timeoutMs: 30000 })
  const buf = stdout as Buffer
  if (!buf.length) throw new Error('FFmpeg non ha prodotto immagine')
  return buf
}

async function handle(job: ThumbJob): Promise<void> {
  const errors: string[] = []
  if (job.kind === 'video') {
    const dur = (job.durationMs ?? 0) / 1000
    const points = dur > 2 ? [Math.min(dur * 0.1, 3), 0] : [0]
    for (const t of points) {
      try { return await encode(await ffmpegFrame(job.abs, t), job) } catch (e) { errors.push((e as Error).message) }
    }
    throw new Error(errors.join(' | '))
  }
  // Immagini, GIF, RAW
  if (job.kind !== 'raw') {
    try { return await encode(job.abs, job) } catch (e) { errors.push(`sharp: ${(e as Error).message}`) }
  }
  // Anteprima JPEG incorporata (RAW, HEIC, alcuni TIFF)
  try {
    const t = await exifr.thumbnail(job.abs)
    if (t && t.byteLength > 0) return await encode(Buffer.from(t), job)
  } catch (e) { errors.push(`exifr: ${(e as Error).message}`) }
  if (job.kind === 'raw') {
    try { return await encode(job.abs, job) } catch (e) { errors.push(`sharp: ${(e as Error).message}`) }
  }
  try { return await encode(await ffmpegImage(job.abs), job) } catch (e) { errors.push(`ffmpeg: ${(e as Error).message}`) }
  throw new Error(errors.join(' | '))
}

port.on('message', async (job: ThumbJob) => {
  try {
    await handle(job)
    port.postMessage({ jobId: job.jobId, id: job.id, ok: true } satisfies ThumbResult)
  } catch (e) {
    try { fs.rmSync(`${job.out}.tmp`, { force: true }) } catch { /* ignora */ }
    port.postMessage({ jobId: job.jobId, id: job.id, ok: false, error: String((e as Error).message).slice(0, 500) } satisfies ThumbResult)
  }
})
