// Completa l'installazione dopo "npm install" --ignore-scripts:
// scarica l'eseguibile di Electron e FFmpeg per questo sistema operativo.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const run = (label, file) => {
  const p = path.join(root, 'node_modules', file)
  if (!fs.existsSync(p)) { console.log(`- ${label}: pacchetto non trovato, salto`); return }
  console.log(`- ${label}...`)
  execFileSync(process.execPath, [p], { stdio: 'inherit', cwd: path.dirname(p) })
}
run('Electron', 'electron/install.js')
run('FFmpeg', 'ffmpeg-static/install.js')
console.log('\nPronto. Avvia con: npm run dev')
