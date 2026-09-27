import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDatabase, backupDatabase } from '../src/main/db/database'
import { MIGRATIONS } from '../src/main/db/schema'
import { MediaRepo, type ScannedRecord } from '../src/main/db/mediaRepo'
import { AlbumRepo, SettingsRepo, TagRepo } from '../src/main/db/orgRepo'

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vv-db-'))
}

export function rec(rel: string, over: Partial<ScannedRecord> = {}): ScannedRecord {
  const name = rel.split('/').pop()!
  return {
    rel, folder: rel.split('/').slice(0, -1).join('/'), name, ext: name.split('.').pop()!, mime: 'image/jpeg', kind: 'photo',
    size: 1000, mtime: 1_600_000_000_000, birthtime: 1_600_000_000_000, exifDate: null, width: 100, height: 50,
    durationMs: null, orientation: null, make: null, model: null, lat: null, lon: null, hashQuick: 'h-' + rel,
    isScreenshot: false, status: 'ok', error: null, takeoutDate: null, nameDate: null, origin: 'unknown', takeout: null, ...over
  }
}

describe('database', () => {
  it('crea schema, indici e user_version', () => {
    const dir = tmpDir()
    const { db, recovered } = openDatabase(path.join(dir, 'database.sqlite'))
    expect(recovered).toBe(false)
    expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length)
    const idx = (db.prepare(`SELECT name FROM sqlite_master WHERE type='index'`).all() as { name: string }[]).map((r) => r.name)
    for (const n of ['idx_media_folder', 'idx_media_kind_date', 'idx_media_rating', 'idx_media_favorite', 'idx_media_date']) expect(idx).toContain(n)
    db.close()
  })

  it('recupera un database corrotto mettendolo da parte', () => {
    const dir = tmpDir()
    const p = path.join(dir, 'database.sqlite')
    fs.writeFileSync(p, 'questo non è un database sqlite'.repeat(100))
    const { db, recovered } = openDatabase(p)
    expect(recovered).toBe(true)
    expect(fs.readdirSync(dir).some((f) => f.includes('.corrupt-'))).toBe(true)
    db.close()
  })

  it('upsert, query, filtri, ricerca e riconciliazione spostamenti', () => {
    const { db } = openDatabase(path.join(tmpDir(), 'd.sqlite'))
    const repo = new MediaRepo(db)
    const s1 = repo.upsertScanned([
      rec('Library/Foto/a.jpg', { exifDate: Date.UTC(2023, 5, 1) }),
      rec('Library/Foto/b.png', { size: 2000 }),
      rec('Library/Video/c.mp4', { kind: 'video', durationMs: 5000, width: 1080, height: 1920 })
    ], 1)
    expect(s1.added).toHaveLength(3)
    expect(repo.query({}, { largeThresholdBytes: 1e9 })).toHaveLength(3)
    expect(repo.query({ kinds: ['video'] }, { largeThresholdBytes: 1e9 })).toHaveLength(1)
    expect(repo.query({ orientation: 'portrait' }, { largeThresholdBytes: 1e9 })[0].n).toBe('c.mp4')
    expect(repo.query({ search: 'year:2023' }, { largeThresholdBytes: 1e9 })).toHaveLength(1)
    expect(repo.query({ search: 'ext:png' }, { largeThresholdBytes: 1e9 })[0].n).toBe('b.png')
    expect(repo.query({ folder: 'Library', recursive: true }, { largeThresholdBytes: 1e9 })).toHaveLength(3)
    expect(repo.query({ folder: 'Library/Foto' }, { largeThresholdBytes: 1e9 })).toHaveLength(2)
    expect(repo.query({ noDate: true }, { largeThresholdBytes: 1e9 })).toHaveLength(2)

    // tag + rating sul file a.jpg
    const aId = s1.added[0]
    new TagRepo(db).add([aId], ['Mare'])
    repo.setField([aId], 'rating', 5)
    expect(repo.query({ search: 'tag:mar' }, { largeThresholdBytes: 1e9 })).toHaveLength(1)

    // Scan 2: a.jpg è stato spostato fuori dall'app in un'altra cartella
    const s2 = repo.upsertScanned([
      rec('Library/Viaggi/a.jpg', { exifDate: Date.UTC(2023, 5, 1), hashQuick: 'h-Library/Foto/a.jpg' }),
      rec('Library/Foto/b.png', { size: 2000 }),
      rec('Library/Video/c.mp4', { kind: 'video', durationMs: 5000, width: 1080, height: 1920 })
    ], 2)
    expect(s2.added).toHaveLength(1)
    expect(s2.unchanged).toBe(2)
    expect(repo.markMissing(2, ['Library'], () => false)).toBe(1)
    expect(repo.reconcileMoves(s2.added)).toBe(1)
    const moved = repo.details(aId, (r) => r)!
    expect(moved.filePathRelative).toBe('Library/Viaggi/a.jpg')
    expect(moved.status).toBe('ok')
    expect(moved.rating).toBe(5)
    expect(moved.tags.map((t) => t.name)).toEqual(['Mare'])
    expect(repo.query({}, { largeThresholdBytes: 1e9 })).toHaveLength(3)

    repo.rebuildFolders()
    const folders = repo.folders().map((f) => f.pathRelative)
    expect(folders).toEqual(expect.arrayContaining(['Library', 'Library/Foto', 'Library/Viaggi', 'Library/Video']))
    expect(repo.folders().find((f) => f.pathRelative === 'Library')!.fileCount).toBe(3)
    db.close()
  })

  it('album, settings e backup', async () => {
    const dir = tmpDir()
    const { db } = openDatabase(path.join(dir, 'd.sqlite'))
    const repo = new MediaRepo(db)
    const { added } = repo.upsertScanned([rec('Library/x.jpg'), rec('Library/y.jpg')], 1)
    const albums = new AlbumRepo(db)
    const a = albums.create('Estate')
    expect(albums.addItems(a.id, added)).toHaveLength(2)
    expect(albums.addItems(a.id, added)).toHaveLength(0)
    expect(albums.list()[0].count).toBe(2)
    expect(repo.query({ albumId: a.id }, { largeThresholdBytes: 1e9 }).map((i) => i.id)).toEqual(added)

    const settings = new SettingsRepo(db)
    expect(settings.getAll().theme).toBe('dark')
    expect(settings.set({ theme: 'light' }).theme).toBe('light')

    const b = await backupDatabase(db, path.join(dir, 'backups'))
    expect(fs.existsSync(b)).toBe(true)
    db.close()
  })
})
