import type { MediaKind } from './formats'

export type { MediaKind }
export type Flag = 'none' | 'keep' | 'maybe' | 'trash'
export type ColorLabel = 'none' | 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple'
export type MediaStatus = 'ok' | 'missing' | 'corrupt' | 'unsupported' | 'trashed'

/** Riga compatta per la griglia (chiavi corte: può essere 100k elementi). */
export interface GridItem {
  id: number
  k: MediaKind
  /** data effettiva in ms (exif o fallback file) */
  t: number
  w: number
  h: number
  fav: 0 | 1
  fl: Flag
  r: number
  d: number | null
  n: string
  st: MediaStatus
}

export interface MediaDetails {
  id: number
  filePathRelative: string
  fileName: string
  extension: string
  mimeType: string
  kind: MediaKind
  sizeBytes: number
  createdAt: number | null
  modifiedAt: number | null
  exifDate: number | null
  effectiveDate: number
  dateSource: 'exif' | 'file' | 'none'
  width: number | null
  height: number | null
  durationMs: number | null
  orientation: number | null
  cameraMake: string | null
  cameraModel: string | null
  gpsLat: number | null
  gpsLon: number | null
  placeName: string | null
  hashQuick: string | null
  hashSha256: string | null
  rating: number
  flag: Flag
  colorLabel: ColorLabel
  favorite: boolean
  archived: boolean
  deletedAt: number | null
  notes: string
  status: MediaStatus
  tags: Tag[]
  albums: Album[]
  absolutePath: string
}

export interface Tag {
  id: number
  name: string
  color: string | null
  count?: number
}

export interface Album {
  id: number
  name: string
  type: 'manual' | 'smart'
  query: string | null
  coverMediaId: number | null
  createdAt: number
  count?: number
}

export interface FolderNode {
  id: number
  pathRelative: string
  name: string
  parentId: number | null
  fileCount: number
  sizeBytes: number
}

export type SortField = 'date' | 'name' | 'size' | 'added' | 'rating' | 'duration'

export interface MediaQuery {
  kinds?: MediaKind[]
  search?: string
  sort?: SortField
  order?: 'asc' | 'desc'
  favorite?: boolean
  flags?: Flag[]
  minRating?: number
  albumId?: number
  tagId?: number
  folder?: string
  recursive?: boolean
  noDate?: boolean
  largeFiles?: boolean
  screenshots?: boolean
  archived?: boolean
  trashed?: boolean
  missing?: boolean
  orientation?: 'portrait' | 'landscape' | 'square'
  dateFrom?: number
  dateTo?: number
  colorLabel?: ColorLabel
  recent?: boolean
  limit?: number
}

export interface ScanProgress {
  phase: 'idle' | 'walking' | 'indexing' | 'reconciling' | 'done' | 'error' | 'cancelled'
  scanned: number
  added: number
  updated: number
  unchanged: number
  missing: number
  moved: number
  errors: number
  currentPath?: string
  startedAt?: number
  finishedAt?: number
  message?: string
}

export interface ScanErrorEntry {
  path: string
  message: string
}

export interface ThumbStatus {
  queued: number
  done: number
  failed: number
}

export interface OperationRecord {
  id: number
  type: string
  label: string
  status: 'done' | 'undone' | 'failed' | 'partial'
  createdAt: number
  count: number
  undoable: boolean
}

export interface OpResult {
  ok: boolean
  operationId?: number
  affected: number
  errors: { id?: number; path?: string; message: string }[]
  message?: string
}

export interface TrashEntry {
  id: number
  mediaId: number
  originalPath: string
  trashPath: string
  deletedAt: number
  fileName: string
  sizeBytes: number
  kind: MediaKind
}

export interface DuplicateGroup {
  key: string
  sizeBytes: number
  items: GridItem[]
  verified: boolean
}

export interface LibraryStats {
  total: number
  totalBytes: number
  byKind: { kind: MediaKind; count: number; bytes: number }[]
  byYear: { year: string; count: number }[]
  byExt: { ext: string; count: number; bytes: number }[]
  noDate: number
  missing: number
  corrupt: number
  trashed: number
  favorites: number
  flags: Record<Flag, number>
  thumbsPending: number
}

export interface VaultInfo {
  root: string
  libraryDir: string
  portable: boolean
  rootChanged: { from: string; to: string } | null
  vaultId: string
  dbPath: string
  tools: { ffmpeg: string | null; ffprobe: string | null }
  version: string
}

export type ThemeName = 'dark' | 'light' | 'auto' | 'high-contrast'

export interface AppSettings {
  theme: ThemeName
  reducedMotion: boolean
  gridSize: 's' | 'm' | 'l'
  groupBy: 'day' | 'month' | 'none'
  computeFullHash: boolean
  includeAudio: boolean
  hideSensitiveThumbs: boolean
  largeFileThresholdMB: number
  showInspector: boolean
  backupBeforeBatch: boolean
  scanFolders: string[]
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  reducedMotion: false,
  gridSize: 'm',
  groupBy: 'day',
  computeFullHash: false,
  includeAudio: false,
  hideSensitiveThumbs: false,
  largeFileThresholdMB: 500,
  showInspector: true,
  backupBeforeBatch: true,
  scanFolders: ['Library']
}
