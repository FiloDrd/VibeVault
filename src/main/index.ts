import path from 'node:path'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, session, shell } from 'electron'
import { IPC_CHANNELS, type IpcChannel, type IpcEventName, type IpcEvents } from '@shared/ipc'
import type { VaultInfo } from '@shared/types'
import { resolveRoot, saveRootChoice, type RootResolution } from './rootResolver'
import { registerProtocolHandler, registerSchemePrivileges } from './protocol'
import { resolveTools } from './tools'
import { openVault, type VaultSession } from './bootstrap'
import type { ActionHandlers } from './handlers'
import { Vault, normalizeRel } from './vault'

// ------------------------------------------------------------------ pre-ready

const resolution: RootResolution = resolveRoot()
// Tutto ciò che Chromium scrive (profilo, cache GPU) resta dentro il vault
fs.mkdirSync(path.join(resolution.root, 'VaultData', 'electron'), { recursive: true })
app.setPath('userData', path.join(resolution.root, 'VaultData', 'electron'))
app.setPath('sessionData', path.join(resolution.root, 'VaultData', 'electron'))
registerSchemePrivileges()

if (!app.requestSingleInstanceLock()) app.quit()

let win: BrowserWindow | null = null
let vs: VaultSession | null = null

function emit<E extends IpcEventName>(event: E, payload: IpcEvents[E]): void {
  if (win && !win.isDestroyed()) win.webContents.send(event, payload)
}

function vaultInfo(): VaultInfo {
  const ctx = vs!.ctx
  return {
    root: ctx.vault.root,
    libraryDir: ctx.vault.libraryDir,
    portable: resolution.portable,
    rootChanged: vs!.rootChanged,
    vaultId: vs!.vaultId,
    dbPath: ctx.vault.toRel(ctx.vault.dbPath),
    tools: ctx.tools,
    version: app.getVersion()
  }
}

// ------------------------------------------------------------------ IPC

function electronHandlers(): ActionHandlers {
  return {
    'vault.info': () => vaultInfo(),
    'vault.revealRoot': () => { void shell.openPath(vs!.ctx.vault.root) },
    'vault.openRootDialog': async () => {
      const r = await dialog.showOpenDialog(win!, {
        title: 'Scegli o crea la cartella del Vault (es. sull\'SSD)',
        properties: ['openDirectory', 'createDirectory']
      })
      if (r.canceled || !r.filePaths[0]) return null
      saveRootChoice(resolution.configFile, r.filePaths[0])
      app.relaunch()
      app.exit(0)
      return null
    },
    'library.addScanFolderDialog': async () => {
      const ctx = vs!.ctx
      const r = await dialog.showOpenDialog(win!, { title: 'Aggiungi cartella da indicizzare', defaultPath: ctx.vault.libraryDir, properties: ['openDirectory'] })
      if (r.canceled || !r.filePaths[0]) return { ok: false }
      const abs = r.filePaths[0]
      if (!ctx.vault.isInside(abs)) {
        return { ok: false, message: `La cartella deve trovarsi dentro il vault (${ctx.vault.root}) per restare portatile. Spostala o copiala dentro Library/.` }
      }
      const rel = normalizeRel(ctx.vault.toRel(abs))
      if (ctx.vault.isReserved(rel)) return { ok: false, message: 'Cartella di sistema del vault: non indicizzabile' }
      const st = ctx.settings.getAll()
      // se è già coperta da una cartella padre non serve aggiungerla; se ne contiene altre, le sostituisce
      const covered = st.scanFolders.some((f) => f === '' || rel === f || rel.startsWith(f + '/'))
      if (!covered) {
        ctx.settings.set({ scanFolders: [...st.scanFolders.filter((f) => !(rel === '' || f.startsWith(rel + '/'))), rel] })
      }
      vs!.scan.start({ folders: [rel] })
      return { ok: true, folder: rel }
    },
    'media.showInFolder': (id) => {
      const row = vs!.ctx.media.getRow(id)
      if (row) shell.showItemInFolder(vs!.ctx.vault.toAbs(row.file_path_relative))
    },
    'media.openExternal': (id) => {
      const row = vs!.ctx.media.getRow(id)
      if (row) void shell.openPath(vs!.ctx.vault.toAbs(row.file_path_relative))
    },
    'maintenance.openLogs': () => { void shell.openPath(vs!.ctx.vault.logsDir) }
  }
}

function isAppUrl(url: string): boolean {
  const dev = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined
  if (dev) return url.startsWith(dev)
  const expected = pathToFileURL(path.join(__dirname, '../renderer/index.html')).href
  return url.split('#')[0].split('?')[0] === expected
}

function registerIpc(): void {
  const all: ActionHandlers = { ...vs!.handlers, ...electronHandlers() }
  for (const ch of IPC_CHANNELS) {
    const fn = all[ch as IpcChannel] as ((...a: unknown[]) => unknown) | undefined
    if (!fn) throw new Error(`Handler IPC mancante: ${ch}`)
    ipcMain.handle(ch, async (event, ...args) => {
      // solo dal frame principale della finestra dell'app, caricato dall'URL dell'app
      if (!win || event.sender.id !== win.webContents.id || event.senderFrame !== win.webContents.mainFrame || !isAppUrl(event.senderFrame?.url ?? '')) {
        throw new Error('Mittente IPC non autorizzato')
      }
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
  const vault = new Vault(resolution.root)
  vault.ensureStructure()
  const tools = resolveTools(resolution.root)
  vs = openVault({ root: resolution.root, tools, workerDir: __dirname, appVersion: app.getVersion(), emit })
  vs.ctx.log.info('app.start', { version: app.getVersion(), portable: resolution.portable, tools: { ffmpeg: !!tools.ffmpeg, ffprobe: !!tools.ffprobe } })
  lockDownNetwork()
  registerProtocolHandler(() => vs?.ctx ?? null, () => vs?.thumbs ?? null)
  registerIpc()
  createWindow()
  if (vs.dbMessage) {
    void dialog.showMessageBox({ type: 'warning', title: 'Database ricostruito', message: vs.dbMessage })
  }
  // indicizzazione incrementale all'avvio: l'interfaccia è subito usabile
  setTimeout(() => vs?.scan.start(), 800)
})

app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus() }
})

let quitting = false
app.on('before-quit', (e) => {
  if (quitting || !vs) return
  e.preventDefault()
  quitting = true
  void vs.close().finally(() => app.quit())
})

app.on('window-all-closed', () => app.quit())
