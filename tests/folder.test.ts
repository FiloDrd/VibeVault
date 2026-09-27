/**
 * Cartella qualsiasi come libreria (layout "folder"), Google Takeout, date dal nome
 * del file e classificazione automatica. Richiede `npm run build` (worker in out/main).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { openVault, type VaultSession } from '../src/main/bootstrap'
import { openDatabase } from '../src/main/db/database'
import { MIGRATIONS } from '../src/main/db/schema'
import { EMPTY_TRASH_CONFIRM } from '../src/shared/ipc'
import { dateFromFileName, editedOriginalName, originFor } from '../src/shared/formats'
import { SidecarIndex, parseSidecar } from '../src/shared/takeout'
import type { GridItem, MediaQuery } from '../src/shared/types'

const WORKERS = path.resolve(__dirname, '../out/main')
const tools = { ffmpeg: null, ffprobe: null }
const TAKEN_2019 = 1561370400 // 2019-06-24T10:00:00Z
const TAKEN_2018 = 1530000000 // 2018-06-26

let root: string
let vs: VaultSession
const H = () => vs.handlers as Required<VaultSession['handlers']>
const q = (query: MediaQuery = {}) => H()['library.query'](query) as GridItem[]
const row = (name: string) => vs.ctx.db.prepare(`SELECT * FROM media WHERE file_name = ?`).get(name) as Record<string, any>
const jpeg = (color: string, w = 64, h = 48) => sharp({ create: { width: w, height: h, channels: 3, background: color } }).jpeg().toBuffer()
const LONG = 'Vacanze al mare con la famiglia e gli amici 2019 foto.jpg'

function put(rel: string, data: string | Buffer): void {
  const p = path.join(root, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, data)
}

function sidecar(title: string, ts: number, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ title, photoTakenTime: { timestamp: String(ts), formatted: '' }, creationTime: { timestamp: '1700000000' }, geoData: { latitude: 0, longitude: 0 }, ...extra })
}

async function scan(opts?: { full?: boolean }) {
  const r = vs.scan.start(opts)
  expect(r.started).toBe(true)
  return vs.scan.wait()
}

beforeAll(async () => {
  if (!fs.existsSync(path.join(WORKERS, 'scanner.worker.js'))) throw new Error('Esegui prima `npm run build`')
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vv-folder-'))
  const exifPhoto = await sharp({ create: { width: 80, height: 60, channels: 3, background: '#ff6b6b' } })
    .jpeg().withExif({ IFD0: { Make: 'Canon', Model: 'EOS R6' }, IFD2: { DateTimeOriginal: '2023:05:10 09:30:00' } }).toBuffer()
  put('Viaggi/2023/IMG_0001.jpg', exifPhoto)
  put('Cache/foto nella cartella Cache.jpg', await jpeg('#4ecdc4'))
  put('WhatsApp/IMG-20210704-WA0003.jpg', await jpeg('#ffe66d'))
  put('Telefono/PXL_20220115_183012345.jpg', await jpeg('#1a535c'))
  put('nota.txt', 'non è un media')

  const year = 'Takeout/Google Foto/Photos from 2019'
  const orig = await jpeg('#8338ec')
  put(`${year}/IMG_1234.jpg`, orig)
  put(`${year}/IMG_1234.jpg.supplemental-metadata.json`, sidecar('IMG_1234.jpg', TAKEN_2019, {
    description: 'Milano', favorited: true, people: [{ name: 'Anna' }], geoData: { latitude: 45.4642, longitude: 9.19 }
  }))
  put(`${year}/IMG_1234-edited.jpg`, await jpeg('#8338ed', 66, 48))
  put(`${year}/IMG_1234(1).jpg`, await jpeg('#3a86ff'))
  put(`${year}/IMG_1234.jpg(1).json`, sidecar('IMG_1234.jpg', TAKEN_2018))
  put(`${year}/${LONG}`, await jpeg('#ff9f1c'))
  put(`${year}/${`${LONG}.supplemental-metadata`.slice(0, 46)}.json`, sidecar(LONG, TAKEN_2019 + 3600))
  put(`${year}/metadata.json`, JSON.stringify({ title: 'Photos from 2019' }))

  const album = 'Takeout/Google Foto/Mare 2019'
  put(`${album}/metadati.json`, JSON.stringify({ title: 'Mare 2019', description: '' }))
  put(`${album}/IMG_1234.jpg`, orig)
  put(`${album}/IMG_1234.jpg.supplemental-metadata.json`, sidecar('IMG_1234.jpg', TAKEN_2019))

  vs = openVault({ root, tools, workerDir: WORKERS, appVersion: 'test', thumbPool: 1 })
})

afterAll(async () => { await vs?.close() })

describe('cartella qualsiasi come libreria', () => {
  it('scrive solo dentro .vibevault/, niente Library né VaultData', () => {
    expect(vs.ctx.vault.layout).toBe('folder')
    for (const d of ['Library', 'VaultData', 'Trash', 'Exports', 'Logs']) expect(fs.existsSync(path.join(root, d)), d).toBe(false)
    expect(fs.existsSync(path.join(root, '.vibevault', 'database.sqlite'))).toBe(true)
    expect(fs.existsSync(path.join(root, '.vibevault', 'cache', 'thumbnails'))).toBe(true)
    expect(vs.ctx.settings.getAll().scanFolders).toEqual([''])
  })

  it('indicizza tutte le sottocartelle, anche una chiamata "Cache"', async () => {
    const p = await scan()
    expect(p.phase).toBe('done')
    expect(row('foto nella cartella Cache.jpg').file_path_relative).toBe('Cache/foto nella cartella Cache.jpg')
    expect(row('IMG_0001.jpg').file_path_relative).toBe('Viaggi/2023/IMG_0001.jpg')
    expect(vs.ctx.db.prepare(`SELECT COUNT(*) c FROM media WHERE file_path_relative LIKE '.vibevault%'`).get()).toEqual({ c: 0 })
    expect(row('nota.txt')).toBeUndefined()
  })

  it('data di scatto: JSON di Takeout, EXIF, nome del file', () => {
    const t = row('IMG_1234.jpg')
    expect(t.date_source).toBe('takeout')
    expect(t.effective_date).toBe(TAKEN_2019 * 1000)
    expect(row('IMG_0001.jpg').date_source).toBe('exif')
    const wa = row('IMG-20210704-WA0003.jpg')
    expect(wa.date_source).toBe('filename')
    expect(wa.effective_date).toBe(new Date(2021, 6, 4, 12, 0, 0).getTime())
    expect(row('PXL_20220115_183012345.jpg').effective_date).toBe(new Date(2022, 0, 15, 18, 30, 12).getTime())
    // JSON con nome troncato e duplicato "(1)"
    expect(row(LONG).effective_date).toBe((TAKEN_2019 + 3600) * 1000)
    expect(row('IMG_1234(1).jpg').effective_date).toBe(TAKEN_2018 * 1000)
    // la copia modificata usa il JSON dell'originale
    expect(row('IMG_1234-edited.jpg').effective_date).toBe(TAKEN_2019 * 1000)
  })

  it('importa GPS, descrizione, preferito e persone dal JSON', () => {
    const t = vs.ctx.db.prepare(`SELECT * FROM media WHERE file_path_relative = ?`).get('Takeout/Google Foto/Photos from 2019/IMG_1234.jpg') as Record<string, any>
    expect(t.gps_lat).toBeCloseTo(45.4642)
    expect(t.notes).toBe('Milano')
    expect(t.favorite).toBe(1)
    const d = H()['media.details'](t.id) as { tags: { name: string }[] }
    expect(d.tags.map((x) => x.name)).toContain('Anna')
  })

  it('provenienza automatica', () => {
    expect(row('IMG-20210704-WA0003.jpg').origin).toBe('whatsapp')
    expect(row('IMG_0001.jpg').origin).toBe('camera')
    expect(row('PXL_20220115_183012345.jpg').origin).toBe('phone')
    expect(q({ origin: 'whatsapp' }).map((i) => i.n)).toEqual(['IMG-20210704-WA0003.jpg'])
    expect(q({ hasGps: true }).length).toBeGreaterThan(0)
    const st = H()['library.stats']() as { byOrigin: { origin: string; count: number }[] }
    expect(st.byOrigin.find((o) => o.origin === 'whatsapp')?.count).toBe(1)
  })

  it('timeline unificata senza doppioni: nasconde originale "-edited" e copie negli album', () => {
    const names = q().map((i) => i.n)
    expect(names).toContain('IMG_1234-edited.jpg')
    expect(names.filter((n) => n === 'IMG_1234.jpg')).toHaveLength(0)
    expect(names).toContain('IMG_0001.jpg')
    // aprendo la cartella si vedono tutti i file reali
    expect(q({ folder: 'Takeout/Google Foto/Mare 2019', recursive: true }).map((i) => i.n)).toEqual(['IMG_1234.jpg'])
    const edited = row('IMG_1234-edited.jpg')
    const d = H()['media.details'](edited.id) as { copies: { fileName: string }[] }
    expect(d.copies.map((c) => c.fileName).sort()).toEqual(['IMG_1234.jpg', 'IMG_1234.jpg'])
  })

  it('crea gli album dalle cartelle album di Takeout (non dalle cartelle per anno)', async () => {
    const albums = H()['albums.list']() as { id: number; name: string; count: number; sourceFolder: string | null }[]
    expect(albums.map((a) => a.name)).toEqual(['Mare 2019'])
    expect(albums[0].sourceFolder).toBe('Takeout/Google Foto/Mare 2019')
    expect(q({ albumId: albums[0].id }).map((i) => i.n)).toEqual(['IMG_1234-edited.jpg'])
    // un album automatico eliminato non torna con la scansione successiva
    H()['albums.delete'](albums[0].id)
    await scan({ full: true })
    expect((H()['albums.list']() as unknown[]).length).toBe(0)
  })

  it('cestino in .vibevault/trash con il JSON al seguito, ripristino e svuotamento', async () => {
    const id = row('IMG_1234(1).jpg').id
    const r = await H()['files.trash']([id])
    expect(r.ok).toBe(true)
    const t = row('IMG_1234(1).jpg')
    expect(t.file_path_relative.startsWith('.vibevault/trash/')).toBe(true)
    const dir = path.join(root, 'Takeout/Google Foto/Photos from 2019')
    expect(fs.existsSync(path.join(dir, 'IMG_1234.jpg(1).json'))).toBe(false)
    const trashDir = path.dirname(path.join(root, t.file_path_relative))
    expect(fs.readdirSync(trashDir).some((f) => f.endsWith('.json'))).toBe(true)
    const entries = H()['trash.list']() as { id: number }[]
    H()['trash.restore']([entries[0].id])
    expect(fs.existsSync(path.join(dir, 'IMG_1234(1).jpg'))).toBe(true)
    const jsonsHere = fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
    expect(new SidecarIndex(jsonsHere).find('IMG_1234(1).jpg')?.direct).toBe(true)
    expect(jsonsHere).toHaveLength(4)
    await H()['files.trash']([id])
    const e2 = await H()['trash.empty']({ confirmToken: EMPTY_TRASH_CONFIRM })
    expect(e2.affected).toBe(1)
    expect(fs.readdirSync(trashDir).length).toBe(0)
  })

  it('sposta e rinomina portando con sé il JSON, senza perdere la data', async () => {
    const id = row(LONG).id
    const m = await H()['files.move']([id], 'Viaggi')
    expect(m.ok).toBe(true)
    expect(fs.readdirSync(path.join(root, 'Viaggi')).filter((f) => f.endsWith('.json'))).toHaveLength(1)
    const rn = await H()['files.rename']([{ id, newName: 'mare' }])
    expect(rn.ok).toBe(true)
    expect(fs.existsSync(path.join(root, 'Viaggi', 'mare.jpg.supplemental-metadata.json'))).toBe(true)
    await scan({ full: true })
    expect(row('mare.jpg').effective_date).toBe((TAKEN_2019 + 3600) * 1000)
  })

  it('le cartelle di sistema dei vault v0.1 non sono più riservate', async () => {
    const r = await H()['files.move']([row('IMG_0001.jpg').id], 'Cache')
    expect(r.ok).toBe(true)
    const bad = await H()['files.move']([row('IMG_0001.jpg').id], '.vibevault/cache')
    expect(bad.ok).toBe(false)
    const f = await H()['files.createFolder']('', '.nascosta')
    expect(f.ok).toBe(false)
  })
})

describe('funzioni pure', () => {
  it('data dal nome del file', () => {
    const at = (y: number, mo: number, d: number, h = 12, mi = 0, s = 0) => new Date(y, mo - 1, d, h, mi, s).getTime()
    expect(dateFromFileName('IMG_20240315_101010.jpg')).toBe(at(2024, 3, 15, 10, 10, 10))
    expect(dateFromFileName('20240315_101010.jpg')).toBe(at(2024, 3, 15, 10, 10, 10))
    expect(dateFromFileName('IMG-20240315-WA0001.jpg')).toBe(at(2024, 3, 15))
    expect(dateFromFileName('WhatsApp Image 2024-03-15 at 10.10.10.jpeg')).toBe(at(2024, 3, 15, 10, 10, 10))
    expect(dateFromFileName('Screenshot_2024-03-15-10-10-10.png')).toBe(at(2024, 3, 15, 10, 10, 10))
    expect(dateFromFileName('Schermata 2024-03-15 alle 10.10.10.png')).toBe(at(2024, 3, 15, 10, 10, 10))
    expect(dateFromFileName('FB_IMG_1710498610123.jpg')).toBe(1710498610123)
    expect(dateFromFileName('IMG_1234.jpg')).toBeNull()
    expect(dateFromFileName('DSC_20241345.jpg')).toBeNull()
    expect(dateFromFileName('foto_20230231.jpg')).toBeNull()
  })

  it('provenienza', () => {
    expect(originFor('IMG-20240315-WA0001.jpg', null, null)).toBe('whatsapp')
    expect(originFor('WhatsApp Image 2024-03-15 at 10.10.10.jpeg', null, null)).toBe('whatsapp')
    expect(originFor('FB_IMG_1710498610123.jpg', null, null)).toBe('social')
    expect(originFor('Screenshot_20240101.png', null, null)).toBe('screenshot')
    expect(originFor('IMG_1234.HEIC', 'Apple', 'iPhone 13')).toBe('phone')
    expect(originFor('DSC01234.JPG', 'SONY', 'ILCE-7M3')).toBe('camera')
    expect(originFor('DSC01234.JPG', 'Sony', 'Xperia 5 II')).toBe('phone')
    expect(originFor('20240101_101010.jpg', 'samsung', 'SM-G991B')).toBe('phone')
    expect(originFor('IMG_0001.JPG', 'Canon', 'EOS R6')).toBe('camera')
    expect(originFor('foto.jpg', null, null)).toBe('unknown')
  })

  it('abbinamento dei JSON di Takeout', () => {
    const idx = new SidecarIndex(['a.jpg.json', 'b.jpg.supplemental-metadata.json', 'c.jpg(2).json', 'metadata.json', `${`${LONG}.supplemental-metadata`.slice(0, 46)}.json`])
    expect(idx.find('a.jpg')).toEqual({ names: ['a.jpg.json'], direct: true })
    expect(idx.find('b.jpg')?.names).toEqual(['b.jpg.supplemental-metadata.json'])
    expect(idx.find('c(2).jpg')?.names).toEqual(['c.jpg(2).json'])
    expect(idx.find('c.jpg')).toBeNull()
    expect(idx.find('a-edited.jpg')).toEqual({ names: ['a.jpg.json'], direct: false })
    expect(idx.find(LONG)?.names).toHaveLength(1)
    expect(editedOriginalName('IMG_1-modificato.jpg')).toBe('IMG_1.jpg')
    const m = parseSidecar(sidecar('x.jpg', TAKEN_2019, { geoDataExif: { latitude: 1.5, longitude: 2.5 } }))
    expect(m?.takenAt).toBe(TAKEN_2019 * 1000)
    expect(m?.lat).toBe(1.5)
    expect(parseSidecar('{"title":"album"}')).toBeNull()
  })

  it('migrazione v1 → v2: provenienza calcolata e file senza EXIF da rileggere', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vv-mig-'))
    const file = path.join(dir, 'db.sqlite')
    const old = new Database(file)
    old.exec(MIGRATIONS[0])
    old.pragma('user_version = 1')
    old.prepare(`INSERT INTO media (file_path_relative, file_name, extension, mime_type, kind, added_at, modified_at, date_source) VALUES (?, ?, 'jpg', 'image/jpeg', 'photo', 1, 123, ?)`).run('Library/IMG-20200101-WA0001.jpg', 'IMG-20200101-WA0001.jpg', 'file')
    old.prepare(`INSERT INTO media (file_path_relative, file_name, extension, mime_type, kind, added_at, modified_at, date_source) VALUES (?, ?, 'jpg', 'image/jpeg', 'photo', 1, 456, ?)`).run('Library/b.jpg', 'b.jpg', 'exif')
    old.close()
    const { db } = openDatabase(file)
    const rows = db.prepare(`SELECT file_name n, origin, modified_at m FROM media ORDER BY id`).all()
    expect(rows).toEqual([{ n: 'IMG-20200101-WA0001.jpg', origin: 'whatsapp', m: null }, { n: 'b.jpg', origin: 'unknown', m: 456 }])
    db.close()
  })
})
