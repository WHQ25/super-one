import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { GitFork } from 'lucide-react'
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
        <div className="min-w-0 flex-1 break-words text-sm font-medium text-popover-foreground">{model.title}</div>
        {age && <span className="shrink-0 tabular-nums text-muted-foreground">{age}</span>}
      </div>
      <div className="flex flex-col gap-1 text-muted-foreground">
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

export function SessionHoverCard({
  model,
  open,
  triggerClassName = 'min-w-0 flex-1',
  children,
}: {
  model: SessionHoverModel
  /** Stories pin the card open. Production leaves this unset. */
  open?: boolean
  triggerClassName?: string
  children: ReactNode
}) {
  return (
    <HoverCard open={open} openDelay={300} closeDelay={150}>
      <HoverCardTrigger asChild>
        <span className={triggerClassName}>{children}</span>
      </HoverCardTrigger>
      <HoverCardContent className="w-72 p-3" side="right" align="start">
        <SessionHoverBody model={model} />
      </HoverCardContent>
    </HoverCard>
  )
}
