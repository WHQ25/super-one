import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, ExternalLink, MessageSquare, ShieldCheck, ShieldOff, Terminal, Webhook } from 'lucide-react'
import { useAppStore } from '@/stores/app'
import { cn } from '@superone/ui/lib/utils'
import { scopeBadgeClass } from '@/lib/scope-badge'
import {
  ResourceScopeToolbar,
  type ResourceScopeView,
} from '@/components/settings/ResourceScopeToolbar'
import { SettingsSection, settingsRowClassName } from '@/components/settings/SettingsSection'
import { SettingsCollapsibleGroup } from '@/components/settings/SettingsDisclosureRow'
import { SettingsEmptyState, SettingsLoadingState } from '@/components/settings/SettingsEmptyState'
import { SettingsFootnote } from '@/components/settings/SettingsFootnote'
import type { CodexHookEventName, CodexHookGroup, CodexHookHandlerType, CodexHookInfo, CodexHookSource, CodexHookTrustStatus } from '@superone/shared/agent-types'

const EVENT_ORDER: CodexHookEventName[] = [
  'preToolUse',
  'postToolUse',
  'permissionRequest',
  'preCompact',
  'postCompact',
  'sessionStart',
  'sessionEnd',
  'userPromptSubmit',
  'stop',
]

const HANDLER_ICON: Record<CodexHookHandlerType, typeof Terminal> = {
  command: Terminal,
  mcpTool: Webhook,
  prompt: MessageSquare,
  agent: Bot,
}

const SOURCE_LABEL_KEY: Record<CodexHookSource, string> = {
  user: 'resources.codexHooks.source.user',
  project: 'resources.codexHooks.source.project',
  managed: 'resources.codexHooks.source.managed',
  plugin: 'resources.codexHooks.source.plugin',
  unknown: 'resources.codexHooks.source.unknown',
}

function compareEvents(a: CodexHookEventName, b: CodexHookEventName): number {
  return EVENT_ORDER.indexOf(a) - EVENT_ORDER.indexOf(b)
}

function summaryFor(hook: CodexHookInfo): string {
  const text = hook.handlerType === 'mcpTool'
    ? `${hook.server ?? ''}/${hook.tool ?? ''}`
    : hook.command ?? hook.statusMessage ?? hook.matcher ?? ''
  return text.split('\n')[0].slice(0, 120)
}

export function CodexHooksPanel() {
  const { t } = useTranslation()
  const currentFolder = useAppStore((s) => s.currentFolder)
  const [groups, setGroups] = useState<CodexHookGroup[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [scope, setScope] = useState<ResourceScopeView>('user')

  const refresh = useCallback(async () => {
    if (!currentFolder) {
      setGroups([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await window.app.codexListHooks(currentFolder, { forceReload: true })
      setGroups(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setGroups([])
    }
    setLoading(false)
  }, [currentFolder])

  useEffect(() => { void refresh() }, [refresh])

  const hooks = useMemo(() => groups.flatMap((g) => g.hooks), [groups])
  const warnings = useMemo(() => groups.flatMap((g) => g.warnings), [groups])
  const errors = useMemo(() => groups.flatMap((g) => g.errors), [groups])

  // User view keeps non-project sources (managed/plugin/unknown) with user hooks.
  const scopedHooks = useMemo(
    () =>
      hooks.filter((h) =>
        scope === 'project' ? h.source === 'project' : h.source !== 'project',
      ),
    [hooks, scope],
  )

  const grouped = useMemo(() => {
    const map = new Map<CodexHookEventName, CodexHookInfo[]>()
    for (const h of scopedHooks) {
      const list = map.get(h.eventName) ?? []
      list.push(h)
      map.set(h.eventName, list)
    }
    for (const list of map.values()) list.sort((a, b) => a.displayOrder - b.displayOrder)
    return Array.from(map.entries()).sort(([a], [b]) => compareEvents(a, b))
  }, [scopedHooks])

  const toggleCollapse = (event: CodexHookEventName) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(event)) next.delete(event)
      else next.add(event)
      return next
    })
  }

  return (
    <div>
      <SettingsSection
        title={t('resources.codexHooks.title')}
        actions={<ResourceScopeToolbar className="mb-0" scope={scope} onScopeChange={setScope} />}
      >
        {warnings.length > 0 && (
          <div className={cn(settingsRowClassName, 'space-y-0.5 bg-warning/10 text-xs text-warning')}>
            {warnings.map((w, i) => <div key={i}>{w}</div>)}
          </div>
        )}

        {errors.length > 0 && (
          <div className={cn(settingsRowClassName, 'space-y-0.5 bg-error/10 text-xs text-error')}>
            {errors.map((e, i) => <div key={i}>{e}</div>)}
          </div>
        )}

        {loading ? (
          <SettingsLoadingState label={t('common.loading')} />
        ) : error ? (
          <p className={cn(settingsRowClassName, 'py-4 text-sm break-words text-error')}>{error}</p>
        ) : scopedHooks.length === 0 ? (
          <SettingsEmptyState
            title={t('resources.codexHooks.empty')}
            hint={t('resources.codexHooks.emptyHint')}
          />
        ) : (
          grouped.map(([event, entries]) => (
            <SettingsCollapsibleGroup
              key={event}
              title={event}
              meta={t('resources.hooks.entryCount', { count: entries.length })}
              collapsed={collapsed.has(event)}
              onToggle={() => toggleCollapse(event)}
            >
              {entries.map((hook) => (
                <CodexHookRow key={hook.key} hook={hook} />
              ))}
            </SettingsCollapsibleGroup>
          ))
        )}
      </SettingsSection>
      <SettingsFootnote>
        {t('resources.codexHooks.subtitle')} {t('resources.codexHooks.readOnlyNote')}
      </SettingsFootnote>
    </div>
  )
}

function CodexHookRow({ hook }: { hook: CodexHookInfo }) {
  const { t } = useTranslation()
  const TypeIcon = HANDLER_ICON[hook.handlerType]
  const sourceLabel = hook.pluginId
    ? `${t('resources.codexHooks.source.plugin')} · ${hook.pluginId}`
    : t(SOURCE_LABEL_KEY[hook.source])
  const TrustIcon = trustIcon(hook.trustStatus)

  return (
    <div className={cn(settingsRowClassName, 'flex items-start gap-3')}>
      <span className={cn(
        'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium',
        hook.source === 'user' && scopeBadgeClass('user'),
        hook.source === 'project' && scopeBadgeClass('project'),
        hook.source === 'plugin' && scopeBadgeClass('minor'),
        hook.source === 'managed' && scopeBadgeClass('minor'),
        hook.source === 'unknown' && 'bg-background text-muted-foreground',
      )}>
        {sourceLabel}
      </span>
      {hook.matcher && (
        <span className="shrink-0 rounded bg-background px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
          {hook.matcher}
        </span>
      )}
      <TypeIcon className={cn(
        'size-3.5 shrink-0',
        hook.enabled ? 'text-muted-foreground' : 'text-muted-foreground/40',
      )} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className={cn(
          'truncate font-mono text-xs',
          hook.enabled ? 'text-foreground/80' : 'text-muted-foreground/60 line-through',
        )}>
          {summaryFor(hook)}
        </span>
        <span className="truncate text-[11px] text-muted-foreground/70">
          {hook.sourcePath}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <TrustIcon className={cn(
          'size-3.5',
          hook.trustStatus === 'trusted' && 'text-success',
          hook.trustStatus === 'untrusted' && 'text-error',
          hook.trustStatus === 'unknown' && 'text-muted-foreground',
        )} aria-label={hook.trustStatus} />
        {hook.isManaged && (
          <ExternalLink className="size-3 text-muted-foreground" aria-label="managed" />
        )}
      </div>
    </div>
  )
}

function trustIcon(status: CodexHookTrustStatus): typeof ShieldCheck {
  switch (status) {
    case 'trusted': return ShieldCheck
    case 'untrusted': return ShieldOff
    default: return ShieldCheck
  }
}
