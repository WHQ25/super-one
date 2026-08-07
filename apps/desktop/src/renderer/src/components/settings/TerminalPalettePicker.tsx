import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@superone/ui/components/ui/dropdown-menu'
import {
  type TerminalScheme,
  DEFAULT_DARK_PALETTE_ID,
  DEFAULT_LIGHT_PALETTE_ID,
  DEFAULT_TERMINAL_FONT_SIZE,
  getTerminalPalette,
  terminalPalettesFor,
} from '@/components/coding/terminal-palettes'
import { TerminalThemePreview } from '@/components/coding/TerminalThemePreview'

export interface TerminalPalettePickerProps {
  scheme: TerminalScheme
  /** Stored palette id, or null for scheme default. */
  value: string | null
  onChange: (id: string | null) => void
  fontSize?: number
  fontFamily?: string | null
  disabled?: boolean
  /** compact: smaller trigger (config confirm); default matches Appearance. */
  size?: 'compact' | 'default'
  /** Optional left-side label on the same row as the dropdown (Appearance). */
  label?: ReactNode
  /** When true, offer a Default option that writes null. */
  clearable?: boolean
  /** When false, only the dropdown is shown. Default true. */
  showPreview?: boolean
}

export function TerminalPalettePicker({
  scheme,
  value,
  onChange,
  fontSize = DEFAULT_TERMINAL_FONT_SIZE,
  fontFamily = null,
  disabled = false,
  size = 'default',
  label,
  clearable = false,
  showPreview = true,
}: TerminalPalettePickerProps) {
  const { t } = useTranslation()
  const resolvedId = value ?? (scheme === 'dark' ? DEFAULT_DARK_PALETTE_ID : DEFAULT_LIGHT_PALETTE_ID)
  const selected = getTerminalPalette(resolvedId, scheme)
  const isCompact = size === 'compact'
  const displayName = clearable && value === null
    ? t('chat.configConfirm.defaultOption')
    : selected.name

  const dropdown = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={
            isCompact
              ? 'flex min-w-36 items-center justify-between gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-xs transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60'
              : 'flex min-w-40 items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60'
          }
        >
          <span className="truncate">{displayName}</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {clearable && (
          <DropdownMenuItem onClick={() => onChange(null)} className="flex items-center justify-between">
            <span>{t('chat.configConfirm.defaultOption')}</span>
            {value === null && <Check className="size-4 text-muted-foreground" />}
          </DropdownMenuItem>
        )}
        {terminalPalettesFor(scheme).map((palette) => (
          <DropdownMenuItem
            key={palette.id}
            onClick={() => onChange(palette.id)}
            className="flex items-center justify-between gap-2"
          >
            <span className="flex items-center gap-2">
              <span className="flex size-4 overflow-hidden rounded-sm border border-border">
                <span className="flex-1" style={{ backgroundColor: palette.ansi.red }} />
                <span className="flex-1" style={{ backgroundColor: palette.ansi.green }} />
                <span className="flex-1" style={{ backgroundColor: palette.ansi.blue }} />
              </span>
              <span>{palette.name}</span>
            </span>
            {(clearable ? value === palette.id : resolvedId === palette.id) && (
              <Check className="size-4 shrink-0 text-muted-foreground" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    <div className="flex w-full min-w-0 flex-col gap-3">
      {label ? (
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">{label}</div>
          {dropdown}
        </div>
      ) : (
        <div className="flex justify-end">{dropdown}</div>
      )}
      {showPreview && (
        <TerminalThemePreview
          ansi={selected.ansi}
          scheme={scheme}
          fontSize={fontSize}
          fontFamily={fontFamily}
        />
      )}
    </div>
  )
}

export function terminalPaletteSchemeForKey(key: string): TerminalScheme | null {
  if (key === 'terminalLightPalette') return 'light'
  if (key === 'terminalDarkPalette') return 'dark'
  return null
}
