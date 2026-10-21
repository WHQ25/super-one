import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Monitor, Server, Unplug, Laptop } from 'lucide-react'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@superone/ui/components/ui/hover-card'
import { cn } from '@superone/ui/lib/utils'
import type { EnvironmentConnection, EnvironmentKind } from '@/lib/multi-host/types'
import { hoverLiveStatus, type SessionHoverLiveStatus, type SessionHoverModel } from '@/lib/multi-host/session-hover'

function kindIcon(kind: EnvironmentKind) {
  if (kind === 'cli-node') return Server
  if (kind === 'remote-desktop') return Laptop
  return Monitor
}

function kindLabelKey(kind: EnvironmentKind): 'sidebar.hover.kindLocal' | 'sidebar.hover.kindCliNode' | 'sidebar.hover.kindRemoteDesktop' {
  if (kind === 'cli-node') return 'sidebar.hover.kindCliNode'
  if (kind === 'remote-desktop') return 'sidebar.hover.kindRemoteDesktop'
  return 'sidebar.hover.kindLocal'
}

function connectionLabelKey(connection: EnvironmentConnection): 'sidebar.hover.offline' | 'sidebar.hover.needsUpgrade' | 'sidebar.hover.connecting' | 'sidebar.hover.connected' {
  if (connection === 'offline') return 'sidebar.hover.offline'
  if (connection === 'needs-upgrade') return 'sidebar.hover.needsUpgrade'
  if (connection === 'connecting') return 'sidebar.hover.connecting'
  return 'sidebar.hover.connected'
}

function statusKey(status: SessionHoverLiveStatus): 'sidebar.hover.idle' | 'sidebar.hover.running' | 'sidebar.hover.background' | 'sidebar.hover.unseen' {
  if (status === 'running') return 'sidebar.hover.running'
  if (status === 'background') return 'sidebar.hover.background'
  if (status === 'unseen') return 'sidebar.hover.unseen'
  return 'sidebar.hover.idle'
}

function harnessKey(provider: string | null) {
  if (provider === 'claude' || provider === 'codex' || provider === 'opencode' || provider === 'deepseek' || provider === 'cursor' || provider === 'acp') {
    return `sidebar.hover.harnesses.${provider}` as const
  }
  return null
}

function activityLabel(raw: string): string {
  const parsed = Date.parse(raw)
  if (!Number.isFinite(parsed)) return raw
  return new Date(parsed).toLocaleString()
}

export function SessionHoverBody({
  model,
  liveStatus = 'idle',
}: {
  model: SessionHoverModel
  liveStatus?: SessionHoverLiveStatus
}) {
  const { t } = useTranslation()
  const Icon = kindIcon(model.kind)
  const offline = model.connection === 'offline'
  const harnessKeyName = harnessKey(model.provider)
  const harness = model.provider === 'acp' && model.acpAgentId
    ? model.acpAgentId
    : harnessKeyName
      ? t(harnessKeyName)
      : (model.provider || t('sidebar.hover.unknownHarness'))
  return (
    <div className={cn('flex flex-col gap-1.5 text-xs', offline && 'opacity-80')} data-session-hover>
      <div className="truncate text-sm font-medium text-popover-foreground">{model.title}</div>
      <HoverLine label={t('sidebar.hover.environment')}>
        <span className="inline-flex min-w-0 items-center gap-1">
          <Icon className="size-3 shrink-0" aria-hidden />
          <span className="truncate">{model.environmentLabel}</span>
        </span>
        <span className="text-muted-foreground">
          {' · '}{t(kindLabelKey(model.kind))}
          {model.connection !== 'connected' ? ` · ${t(connectionLabelKey(model.connection))}` : ''}
        </span>
      </HoverLine>
      <HoverLine label={t('sidebar.hover.location')}>
        <span className="block">{t(model.locationKind === 'worktree' ? 'sidebar.hover.worktree' : 'sidebar.hover.checkout')}</span>
        <span className="block break-all font-mono text-[11px] text-muted-foreground">{model.locationPath}</span>
      </HoverLine>
      <HoverLine label={t('sidebar.hover.branch')}>
        <span className="font-mono">{model.branch || t('sidebar.hover.noBranch')}</span>
      </HoverLine>
      <HoverLine label={t('sidebar.hover.harness')}>{harness}</HoverLine>
      <HoverLine label={t('sidebar.hover.status')}>
        {t(statusKey(liveStatus))}
        {model.lastActiveAt ? ` · ${activityLabel(model.lastActiveAt)}` : ''}
      </HoverLine>
      {model.parentTitle && (
        <HoverLine label={t('sidebar.hover.parent')}>{model.parentTitle}</HoverLine>
      )}
      {model.childCount > 0 && (
        <HoverLine label={t('sidebar.hover.parent')}>{t('sidebar.hover.children', { count: model.childCount })}</HoverLine>
      )}
      {model.startedFrom && (
        <HoverLine label={t('sidebar.hover.startedFrom')}>{model.startedFrom}</HoverLine>
      )}
      {model.tags.length > 0 && (
        <HoverLine label={t('sidebar.hover.tags')}>
          <span className="flex flex-wrap gap-1">
            {model.tags.map((tag) => (
              <span key={tag} className="rounded bg-muted px-1.5 py-px text-[11px]">{tag}</span>
            ))}
          </span>
        </HoverLine>
      )}
    </div>
  )
}

function HoverLine({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2 py-0.5">
      <span className="w-16 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  )
}

export function SessionHoverCard({
  model,
  liveStatus,
  unseen = false,
  open,
  triggerClassName = 'min-w-0 flex-1',
  children,
}: {
  model: SessionHoverModel
  liveStatus?: string | null
  unseen?: boolean
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
        <SessionHoverBody model={model} liveStatus={hoverLiveStatus(liveStatus, unseen)} />
      </HoverCardContent>
    </HoverCard>
  )
}
