import { cn } from '@superone/ui/lib/utils'

/**
 * Mention rows whose name shares a line with a description (a commit's sha and
 * author, a branch's subject, a session's project). The popup's list is the
 * `@container`: from `@md` up both sit on one line; below it the description
 * drops under the name instead of squeezing it away, and the row's edges —
 * icon and pills — stay on the first line.
 */
export const STACKED_ROW_CLASS = 'items-start @md:items-center'
export const STACKED_ICON_CLASS = 'mt-0.5 @md:mt-0'
export const STACKED_BODY_CLASS = 'flex min-w-0 flex-1 flex-col gap-0.5 @md:flex-row @md:items-baseline @md:gap-2'
/** The quiet second line: small, muted, and truncated on its own. */
export const STACKED_DETAIL_CLASS = 'min-w-0 truncate text-2xs font-normal text-muted-foreground'

/** Every selectable popup row; `selected` is the keyboard / hover position. */
export function mentionRowClass(selected: boolean): string {
  return cn(
    'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors',
    selected ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent/40',
  )
}
