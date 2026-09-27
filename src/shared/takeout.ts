import { editedOriginalName } from './formats'

/**
 * Google Takeout (Google Foto): accanto a quasi ogni foto c'è un file JSON con la
 * data vera di scatto, il GPS, la descrizione, il preferito e le persone.
 * Takeout assegna a tutti i file la data dell'esportazione: senza il JSON la
 * timeline sarebbe sbagliata. Qui solo logica pura (nessun accesso al disco).
 *
 * Nomi dei JSON (non sempre regolari):
 *   IMG_1234.jpg            ↔ IMG_1234.jpg.json                         (classico)
 *                           ↔ IMG_1234.jpg.supplemental-metadata.json   (dal 2024)
 *   nomi lunghi             ↔ troncati a 51 caratteri: "...supplemental-metad.json", "....jp.json"
 *   IMG_1234(1).jpg         ↔ IMG_1234.jpg(1).json / IMG_1234.jpg.supplemental-metadata(1).json
 *   IMG_1234-edited.jpg     ↔ nessun JSON proprio: usa quello dell'originale
 */

export interface TakeoutMeta {
  takenAt: number | null
  lat: number | null
  lon: number | null
  description: string | null
  favorited: boolean
  people: string[]
  title: string | null
}

const SUPPL = '.supplemental-metadata'
/** I nomi troncati hanno almeno questa lunghezza (limite di Takeout: 51 caratteri con ".json"). */
const MIN_TRUNCATED_STEM = 30

interface Entry { name: string; stem: string; stemLower: string; dup: string | null }

export class SidecarIndex {
  private byLower = new Map<string, string>()
  private long: Entry[] = []

  constructor(jsonNames: string[]) {
    for (const name of jsonNames) {
      if (!/\.json$/i.test(name)) continue
      this.byLower.set(name.toLowerCase(), name)
      const stemFull = name.slice(0, -5)
      const dm = stemFull.match(/^(.*)\((\d+)\)$/)
      const stem = dm ? dm[1] : stemFull
      if (stem.length >= MIN_TRUNCATED_STEM) this.long.push({ name, stem, stemLower: stem.toLowerCase(), dup: dm ? dm[2] : null })
    }
  }

  get size(): number { return this.byLower.size }

  private exact(name: string): string | null {
    return this.byLower.get(name.toLowerCase()) ?? null
  }

  /**
   * JSON abbinato a un file multimediale. `direct` è falso quando il JSON è quello
   * dell'originale (copia "-edited"): in quel caso non va spostato insieme al file.
   * Con più candidati troncati restituisce tutti i nomi: il chiamante verifica il campo "title".
   */
  find(mediaName: string): { names: string[]; direct: boolean } | null {
    const direct = this.findDirect(mediaName)
    if (direct.length) return { names: direct, direct: true }
    const orig = editedOriginalName(mediaName)
    if (orig) {
      const o = this.findDirect(orig)
      if (o.length) return { names: o, direct: false }
    }
    return null
  }

  private findDirect(mediaName: string): string[] {
    const dm = mediaName.match(/^(.*)\((\d+)\)(\.[^.]+)$/)
    const base = dm ? `${dm[1]}${dm[3]}` : mediaName
    const n = dm ? dm[2] : null
    const tries = n
      ? [`${base}(${n}).json`, `${base}${SUPPL}(${n}).json`, `${mediaName}.json`, `${mediaName}${SUPPL}.json`]
      : [`${base}.json`, `${base}${SUPPL}.json`]
    for (const t of tries) {
      const hit = this.exact(t)
      if (hit) return [hit]
    }
    // nomi troncati: lo "stem" del JSON è un prefisso di "<nome>.supplemental-metadata"
    const full = `${base}${SUPPL}`.toLowerCase()
    const out: string[] = []
    for (const e of this.long) {
      if (e.dup !== n) continue
      if (e.stemLower.length < full.length && full.startsWith(e.stemLower) && e.stemLower.length >= Math.min(base.length, MIN_TRUNCATED_STEM)) out.push(e.name)
    }
    return out
  }
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

function geo(g: unknown): { lat: number; lon: number } | null {
  if (!g || typeof g !== 'object') return null
  const o = g as Record<string, unknown>
  const lat = num(o.latitude)
  const lon = num(o.longitude)
  if (lat === null || lon === null || (lat === 0 && lon === 0) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  return { lat, lon }
}

/** Legge un JSON di Takeout. null se non è un JSON di Google Foto. */
export function parseSidecar(text: string, now = Date.now()): TakeoutMeta | null {
  let j: Record<string, unknown>
  try { j = JSON.parse(text) } catch { return null }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return null
  if (!('photoTakenTime' in j) && !('creationTime' in j) && !('geoData' in j)) return null
  const pt = j.photoTakenTime as Record<string, unknown> | undefined
  const ts = num(pt?.timestamp)
  const takenAt = ts && ts > 31536000 && ts * 1000 < now + 365 * 86400000 ? ts * 1000 : null
  const g = geo(j.geoData) ?? geo(j.geoDataExif)
  const description = typeof j.description === 'string' && j.description.trim() ? j.description.trim().slice(0, 2000) : null
  const people = Array.isArray(j.people)
    ? (j.people as unknown[]).map((p) => (p && typeof p === 'object' ? (p as Record<string, unknown>).name : null)).filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim().slice(0, 80)).slice(0, 30)
    : []
  return {
    takenAt,
    lat: g?.lat ?? null,
    lon: g?.lon ?? null,
    description,
    favorited: j.favorited === true,
    people,
    title: typeof j.title === 'string' ? j.title : null
  }
}

/** File "metadata.json" degli album di Takeout (nome tradotto nelle varie lingue). */
export const ALBUM_METADATA_NAMES = new Set(['metadata.json', 'metadati.json', 'metadaten.json', 'metadatos.json', 'métadonnées.json', 'metadados.json', 'metagegevens.json'])

/** Cartelle per anno di Takeout ("Photos from 2019", "Foto del 2019", …): non sono album. */
export function isYearFolderName(name: string): boolean {
  return /^(photos from|foto del|foto dal|fotos de|fotos aus|fotos von|photos de|fotos van|foto från|zdjęcia z) \d{4}$/i.test(name.trim())
}

/** Titolo dell'album dal suo metadata.json, oppure null. */
export function parseAlbumMetadata(text: string): string | null {
  try {
    const j = JSON.parse(text) as Record<string, unknown>
    if (j && typeof j.title === 'string' && j.title.trim() && !('photoTakenTime' in j)) return j.title.trim().slice(0, 120)
  } catch { /* non è un JSON valido */ }
  return null
}

/** Nuovo nome del JSON quando il file multimediale cambia nome (spostamento con "nome (1).jpg" o rinomina). */
export function sidecarNameFor(oldSidecar: string, oldMedia: string, newMedia: string): string {
  if (oldMedia === newMedia) return oldSidecar
  if (oldSidecar.toLowerCase().startsWith(oldMedia.toLowerCase())) return newMedia + oldSidecar.slice(oldMedia.length)
  // forma di Google per i nomi doppi: "IMG(1).jpg" ↔ "IMG.jpg.supplemental-metadata(1).json"
  const dm = newMedia.match(/^(.*)\((\d+)\)(\.[^.]+)$/)
  if (dm) return `${dm[1]}${dm[3]}${SUPPL}(${dm[2]}).json`
  return `${newMedia}${SUPPL}.json`
}
