import type { LucideIcon } from 'lucide-react'
import { X } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'

/**
 * A composer mode shown as an icon + label chip in the toolbar. When it can be
 * left, the leading icon becomes the close affordance on hover, the way the
 * sidebar rows do it — the chip only gains a background, never a different
 * text colour.
 */
export function ComposerModeChip({ icon: Icon, label, title, onExit, className, compact = false }: {
  icon: LucideIcon
  label: string
  title?: string
  onExit?: () => void
  className?: string
  compact?: boolean
}) {
  const base = 'group/mode-chip inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-2 py-1 text-xs transition-colors'
  if (!onExit) {
    return (
      <span className={cn(base, className)} title={compact ? (title ?? label) : title} aria-label={compact ? label : undefined}>
        <Icon className="size-3.5 shrink-0" />
        {!compact && <span data-toolbar-chip-label="">{label}</span>}
      </span>
    )
  }
  return (
    <button
      type="button"
      onClick={onExit}
      title={compact ? (title ? `${label} — ${title}` : label) : title}
      aria-label={compact ? label : undefined}
      className={cn(base, className)}
    >
      <Icon className="size-3.5 shrink-0 group-hover/mode-chip:hidden" />
      <X className="hidden size-3.5 shrink-0 group-hover/mode-chip:block" />
      {!compact && <span data-toolbar-chip-label="">{label}</span>}
    </button>
  )
}
