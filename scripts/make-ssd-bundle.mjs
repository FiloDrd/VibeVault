// Assembla la cartella portatile pronta per l'SSD:
//
//   release/VibeVault/
//     App/            ← build Electron (VibeVault.exe + risorse)
//     LEGGIMI.txt
//
// Le foto restano nella cartella dell'utente: l'app scrive solo la cartella
// nascosta .vibevault/ dentro la cartella foto scelta e VibeVault-dati/ accanto
// all'exe. Non cancella mai nulla fuori da release/.
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
  // sostituisce SOLO la cartella App (mai i dati dell'utente)
  fs.rmSync(app, { recursive: true, force: true })
}
fs.mkdirSync(out, { recursive: true })
fs.cpSync(unpacked, app, { recursive: true })
fs.writeFileSync(
  path.join(out, 'LEGGIMI.txt'),
  [
    'VibeVault — media manager portatile',
    '',
    '1. Copia questa cartella "VibeVault" dove preferisci (anche sull\'SSD delle foto).',
    '2. Avvia App/VibeVault.exe (Windows) e scegli la cartella delle tue foto.',
    '3. VibeVault legge tutte le sottocartelle e mostra un\'unica timeline per data.',
    '',
    'Le foto non vengono spostate. L\'app scrive solo la cartella nascosta .vibevault',
    'dentro la cartella foto (indice, miniature, cestino, log) e App/VibeVault-dati',
    '(cartelle recenti). I percorsi sono relativi: puoi collegare l\'SSD a un altro PC.',
    '',
    'Eliminare: i file vanno prima nel Cestino interno (.vibevault/trash). Solo "Svuota',
    'cestino" con doppia conferma li cancella davvero dal disco.',
    ''
  ].join('\r\n')
)
console.log(`Pronto: ${out}`)
