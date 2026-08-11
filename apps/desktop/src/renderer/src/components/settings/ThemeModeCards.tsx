import { cn } from '@superone/ui/lib/utils'
import type { ThemeMode } from '@superone/shared/agent-types'

const THEME_PREVIEW_SURFACE: Record<
  'light' | 'dark',
  {
    sidebar: string
    main: string
    border: string
    row: string
    pill: string
    userBubble: string
    text: string
    textSoft: string
  }
> = {
  light: {
    sidebar: '#f2f1ee',
    main: '#fbfaf8',
    border: '#e4e2dd',
    row: '#e8e6e1',
    pill: '#ffffff',
    userBubble: '#e6e4de',
    text: '#cbc9c3',
    textSoft: '#dedcd6',
  },
  dark: {
    sidebar: '#1c1c1c',
    main: '#242424',
    border: '#333333',
    row: '#2c2c2c',
    pill: '#2a2a2a',
    userBubble: '#3a3a3a',
    text: '#565656',
    textSoft: '#454545',
  },
}

function ThemeSwatch({ scheme }: { scheme: 'light' | 'dark' }) {
  const c = THEME_PREVIEW_SURFACE[scheme]
  return (
    <div className="flex h-full w-full" style={{ backgroundColor: c.main }}>
      <div
        className="flex h-full w-[34%] shrink-0 flex-col gap-1 border-r p-1"
        style={{ borderColor: c.border, backgroundColor: c.sidebar }}
      >
        <div className="h-1.5 w-3/4 rounded-full" style={{ backgroundColor: c.row }} />
        <div className="h-1.5 w-full rounded-full" style={{ backgroundColor: c.row }} />
        <div className="h-1.5 w-2/3 rounded-full" style={{ backgroundColor: c.row }} />
      </div>
      <div className="relative flex-1">
        <div className="absolute inset-x-1.5 top-1.5 flex flex-col gap-1">
          <div className="ml-auto h-1.5 w-2/5 rounded-full" style={{ backgroundColor: c.userBubble }} />
          <div className="flex flex-col gap-0.5 pt-0.5">
            <div className="h-1 w-4/5 rounded-full" style={{ backgroundColor: c.text }} />
            <div className="h-1 w-3/5 rounded-full" style={{ backgroundColor: c.textSoft }} />
          </div>
          <div className="ml-auto h-1.5 w-1/3 rounded-full" style={{ backgroundColor: c.userBubble }} />
          <div className="flex flex-col gap-0.5 pt-0.5">
            <div className="h-1 w-2/3 rounded-full" style={{ backgroundColor: c.text }} />
          </div>
        </div>
        <div
          className="absolute inset-x-1.5 bottom-1.5 h-2 rounded-full border"
          style={{ backgroundColor: c.pill, borderColor: c.border }}
        />
      </div>
    </div>
  )
}

function ThemePreview({ mode }: { mode: ThemeMode }) {
  if (mode === 'system') {
    return (
      <div className="relative h-full w-full overflow-hidden">
        <div className="absolute inset-y-0 left-0 w-1/2">
          <ThemeSwatch scheme="light" />
        </div>
        <div className="absolute inset-y-0 right-0 w-1/2">
          <ThemeSwatch scheme="dark" />
        </div>
      </div>
    )
  }
  return <ThemeSwatch scheme={mode} />
}

function ThemeOptionCard({
  mode,
  label,
  selected,
  onSelect,
}: {
  mode: ThemeMode
  label: string
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex flex-1 flex-col items-center gap-2 rounded-lg border-2 p-1.5 transition-colors',
        selected ? 'border-primary' : 'border-transparent hover:border-border',
      )}
    >
      <div className="aspect-video w-full overflow-hidden rounded-md border border-border">
        <ThemePreview mode={mode} />
      </div>
      <span className="text-sm font-medium">{label}</span>
    </button>
  )
}

const THEME_MODES: ThemeMode[] = ['system', 'light', 'dark']

/** Shared System / Light / Dark cards with mini chat UI preview (Settings + Onboarding). */
export function ThemeModeCards({
  value,
  onChange,
  labelFor,
  className,
}: {
  value: ThemeMode
  onChange: (mode: ThemeMode) => void
  labelFor: (mode: ThemeMode) => string
  className?: string
}) {
  return (
    <div className={cn('flex w-full gap-3', className)}>
      {THEME_MODES.map((mode) => (
        <ThemeOptionCard
          key={mode}
          mode={mode}
          label={labelFor(mode)}
          selected={value === mode}
          onSelect={() => onChange(mode)}
        />
      ))}
    </div>
  )
}
