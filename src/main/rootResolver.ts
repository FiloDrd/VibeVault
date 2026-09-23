import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { writeFileAtomic } from './vault'

/**
 * Dove vive il vault:
 *   - VIBEVAULT_ROOT (variabile d'ambiente) se impostata
 *   - root scelta dall'utente, salvata in un piccolo file di config accanto all'app
 *     (percorso relativo quando possibile → resta valido se la lettera dell'unità cambia)
 *   - build portatile: se l'exe sta in <root>/App/, la root è la cartella padre;
 *     altrimenti la cartella dell'exe stessa
 *   - sviluppo: <progetto>/.vault-dev
 */
export interface RootResolution {
  root: string
  portable: boolean
  configFile: string
}

function baseDir(): { base: string; portable: boolean } {
  if (app.isPackaged) {
    const exeDir = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(app.getPath('exe'))
    return { base: exeDir, portable: true }
  }
  return { base: app.getAppPath(), portable: false }
}

export function resolveRoot(): RootResolution {
  const { base, portable } = baseDir()
  const configFile = path.join(base, portable ? 'vibevault.config.json' : '.vault-root.json')
  if (process.env.VIBEVAULT_ROOT) return { root: path.resolve(process.env.VIBEVAULT_ROOT), portable, configFile }
  try {
    const cfg = JSON.parse(fs.readFileSync(configFile, 'utf8')) as { root?: string }
    if (cfg.root) {
      const r = path.resolve(base, cfg.root)
      if (fs.existsSync(r)) return { root: r, portable, configFile }
    }
  } catch {
    /* nessuna config: default */
  }
  if (portable) {
    const root = path.basename(base).toLowerCase() === 'app' ? path.dirname(base) : base
    return { root, portable, configFile }
  }
  return { root: path.join(base, '.vault-dev'), portable, configFile }
}

export function saveRootChoice(configFile: string, root: string): void {
  const base = path.dirname(configFile)
  const rel = path.relative(base, root)
  // stesso disco → relativo (portabile); altrimenti assoluto
  const value = !path.isAbsolute(rel) && path.parse(base).root === path.parse(root).root ? rel || '.' : root
  writeFileAtomic(configFile, JSON.stringify({ root: value }, null, 2))
}
