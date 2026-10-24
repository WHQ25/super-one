import { forwardRef, type ComponentProps, type ReactNode, type Ref } from 'react'
import { useTranslation } from 'react-i18next'
import { Folder, GitFork } from 'lucide-react'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@superone/ui/components/ui/hover-card'
import { cn } from '@superone/ui/lib/utils'
import { formatCompactAge } from '@superone/shared/relative-time'
import type { SessionHoverModel } from '@/lib/multi-host/session-hover'
import { EnvironmentKindIcon } from './EnvironmentSectionHeader'

export function SessionHoverBody({ model }: { model: SessionHoverModel }) {
  const { i18n } = useTranslation()
  const age = formatCompactAge(model.lastActiveAt, { locale: i18n.language })
  return (
    <div className={cn('flex flex-col gap-2 text-xs', model.connection === 'offline' && 'opacity-80')} data-session-hover>
      <div className="flex items-baseline gap-2">
        <div className="line-clamp-3 min-w-0 flex-1 break-words text-sm font-medium text-popover-foreground">{model.title}</div>
        {age && <span className="shrink-0 tabular-nums text-muted-foreground">{age}</span>}
      </div>
      <div className="flex flex-col gap-1 text-muted-foreground">
        {model.projectName && (
          <HoverLine icon={<Folder className="size-3" />}>
            <span className="block truncate">{model.projectName}</span>
          </HoverLine>
        )}
        <HoverLine icon={<EnvironmentKindIcon kind={model.kind} connection={model.connection} path={model.path} className="size-3" />}>
          <span className="block truncate">{model.environmentLabel}</span>
        </HoverLine>
        {model.worktreeName && (
          <HoverLine icon={<GitFork className="size-3" />}>
            <span className="block break-all font-mono text-[11px]">{model.worktreeName}</span>
          </HoverLine>
        )}
      </div>
      {model.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {model.tags.map((tag) => (
            <span key={tag} className="rounded bg-muted px-1.5 py-px text-[11px]">{tag}</span>
          ))}
        </div>
      )}
    </div>
  )
}

function HoverLine({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start gap-1.5">
      <span className="flex h-4 shrink-0 items-center">{icon}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  )
}

/** The session row. HoverCard's trigger is also its anchor, so this element
 *  has to be the row: the card then shares the row's top edge and starts to
 *  its right. The context menu slots its handlers onto this component; they
 *  have to reach the row or a right-click does nothing. */
type SessionHoverTriggerProps = ComponentProps<typeof HoverCardTrigger> & {
  /** Context-menu trigger stamps this. Dropped so the hover-card marker stays. */
  'data-slot'?: string
}

export const SessionHoverCardTrigger = forwardRef<HTMLElement, SessionHoverTriggerProps>(
  function SessionHoverCardTrigger({ children, ...props }, ref) {
    // Both triggers stamp `data-slot`. Keep the hover-card marker; the menu
    // opens from `onContextMenu`, not from its slot name.
    const { 'data-slot': _dataSlot, ...rest } = props
    return (
      // Radix types the trigger ref as an anchor. `asChild` forwards it to the row.
      <HoverCardTrigger asChild {...rest} ref={ref as Ref<HTMLAnchorElement>}>
        {children}
      </HoverCardTrigger>
    )
  },
)

/** Same placement for every sidebar hover card: 4px to the right of the row, top-aligned. */
export function SidebarHoverCard({
  open,
  children,
  content,
}: {
  /** Stories pin the card open. Production leaves this unset. */
  open?: boolean
  /** Usually the context menu, with `SessionHoverCardTrigger` on the row inside it. */
  children: ReactNode
  content: ReactNode
}) {
  return (
    <HoverCard open={open} openDelay={300} closeDelay={150}>
      {children}
      {/* 4px off the row. Flush looks stuck to the title; a collision shift
          would slide the card left onto it. */}
      <HoverCardContent
        className="w-72 p-3"
        side="right"
        align="start"
        sideOffset={4}
        avoidCollisions={false}
      >
        {content}
      </HoverCardContent>
    </HoverCard>
  )
}

export function SessionHoverCard({
  model,
  open,
  children,
}: {
  model: SessionHoverModel
  /** Stories pin the card open. Production leaves this unset. */
  open?: boolean
  /** Usually the context menu, with `SessionHoverCardTrigger` on the row inside it. */
  children: ReactNode
}) {
  return (
    <SidebarHoverCard open={open} content={<SessionHoverBody model={model} />}>
      {children}
    </SidebarHoverCard>
  )
}
