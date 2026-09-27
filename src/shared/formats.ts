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

// ------------------------------------------------------------------ date dal nome file

const NAME_DATE = /(?<!\d)((?:19|20)\d{2})([-_.]?)(0[1-9]|1[0-2])\2(0[1-9]|[12]\d|3[01])(?:(?:[ _\-T]|\s(?:at|alle|um|à|om|a las)\s)([01]\d|2[0-3])([-_.:]?)([0-5]\d)\6([0-5]\d)(?:\d{3})?)?(?!\d)/i
const NAME_EPOCH_MS = /(?<!\d)(1[3-7]\d{11})(?!\d)/

/**
 * Data di scatto ricavata dal nome del file, per i file senza EXIF:
 *   IMG_20240315_101010.jpg · PXL_20240315_101010123.jpg · 20240315_101010.jpg
 *   IMG-20240315-WA0001.jpg · WhatsApp Image 2024-03-15 at 10.10.10.jpeg
 *   Screenshot_2024-03-15-10-10-10.png · Schermata 2024-03-15 alle 10.10.10.png
 *   FB_IMG_1710498610123.jpg (millisecondi Unix)
 * Senza ora → mezzogiorno (così il giorno non cambia con il fuso orario).
 */
export function dateFromFileName(fileName: string, now = Date.now()): number | null {
  const maxYear = new Date(now).getFullYear() + 1
  const m = fileName.match(NAME_DATE)
  if (m) {
    const y = Number(m[1])
    const mo = Number(m[3])
    const d = Number(m[4])
    if (y >= 1990 && y <= maxYear) {
      const hasTime = m[5] !== undefined
      const dt = new Date(y, mo - 1, d, hasTime ? Number(m[5]) : 12, hasTime ? Number(m[7]) : 0, hasTime ? Number(m[8]) : 0)
      // scarta date impossibili (es. 31 febbraio → 2 marzo)
      if (dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d && dt.getTime() <= now + 365 * 86400000) return dt.getTime()
    }
  }
  const e = fileName.match(NAME_EPOCH_MS)
  if (e) {
    const t = Number(e[1])
    if (t > Date.UTC(2011, 0, 1) && t <= now + 86400000) return t
  }
  return null
}

// ------------------------------------------------------------------ provenienza

/** Da dove arriva un file: calcolata dal nome e dalla marca/modello EXIF. */
export type Origin = 'phone' | 'camera' | 'whatsapp' | 'social' | 'screenshot' | 'unknown'

export const ORIGIN_LABELS: Record<Origin, string> = {
  phone: 'Smartphone',
  camera: 'Fotocamera',
  whatsapp: 'WhatsApp',
  social: 'Social e messaggi',
  screenshot: 'Screenshot',
  unknown: 'Altro'
}

const WHATSAPP_NAME = /(^(IMG|VID|AUD|PTT|STK)-\d{8}-WA\d+)|(^WhatsApp (Image|Video|Immagine|Foto))|(-WA\d{4})/i
const SOCIAL_NAME = /^(FB_IMG|received_|Snapchat-|snap-|signal-|telegram|instagram|tiktok|Messenger_creation|photo_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}|video_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})/i
const PHONE_NAME = /^(PXL_\d{8}|IMG_\d{8}_\d{6}|VID_\d{8}_\d{6}|\d{8}_\d{6}|MVIMG_\d{8})/i
const PHONE_MAKE = /^(apple|xiaomi|redmi|poco|google|huawei|honor|oneplus|oppo|vivo|realme|motorola|nokia|hmd|lge|lg electronics|asus|zte|meizu|nothing|fairphone|tcl|alcatel|blackview|ulefone|doogee|umidigi|wiko|infinix|tecno|htc|blackberry|sony mobile|sony ericsson)/i
const CAMERA_MAKE = /^(canon|nikon|fujifilm|fuji|olympus|om digital|panasonic|leica|pentax|ricoh|sigma|hasselblad|gopro|dji|kodak|eastman kodak|minolta|konica|casio|phase one|insta360|polaroid|arashi)/i

export function originFor(fileName: string, make: string | null | undefined, model: string | null | undefined): Origin {
  if (looksLikeScreenshot(fileName)) return 'screenshot'
  if (WHATSAPP_NAME.test(fileName)) return 'whatsapp'
  if (SOCIAL_NAME.test(fileName)) return 'social'
  const mk = (make ?? '').trim()
  const md = (model ?? '').trim()
  if (mk) {
    if (/^samsung/i.test(mk)) return /^(NX|EX|WB|ST|PL|ES)\d/i.test(md) ? 'camera' : 'phone'
    if (/^sony/i.test(mk)) return /xperia|^(so-|sov|xq-|g8\d|h8\d|j9\d|[cdef]\d{4})/i.test(md) ? 'phone' : 'camera'
    if (PHONE_MAKE.test(mk)) return 'phone'
    if (CAMERA_MAKE.test(mk)) return 'camera'
  }
  if (PHONE_NAME.test(fileName)) return 'phone'
  return 'unknown'
}

// ------------------------------------------------------------------ copie modificate

const EDITED = /^(.*?)-(edited|modificato|modificata|modifi[ée]|bearbeitet|editado|editada|bewerkt|redigerad|muokattu|edytowane)(\(\d+\))?(\.[^.]+)$/i

/** "IMG_1234-edited.jpg" → "IMG_1234.jpg" (copie modificate da Google Foto); altrimenti null. */
export function editedOriginalName(fileName: string): string | null {
  const m = fileName.match(EDITED)
  return m ? `${m[1]}${m[3] ?? ''}${m[4]}` : null
}
