import { useEffect, useState } from 'react'
import { Database, FolderOpen, FolderPlus, HardDrive, History, RefreshCw, RotateCcw, ScrollText, Trash, X, Eraser } from 'lucide-react'
import type { OperationRecord, ThemeName } from '@shared/types'
import { useApp } from '@/store/app'
import { api, bumpThumbVersion } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { Button, cx, Segmented, Toggle } from '@/components/ui'

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-panel p-5">
      <h3 className="font-display text-[14px] font-semibold">{title}</h3>
      {desc && <p className="mt-0.5 text-[12px] text-faint">{desc}</p>}
      <div className="mt-3">{children}</div>
    </section>
  )
}

export function SettingsView() {
  const settings = useApp((s) => s.settings)
  const update = useApp((s) => s.updateSettings)
  const vault = useApp((s) => s.vault)
  const toast = useApp((s) => s.toast)
  const openDialog = useApp((s) => s.openDialog)
  const undo = useApp((s) => s.undo)
  const reload = useApp((s) => s.reload)
  const [ops, setOps] = useState<OperationRecord[]>([])

  const loadOps = () => void api('operations.list', 60).then(setOps)
  useEffect(loadOps, [])

  const addFolder = async () => {
    const r = await api('library.addScanFolderDialog')
    if (r.ok) { toast({ text: `Cartella aggiunta: ${r.folder}. Scansione avviata.`, tone: 'ok' }); useApp.setState({ settings: await api('settings.get') }) }
    else if (r.message) toast({ text: r.message, tone: 'error' })
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-[820px] space-y-4">
        <Section title="Aspetto">
          <div className="flex items-center justify-between py-2">
            <span className="text-[13px]">Tema</span>
            <Segmented<ThemeName>
              value={settings.theme}
              onChange={(t) => void update({ theme: t })}
              options={[{ value: 'dark', label: 'Scuro' }, { value: 'light', label: 'Chiaro' }, { value: 'auto', label: 'Auto' }, { value: 'high-contrast', label: 'Alto contrasto' }]}
            />
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-[13px]">Raggruppa la timeline per</span>
            <Segmented value={settings.groupBy} onChange={(g) => void update({ groupBy: g })} options={[{ value: 'day', label: 'Giorno' }, { value: 'month', label: 'Mese' }, { value: 'none', label: 'Nessuno' }]} />
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-[13px]">Dimensione miniature</span>
            <Segmented value={settings.gridSize} onChange={(g) => void update({ gridSize: g })} options={[{ value: 's', label: 'Piccole' }, { value: 'm', label: 'Medie' }, { value: 'l', label: 'Grandi' }]} />
          </div>
          <Toggle checked={settings.reducedMotion} onChange={(v) => void update({ reducedMotion: v })} label="Riduci animazioni" />
          <Toggle checked={settings.hideSensitiveThumbs} onChange={(v) => void update({ hideSensitiveThumbs: v })} label="Sfoca le miniature" hint="Utile quando mostri lo schermo ad altri. Le immagini restano visibili aprendole." />
        </Section>

        <Section title="Vault portatile" desc="Tutto (database, miniature, cestino, log) vive dentro questa cartella: spostala su qualsiasi SSD o PC e continua a funzionare.">
          <div className="rounded-lg bg-elev-2 p-3 font-mono text-[12px] text-dim">
            <div className="flex items-center gap-2"><HardDrive size={14} className="text-accent" />{vault?.root}</div>
            <div className="mt-1.5 text-[11.5px] text-faint">Database: {vault?.dbPath} · {vault?.portable ? 'modalità portatile' : 'modalità sviluppo'} · v{vault?.version}</div>
            <div className="mt-0.5 text-[11.5px] text-faint">FFmpeg: {vault?.tools.ffmpeg ? 'trovato' : 'NON trovato (video senza miniature)'} · ffprobe: {vault?.tools.ffprobe ? 'trovato' : 'NON trovato'}</div>
            {vault?.rootChanged && <div className="mt-1.5 text-[11.5px] text-warn">Root cambiata da {vault.rootChanged.from}: nessun problema, i percorsi sono relativi.</div>}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" icon={<FolderOpen size={14} />} onClick={() => void api('vault.revealRoot')}>Apri cartella vault</Button>
            <Button size="sm" icon={<HardDrive size={14} />} onClick={() => openDialog({ type: 'confirm', title: 'Cambiare vault?', message: 'Scegli un\'altra cartella come vault (verrà creata la struttura se vuota). L\'app si riavvierà.', confirmText: 'Scegli cartella', onConfirm: async () => { await api('vault.openRootDialog') } })}>Cambia vault…</Button>
          </div>
        </Section>

        <Section title="Cartelle indicizzate" desc="Percorsi relativi alla root del vault. Devono stare dentro il vault per restare portatili.">
          <div className="space-y-1">
            {settings.scanFolders.map((f) => (
              <div key={f} className="flex items-center justify-between rounded-lg bg-elev-2 px-3 py-2 text-[12.5px]">
                <span className="font-mono">{f || '(intero vault)'}</span>
                <button
                  className="text-faint hover:text-danger"
                  title="Smetti di indicizzare (i file non vengono toccati)"
                  onClick={() => void update({ scanFolders: settings.scanFolders.filter((x) => x !== f) })}
                  disabled={settings.scanFolders.length === 1}
                ><X size={14} /></button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" icon={<FolderPlus size={14} />} onClick={() => void addFolder()}>Aggiungi cartella…</Button>
            <Button size="sm" icon={<RefreshCw size={14} />} onClick={() => void api('library.scan')}>Scansiona ora</Button>
            <Button size="sm" variant="ghost" icon={<RefreshCw size={14} />} onClick={() => void api('library.rebuildIndex')}>Ricostruisci indice completo</Button>
          </div>
          <div className="mt-3 border-t border-line pt-2">
            <Toggle checked={settings.includeAudio} onChange={(v) => void update({ includeAudio: v })} label="Indicizza anche file audio" />
            <label className="flex items-center justify-between py-2.5 text-[13px]">
              <span>Soglia "file grandi"</span>
              <span className="flex items-center gap-2">
                <input type="number" min={10} step={50} value={settings.largeFileThresholdMB} onChange={(e) => void update({ largeFileThresholdMB: Math.max(1, Number(e.target.value) || 500) })} className="h-8 w-24 rounded-lg bg-elev-2 px-2 text-right outline-none" />
                <span className="text-dim">MB</span>
              </span>
            </label>
          </div>
        </Section>

        <Section title="Sicurezza e manutenzione">
          <Toggle checked={settings.backupBeforeBatch} onChange={(v) => void update({ backupBeforeBatch: v })} label="Backup automatico del database prima delle operazioni su 50+ file" hint="I backup vanno in VaultData/backups (ultimi 10)." />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" icon={<Database size={14} />} onClick={async () => { const r = await api('maintenance.backupDb'); toast({ text: r.ok ? `Backup creato: ${r.path}` : r.message ?? 'Errore', tone: r.ok ? 'ok' : 'error' }) }}>Backup database</Button>
            <Button size="sm" icon={<Eraser size={14} />} onClick={async () => { const r = await api('maintenance.clearCache'); bumpThumbVersion(); toast({ text: `Cache svuotata (${r.removed} file). Le miniature verranno rigenerate.`, tone: 'ok' }); void reload() }}>Svuota cache miniature</Button>
            <Button size="sm" icon={<ScrollText size={14} />} onClick={() => void api('maintenance.openLogs')}>Apri log</Button>
          </div>
        </Section>

        <Section title="Cronologia operazioni" desc="Ogni operazione è registrata. Quelle annullabili possono essere invertite anche a distanza di tempo.">
          <div className="max-h-[360px] space-y-px overflow-y-auto">
            {ops.map((o) => (
              <div key={o.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-[12.5px] hover:bg-hover">
                <History size={14} className="shrink-0 text-faint" />
                <span className={cx('min-w-0 flex-1 truncate', o.status === 'undone' && 'text-faint line-through')}>{o.label}</span>
                <span className="shrink-0 text-[11px] text-faint">{formatDate(o.createdAt)}</span>
                {o.status === 'partial' && <span className="text-[11px] text-warn">parziale</span>}
                {o.status === 'failed' && <span className="text-[11px] text-danger">fallita</span>}
                {o.undoable ? (
                  <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} onClick={async () => { await undo(o.id); loadOps() }}>Annulla</Button>
                ) : o.type === 'trash.empty' ? <Trash size={13} className="text-faint" /> : <span className="w-[76px]" />}
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  )
}
