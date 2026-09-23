export type MediaKind = 'photo' | 'video' | 'gif' | 'raw' | 'audio' | 'unsupported'

const IMAGES = ['jpg', 'jpeg', 'png', 'webp', 'avif', 'bmp', 'tif', 'tiff', 'ico', 'heic', 'heif', 'jxl']
const RAW = ['dng', 'cr2', 'cr3', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'raf', 'orf', 'rw2', 'pef', 'srw', 'x3f', '3fr', 'iiq']
const VIDEOS = ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'mpg', 'mpeg', 'mts', 'm2ts', '3gp', '3g2', 'wmv', 'flv', 'vob', 'ts', 'mxf']
const AUDIO = ['mp3', 'aac', 'm4a', 'wav', 'flac', 'ogg', 'opus']

export const FORMAT_GROUPS = { images: IMAGES, raw: RAW, videos: VIDEOS, gif: ['gif'], audio: AUDIO }

/** Formati che Chromium visualizza direttamente come <img>. */
export const BROWSER_IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp', 'ico'])
/** Formati video che Chromium di norma riproduce (dipende dal codec interno). */
export const BROWSER_VIDEO_EXT = new Set(['mp4', 'm4v', 'webm', 'mov', 'mkv', 'ogv'])

const KIND_BY_EXT = new Map<string, MediaKind>()
for (const e of IMAGES) KIND_BY_EXT.set(e, 'photo')
for (const e of RAW) KIND_BY_EXT.set(e, 'raw')
for (const e of VIDEOS) KIND_BY_EXT.set(e, 'video')
for (const e of AUDIO) KIND_BY_EXT.set(e, 'audio')
KIND_BY_EXT.set('gif', 'gif')

export function extOf(fileName: string): string {
  const i = fileName.lastIndexOf('.')
  return i < 0 ? '' : fileName.slice(i + 1).toLowerCase()
}

/** Restituisce il tipo di media o null se il file va ignorato dallo scanner. */
export function kindForFile(fileName: string, includeAudio = false): MediaKind | null {
  const k = KIND_BY_EXT.get(extOf(fileName))
  if (!k) return null
  if (k === 'audio' && !includeAudio) return null
  return k
}

const MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon', tif: 'image/tiff', tiff: 'image/tiff',
  heic: 'image/heic', heif: 'image/heif', jxl: 'image/jxl',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', mkv: 'video/x-matroska', webm: 'video/webm',
  avi: 'video/x-msvideo', mpg: 'video/mpeg', mpeg: 'video/mpeg', mts: 'video/mp2t', m2ts: 'video/mp2t',
  ts: 'video/mp2t', '3gp': 'video/3gpp', '3g2': 'video/3gpp2', wmv: 'video/x-ms-wmv', flv: 'video/x-flv',
  vob: 'video/dvd', mxf: 'application/mxf',
  mp3: 'audio/mpeg', aac: 'audio/aac', m4a: 'audio/mp4', wav: 'audio/wav', flac: 'audio/flac',
  ogg: 'audio/ogg', opus: 'audio/opus'
}

export function mimeFor(ext: string): string {
  return MIME[ext] ?? 'application/octet-stream'
}

/** Euristica screenshot: nome file tipico dei principali OS/telefoni. */
export function looksLikeScreenshot(fileName: string): boolean {
  return /(screenshot|screen shot|schermata|istantanea|capture d.écran|bildschirmfoto|scr_\d|screen_\d)/i.test(fileName)
}
