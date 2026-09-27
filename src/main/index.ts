import path from 'node:path'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, session, shell } from 'electron'
import { IPC_CHANNELS, type IpcChannel, type IpcEventName, type IpcEvents } from '@shared/ipc'
import { DEFAULT_SETTINGS, type RecentFolder, type VaultInfo } from '@shared/types'
import { appPaths, forgetRecent, initialFolder, loadRecent, pushRecent, samePath, type AppPaths } from './rootResolver'
import { registerProtocolHandler, registerSchemePrivileges } from './protocol'
import { resolveTools } from './tools'
import { openVault, type VaultSession } from './bootstrap'
import type { ActionHandlers } from './handlers'
import type { Tools } from './context'
import { DATA_DIR_NAME, normalizeRel } from './vault'

// ------------------------------------------------------------------ pre-ready

const paths: AppPaths = appPaths()
// Tutto ciò che Chromium scrive (profilo, cache GPU) resta accanto all'app, non tra le foto
fs.mkdirSync(path.join(paths.appDataDir, 'electron'), { recursive: true })
app.setPath('userData', path.join(paths.appDataDir, 'electron'))
app.setPath('sessionData', path.join(paths.appDataDir, 'electron'))
registerSchemePrivileges()

if (!app.requestSingleInstanceLock()) app.quit()

let win: BrowserWindow | null = null
let vs: VaultSession | null = null
let tools: Tools = { ffmpeg: null, ffprobe: null }
/** Le aperture di cartella sono serializzate: mai due vault aperti insieme. */
let queue: Promise<unknown> = Promise.resolve()

function emit<E extends IpcEventName>(event: E, payload: IpcEvents[E]): void {
  if (win && !win.isDestroyed()) win.webContents.send(event, payload)
}

function vaultInfo(): VaultInfo | null {
  if (!vs) return null
  const ctx = vs.ctx
  return {
    root: ctx.vault.root,
    name: path.basename(ctx.vault.root) || ctx.vault.root,
    layout: ctx.vault.layout,
    libraryDir: ctx.vault.libraryDir,
    portable: paths.portable,
    rootChanged: vs.rootChanged,
    vaultId: vs.vaultId,
    dbPath: ctx.vault.toRel(ctx.vault.dbPath),
    tools: ctx.tools,
    version: app.getVersion()
  }
}

function recentList(): RecentFolder[] {
  return loadRecent(paths).map((p) => ({
    path: p,
    name: path.basename(p) || p,
    exists: fs.existsSync(p),
    current: !!vs && samePath(vs.ctx.vault.root, p)
  }))
}

// ------------------------------------------------------------------ apertura cartella

const SYSTEM_DIRS = ['windows', 'program files', 'program files (x86)', 'programdata']

/** Controlla che la cartella si possa usare. Restituisce un messaggio d'errore o null. */
function checkFolder(abs: string): string | null {
  let st: fs.Stats
  try { st = fs.statSync(abs) } catch { return 'La cartella non esiste (disco scollegato?)' }
  if (!st.isDirectory()) return 'Non è una cartella'
  const parsed = path.parse(abs)
  const rel = path.relative(parsed.root, abs).split(path.sep)
  if (rel[0] && SYSTEM_DIRS.includes(rel[0].toLowerCase())) return 'Cartella di sistema: scegli la cartella che contiene le tue foto'
  if (samePath(abs, paths.appDataDir) || abs.toLowerCase().startsWith(paths.appDataDir.toLowerCase() + path.sep)) return 'Questa è la cartella dei dati dell\'app: scegli la cartella delle foto'
  if (path.basename(abs).toLowerCase() === DATA_DIR_NAME) return 'Questa è la cartella interna di VibeVault: scegli la cartella delle foto'
  // serve poter scrivere .vibevault/ (indice, miniature, cestino)
  try {
    const probe = path.join(abs, DATA_DIR_NAME)
    fs.mkdirSync(probe, { recursive: true })
    const f = path.join(probe, `.write-test-${process.pid}`)
    fs.writeFileSync(f, 'ok')
    fs.rmSync(f)
  } catch {
    return 'Non posso scrivere in questa cartella (disco protetto o in sola lettura): serve per salvare indice e miniature'
  }
  return null
}

function openFolder(target: string): Promise<{ ok: boolean; message?: string }> {
  const run = async (): Promise<{ ok: boolean; message?: string }> => {
    const abs = path.resolve(target)
    if (vs && samePath(vs.ctx.vault.root, abs)) return { ok: true }
    const err = checkFolder(abs)
    if (err) return { ok: false, message: err }
    const prev = vs
    vs = null
    if (prev) {
      emit('vault:changed', null)
      try { await prev.close() } catch { /* ignora */ }
    }
    try {
      vs = openVault({ root: abs, tools, workerDir: __dirname, appVersion: app.getVersion(), emit })
    } catch (e) {
      return { ok: false, message: `Impossibile aprire la cartella: ${(e as Error).message}` }
    }
    try { pushRecent(paths, abs) } catch { /* l'elenco recenti è best effort */ }
    vs.ctx.log.info('folder.open', { layout: vs.ctx.vault.layout, portable: paths.portable, tools: { ffmpeg: !!tools.ffmpeg, ffprobe: !!tools.ffprobe } })
    if (vs.dbMessage && win) void dialog.showMessageBox(win, { type: 'warning', title: 'Indice ricostruito', message: vs.dbMessage })
    emit('vault:changed', vaultInfo())
    // indicizzazione incrementale: l'interfaccia è subito usabile
    const opened = vs
    setTimeout(() => { if (vs === opened) vs.scan.start() }, 500)
    return { ok: true }
  }
  const p = queue.then(run, run)
  queue = p.catch(() => undefined)
  return p
}

// ------------------------------------------------------------------ IPC

/** Risposte innocue quando nessuna cartella è aperta (schermata di benvenuto). */
const NO_FOLDER: ActionHandlers = {
  'settings.get': () => DEFAULT_SETTINGS,
  'library.scanStatus': () => ({ phase: 'idle', scanned: 0, added: 0, updated: 0, unchanged: 0, missing: 0, moved: 0, errors: 0 }),
  'library.scanErrors': () => [],
  'library.query': () => [],
  'library.folders': () => [],
  'library.duplicates': () => [],
  'albums.list': () => [],
  'tags.list': () => [],
  'trash.list': () => [],
  'operations.list': () => [],
  'thumbs.status': () => ({ queued: 0, done: 0, failed: 0 }),
  'thumbs.prioritize': () => undefined,
  'library.stats': () => ({ total: 0, totalBytes: 0, byKind: [], byYear: [], byExt: [], byOrigin: [], noDate: 0, missing: 0, corrupt: 0, trashed: 0, favorites: 0, withGps: 0, flags: { none: 0, keep: 0, maybe: 0, trash: 0 }, thumbsPending: 0 })
}

function electronHandlers(): ActionHandlers {
  const need = () => { if (!vs) throw new Error('Nessuna cartella aperta'); return vs }
  return {
    'vault.info': () => vaultInfo(),
    'vault.revealRoot': () => { if (vs) void shell.openPath(vs.ctx.vault.root) },
    'folder.openDialog': async () => {
      const r = await dialog.showOpenDialog(win!, {
        title: 'Scegli la cartella delle tue foto',
        defaultPath: vs?.ctx.vault.root ?? app.getPath('pictures'),
        properties: ['openDirectory']
      })
      if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true }
      return openFolder(r.filePaths[0])
    },
    'folder.recent': () => recentList(),
    'folder.open': (p) => {
      // solo cartelle già scelte dall'utente con il dialog di sistema
      const known = loadRecent(paths).find((x) => samePath(x, p))
      if (!known) return { ok: false, message: 'Cartella non presente tra le recenti' }
      return openFolder(known)
    },
    'folder.forget': (p) => { forgetRecent(paths, p); return recentList() },
    'library.addScanFolderDialog': async () => {
      const ctx = need().ctx
      if (ctx.vault.layout === 'folder') return { ok: false, message: 'Tutte le sottocartelle sono già incluse. Per un\'altra cartella usa "Apri cartella…".' }
      const r = await dialog.showOpenDialog(win!, { title: 'Aggiungi cartella da indicizzare', defaultPath: ctx.vault.libraryDir, properties: ['openDirectory'] })
      if (r.canceled || !r.filePaths[0]) return { ok: false }
      const abs = r.filePaths[0]
      if (!ctx.vault.isInside(abs)) {
        return { ok: false, message: `La cartella deve trovarsi dentro il vault (${ctx.vault.root}). Per sfogliare un'altra cartella usa "Apri cartella…".` }
      }
      const rel = normalizeRel(ctx.vault.toRel(abs))
      if (ctx.vault.isReserved(rel)) return { ok: false, message: 'Cartella di sistema del vault: non indicizzabile' }
      const st = ctx.settings.getAll()
      // se è già coperta da una cartella padre non serve aggiungerla; se ne contiene altre, le sostituisce
      const covered = st.scanFolders.some((f) => f === '' || rel === f || rel.startsWith(f + '/'))
      if (!covered) {
        ctx.settings.set({ scanFolders: [...st.scanFolders.filter((f) => !(rel === '' || f.startsWith(rel + '/'))), rel] })
      }
      need().scan.start({ folders: [rel] })
      return { ok: true, folder: rel }
    },
    'media.showInFolder': (id) => {
      const s = need()
      const row = s.ctx.media.getRow(id)
      if (row) shell.showItemInFolder(s.ctx.vault.toAbs(row.file_path_relative))
    },
    'media.openExternal': (id) => {
      const s = need()
      const row = s.ctx.media.getRow(id)
      if (row) void shell.openPath(s.ctx.vault.toAbs(row.file_path_relative))
    },
    'maintenance.openLogs': () => { void shell.openPath(need().ctx.vault.logsDir) }
  }
}

function isAppUrl(url: string): boolean {
  const dev = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined
  if (dev) return url.startsWith(dev)
  const expected = pathToFileURL(path.join(__dirname, '../renderer/index.html')).href
  return url.split('#')[0].split('?')[0] === expected
}

function registerIpc(): void {
  const own = electronHandlers()
  for (const ch of IPC_CHANNELS) {
    ipcMain.handle(ch, async (event, ...args) => {
      // solo dal frame principale della finestra dell'app, caricato dall'URL dell'app
      if (!win || event.sender.id !== win.webContents.id || event.senderFrame !== win.webContents.mainFrame || !isAppUrl(event.senderFrame?.url ?? '')) {
        throw new Error('Mittente IPC non autorizzato')
      }
      // smistamento sulla sessione CORRENTE: funziona anche dopo un cambio di cartella
      const fn = (own[ch as IpcChannel] ?? (vs ? vs.handlers[ch as IpcChannel] : NO_FOLDER[ch as IpcChannel])) as ((...a: unknown[]) => unknown) | undefined
      if (!fn) throw new Error(vs ? `Handler IPC mancante: ${ch}` : 'Nessuna cartella aperta: scegli la cartella delle foto')
      return await fn(...args)
    })
  }
}

// ------------------------------------------------------------------ window

function createWindow(): void {
  const dark = nativeTheme.shouldUseDarkColors
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#0b0d12',
    title: 'VibeVault',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    titleBarOverlay: process.platform === 'darwin' ? undefined : { color: '#00000000', symbolColor: dark ? '#cbd5e1' : '#cbd5e1', height: 44 },
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false
    }
  })
  win.once('ready-to-show', () => win?.show())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  // l'app è una single-page: nessuna navigazione è mai legittima (es. file .html trascinato sulla finestra)
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.webContents.on('will-redirect', (e) => e.preventDefault())
  win.webContents.on('will-attach-webview', (e) => e.preventDefault())
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  win.on('closed', () => { win = null })
}

/** Privacy: nessuna richiesta di rete in uscita dal renderer (tranne il dev server in sviluppo). */
function lockDownNetwork(): void {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (details, cb) => {
    const allowed = !app.isPackaged && devUrl && (details.url.startsWith(devUrl) || details.url.startsWith(devUrl.replace('http', 'ws')))
    cb({ cancel: !allowed })
  })
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'clipboard-sanitized-write' || permission === 'fullscreen'))
}

// ------------------------------------------------------------------ lifecycle

app.whenReady().then(async () => {
  tools = resolveTools([path.join(paths.base, 'bin'), path.join(paths.appDataDir, 'bin')])
  lockDownNetwork()
  registerProtocolHandler(() => (vs ? { ctx: vs.ctx, thumbs: vs.thumbs, vaultId: vs.vaultId } : null))
  registerIpc()
  // riapre l'ultima cartella usata (se esiste ancora) prima di mostrare la finestra
  const first = initialFolder(paths)
  if (first) {
    const r = await openFolder(first)
    if (!r.ok) console.warn(`Cartella recente non apribile: ${r.message}`)
  }
  createWindow()
})

app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus() }
})

let quitting = false
app.on('before-quit', (e) => {
  if (quitting) return
  e.preventDefault()
  quitting = true
  void queue.then(async () => { if (vs) await vs.close() }).finally(() => app.quit())
})

app.on('window-all-closed', () => app.quit())
