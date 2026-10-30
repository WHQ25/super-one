import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Folder, GitCommit, GitFork } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import { formatCompactAge } from '@superone/shared/relative-time'
import {
  worktreeCheckoutLabel,
  worktreeInfoRoot,
  type SessionHoverModel,
  type WorktreeCheckoutLabel,
} from '@/lib/multi-host/session-hover'
import { EnvironmentKindIcon } from './EnvironmentKindIcon'
import { SessionHoverCardTrigger, SidebarHoverCard, sidebarHoverCardRowClass } from './SidebarHoverCard'

export { SessionHoverCardTrigger, SidebarHoverCard, sidebarHoverCardRowClass }

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
          <HoverLine icon={model.checkoutKind === 'commit'
            ? <GitCommit className="size-3" />
            : <GitFork className="size-3" />}>
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

/** Branch from the session row until the card opens; then the live worktree list, like the workdir chip. */
function useLiveCheckout(model: SessionHoverModel, shown: boolean): WorktreeCheckoutLabel | null {
  const path = model.worktreePath ?? null
  const projectPath = model.projectPath ?? null
  const [live, setLive] = useState<{ path: string; label: WorktreeCheckoutLabel | null } | null>(null)
  useEffect(() => {
    if (!shown || !path) return
    let cancelled = false
    void window.app.getWorktreeInfo(worktreeInfoRoot(projectPath, path)).then((info) => {
      if (!cancelled) setLive({ path, label: worktreeCheckoutLabel(info?.entries, path) })
    }).catch(() => {
      if (!cancelled) setLive({ path, label: null })
    })
    return () => { cancelled = true }
  }, [shown, path, projectPath])
  return live?.path === path ? live.label : null
}

function checkoutText(live: WorktreeCheckoutLabel | null, storedBranch: string | null, detachedLabel: string): {
  text: string | null
  commit: boolean
} {
  if (live?.kind === 'branch') return { text: live.name, commit: false }
  if (live?.kind === 'commit') return { text: live.hash, commit: true }
  if (live?.kind === 'detached') return { text: detachedLabel, commit: true }
  return { text: storedBranch, commit: false }
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
  const { t } = useTranslation()
  const [hovered, setHovered] = useState(false)
  const live = useLiveCheckout(model, open ?? hovered)
  const checkout = checkoutText(live, model.worktreeName, t('chat.worktree.detachedLabel'))
  const shown = checkout.text === model.worktreeName && checkout.commit === (model.checkoutKind === 'commit')
    ? model
    : { ...model, worktreeName: checkout.text, ...(checkout.commit ? { checkoutKind: 'commit' as const } : { checkoutKind: undefined }) }
  return (
    <SidebarHoverCard open={open} onOpenChange={setHovered} content={<SessionHoverBody model={shown} />}>
      {children}
    </SidebarHoverCard>
  )
}
