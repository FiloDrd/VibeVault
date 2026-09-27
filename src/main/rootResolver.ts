import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { writeFileAtomic } from './vault'

/**
 * Dove vivono i dati dell'APP (non quelli delle foto):
 *   - build portatile: cartella "VibeVault-dati" accanto all'exe
 *     (profilo Chromium + elenco delle cartelle recenti)
 *   - sviluppo: <progetto>/.vault-dev/app
 *
 * I dati di ogni cartella foto (database, miniature, cestino) stanno invece
 * dentro la cartella stessa, in .vibevault/ (vedi vault.ts).
 *
 * Le cartelle recenti si salvano relative all'exe quando sono sullo stesso disco:
 * così restano valide anche se l'SSD cambia lettera di unità.
 */
export interface AppPaths {
  base: string
  portable: boolean
  appDataDir: string
  configFile: string
  /** config della v0.1 (vibevault.config.json / .vault-root.json con la sola "root") */
  legacyConfigFile: string
}

const MAX_RECENT = 8

export function appPaths(): AppPaths {
  if (app.isPackaged) {
    const base = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(app.getPath('exe'))
    const appDataDir = path.join(base, 'VibeVault-dati')
    return { base, portable: true, appDataDir, configFile: path.join(appDataDir, 'config.json'), legacyConfigFile: path.join(base, 'vibevault.config.json') }
  }
  const base = app.getAppPath()
  const appDataDir = path.join(base, '.vault-dev', 'app')
  return { base, portable: false, appDataDir, configFile: path.join(appDataDir, 'config.json'), legacyConfigFile: path.join(base, '.vault-root.json') }
}

interface StoredConfig { recent?: string[] }

function toStored(base: string, abs: string): string {
  const rel = path.relative(base, abs)
  // stesso disco → relativo (portabile); altrimenti assoluto
  return !path.isAbsolute(rel) && path.parse(base).root.toLowerCase() === path.parse(abs).root.toLowerCase() ? rel || '.' : abs
}

export function samePath(a: string, b: string): boolean {
  const na = path.resolve(a)
  const nb = path.resolve(b)
  return process.platform === 'win32' || process.platform === 'darwin' ? na.toLowerCase() === nb.toLowerCase() : na === nb
}

/** Cartelle recenti (assolute), la più recente per prima. */
export function loadRecent(p: AppPaths): string[] {
  const out: string[] = []
  const push = (abs: string) => { if (!out.some((x) => samePath(x, abs))) out.push(abs) }
  try {
    const cfg = JSON.parse(fs.readFileSync(p.configFile, 'utf8')) as StoredConfig
    for (const r of cfg.recent ?? []) if (typeof r === 'string' && r) push(path.resolve(p.base, r))
  } catch { /* nessuna config */ }
  if (!out.length) {
    try {
      const old = JSON.parse(fs.readFileSync(p.legacyConfigFile, 'utf8')) as { root?: string }
      if (old.root) push(path.resolve(p.base, old.root))
    } catch { /* nessuna config v0.1 */ }
  }
  return out.slice(0, MAX_RECENT)
}

export function saveRecent(p: AppPaths, list: string[]): void {
  writeFileAtomic(p.configFile, JSON.stringify({ recent: list.slice(0, MAX_RECENT).map((abs) => toStored(p.base, abs)) }, null, 2))
}

export function pushRecent(p: AppPaths, abs: string): string[] {
  const list = [abs, ...loadRecent(p).filter((x) => !samePath(x, abs))]
  saveRecent(p, list)
  return list
}

export function forgetRecent(p: AppPaths, abs: string): string[] {
  const list = loadRecent(p).filter((x) => !samePath(x, abs))
  saveRecent(p, list)
  return list
}

/** Cartella da aprire all'avvio: VIBEVAULT_ROOT, altrimenti l'ultima cartella recente che esiste ancora. */
export function initialFolder(p: AppPaths): string | null {
  if (process.env.VIBEVAULT_ROOT) return path.resolve(process.env.VIBEVAULT_ROOT)
  return loadRecent(p).find((f) => fs.existsSync(f)) ?? null
}
