import type { IpcArgs, IpcChannel, IpcEventName, IpcEvents, IpcResult } from '../shared/ipc'

export interface VibeVaultApi {
  invoke<C extends IpcChannel>(channel: C, ...args: IpcArgs<C>): Promise<Awaited<IpcResult<C>>>
  on<E extends IpcEventName>(event: E, cb: (payload: IpcEvents[E]) => void): () => void
  platform: string
}

declare global {
  interface Window {
    vv: VibeVaultApi
  }
}
