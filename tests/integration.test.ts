/**
 * Test end-to-end del motore (senza Electron): scansione reale con worker,
 * metadata, miniature, spostamenti, rinomina, cestino, undo, riconciliazione,
 * portabilità della root. Richiede `npm run build` (usa i worker compilati in out/main).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openVault, type VaultSession } from '../src/main/bootstrap'
import { EMPTY_TRASH_CONFIRM } from '../src/shared/ipc'
import { makeSampleLibrary } from './fixtures'

const WORKERS = path.resolve(__dirname, '../out/main')
const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version']); return true } catch { return false } })()
const tools = { ffmpeg: hasFfmpeg ? 'ffmpeg' : null, ffprobe: hasFfmpeg ? 'ffprobe' : null }

let root: string
let vs: VaultSession
const H = () => vs.handlers as Required<VaultSession['handlers']>
const details = (id: number) => vs.ctx.media.details(id, (r) => vs.ctx.vault.toAbs(r))

async function scan(opts?: { full?: boolean }) {
  const r = vs.scan.start(opts)
  expect(r.started).toBe(true)
  return vs.scan.wait()
}

function byName(name: string) {
  return (H()['library.query']({ search: `"${name}"` }) as ReturnType<VaultSession['ctx']['media']['query']>).find((i) => i.n === name)!
}

beforeAll(async () => {
  if (!fs.existsSync(path.join(WORKERS, 'scanner.worker.js'))) throw new Error('Esegui prima `npm run build`')
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vv-it-'))
  fs.mkdirSync(path.join(root, 'Library'), { recursive: true })
  await makeSampleLibrary(root)
  vs = openVault({ root, tools, workerDir: WORKERS, appVersion: 'test', thumbPool: 2 })
})

afterAll(async () => {
  await vs?.close()
})

describe('motore VibeVault', () => {
  it('crea la struttura portatile del vault', () => {
    for (const d of ['Library', 'VaultData', 'Cache/thumbnails', 'Cache/previews', 'Trash', 'Exports/Foto', 'Logs']) {
      expect(fs.existsSync(path.join(root, d)), d).toBe(true)
    }
    expect(fs.existsSync(path.join(root, 'VaultData', 'database.sqlite'))).toBe(true)
    expect(fs.existsSync(path.join(root, 'VaultData', 'vault.json'))).toBe(true)
  })

  it('scansiona, estrae metadata e salva percorsi relativi', async () => {
    const p = await scan()
    expect(p.phase).toBe('done')
    const all = H()['library.query']({}) as { n: string; k: string }[]
    const names = all.map((i) => i.n)
    expect(names).not.toContain('note.txt')
    expect(names).not.toContain('segreto.png')
    expect(names).toContain('IMG_0000.jpg')
    expect(names).toContain('animata.gif')

    const rows = vs.ctx.db.prepare(`SELECT file_path_relative p FROM media`).all() as { p: string }[]
    for (const r of rows) {
      expect(path.isAbsolute(r.p)).toBe(false)
      expect(r.p.startsWith('Library/')).toBe(true)
      expect(r.p.includes('\\')).toBe(false)
    }

    const img = details(byName('IMG_0000.jpg').id)!
    expect(img.dateSource).toBe('exif')
    expect(new Date(img.effectiveDate).getFullYear()).toBe(2023)
    expect(img.cameraMake).toBe('Canon')
    expect(img.width).toBe(1200)
    expect(img.height).toBe(800)
    expect(img.gpsLat).toBeCloseTo(45.45, 1)
    expect(img.hashQuick).toBeTruthy()

    const png = details(byName('verticale.png').id)!
    expect(png.dateSource).toBe('file')

    const shot = H()['library.query']({ screenshots: true }) as { n: string }[]
    expect(shot.map((s) => s.n)).toEqual(['Screenshot 2024-02-01 101010.png'])

    const corrupt = vs.ctx.db.prepare(`SELECT file_name n FROM media WHERE status = 'corrupt'`).all() as { n: string }[]
    expect(corrupt.map((c) => c.n)).toContain('vuoto.png')
    if (hasFfmpeg) expect(corrupt.map((c) => c.n)).toContain('rotto.mp4')
  })

  it.runIf(hasFfmpeg)('legge durata e orientamento dei video', () => {
    const v = details(byName('verticale.mp4').id)!
    expect(v.kind).toBe('video')
    expect(v.durationMs).toBeGreaterThan(1500)
    expect(v.height! > v.width!).toBe(true)
    const o = details(byName('orizzontale.mp4').id)!
    expect(o.dateSource).toBe('exif')
    expect(new Date(o.effectiveDate).getUTCFullYear()).toBe(2022)
    const portrait = (H()['library.query']({ kinds: ['video'], orientation: 'portrait' }) as { n: string }[]).map((i) => i.n)
    expect(portrait).toEqual(['verticale.mp4'])
  })

  it('genera miniature per foto, GIF e video senza bloccare', async () => {
    const items = H()['library.query']({}) as { id: number; n: string; st: string }[]
    const ok = items.filter((i) => i.st === 'ok')
    const results = await Promise.all(ok.map((i) => vs.thumbs.ensure(i.id, 'thumb', 30000)))
    const failed = ok.filter((_, i) => !results[i]).map((i) => i.n)
    // rotto.jpg ha estensione giusta ma contenuto non valido: unica miniatura che può fallire
    expect(failed.filter((n) => n !== 'rotto.jpg')).toEqual([])
    for (const i of ok) if (!failed.includes(i.n)) expect(fs.existsSync(vs.thumbs.thumbAbs(i.id))).toBe(true)
  })

  it('rileva duplicati esatti (verificati con SHA-256)', async () => {
    const groups = (await H()['library.duplicates']({ verify: true })) as { verified: boolean; items: { n: string }[] }[]
    expect(groups).toHaveLength(1)
    expect(groups[0].verified).toBe(true)
    expect(groups[0].items.map((i) => i.n).sort()).toEqual(['Copia di IMG_0001.jpg', 'IMG_0001.jpg'])
  })

  it('tag, rating, preferiti e undo', async () => {
    const id = byName('IMG_0002.jpg').id
    H()['tags.add']([id], ['Mare', 'Estate'])
    H()['media.rate']([id], 4)
    H()['media.favorite']([id], true)
    expect(details(id)!.rating).toBe(4)
    await H()['operations.undo']() // annulla preferito
    expect(details(id)!.favorite).toBe(false)
    await H()['operations.undo']() // annulla rating
    expect(details(id)!.rating).toBe(0)
    expect(details(id)!.tags.map((t) => t.name).sort()).toEqual(['Estate', 'Mare'])
    const albums = H()['albums.create']('Vacanze', [id]) as { id: number }
    expect((H()['library.query']({ albumId: albums.id }) as unknown[]).length).toBe(1)
  })

  it('sposta file con undo, senza sovrascrivere', async () => {
    const a = byName('IMG_0003.jpg')
    const b = byName('IMG_0004.jpg')
    H()['files.createFolder']('Library', 'Selezione')
    // un file omonimo già presente nella destinazione non va mai sovrascritto
    fs.writeFileSync(path.join(root, 'Library/Selezione/IMG_0003.jpg'), 'occupato')
    const r = await H()['files.move']([a.id, b.id], 'Library/Selezione')
    expect(r.ok).toBe(true)
    expect(r.affected).toBe(2)
    expect(fs.readFileSync(path.join(root, 'Library/Selezione/IMG_0003.jpg'), 'utf8')).toBe('occupato')
    expect(fs.existsSync(path.join(root, 'Library/Selezione/IMG_0003 (1).jpg'))).toBe(true)
    expect(fs.existsSync(path.join(root, 'Library/Selezione/IMG_0004.jpg'))).toBe(true)
    expect(fs.existsSync(path.join(root, 'Library/Foto/2023/IMG_0003.jpg'))).toBe(false)
    expect(details(a.id)!.filePathRelative).toBe('Library/Selezione/IMG_0003 (1).jpg')

    const u = await H()['operations.undo'](r.operationId)
    expect(u.ok).toBe(true)
    expect(fs.existsSync(path.join(root, 'Library/Foto/2023/IMG_0003.jpg'))).toBe(true)
    expect(fs.existsSync(path.join(root, 'Library/Foto/2023/IMG_0004.jpg'))).toBe(true)
    expect(details(a.id)!.filePathRelative).toBe('Library/Foto/2023/IMG_0003.jpg')
    fs.rmSync(path.join(root, 'Library/Selezione/IMG_0003.jpg'))
  })

  it('rinomina con template e undo', async () => {
    const a = byName('IMG_0005.jpg')
    const prev = H()['files.renameTemplate']([a.id], '{YYYY}-{MM}-{DD}_{nnn}') as { preview: { to: string }[] }
    expect(prev.preview[0].to).toBe('2023-06-15_001.jpg')
    const r = H()['files.rename']([{ id: a.id, newName: prev.preview[0].to }]) as { ok: boolean; operationId: number }
    expect(r.ok).toBe(true)
    expect(fs.existsSync(path.join(root, 'Library/Foto/2023/2023-06-15_001.jpg'))).toBe(true)
    await H()['operations.undo'](r.operationId)
    expect(fs.existsSync(path.join(root, 'Library/Foto/2023/IMG_0005.jpg'))).toBe(true)
    // rinomina verso un nome esistente: rifiutata
    const clash = H()['files.rename']([{ id: a.id, newName: 'IMG_0000.jpg' }]) as { ok: boolean }
    expect(clash.ok).toBe(false)
  })

  it('cestino: preferiti protetti, ripristino, svuotamento solo con conferma', async () => {
    const fav = byName('IMG_0002.jpg')
    H()['media.favorite']([fav.id], true)
    const blocked = await H()['files.trash']([fav.id])
    expect(blocked.affected).toBe(0)
    expect(fs.existsSync(path.join(root, 'Library/Foto/2023/IMG_0002.jpg'))).toBe(true)

    const t = byName('quadrata.webp')
    const r = await H()['files.trash']([t.id])
    expect(r.affected).toBe(1)
    expect(fs.existsSync(path.join(root, 'Library/Foto/quadrata.webp'))).toBe(false)
    const entries = H()['trash.list']() as { id: number; trashPath: string; originalPath: string }[]
    expect(entries).toHaveLength(1)
    expect(entries[0].originalPath).toBe('Library/Foto/quadrata.webp')
    expect(fs.existsSync(path.join(root, entries[0].trashPath))).toBe(true)
    expect((H()['library.query']({}) as { id: number }[]).some((i) => i.id === t.id)).toBe(false)

    // un nuovo file con lo stesso nome nel frattempo: il ripristino non lo sovrascrive
    fs.writeFileSync(path.join(root, 'Library/Foto/quadrata.webp'), 'nuovo')
    const res = H()['trash.restore']([entries[0].id]) as { ok: boolean }
    expect(res.ok).toBe(true)
    expect(fs.readFileSync(path.join(root, 'Library/Foto/quadrata.webp'), 'utf8')).toBe('nuovo')
    expect(fs.existsSync(path.join(root, 'Library/Foto/quadrata (1).webp'))).toBe(true)
    expect(details(t.id)!.status).toBe('ok')
    fs.rmSync(path.join(root, 'Library/Foto/quadrata.webp'))

    // Svuotamento definitivo
    await H()['files.trash']([t.id])
    const refused = H()['trash.empty']({ confirmToken: 'sì' }) as { ok: boolean }
    expect(refused.ok).toBe(false)
    expect((H()['trash.list']() as unknown[]).length).toBe(1)
    const purged = H()['trash.empty']({ confirmToken: EMPTY_TRASH_CONFIRM }) as { affected: number }
    expect(purged.affected).toBe(1)
    expect((H()['trash.list']() as unknown[]).length).toBe(0)
    expect(details(t.id)).toBeNull()
  })

  it('review: scarta con flag, poi sposta nel cestino con dry-run', async () => {
    const a = byName('IMG_0000.jpg')
    H()['media.flag']([a.id], 'trash')
    const dry = (await H()['files.trashFlagged']({ dryRun: true })) as { affected: number }
    expect(dry.affected).toBe(1)
    expect(fs.existsSync(path.join(root, 'Library/Foto/2023/IMG_0000.jpg'))).toBe(true)
    const real = await H()['files.trashFlagged']({ dryRun: false })
    expect(real.affected).toBe(1)
    const u = await H()['operations.undo']()
    expect(u.ok).toBe(true)
    expect(fs.existsSync(path.join(root, 'Library/Foto/2023/IMG_0000.jpg'))).toBe(true)
  })

  it('riconcilia file spostati fuori dall\'app mantenendo tag e rating', async () => {
    const id = byName('IMG_0002.jpg').id
    H()['media.rate']([id], 5)
    fs.mkdirSync(path.join(root, 'Library/Riordinate'), { recursive: true })
    fs.renameSync(path.join(root, 'Library/Foto/2023/IMG_0002.jpg'), path.join(root, 'Library/Riordinate/IMG_0002.jpg'))
    const p = await scan()
    expect(p.moved).toBe(1)
    expect(p.missing).toBe(0)
    const d = details(id)!
    expect(d.filePathRelative).toBe('Library/Riordinate/IMG_0002.jpg')
    expect(d.rating).toBe(5)
    expect(d.tags.map((t) => t.name).sort()).toEqual(['Estate', 'Mare'])
  })

  it('segna come mancanti i file cancellati fuori dall\'app', async () => {
    const id = byName('IMG_0005.jpg').id
    const tmp = path.join(os.tmpdir(), `vv-hold-${Date.now()}.jpg`)
    fs.copyFileSync(path.join(root, 'Library/Foto/2023/IMG_0005.jpg'), tmp)
    fs.rmSync(path.join(root, 'Library/Foto/2023/IMG_0005.jpg'))
    const p = await scan()
    expect(p.missing).toBe(1)
    expect(details(id)!.status).toBe('missing')
    fs.copyFileSync(tmp, path.join(root, 'Library/Foto/2023/IMG_0005.jpg'))
    fs.utimesSync(path.join(root, 'Library/Foto/2023/IMG_0005.jpg'), new Date(), new Date(vs.ctx.media.getRow(id)!.modified_at))
    await scan()
    expect(details(id)!.status).toBe('ok')
  })

  it('funziona dopo aver spostato l\'intero vault (SSD su altra lettera/percorso)', async () => {
    const countBefore = (H()['library.query']({}) as unknown[]).length
    const favId = byName('IMG_0002.jpg').id
    await vs.close()
    const newRoot = `${root}-spostato`
    fs.renameSync(root, newRoot)
    root = newRoot
    vs = openVault({ root, tools, workerDir: WORKERS, appVersion: 'test', thumbPool: 1 })
    expect(vs.rootChanged).not.toBeNull()
    expect((H()['library.query']({}) as unknown[]).length).toBe(countBefore)
    expect(details(favId)!.absolutePath.startsWith(newRoot)).toBe(true)
    const p = await scan()
    expect(p.missing).toBe(0)
    expect(p.added).toBe(0)
    expect(await vs.thumbs.ensure(favId)).toBe(true)
  })

  it('log operazioni persistente senza percorsi assoluti', () => {
    const logs = fs.readdirSync(path.join(root, 'Logs'))
    const opsLog = logs.find((f) => f.startsWith('operations-'))!
    const content = fs.readFileSync(path.join(root, 'Logs', opsLog), 'utf8')
    expect(content).toContain('files.move')
    expect(content).not.toContain(os.tmpdir())
    expect((H()['operations.list'](50) as unknown[]).length).toBeGreaterThan(5)
  })
})
