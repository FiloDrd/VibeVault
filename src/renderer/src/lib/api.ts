import type { IpcArgs, IpcChannel, IpcEventName, IpcEvents, IpcResult } from '@shared/ipc'
import { BROWSER_IMAGE_EXT, extOf } from '@shared/formats'

/** Chiamata IPC tipizzata verso il main process. */
export function api<C extends IpcChannel>(channel: C, ...args: IpcArgs<C>): Promise<Awaited<IpcResult<C>>> {
  return window.vv.invoke(channel, ...args)
}

export function onEvent<E extends IpcEventName>(event: E, cb: (payload: IpcEvents[E]) => void): () => void {
  return window.vv.on(event, cb)
}

let thumbVersion = 0
export function bumpThumbVersion(): void { thumbVersion++ }

export const thumbUrl = (id: number) => `vv://thumb/${id}${thumbVersion ? `?v=${thumbVersion}` : ''}`
export const previewUrl = (id: number) => `vv://preview/${id}${thumbVersion ? `?v=${thumbVersion}` : ''}`
export const mediaUrl = (id: number) => `vv://media/${id}`

/** URL migliore per vedere un'immagine a piena risoluzione nel lightbox. */
export function fullImageUrl(id: number, fileName: string): string {
  return BROWSER_IMAGE_EXT.has(extOf(fileName)) ? mediaUrl(id) : previewUrl(id)
}
