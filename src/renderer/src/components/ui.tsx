import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Star } from 'lucide-react'
import type { ColorLabel } from '@shared/types'

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(' ')
}

type Variant = 'primary' | 'ghost' | 'soft' | 'danger' | 'outline'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg hover:bg-accent-strong shadow-sm',
  ghost: 'text-dim hover:text-fg hover:bg-hover',
  soft: 'bg-elev-2 text-fg hover:bg-active',
  danger: 'bg-danger/90 text-white hover:bg-danger',
  outline: 'border border-line-strong text-fg hover:bg-hover'
}

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; icon?: ReactNode }>(
  function Button({ variant = 'soft', size = 'md', icon, className, children, ...rest }, ref) {
    return (
      <button
        ref={ref}
        className={cx(
          'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors duration-150 disabled:opacity-40 disabled:pointer-events-none whitespace-nowrap',
          size === 'sm' ? 'h-7 px-2.5 text-[12.5px]' : 'h-9 px-3.5 text-[13px]',
          VARIANTS[variant],
          className
        )}
        {...rest}
      >
        {icon}
        {children}
      </button>
    )
  }
)

export function IconButton({ label, active, className, children, size = 'md', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex items-center justify-center rounded-lg transition-colors duration-150 disabled:opacity-40 disabled:pointer-events-none',
        size === 'sm' ? 'h-7 w-7' : size === 'lg' ? 'h-11 w-11' : 'h-9 w-9',
        active ? 'bg-accent-soft text-accent' : 'text-dim hover:text-fg hover:bg-hover',
        className
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line-strong bg-elev-2 px-1 font-sans text-[10.5px] text-dim">{children}</kbd>
}

export function Segmented<T extends string>({ value, options, onChange, size = 'md' }: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; size?: 'sm' | 'md' }) {
  return (
    <div className="inline-flex rounded-lg bg-elev-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cx(
            'rounded-md px-2.5 font-medium transition-all duration-150',
            size === 'sm' ? 'h-6 text-[12px]' : 'h-8 text-[12.5px]',
            value === o.value ? 'bg-elev text-fg shadow-sm' : 'text-dim hover:text-fg'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-2.5">
      <span>
        <span className="block text-[13px] text-fg">{label}</span>
        {hint && <span className="mt-0.5 block text-[12px] text-faint">{hint}</span>}
      </span>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx('relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors', checked ? 'bg-accent' : 'bg-elev-2 border border-line-strong')}
      >
        <span className={cx('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all', checked ? 'left-[18px]' : 'left-0.5')} />
      </button>
    </label>
  )
}

export function RatingStars({ value, onChange, size = 16 }: { value: number; onChange?: (v: number) => void; size?: number }) {
  return (
    <div className="inline-flex items-center gap-0.5" role="radiogroup" aria-label="Valutazione">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          disabled={!onChange}
          title={`${n} stelle (tasto ${n})`}
          onClick={() => onChange?.(value === n ? 0 : n)}
          className="text-faint transition-transform hover:scale-110 disabled:hover:scale-100"
        >
          <Star size={size} className={n <= value ? 'fill-warn text-warn' : ''} strokeWidth={1.8} />
        </button>
      ))}
    </div>
  )
}

export const COLOR_LABELS: { value: ColorLabel; color: string; name: string }[] = [
  { value: 'red', color: '#ff5d6c', name: 'Rosso' },
  { value: 'orange', color: '#ff9f43', name: 'Arancione' },
  { value: 'yellow', color: '#ffd23f', name: 'Giallo' },
  { value: 'green', color: '#3ddc97', name: 'Verde' },
  { value: 'blue', color: '#4dabf7', name: 'Blu' },
  { value: 'purple', color: '#b197fc', name: 'Viola' }
]

export function ColorLabelPicker({ value, onChange }: { value: ColorLabel; onChange: (v: ColorLabel) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      {COLOR_LABELS.map((c) => (
        <button
          key={c.value}
          title={c.name}
          onClick={() => onChange(value === c.value ? 'none' : c.value)}
          className={cx('h-5 w-5 rounded-full transition-transform hover:scale-110', value === c.value && 'ring-2 ring-fg ring-offset-2 ring-offset-panel')}
          style={{ background: c.color }}
        />
      ))}
    </div>
  )
}

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <span
      className="inline-block animate-spin rounded-full border-2 border-current border-t-transparent opacity-70"
      style={{ width: size, height: size }}
    />
  )
}

export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center anim-fade">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-elev-2 text-dim">{icon}</div>
      <h3 className="font-display text-[17px] font-semibold text-fg">{title}</h3>
      {children && <div className="max-w-md text-[13px] leading-relaxed text-dim">{children}</div>}
    </div>
  )
}
