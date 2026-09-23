// Assembla la cartella portatile pronta per l'SSD:
//
//   release/VibeVault/
//     App/            ← build Electron (VibeVault.exe + risorse)
//     Library/        ← qui vanno foto, video e GIF
//     LEGGIMI.txt
//
// Le altre cartelle (VaultData, Cache, Trash, Exports, Logs) vengono create
// dall'app al primo avvio. Non cancella mai nulla fuori da release/.
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const dist = path.join(root, 'dist')
const unpacked = fs.readdirSync(dist).map((d) => path.join(dist, d)).find((d) => /-unpacked$/.test(d) && fs.statSync(d).isDirectory())
if (!unpacked) {
  console.error('Build non trovata: esegui prima "npm run dist:dir"')
  process.exit(1)
}
const out = path.join(root, 'release', 'VibeVault')
const app = path.join(out, 'App')
if (fs.existsSync(app)) {
  // sostituisce SOLO la cartella App (mai Library o i dati del vault)
  fs.rmSync(app, { recursive: true, force: true })
}
fs.mkdirSync(out, { recursive: true })
fs.cpSync(unpacked, app, { recursive: true })
for (const d of ['Library/Foto', 'Library/Video', 'Library/GIF', 'Library/Raw', 'Library/Screenshots', 'Library/Archivio']) {
  fs.mkdirSync(path.join(out, d), { recursive: true })
}
fs.writeFileSync(
  path.join(out, 'LEGGIMI.txt'),
  [
    'VibeVault — media manager portatile',
    '',
    '1. Copia questa cartella "VibeVault" sul tuo SSD.',
    '2. Metti foto, video e GIF dentro Library/ (anche in sottocartelle).',
    '3. Avvia App/VibeVault.exe (Windows).',
    '',
    'Tutto resta dentro questa cartella: database (VaultData/), miniature (Cache/),',
    'cestino (Trash/), export (Exports/) e log (Logs/). Puoi spostare la cartella',
    'o collegare l\'SSD a un altro PC: i percorsi sono relativi.',
    '',
    'Eliminare: i file vanno prima nel Cestino interno (Trash/). Solo "Svuota',
    'cestino" con doppia conferma li cancella davvero dal disco.',
    ''
  ].join('\r\n')
)
console.log(`Pronto: ${out}`)
