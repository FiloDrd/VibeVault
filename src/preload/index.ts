import { contextBridge, ipcRenderer } from 'electron'
import type { IpcArgs, IpcChannel, IpcEventName, IpcEvents, IpcResult } from '@shared/ipc'

/**
 * API minimale esposta al renderer: nessun accesso a Node/fs.
 * Tutte le operazioni passano dai canali IPC dichiarati in @shared/ipc.
 */
const api = {
  invoke<C extends IpcChannel>(channel: C, ...args: IpcArgs<C>): Promise<Awaited<IpcResult<C>>> {
    return ipcRenderer.invoke(channel, ...args)
  },
  on<E extends IpcEventName>(event: E, cb: (payload: IpcEvents[E]) => void): () => void {
    const listener = (_e: unknown, payload: IpcEvents[E]) => cb(payload)
    ipcRenderer.on(event, listener)
    return () => { ipcRenderer.removeListener(event, listener) }
  },
  platform: process.platform
}

export type VibeVaultApi = typeof api

contextBridge.exposeInMainWorld('vv', api)
