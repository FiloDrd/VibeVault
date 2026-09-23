/**
 * Migrazioni SQLite versionate tramite PRAGMA user_version.
 * Regola: non modificare mai una migrazione già rilasciata, aggiungerne una nuova.
 */
export const MIGRATIONS: string[] = [
  /* v1 — schema iniziale. AUTOINCREMENT: gli id non vengono mai riutilizzati (l'undo e il log vi fanno riferimento). */ `
  CREATE TABLE IF NOT EXISTS folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path_relative TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    parent_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
    last_scanned_at INTEGER,
    file_count INTEGER NOT NULL DEFAULT 0,
    size_bytes INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_id);

  CREATE TABLE IF NOT EXISTS media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path_relative TEXT NOT NULL UNIQUE,
    folder_path_relative TEXT NOT NULL DEFAULT '',
    file_name TEXT NOT NULL,
    extension TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    kind TEXT NOT NULL,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER,
    modified_at INTEGER,
    exif_date INTEGER,
    effective_date INTEGER NOT NULL DEFAULT 0,
    date_source TEXT NOT NULL DEFAULT 'none',
    width INTEGER,
    height INTEGER,
    duration_ms INTEGER,
    orientation INTEGER,
    camera_make TEXT,
    camera_model TEXT,
    gps_lat REAL,
    gps_lon REAL,
    place_name TEXT,
    hash_quick TEXT,
    hash_sha256 TEXT,
    hash_phash TEXT,
    rating INTEGER NOT NULL DEFAULT 0,
    flag TEXT NOT NULL DEFAULT 'none',
    color_label TEXT NOT NULL DEFAULT 'none',
    favorite INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    deleted_at INTEGER,
    notes TEXT NOT NULL DEFAULT '',
    thumbnail_path TEXT,
    preview_path TEXT,
    thumb_state TEXT NOT NULL DEFAULT 'pending',
    status TEXT NOT NULL DEFAULT 'ok',
    is_screenshot INTEGER NOT NULL DEFAULT 0,
    added_at INTEGER NOT NULL,
    last_seen_scan INTEGER NOT NULL DEFAULT 0,
    error TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_media_folder ON media(folder_path_relative);
  CREATE INDEX IF NOT EXISTS idx_media_kind_date ON media(kind, effective_date);
  CREATE INDEX IF NOT EXISTS idx_media_date ON media(effective_date);
  CREATE INDEX IF NOT EXISTS idx_media_rating ON media(rating);
  CREATE INDEX IF NOT EXISTS idx_media_favorite ON media(favorite) WHERE favorite = 1;
  CREATE INDEX IF NOT EXISTS idx_media_flag ON media(flag);
  CREATE INDEX IF NOT EXISTS idx_media_status ON media(status);
  CREATE INDEX IF NOT EXISTS idx_media_quick ON media(size_bytes, hash_quick);
  CREATE INDEX IF NOT EXISTS idx_media_sha ON media(hash_sha256);
  CREATE INDEX IF NOT EXISTS idx_media_thumb ON media(thumb_state);
  CREATE INDEX IF NOT EXISTS idx_media_name ON media(file_name COLLATE NOCASE);
  CREATE INDEX IF NOT EXISTS idx_media_size ON media(size_bytes);

  CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    color TEXT,
    parent_id INTEGER REFERENCES tags(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS media_tags (
    media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (media_id, tag_id)
  );
  CREATE INDEX IF NOT EXISTS idx_media_tags_tag ON media_tags(tag_id);

  CREATE TABLE IF NOT EXISTS albums (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'manual',
    query TEXT,
    cover_media_id INTEGER REFERENCES media(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS album_items (
    album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
    media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (album_id, media_id)
  );
  CREATE INDEX IF NOT EXISTS idx_album_items_media ON album_items(media_id);

  CREATE TABLE IF NOT EXISTS edits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    editor_type TEXT NOT NULL,
    instructions_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_edits_media ON edits(media_id);

  CREATE TABLE IF NOT EXISTS operations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    payload_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'done',
    created_at INTEGER NOT NULL,
    undo_data_json TEXT,
    item_count INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_operations_created ON operations(created_at);

  CREATE TABLE IF NOT EXISTS smart_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    rule_json TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 0,
    last_run_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS trash_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    media_id INTEGER REFERENCES media(id) ON DELETE SET NULL,
    original_path TEXT NOT NULL,
    trash_path TEXT NOT NULL,
    deleted_at INTEGER NOT NULL,
    restore_info_json TEXT NOT NULL DEFAULT '{}',
    purged_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_trash_media ON trash_items(media_id);

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `
]
