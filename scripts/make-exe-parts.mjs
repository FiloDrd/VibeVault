// Prepara VibeVault-SSD/ per GitHub: l'exe portatile (oltre 100 MB, limite di GitHub)
// viene spezzato in parti da 19.000.000 byte; UNISCI-VibeVault.cmd le ricompone su
// Windows e verifica lo SHA-256.
//
//   npm run dist:parts   (= dist:portable + questo script)
//
// Tocca SOLO i file VibeVault.exe.partNN e UNISCI-VibeVault.cmd dentro VibeVault-SSD/.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const root = path.resolve(import.meta.dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const exe = path.join(root, 'dist', `VibeVault-${pkg.version}-portable.exe`)
const out = path.join(root, 'VibeVault-SSD')
const PART = 19_000_000

if (!fs.existsSync(exe)) {
  console.error(`Exe non trovato: ${exe}\nEsegui prima "npm run dist:portable".`)
  process.exit(1)
}
fs.mkdirSync(out, { recursive: true })

// rimuove le parti della versione precedente (solo file con questo nome esatto)
for (const f of fs.readdirSync(out)) if (/^VibeVault\.exe\.part\d{2}$/.test(f)) fs.rmSync(path.join(out, f))

const data = fs.readFileSync(exe)
const sha = crypto.createHash('sha256').update(data).digest('hex')
const parts = []
for (let i = 0, off = 0; off < data.length; i++, off += PART) {
  const name = `VibeVault.exe.part${String(i).padStart(2, '0')}`
  fs.writeFileSync(path.join(out, name), data.subarray(off, off + PART))
  parts.push(name)
}
const ids = parts.map((p) => p.slice(-2))

const cmd = [
  '@echo off',
  'chcp 65001 >nul',
  'setlocal',
  'cd /d "%~dp0"',
  'echo.',
  `echo  VibeVault ${pkg.version} - ricompongo VibeVault.exe dalle ${parts.length} parti...`,
  'echo.',
  'if exist VibeVault.exe (',
  "  echo  VibeVault.exe esiste gia' in questa cartella: non lo sovrascrivo.",
  '  echo  Rinominalo o spostalo e rilancia questo file.',
  '  pause',
  '  exit /b 1',
  ')',
  `for %%P in (${ids.join(' ')}) do (`,
  '  if not exist "VibeVault.exe.part%%P" (',
  '    echo  Manca la parte VibeVault.exe.part%%P',
  '    pause',
  '    exit /b 1',
  '  )',
  ')',
  `copy /b ${parts.join('+')} VibeVault.exe >nul`,
  "echo  Verifico l'integrita' (SHA-256)...",
  `certutil -hashfile VibeVault.exe SHA256 | findstr /i /c:"${sha}" >nul`,
  'if errorlevel 1 (',
  '  echo.',
  "  echo  ERRORE: il file ricomposto non corrisponde all'originale. Non usarlo.",
  '  del VibeVault.exe',
  '  pause',
  '  exit /b 1',
  ')',
  'echo.',
  'echo  OK: VibeVault.exe creato e verificato.',
  'echo.',
  `choice /c SN /m " Elimino le ${parts.length} parti ormai inutili"`,
  'if errorlevel 2 goto fine',
  'del VibeVault.exe.part??',
  ':fine',
  'echo.',
  'echo  Fatto. Copia VibeVault.exe e "ISTRUZIONI VibeVault.txt" dove preferisci',
  'echo  (anche sull\'SSD, accanto alla cartella delle foto) e avvialo con doppio clic.',
  'echo.',
  'pause',
  ''
].join('\r\n')
fs.writeFileSync(path.join(out, 'UNISCI-VibeVault.cmd'), cmd)

console.log(`Exe: ${path.relative(root, exe)} (${data.length} byte)`)
console.log(`SHA-256: ${sha}`)
console.log(`Parti: ${parts.length} in ${path.relative(root, out)}/`)
