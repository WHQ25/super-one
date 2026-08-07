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
  type MermaidScheme,
  getMermaidThemeOption,
  mermaidThemesFor,
} from '@/components/chat/mermaid-themes'
import { MermaidThemePreview } from '@/components/chat/MermaidThemePreview'

export interface MermaidThemePickerProps {
  scheme: MermaidScheme
  /** Stored theme id, or null for scheme default. */
  value: string | null
  onChange: (id: string | null) => void
  disabled?: boolean
  size?: 'compact' | 'default'
  /** Optional left-side label on the same row as the dropdown (Appearance). */
  label?: ReactNode
  /** When true, offer a Default option that writes null. */
  clearable?: boolean
  showPreview?: boolean
}

export function MermaidThemePicker({
  scheme,
  value,
  onChange,
  disabled = false,
  size = 'default',
  label,
  clearable = false,
  showPreview = true,
}: MermaidThemePickerProps) {
  const { t } = useTranslation()
  const selected = getMermaidThemeOption(scheme, value)
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
        {mermaidThemesFor(scheme).map((theme) => (
          <DropdownMenuItem
            key={theme.id}
            onClick={() => onChange(theme.id)}
            className="flex items-center justify-between gap-2"
          >
            <span className="flex items-center gap-2">
              <span className="flex size-4 overflow-hidden rounded-sm border border-border">
                <span className="flex-1" style={{ backgroundColor: theme.swatch[0] }} />
                <span className="flex-1" style={{ backgroundColor: theme.swatch[1] }} />
                <span className="flex-1" style={{ backgroundColor: theme.swatch[2] }} />
              </span>
              <span>{theme.name}</span>
            </span>
            {(clearable ? value === theme.id : selected.id === theme.id) && (
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
      {showPreview && <MermaidThemePreview themeId={selected.id} scheme={scheme} />}
    </div>
  )
}

export function mermaidThemeSchemeForKey(key: string): MermaidScheme | null {
  if (key === 'mermaidLightTheme') return 'light'
  if (key === 'mermaidDarkTheme') return 'dark'
  return null
}
