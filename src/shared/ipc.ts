import type {
  Album, AppSettings, ColorLabel, DuplicateGroup, Flag, FolderNode, GridItem, LibraryStats, MediaDetails,
  MediaQuery, OperationRecord, OpResult, ScanErrorEntry, ScanProgress, Tag, ThumbStatus, TrashEntry, VaultInfo
} from './types'

/**
 * Contratto IPC unico. Ogni chiave è un canale `ipcMain.handle`; il preload
 * espone `window.vv.invoke(canale, ...args)` tipizzato su questa mappa.
 */
export interface IpcContract {
  'vault.info': () => VaultInfo
  'vault.openRootDialog': () => VaultInfo | null
  'vault.revealRoot': () => void

  'settings.get': () => AppSettings
  'settings.set': (patch: Partial<AppSettings>) => AppSettings

  'library.scan': (opts?: { folders?: string[]; full?: boolean }) => { started: boolean; message?: string }
  'library.cancelScan': () => void
  'library.scanStatus': () => ScanProgress
  'library.scanErrors': () => ScanErrorEntry[]
  'library.addScanFolderDialog': () => { ok: boolean; folder?: string; message?: string }
  'library.query': (q: MediaQuery) => GridItem[]
  'library.stats': () => LibraryStats
  'library.folders': () => FolderNode[]
  'library.duplicates': (opts?: { verify?: boolean }) => DuplicateGroup[]
  'library.rebuildIndex': () => { started: boolean }

  'media.details': (id: number) => MediaDetails | null
  'media.rate': (ids: number[], rating: number) => OpResult
  'media.flag': (ids: number[], flag: Flag) => OpResult
  'media.favorite': (ids: number[], value: boolean) => OpResult
  'media.color': (ids: number[], color: ColorLabel) => OpResult
  'media.notes': (id: number, notes: string) => OpResult
  'media.archive': (ids: number[], value: boolean) => OpResult
  'media.showInFolder': (id: number) => void
  'media.openExternal': (id: number) => void

  'tags.list': () => Tag[]
  'tags.add': (ids: number[], names: string[]) => OpResult
  'tags.remove': (ids: number[], tagId: number) => OpResult
  'tags.rename': (tagId: number, name: string) => OpResult
  'tags.delete': (tagId: number) => OpResult

  'albums.list': () => Album[]
  'albums.create': (name: string, mediaIds?: number[]) => Album
  'albums.rename': (albumId: number, name: string) => OpResult
  'albums.delete': (albumId: number) => OpResult
  'albums.addItems': (albumId: number, mediaIds: number[]) => OpResult
  'albums.removeItems': (albumId: number, mediaIds: number[]) => OpResult

  'files.move': (ids: number[], destFolderRel: string) => OpResult
  'files.copy': (ids: number[], destFolderRel: string) => OpResult
  'files.rename': (items: { id: number; newName: string }[]) => OpResult
  'files.renameTemplate': (ids: number[], template: string) => { preview: { id: number; from: string; to: string }[] }
  'files.createFolder': (parentRel: string, name: string) => { ok: boolean; path?: string; message?: string }
  'files.trash': (ids: number[], opts?: { allowFavorites?: boolean }) => OpResult
  'files.trashFlagged': (opts: { dryRun: boolean }) => OpResult & { ids?: number[]; bytes?: number }

  'trash.list': () => TrashEntry[]
  'trash.restore': (trashIds: number[]) => OpResult
  'trash.empty': (opts: { trashIds?: number[]; confirmToken: string }) => OpResult

  'operations.list': (limit?: number) => OperationRecord[]
  'operations.undo': (operationId?: number) => OpResult

  'thumbs.prioritize': (ids: number[]) => void
  'thumbs.status': () => ThumbStatus

  'maintenance.backupDb': () => { ok: boolean; path?: string; message?: string }
  'maintenance.clearCache': () => { ok: boolean; removed: number }
  'maintenance.openLogs': () => void
}

export type IpcChannel = keyof IpcContract
export type IpcArgs<C extends IpcChannel> = Parameters<IpcContract[C]>
export type IpcResult<C extends IpcChannel> = ReturnType<IpcContract[C]>

/** Eventi main → renderer. */
export interface IpcEvents {
  'scan:progress': ScanProgress
  'thumbs:ready': { ids: number[] }
  'thumbs:status': ThumbStatus
  'library:changed': { reason: string; ids?: number[] }
  'operations:changed': { latest?: OperationRecord }
  'vault:changed': VaultInfo
}

export type IpcEventName = keyof IpcEvents

export const IPC_CHANNELS: IpcChannel[] = [
  'vault.info', 'vault.openRootDialog', 'vault.revealRoot',
  'settings.get', 'settings.set',
  'library.scan', 'library.cancelScan', 'library.scanStatus', 'library.scanErrors', 'library.addScanFolderDialog',
  'library.query', 'library.stats', 'library.folders', 'library.duplicates', 'library.rebuildIndex',
  'media.details', 'media.rate', 'media.flag', 'media.favorite', 'media.color', 'media.notes', 'media.archive',
  'media.showInFolder', 'media.openExternal',
  'tags.list', 'tags.add', 'tags.remove', 'tags.rename', 'tags.delete',
  'albums.list', 'albums.create', 'albums.rename', 'albums.delete', 'albums.addItems', 'albums.removeItems',
  'files.move', 'files.copy', 'files.rename', 'files.renameTemplate', 'files.createFolder', 'files.trash', 'files.trashFlagged',
  'trash.list', 'trash.restore', 'trash.empty',
  'operations.list', 'operations.undo',
  'thumbs.prioritize', 'thumbs.status',
  'maintenance.backupDb', 'maintenance.clearCache', 'maintenance.openLogs'
]

export const IPC_EVENTS: IpcEventName[] = [
  'scan:progress', 'thumbs:ready', 'thumbs:status', 'library:changed', 'operations:changed', 'vault:changed'
]

/** Token richiesto per lo svuotamento definitivo del cestino (doppia conferma lato UI). */
export const EMPTY_TRASH_CONFIRM = 'ELIMINA-DEFINITIVAMENTE'
