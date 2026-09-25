import type { ComponentProps } from 'react'
import { cn } from '@superone/ui/lib/utils'

/**
 * Explanatory text under a settings card, the way macOS System Settings puts
 * longer notes below a group. `SettingsSection` descriptions sit inline after
 * the title, so they only suit a few words; wrap the section and this note in
 * one element so the page's section spacing does not separate them.
 */
export function SettingsFootnote({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('mt-1.5 px-3 text-xs text-muted-foreground', className)} {...props} />
}
