import type { LucideIcon } from 'lucide-react'
import { X } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'

/**
 * A composer mode shown as an icon + label chip in the toolbar. When it can be
 * left, the leading icon becomes the close affordance on hover, the way the
 * sidebar rows do it — the chip only gains a background, never a different
 * text colour.
 */
export function ComposerModeChip({ icon: Icon, label, title, onExit, className }: {
  icon: LucideIcon
  label: string
  title?: string
  onExit?: () => void
  className?: string
}) {
  const base = 'group/mode-chip inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs transition-colors'
  if (!onExit) {
    return <span className={cn(base, className)}><Icon className="size-3.5 shrink-0" /><span>{label}</span></span>
  }
  return (
    <button type="button" onClick={onExit} title={title} className={cn(base, className)}>
      <Icon className="size-3.5 shrink-0 group-hover/mode-chip:hidden" />
      <X className="hidden size-3.5 shrink-0 group-hover/mode-chip:block" />
      <span>{label}</span>
    </button>
  )
}
