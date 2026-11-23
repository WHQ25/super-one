import { useEffect, useMemo, useState, useSyncExternalStore, type ComponentType, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AppWindow, Blocks, Bug, File, FileDiff, Folder, GitCommit, GitFork, Globe, MessageCirclePlus, Puzzle, Route, Smartphone, Terminal } from 'lucide-react'
import type { LayoutTabKind } from '@superone/shared/layout-control'
import { projectSessionKey } from '@superone/shared/remote-resource-key'
import { cn } from '@superone/ui/lib/utils'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@superone/ui/components/ui/tooltip'
import { formatCompactAge } from '@superone/shared/relative-time'
import { activityDockRevision, subscribeActivityDockRevision } from '@/components/activity/activity-dock-revision'
import { sessionTerminalRevision, subscribeSessionTerminals } from '@/components/activity/session-terminals'
import {
  worktreeCheckoutLabel,
  worktreeInfoRoot,
  type SessionHoverModel,
  type WorktreeCheckoutLabel,
} from '@/lib/multi-host/session-hover'
import { sessionTabCounts, type SessionTabCount } from '@/lib/session-bound-tabs'
import { useActivityViewStateStore } from '@/stores/activity-view-state'
import { useBrowserStore } from '@/stores/browser'
import { EnvironmentKindIcon } from './EnvironmentKindIcon'
import { SessionHoverCardTrigger, SidebarHoverCard, sidebarHoverCardRowClass } from './SidebarHoverCard'

export { SessionHoverCardTrigger, SidebarHoverCard, sidebarHoverCardRowClass }

const TAB_KIND_ICON: Record<LayoutTabKind, ComponentType<{ className?: string }>> = {
  terminal: Terminal,
  browser: Globe,
  device: Smartphone,
  file: File,
  miniapp: AppWindow,
  trajectory: Route,
  'side-chat': MessageCirclePlus,
  'tool-preview': Bug,
  'mcp-app': Puzzle,
  'mod-pane': Blocks,
  'plugin-panel': Puzzle,
  review: FileDiff,
  other: AppWindow,
}

const TAB_KIND_LABEL: Record<LayoutTabKind, 'activity.tabs.terminal' | 'activity.tabs.browser' | 'activity.tabs.device' | 'activity.tabs.file' | 'activity.tabs.miniapp' | 'activity.tabs.trajectory' | 'activity.tabs.sideChat' | 'activity.tabs.toolPreview' | 'activity.tabs.mcpApp' | 'activity.tabs.modPane' | 'activity.tabs.other'> = {
  terminal: 'activity.tabs.terminal',
  browser: 'activity.tabs.browser',
  device: 'activity.tabs.device',
  file: 'activity.tabs.file',
  miniapp: 'activity.tabs.miniapp',
  trajectory: 'activity.tabs.trajectory',
  'side-chat': 'activity.tabs.sideChat',
  'tool-preview': 'activity.tabs.toolPreview',
  'mcp-app': 'activity.tabs.mcpApp',
  'mod-pane': 'activity.tabs.modPane',
  'plugin-panel': 'activity.tabs.other',
  review: 'activity.tabs.other',
  other: 'activity.tabs.other',
}

const TAB_KIND_HINT: Record<LayoutTabKind, 'activity.tabs.hint.terminal' | 'activity.tabs.hint.browser' | 'activity.tabs.hint.device' | 'activity.tabs.hint.file' | 'activity.tabs.hint.miniapp' | 'activity.tabs.hint.trajectory' | 'activity.tabs.hint.sideChat' | 'activity.tabs.hint.toolPreview' | 'activity.tabs.hint.mcpApp' | 'activity.tabs.hint.modPane' | 'activity.tabs.hint.other'> = {
  terminal: 'activity.tabs.hint.terminal',
  browser: 'activity.tabs.hint.browser',
  device: 'activity.tabs.hint.device',
  file: 'activity.tabs.hint.file',
  miniapp: 'activity.tabs.hint.miniapp',
  trajectory: 'activity.tabs.hint.trajectory',
  'side-chat': 'activity.tabs.hint.sideChat',
  'tool-preview': 'activity.tabs.hint.toolPreview',
  'mcp-app': 'activity.tabs.hint.mcpApp',
  'mod-pane': 'activity.tabs.hint.modPane',
  'plugin-panel': 'activity.tabs.hint.other',
  review: 'activity.tabs.hint.other',
  other: 'activity.tabs.hint.other',
}

/** Stories pass `tabs`. Production recounts when the dock, browsers, or agent terminals change. */
function useSessionTabCounts(model: SessionHoverModel, tabs: SessionTabCount[] | undefined): SessionTabCount[] {
  const layoutKey = projectSessionKey(model.projectPath, model.sessionId)
  const dockRevision = useSyncExternalStore(subscribeActivityDockRevision, activityDockRevision)
  const terminalRevision = useSyncExternalStore(subscribeSessionTerminals, sessionTerminalRevision)
  const browsers = useBrowserStore((s) => s.tabs)
  const layout = useActivityViewStateStore((s) => s.perSession[layoutKey])
  const currentSessionId = useActivityViewStateStore((s) => s._currentSessionId)
  const live = useMemo(
    () => sessionTabCounts(layoutKey),
    // The stores are the reason to recount; sessionTabCounts reads them itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layoutKey, dockRevision, terminalRevision, browsers, layout, currentSessionId],
  )
  return tabs ?? live
}

export function SessionHoverTabs({ tabs }: { tabs: SessionTabCount[] }) {
  const { t } = useTranslation()
  if (tabs.length === 0) return null
  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-muted-foreground" data-session-hover-tabs role="group" aria-label={t('activity.tabs.summary')}>
        {tabs.map(({ kind, count }) => {
          const Icon = TAB_KIND_ICON[kind]
          const label = t(TAB_KIND_LABEL[kind], { count })
          const hint = t(TAB_KIND_HINT[kind])
          return (
            <Tooltip key={kind}>
              <TooltipTrigger asChild>
                <span className="inline-flex items-center gap-1" data-tab-kind={kind} aria-label={`${label}. ${hint}`}>
                  <Icon className="size-3 shrink-0" />
                  <span className="tabular-nums">{count}</span>
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={6} className="max-w-64 text-left">
                <span className="block font-medium">{label}</span>
                <span className="mt-0.5 block text-background/80">{hint}</span>
              </TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </TooltipProvider>
  )
}

export function SessionHoverBody({ model, tabs }: { model: SessionHoverModel; tabs?: SessionTabCount[] }) {
  const { i18n } = useTranslation()
  const age = formatCompactAge(model.lastActiveAt, { locale: i18n.language })
  const openTabs = useSessionTabCounts(model, tabs)
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
      <SessionHoverTabs tabs={openTabs} />
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
