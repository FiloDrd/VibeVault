/**
 * Regressioni sulla sicurezza dei file (problemi emersi dalla revisione indipendente).
 * Richiede `npm run build` (worker compilati in out/main).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { openVault, type VaultSession } from '../src/main/bootstrap'
import { EMPTY_TRASH_CONFIRM } from '../src/shared/ipc'
import { isReservedName } from '../src/main/vault'

const WORKERS = path.resolve(__dirname, '../out/main')
const tools = { ffmpeg: null, ffprobe: null }
let vs: VaultSession | null = null
let root = ''

async function setup(files: Record<string, string | Buffer>): Promise<Required<VaultSession['handlers']>> {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vv-safe-'))
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(root, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, content)
  }
  vs = openVault({ root, tools, workerDir: WORKERS, appVersion: 'test', thumbPool: 1 })
  vs.scan.start()
  await vs.scan.wait()
  return vs.handlers as Required<VaultSession['handlers']>
}

const img = (color: string) => sharp({ create: { width: 40, height: 30, channels: 3, background: color } }).jpeg().toBuffer()
const idOf = (name: string) => (vs!.ctx.db.prepare(`SELECT id FROM media WHERE file_name = ?`).get(name) as { id: number }).id
const read = (rel: string) => fs.readFileSync(path.join(root, rel))

afterEach(async () => { await vs?.close(); vs = null })

describe('sicurezza file', () => {
  it('rinomina solo-maiuscole non sovrascrive un file diverso', async () => {
    const a = await img('#ff0000'), b = await img('#0000ff')
    const H = await setup({ 'Library/t/a.jpg': a, 'Library/t/x.jpg': b })
    // su FS case-sensitive creiamo un secondo file "A.jpg" distinto
    const caseSensitive = !fs.existsSync(path.join(root, 'Library/t/A.jpg'))
    if (caseSensitive) fs.writeFileSync(path.join(root, 'Library/t/A.jpg'), b)
    const r = H['files.rename']([{ id: idOf('a.jpg'), newName: 'A' }]) as { ok: boolean }
    if (caseSensitive) {
      expect(r.ok).toBe(false)
      expect(read('Library/t/a.jpg').equals(a)).toBe(true)
      expect(read('Library/t/A.jpg').equals(b)).toBe(true)
    }
    // cambio di maiuscole sullo stesso file (nessun altro file): consentito
    const r2 = H['files.rename']([{ id: idOf('x.jpg'), newName: 'X' }]) as { ok: boolean }
    expect(r2.ok).toBe(true)
    expect(read('Library/t/X.jpg').equals(b)).toBe(true)
  })

  it('gli id non vengono riutilizzati: l\'undo di una copia vecchia non tocca file nuovi', async () => {
    const H = await setup({ 'Library/a.jpg': await img('#00ff00') })
    const copy = (await H['files.copy']([idOf('a.jpg')], 'Library/copie')) as { operationId: number }
    const copyId = idOf('a.jpg') === idOf('a.jpg') ? (vs!.ctx.db.prepare(`SELECT id FROM media WHERE folder_path_relative = 'Library/copie'`).get() as { id: number }).id : 0
    await H['files.trash']([copyId])
    H['trash.empty']({ confirmToken: EMPTY_TRASH_CONFIRM })
    fs.writeFileSync(path.join(root, 'Library/nuovo.jpg'), await img('#123456'))
    vs!.scan.start(); await vs!.scan.wait()
    const nuovo = idOf('nuovo.jpg')
    expect(nuovo).not.toBe(copyId)
    H['media.favorite']([nuovo], true)
    const u = await H['operations.undo'](copy.operationId)
    expect(u.affected).toBe(0)
    expect(fs.existsSync(path.join(root, 'Library/nuovo.jpg'))).toBe(true)
  })

  it('cartelle di sistema protette senza distinzione di maiuscole e punti finali', async () => {
    expect(isReservedName('cache')).toBe(true)
    expect(isReservedName('Cache.')).toBe(true)
    expect(isReservedName('TRASH ')).toBe(true)
    expect(isReservedName('Cachet')).toBe(false)
    const H = await setup({ 'Library/a.jpg': await img('#abcdef') })
    const r = await H['files.move']([idOf('a.jpg')], 'cache/thumbnails/0000')
    expect(r.ok).toBe(false)
    expect(fs.existsSync(path.join(root, 'Library/a.jpg'))).toBe(true)
  })

  it('svuota cache elimina solo miniature generate dall\'app', async () => {
    const H = await setup({ 'Library/a.jpg': await img('#fedcba') })
    const bucket = path.join(root, 'Cache/thumbnails/0000')
    fs.mkdirSync(bucket, { recursive: true })
    fs.writeFileSync(path.join(bucket, 'foto-utente.jpg'), 'mio')
    fs.writeFileSync(path.join(root, 'Cache/nota.txt'), 'mia')
    fs.writeFileSync(path.join(bucket, '999.webp'), 'thumb')
    H['maintenance.clearCache']()
    expect(fs.existsSync(path.join(bucket, 'foto-utente.jpg'))).toBe(true)
    expect(fs.existsSync(path.join(root, 'Cache/nota.txt'))).toBe(true)
    expect(fs.existsSync(path.join(bucket, '999.webp'))).toBe(false)
  })

  it('non si può rinominare un elemento nel cestino', async () => {
    const H = await setup({ 'Library/a.jpg': await img('#111111') })
    const id = idOf('a.jpg')
    await H['files.trash']([id])
    const r = H['files.rename']([{ id, newName: 'zzz' }]) as { ok: boolean }
    expect(r.ok).toBe(false)
    const t = H['trash.list']() as { id: number }[]
    expect((H['trash.restore']([t[0].id]) as { ok: boolean }).ok).toBe(true)
    expect(fs.existsSync(path.join(root, 'Library/a.jpg'))).toBe(true)
  })

  it('riconciliazione: niente fusioni ambigue e il flag "scarta" non si eredita', async () => {
    const same = await img('#222222')
    const H = await setup({ 'Library/c1/a.jpg': same, 'Library/c2/a.jpg': same, 'Library/solo.jpg': await img('#333333') })
    // due copie identiche spariscono, ne ricompare una: ambiguo → nessuna fusione
    const hold = path.join(os.tmpdir(), `vv-hold-${Date.now()}.jpg`)
    fs.copyFileSync(path.join(root, 'Library/c1/a.jpg'), hold)
    fs.rmSync(path.join(root, 'Library/c1/a.jpg'))
    fs.rmSync(path.join(root, 'Library/c2/a.jpg'))
    fs.mkdirSync(path.join(root, 'Library/c3'))
    fs.copyFileSync(hold, path.join(root, 'Library/c3/a.jpg'))
    vs!.scan.start()
    const p = await vs!.scan.wait()
    expect(p.moved).toBe(0)
    // un file segnato "scarta" e spostato fuori dall'app torna "nessun flag"
    H['media.flag']([idOf('solo.jpg')], 'trash')
    const soloId = idOf('solo.jpg')
    fs.mkdirSync(path.join(root, 'Library/altrove'))
    fs.renameSync(path.join(root, 'Library/solo.jpg'), path.join(root, 'Library/altrove/solo.jpg'))
    vs!.scan.start()
    const p2 = await vs!.scan.wait()
    expect(p2.moved).toBe(1)
    const d = vs!.ctx.media.details(soloId, (r) => r)!
    expect(d.filePathRelative).toBe('Library/altrove/solo.jpg')
    expect(d.flag).toBe('none')
  })

  it('un file esistente non viene mai segnato mancante', async () => {
    await setup({ 'Library/a.jpg': await img('#444444') })
    const id = idOf('a.jpg')
    // simula un file non visto dal worker (es. spostato durante la scansione) ma presente su disco
    vs!.ctx.db.prepare(`UPDATE media SET last_seen_scan = 0 WHERE id = ?`).run(id)
    const n = vs!.ctx.media.markMissing(999, ['Library'], (rel) => fs.existsSync(path.join(root, rel)))
    expect(n).toBe(0)
  })
})
