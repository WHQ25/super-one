import type { KeyboardEvent, ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import { SettingsSubheader, settingsRowClassName } from './SettingsSection'

/**
 * A settings-card row that expands in place to show a detail panel (a file
 * preview, a definition). The header is the toggle; `trailing` controls sit on
 * it but do not toggle it.
 */
export function SettingsDisclosureRow({
  expanded,
  onToggle,
  icon,
  title,
  description,
  meta,
  trailing,
  dimmed,
  children,
}: {
  expanded: boolean
  onToggle: () => void
  icon?: ReactNode
  /** Name line; badges can ride along after the name. */
  title: ReactNode
  description?: ReactNode
  /** Secondary line under the description, e.g. a source path. */
  meta?: ReactNode
  trailing?: ReactNode
  /** Fade the identity (not the controls) for disabled items. */
  dimmed?: boolean
  /** Panel shown while expanded. */
  children?: ReactNode
}) {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onToggle()
    }
  }

  return (
    <div className="first:rounded-t-[inherit] last:rounded-b-[inherit]">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={onToggle}
        onKeyDown={handleKeyDown}
        className={cn(
          settingsRowClassName,
          'flex cursor-pointer items-center gap-3 text-left transition-colors outline-none hover:bg-muted/60 focus-visible:bg-muted/60',
        )}
      >
        <div className={cn('flex min-w-0 flex-1 items-start gap-2.5 transition-opacity', dimmed && 'opacity-50')}>
          {icon && <div className="mt-0.5 shrink-0 text-muted-foreground">{icon}</div>}
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5 text-sm">{title}</div>
            {description && (
              <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{description}</p>
            )}
            {meta && <div className="mt-0.5 truncate text-[11px] text-muted-foreground/70">{meta}</div>}
          </div>
        </div>
        {trailing && (
          <div className="flex shrink-0 items-center gap-2" onClick={(e) => e.stopPropagation()}>
            {trailing}
          </div>
        )}
        <ChevronRight
          className={cn('size-4 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-90')}
        />
      </div>

      <AnimatePresence initial={false}>
        {expanded && children != null && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/**
 * A collapsible run of rows inside a settings card: a subheader that toggles
 * the rows under it (e.g. hooks grouped by event). Renders card children
 * directly, so the card's dividers and subheader rules apply.
 */
export function SettingsCollapsibleGroup({ title, meta, collapsed, onToggle, children }: {
  title: ReactNode
  /** Muted text after the title, e.g. an entry count. */
  meta?: ReactNode
  collapsed: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <>
      <SettingsSubheader className="px-1.5 pt-1.5 pb-0">
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={onToggle}
          className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-muted/60"
        >
          <ChevronRight className={cn('size-3.5 shrink-0 transition-transform', !collapsed && 'rotate-90')} />
          <span className="text-xs font-medium text-foreground">{title}</span>
          {meta && <span className="text-[11px] font-normal">{meta}</span>}
        </button>
      </SettingsSubheader>
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
