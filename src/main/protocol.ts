import fs from 'node:fs'
import { Readable } from 'node:stream'
import { protocol } from 'electron'
import type { AppContext } from './context'
import type { ThumbService } from './services/thumbService'
import { mimeFor } from '@shared/formats'

export const SCHEME = 'vv'

/** Da chiamare PRIMA di app.ready. */
export function registerSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }
  ])
}

function notFound(msg = 'Non trovato'): Response {
  return new Response(msg, { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}

/** Risposta file con supporto Range (necessario per lo scrubbing dei video grandi). */
export function fileResponse(abs: string, mime: string, rangeHeader: string | null, cache = 'no-cache'): Response {
  let st: fs.Stats
  try { st = fs.statSync(abs) } catch { return notFound() }
  const size = st.size
  const baseHeaders: Record<string, string> = { 'Content-Type': mime, 'Accept-Ranges': 'bytes', 'Cache-Control': cache }
  if (rangeHeader) {
    const m = rangeHeader.match(/bytes=(\d*)-(\d*)/)
    if (m) {
      let start = m[1] ? Number(m[1]) : NaN
      let end = m[2] ? Number(m[2]) : size - 1
      if (Number.isNaN(start)) { start = Math.max(0, size - end); end = size - 1 }
      if (start >= size || start > end) {
        return new Response(null, { status: 416, headers: { ...baseHeaders, 'Content-Range': `bytes */${size}` } })
      }
      end = Math.min(end, size - 1)
      const stream = Readable.toWeb(fs.createReadStream(abs, { start, end })) as ReadableStream
      return new Response(stream, {
        status: 206,
        headers: { ...baseHeaders, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) }
      })
    }
  }
  const stream = Readable.toWeb(fs.createReadStream(abs)) as ReadableStream
  return new Response(stream, { status: 200, headers: { ...baseHeaders, 'Content-Length': String(size) } })
}

/**
 *   vv://thumb/<id>    miniatura WebP (generata al volo con priorità se manca)
 *   vv://preview/<id>  anteprima JPEG grande per formati non visualizzabili (HEIC, TIFF, RAW)
 *   vv://media/<id>    file originale in streaming (sola lettura)
 */
export function registerProtocolHandler(getCtx: () => AppContext | null, getThumbs: () => ThumbService | null): void {
  protocol.handle(SCHEME, async (req) => {
    const ctx = getCtx()
    const thumbs = getThumbs()
    if (!ctx || !thumbs) return notFound('Vault non pronto')
    const url = new URL(req.url)
    const id = Number(url.pathname.replace(/^\//, ''))
    if (!Number.isInteger(id) || id <= 0) return notFound()
    try {
      switch (url.hostname) {
        case 'thumb': {
          const ok = await thumbs.ensure(id, 'thumb')
          if (!ok) return notFound('Miniatura non disponibile')
          return fileResponse(thumbs.thumbAbs(id), 'image/webp', null, 'max-age=31536000, immutable')
        }
        case 'preview': {
          const ok = await thumbs.ensure(id, 'preview', 60000)
          if (!ok) return notFound('Anteprima non disponibile')
          return fileResponse(thumbs.previewAbs(id), 'image/jpeg', null, 'max-age=31536000, immutable')
        }
        case 'media': {
          const row = ctx.media.getRow(id)
          if (!row) return notFound()
          const abs = ctx.vault.toAbs(row.file_path_relative)
          return fileResponse(abs, mimeFor(row.extension), req.headers.get('range'))
        }
        default:
          return notFound()
      }
    } catch (e) {
      return new Response(String((e as Error).message), { status: 500 })
    }
  })
}
