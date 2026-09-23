# VibeVault

Media manager **local-first, offline e portatile** per organizzare, rivedere e pulire migliaia di foto, video e GIF direttamente da SSD.
Nessun cloud, nessun account, nessuna telemetria. Gli originali non vengono mai modificati.

> Stato: **MVP v0.1** — libreria, timeline, lightbox, review, organizzazione, cestino e undo funzionanti e testati.
> Editor foto/video, ottimizzatore GIF e regole smart sono le prossime tappe (vedi [Roadmap](#roadmap)).

---

## Avvio rapido (Windows)

Requisiti: **Node.js 22 o superiore** (consigliato 24 LTS). Non servono Visual Studio né Python: SQLite e sharp usano binari precompilati.

```powershell
cd LocalGPhoto
npm install          # dipendenze (gli script sono saltati: vedi .npmrc)
npm run setup        # scarica Electron e FFmpeg per Windows
npm run dev          # avvia l'app in sviluppo (vault in .vault-dev\)
```

> Se `npm run dev` dice **"Electron uninstall"**, l'eseguibile di Electron non è stato scaricato: lancia `npm run setup`.

Per usare una tua cartella come vault in sviluppo:

```powershell
$env:VIBEVAULT_ROOT = "D:\VibeVault"; npm run dev
```

### Build portatile per l'SSD

```powershell
npm run dist:ssd
```

Crea `release\VibeVault\` con questa struttura:

```
VibeVault\
  App\VibeVault.exe      ← l'app (avvio diretto, nessuna installazione)
  Library\               ← metti qui foto, video e GIF (anche in sottocartelle)
  LEGGIMI.txt
```

Copia la cartella `VibeVault` sull'SSD e avvia `App\VibeVault.exe`. Al primo avvio vengono create:

| Cartella | Contenuto | Si può cancellare? |
|---|---|---|
| `Library\` | i tuoi media | **no**, sono i tuoi file |
| `VaultData\` | `database.sqlite`, `backups\`, `vault.json`, profilo Chromium | sì, ma perdi tag/album/rating (i file restano; una scansione ricostruisce l'indice) |
| `Cache\` | miniature e anteprime | sì, si rigenerano |
| `Trash\` | cestino interno | solo svuotando il cestino dall'app |
| `Exports\` | file esportati (editor, prossime versioni) | sì |
| `Logs\` | log operazioni in JSONL | sì |

`npm run dist:portable` genera invece un singolo `.exe` portatile: comodo, ma si estrae in una cartella temporanea a ogni avvio (più lento). Per l'SSD è consigliato `dist:ssd`.

---

## Portabilità SSD: come funziona

- Nel database ci sono **solo percorsi relativi** alla root del vault (`Library/Foto/2024/IMG_0001.jpg`), sempre con `/`.
- La root viene rilevata così: se l'exe sta in `…\VibeVault\App\`, la root è `…\VibeVault\`. In alternativa: variabile `VIBEVAULT_ROOT` o la scelta fatta da *Impostazioni → Cambia vault* (salvata in `vibevault.config.json` accanto all'exe, in forma relativa quando possibile).
- Se l'SSD cambia lettera (da `E:` a `F:`) o la cartella viene spostata, l'app lo rileva e continua a funzionare senza toccare nulla.
- Le cartelle da indicizzare devono stare **dentro** il vault: è ciò che le rende portatili.
- Il database è ricostruibile: se `database.sqlite` è corrotto viene messo da parte (mai cancellato) e ne viene creato uno nuovo; una scansione reindicizza tutto.

## Sicurezza dei file

- **Nessuna sovrascrittura, mai.** Sposta, copia, rinomina e ripristina scelgono un nome libero (`foto (1).jpg`) o rifiutano l'operazione.
- **Elimina = sposta nel Cestino interno** (`Trash\AAAA-MM-GG\`). L'unica cancellazione reale è *Svuota cestino*, con **doppia conferma** (dialog + scrivere `ELIMINA`).
- **Preferiti protetti**: non vanno nel cestino finché non togli il preferito.
- **Undo globale** (Ctrl+Z o "Annulla" nel toast) per spostamenti, rinomine, cestino/ripristino, copie, tag, album, rating, flag, etichette e note. La cronologia completa è in *Impostazioni → Cronologia operazioni*.
- **Backup automatico del database** prima delle operazioni su 50+ file (ultimi 10 in `VaultData\backups\`).
- **Spostamenti tra dischi**: copia esclusiva → verifica dimensione → rimozione della sorgente.
- **File spostati fuori dall'app** (con Esplora risorse): alla scansione successiva vengono riconosciuti tramite dimensione + hash rapido e mantengono tag, album e valutazioni.
- **Privacy**: il renderer non può fare richieste di rete (bloccate a livello di sessione), nessuna telemetria, nessun upload. I log contengono solo percorsi relativi, mai GPS o contenuti.

## Uso

### Review veloce
Sidebar → **Review** (o tasto `R`). Un media alla volta a schermo intero:

| Tasto | Azione |
|---|---|
| `K` | Tieni |
| `M` | Forse |
| `X` / `Canc` | Scarta (solo segnato: il file non si muove) |
| `F` | Preferito |
| `1`–`5`, `0` | Valutazione |
| `S` / `→` | Salta · `←` indietro |
| `Z` / `Ctrl+Z` | Annulla l'ultima decisione |
| `Spazio` | Play/pausa video |

Alla fine, **"Sposta N scartati nel cestino"** mostra prima un'anteprima (quanti file, quanto spazio) e chiede conferma.

### Scorciatoie globali

| Tasto | Azione |
|---|---|
| `Ctrl+K` | Command palette |
| `Ctrl+F` | Cerca |
| `Ctrl+A` | Seleziona tutto |
| `Ctrl+C` / `Ctrl+X` → `Ctrl+V` | Copia / sposta nella cartella aperta |
| `Ctrl+Z` | Annulla |
| `Invio` / doppio clic | Apri nel lightbox · `Esc` chiudi |
| `←` `→` | Elemento precedente / successivo |
| `Canc` | Sposta nel cestino |
| `F` `K` `M` `X` `1-5` | Preferito, flag, rating |
| `T` · `A` · `F2` | Tag · Album · Rinomina |
| `G` · `I` | Dimensione griglia · Pannello info |
| `D` | Duplicati |

Clic = seleziona, `Ctrl`+clic = aggiungi/togli, `Shift`+clic = intervallo, clic sull'intestazione del giorno = seleziona il gruppo.
Trascina la selezione su un **album**, un **tag**, una **cartella** (sposta), **Preferiti**, **Archivio** o **Cestino** nella sidebar.

### Ricerca avanzata
Parole libere cercano in nome file, note e tag. Filtri combinabili:

```
tag:mare  ext:jpg  year:2023  camera:fuji  folder:Viaggi  rating:>=4
is:fav  is:video  is:gif  is:raw  is:keep  is:maybe  is:trash  is:screenshot  is:gps
```

### Duplicati
Vista **Duplicati**: candidati per dimensione + hash rapido, poi **Verifica SHA-256** per la certezza byte per byte. "Tieni il migliore" segna le copie come *Scarta* (preferiti > rating > nome senza "copia" > più vecchio): nessun file viene toccato finché non svuoti gli scartati.

---

## Architettura

```
src/
  shared/        tipi, formati supportati, contratto IPC tipizzato (unica fonte di verità)
  main/          processo principale Electron (Node)
    vault.ts         struttura portatile e conversione percorsi relativi/assoluti (anti path-traversal)
    rootResolver.ts  rilevamento root (portable / config / dev)
    db/              SQLite (better-sqlite3): schema+migrazioni, repository media/tag/album/operazioni/cestino
    services/        scansione, miniature, operazioni file sicure, azioni con undo, metadata
    workers/         worker_threads: scanner (walk+EXIF+ffprobe+hash) e miniature (sharp/FFmpeg)
    protocol.ts      vv://thumb|preview|media con supporto Range (streaming video)
    handlers.ts      handler IPC (senza Electron: testabili)
  preload/       bridge minimale contextIsolation (solo invoke/on tipizzati)
  renderer/      React 19 + Tailwind 4 + Zustand
    components/      griglia virtualizzata justified, card, lightbox, inspector, dialog, palette, toast
    views/           Review, Cestino, Duplicati, Statistiche, Impostazioni
tests/           test unitari DB + test end-to-end del motore su libreria campione generata
```

Scelte principali:
- **Electron 44 + React 19 + TypeScript + Vite (electron-vite) + Tailwind 4 + Zustand**, come da specifica.
- **better-sqlite3 13** (N-API, binari inclusi) e **sharp 0.35**: niente compilazione nativa su Windows.
- **exifr** (JS puro) al posto di ExifTool per EXIF/GPS: più leggero e portatile; **ffprobe** per i video. ExifTool resta un'opzione futura per scrivere metadata.
- UI mai bloccata: scansione e miniature in `worker_threads`; il main fa solo scritture SQLite in transazioni batch.
- Miniature WebP 512 px con coda a priorità (gli elementi visibili passano davanti); anteprime JPEG 2560 px per HEIC/TIFF/RAW nel lightbox.
- Griglia "justified" (proporzioni reali, righe piene) raggruppata per giorno/mese, virtualizzata con `@tanstack/react-virtual`.

FFmpeg/ffprobe vengono cercati in: `VibeVault\App\bin\` → pacchetti inclusi (`ffmpeg-static`, `ffprobe-static`) → `PATH`.

## Test

```powershell
npm test          # build + tutti i test
npm run typecheck
```

`tests/integration.test.ts` genera una libreria campione (JPG con EXIF/GPS, PNG, WebP, GIF animata, MP4 orizzontale/verticale, WebM, file corrotti/vuoti, duplicati, cartelle nascoste) e verifica: scansione e metadata, percorsi relativi, miniature foto/GIF/video, duplicati SHA-256, tag/rating/undo, spostamento senza sovrascrittura + undo, rinomina con template + undo, cestino con preferiti protetti, ripristino senza sovrascrivere, svuotamento solo con conferma, review → cestino con dry-run, riconciliazione di file spostati fuori dall'app, file mancanti, **vault spostato su un altro percorso**, log senza percorsi assoluti.

## Formati

- Immagini: jpg, jpeg, png, webp, gif, avif, bmp, tif/tiff, ico, heic/heif\*, jxl\*
- RAW\*\*: dng, cr2, cr3, nef, nrw, arw, srf, sr2, raf, orf, rw2, pef, srw, x3f, 3fr, iiq
- Video: mp4, mov, mkv, webm, avi, m4v, mpg, mpeg, mts, m2ts, 3gp, 3g2, wmv, flv, vob, ts, mxf
- Audio (opzionale, da Impostazioni): mp3, aac, m4a, wav, flac, ogg, opus

\* HEIC/JXL: miniatura dall'anteprima incorporata o via FFmpeg quando sharp non li decodifica.
\*\* RAW: anteprima JPEG incorporata (niente demosaicing, come da scope MVP).
I video con codec non supportati dal player interno si aprono con un clic nel player di sistema.

## Roadmap

| Task | Stato |
|---|---|
| T001 setup · T002 design system · T003 database | ✅ |
| T004 scanner · T005 metadata · T006 miniature | ✅ |
| T007 griglia · T008 lightbox · T009 sidebar/topbar/filtri | ✅ |
| T010 album/tag/rating/preferiti · T011 review · T012 cestino · T013 move/copy/rename + undo | ✅ |
| T019 performance (virtualizzazione, coda priorità, worker) | ✅ base, da profilare su 100k file reali |
| T020 QA (test motore + flussi UI verificati) · T021 build portatile · T022 documentazione | ✅ |
| T014 regole smart con dry-run | ⏭ prossimo |
| T015–T016 editor foto non distruttivo + export | ⏭ |
| T017–T018 trim video, export MP4/WebM/GIF, ottimizzatore GIF | ⏭ |
| Rilevamento immagini simili (pHash), mappa, rimozione GPS batch | ⏭ |
