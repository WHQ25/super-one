import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { Bot, ChevronDown, ChevronRight, ExternalLink, MessageSquare, ShieldCheck, ShieldOff, Terminal, Webhook } from 'lucide-react'
import { useAppStore } from '@/stores/app'
import { cn } from '@superone/ui/lib/utils'
import { scopeBadgeClass } from '@/lib/scope-badge'
import {
  ResourceScopeToolbar,
  type ResourceScopeView,
} from '@/components/settings/ResourceScopeToolbar'
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
    <div className="mx-auto max-w-4xl">
      <ResourceScopeToolbar scope={scope} onScopeChange={setScope} />
      <div className="mb-4">
        <h2 className="text-lg font-semibold">{t('resources.codexHooks.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('resources.codexHooks.subtitle')}</p>
      </div>

      <div className="mb-4 rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
        {t('resources.codexHooks.readOnlyNote')}
      </div>

      {warnings.length > 0 && (
        <div className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          {warnings.map((w, i) => <div key={i}>{w}</div>)}
        </div>
      )}

      {errors.length > 0 && (
        <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {errors.map((e, i) => <div key={i}>{e}</div>)}
        </div>
      )}

      {loading ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {t('common.loading')}
        </div>
      ) : error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : scopedHooks.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <Webhook className="mx-auto size-8 text-muted-foreground/50" />
          <p className="mt-3 text-sm text-muted-foreground">{t('resources.codexHooks.empty')}</p>
          <p className="mt-1 text-xs text-muted-foreground/70">{t('resources.codexHooks.emptyHint')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {grouped.map(([event, entries]) => {
            const isCollapsed = collapsed.has(event)
            return (
              <div key={event} className="overflow-hidden rounded-lg border border-border bg-card">
                <button
                  onClick={() => toggleCollapse(event)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/50"
                >
                  <div className="flex items-center gap-1.5">
                    {isCollapsed ? <ChevronRight className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
                    <span className="text-sm font-medium">{event}</span>
                    <span className="text-xs text-muted-foreground">
                      {t('resources.hooks.entryCount', { count: entries.length })}
                    </span>
                  </div>
                </button>
                <AnimatePresence initial={false}>
                  {!isCollapsed && (
                    <motion.div
                      initial={{ height: 0 }}
                      animate={{ height: 'auto' }}
                      exit={{ height: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden border-t border-border"
                    >
                      <div className="divide-y divide-border">
                        {entries.map((hook) => (
                          <CodexHookRow key={hook.key} hook={hook} />
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )
          })}
        </div>
      )}
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
    <div className="flex items-start gap-3 px-3 py-2.5">
      <span className={cn(
        'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase',
        hook.source === 'user' && scopeBadgeClass('user'),
        hook.source === 'project' && scopeBadgeClass('project'),
        hook.source === 'plugin' && scopeBadgeClass('minor'),
        hook.source === 'managed' && scopeBadgeClass('minor'),
        hook.source === 'unknown' && 'bg-muted text-muted-foreground',
      )}>
        {sourceLabel}
      </span>
      {hook.matcher && (
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
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
          hook.trustStatus === 'trusted' && 'text-emerald-500',
          hook.trustStatus === 'untrusted' && 'text-destructive',
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
