import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@superone/ui/lib/utils'

/**
 * Building blocks shared by every settings page: a titled page, and titled
 * groups whose rows sit on one tinted card, separated by spacing alone.
 */

export function SettingsPage({ title, description, actions, className, children }: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
  children?: ReactNode
}) {
  return (
    // Pages own their padding because the layout's content pane is edge to edge
    // (master–detail pages such as Providers lay out full-height columns).
    <div className="px-7 pt-5 pb-8">
      <div className={cn('mx-auto max-w-3xl', className)}>
        {/* Actions wrap under the title rather than squeezing it when the pane is narrow. */}
        <div className="mb-5 flex min-h-8 flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex max-w-full min-w-0 items-center gap-2">{actions}</div>}
        </div>
        <div className="space-y-5">{children}</div>
      </div>
    </div>
  )
}

export function SettingsSection({ title, description, actions, className, children }: {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
  children?: ReactNode
}) {
  return (
    <section className={className}>
      {(title || actions) && (
        <div className="mb-1.5 ml-1 flex min-h-7 flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          <div className="min-w-0 text-sm">
            {title && <h3 className="inline font-medium">{title}</h3>}
            {description && <span className="ml-1.5 text-xs text-muted-foreground">{description}</span>}
          </div>
          {actions && <div className="ml-auto flex max-w-full min-w-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      <SettingsCard>{children}</SettingsCard>
    </section>
  )
}

export function SettingsCard({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('rounded-lg bg-muted/50', className)} {...props} />
}

export function SettingsSubheader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('px-3 pt-2.5 pb-0.5 text-[11px] font-medium text-muted-foreground', className)}
      {...props}
    />
  )
}

/** Row chrome without the label layout, for rows that lay out their own content. */
export const settingsRowClassName = 'px-3 py-2.5 first:rounded-t-[inherit] last:rounded-b-[inherit]'

export function SettingsRow({ label, description, children, footer, className, ...props }: Omit<ComponentProps<'div'>, 'children'> & {
  label: ReactNode
  description?: ReactNode
  /** The control, aligned to the trailing edge. */
  children?: ReactNode
  /** Full-width content under the label and control, e.g. a progress bar or inline form. */
  footer?: ReactNode
}) {
  return (
    <div className={cn(settingsRowClassName, className)} {...props}>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm">{label}</div>
          {description && <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>}
        </div>
        {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
      </div>
      {footer && <div className="mt-2">{footer}</div>}
    </div>
  )
}
