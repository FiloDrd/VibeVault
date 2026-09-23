const dayFmt = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const dayShortFmt = new Intl.DateTimeFormat('it-IT', { weekday: 'short', day: 'numeric', month: 'short' })
const monthFmt = new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric' })
const fullFmt = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const relFmt = new Intl.RelativeTimeFormat('it-IT', { numeric: 'auto' })

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function formatBytes(n: number | null | undefined): string {
  if (!n) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  const v = n / 1024 ** i
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1).replace('.', ',')} ${u[i]}`
}

export function formatDuration(ms: number | null | undefined): string {
  if (!ms && ms !== 0) return ''
  const s = Math.round(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}

export function dayKey(t: number): string {
  if (!t) return 'nodate'
  const d = new Date(t)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

export function monthKey(t: number): string {
  if (!t) return 'nodate'
  const d = new Date(t)
  return `${d.getFullYear()}-${d.getMonth()}`
}

export function dayLabel(t: number): string {
  if (!t) return 'Senza data'
  const d = new Date(t)
  const today = new Date()
  const diff = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86400000)
  if (diff === 0) return 'Oggi'
  if (diff === 1) return 'Ieri'
  if (diff > 1 && diff < 7) return cap(relFmt.format(-diff, 'day'))
  if (d.getFullYear() === today.getFullYear()) return cap(dayShortFmt.format(d))
  return cap(dayFmt.format(d))
}

export function monthLabel(t: number): string {
  return t ? cap(monthFmt.format(new Date(t))) : 'Senza data'
}

export function formatDate(t: number | null | undefined): string {
  return t ? fullFmt.format(new Date(t)) : '—'
}

export function formatCount(n: number): string {
  return n.toLocaleString('it-IT')
}

export function plural(n: number, one: string, many: string): string {
  return `${formatCount(n)} ${n === 1 ? one : many}`
}
