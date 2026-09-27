import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import type { Tools } from './context'

const req = createRequire(__filename)
const exe = (name: string) => (process.platform === 'win32' ? `${name}.exe` : name)

function unpacked(p: string | null | undefined): string | null {
  if (!p) return null
  const fixed = p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)
  return fs.existsSync(fixed) ? fixed : fs.existsSync(p) ? p : null
}

function onPath(name: string): string | null {
  try {
    const r = spawnSync(name, ['-version'], { windowsHide: true, timeout: 5000 })
    return r.status === 0 ? name : null
  } catch {
    return null
  }
}

/**
 * Ordine di ricerca FFmpeg/ffprobe:
 *   1. cartelle bin/ locali (es. <cartella dell'exe>/bin: binari portatili messi dall'utente)
 *   2. pacchetti ffmpeg-static / ffprobe-static inclusi nella build
 *   3. PATH di sistema
 */
export function resolveTools(localBinDirs: string[]): Tools {
  const local = (n: string) => {
    for (const dir of localBinDirs) {
      const p = path.join(dir, exe(n))
      if (fs.existsSync(p)) return p
    }
    return null
  }
  let ffmpegStatic: string | null = null
  let ffprobeStatic: string | null = null
  try { ffmpegStatic = unpacked(req('ffmpeg-static') as string) } catch { /* non installato */ }
  try { ffprobeStatic = unpacked((req('ffprobe-static') as { path: string }).path) } catch { /* non installato */ }
  return {
    ffmpeg: local('ffmpeg') ?? ffmpegStatic ?? onPath('ffmpeg'),
    ffprobe: local('ffprobe') ?? ffprobeStatic ?? onPath('ffprobe')
  }
}
