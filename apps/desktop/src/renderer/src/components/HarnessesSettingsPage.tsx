/**
 * Settings → Harnesses — Provider-style Enabled/Disabled list + detail.
 * Claude/Codex detail exposes nested config entries that render the existing
 * Preferences / Skills / MCP / Hooks / Plugins / Agents pages in-place.
 */

import { useCallback, useEffect, useMemo, useState, type ComponentType } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  Blocks,
  Bot,
  ChevronRight,
  Loader2,
  Palette,
  Puzzle,
  RefreshCw,
  Server,
  Webhook,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@superone/ui/components/ui/button'
import { Badge } from '@superone/ui/components/ui/badge'
import { Switch } from '@superone/ui/components/ui/switch'
import { cn } from '@superone/ui/lib/utils'
import { acpAgentDisplayName, isGrokAcpAgent } from '@superone/shared/acp-brand'
import type { AcpAgentDescriptor, SettingsProvider } from '@superone/shared/agent-types'
import { useChatStore } from '@/stores/chat'
import { useAppStore, type HarnessConfigSection } from '@/stores/app'
import { resolveSessionIcon } from '@/components/harness/resolve-session-icon'
import { AgentsPage } from './AgentsPage'
import { SkillsPage } from './SkillsPage'
import { McpPage } from './McpPage'
import { HooksPage } from './HooksPage'
import { PluginsPage } from './PluginsPage'
import { PreferencesPage } from './PreferencesPage'

interface CatalogRow {
  id: string
  enabled: boolean
  state: string
  runtimeSource: string
  requiresAuth: boolean
  runtimeVersion?: string
  command?: string
  diagnostic?: { code: string; message: string }
}

type ListItem =
  | {
      key: string
      kind: 'catalog'
      catalogId: 'claude' | 'codex' | 'opencode' | 'acp-grok'
      label: string
      provider: 'claude' | 'codex' | 'opencode' | 'acp'
      acpAgentId: string | null
      experimental: boolean
      description: string
      /** Opens Claude/Codex nested settings when set. */
      configProvider?: SettingsProvider
    }
  | {
      key: string
      kind: 'experimental-acp'
      acpAgentId: string
      label: string
      provider: 'acp'
      experimental: true
      description: string
      configProvider?: undefined
    }

interface ProgressState {
  received: number
  total: number
  phase: 'download' | 'done' | 'error'
  message?: string
}

const EMPTY_ACP: AcpAgentDescriptor[] = []

const CLAUDE_CONFIG: Array<{
  section: HarnessConfigSection
  labelKey: string
  icon: ComponentType<{ className?: string }>
}> = [
  { section: 'preferences', labelKey: 'settings.layout.tabs.preferences', icon: Palette },
  { section: 'agents', labelKey: 'settings.layout.tabs.agents', icon: Bot },
  { section: 'skills', labelKey: 'settings.layout.tabs.skills', icon: Puzzle },
  { section: 'mcp', labelKey: 'settings.layout.tabs.mcp', icon: Server },
  { section: 'hooks', labelKey: 'settings.layout.tabs.hooks', icon: Webhook },
  { section: 'plugins', labelKey: 'settings.layout.tabs.plugins', icon: Blocks },
]

const CODEX_CONFIG = CLAUDE_CONFIG.filter((c) => c.section !== 'agents')

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function catalogIsOn(row: CatalogRow | undefined): boolean {
  if (!row) return false
  return row.enabled && row.state !== 'disabled'
}

export function HarnessesSettingsPage() {
  const { t } = useTranslation()
  const [catalog, setCatalog] = useState<CatalogRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState<Record<string, ProgressState>>({})
  const [selectedKey, setSelectedKey] = useState<string | null>('claude')
  const [enabledExperimentalAgents, setEnabledExperimentalAgents] = useState<string[]>([])
  const [legacyExperimentalAll, setLegacyExperimentalAll] = useState(false)

  const acpAgents = useChatStore((s) => s.harnessResources.acp?.agents ?? EMPTY_ACP)
  const initializeHarness = useChatStore((s) => s.initializeHarness)
  const settingsProvider = useAppStore((s) => s.settingsProvider)
  const setSettingsProvider = useAppStore((s) => s.setSettingsProvider)
  const harnessConfigSection = useAppStore((s) => s.harnessConfigSection)
  const setHarnessConfigSection = useAppStore((s) => s.setHarnessConfigSection)

  useEffect(() => {
    void initializeHarness('acp')
  }, [initializeHarness])

  useEffect(() => {
    let mounted = true
    window.app.getAppSettings().then((s) => {
      if (!mounted) return
      setEnabledExperimentalAgents(s.enabledExperimentalAgents ?? [])
      setLegacyExperimentalAll(!!s.experimentalAgentsEnabled)
    })
    return () => {
      mounted = false
    }
  }, [])

  const refreshCatalog = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const list = (await window.app.listHarnesses()) as CatalogRow[]
      setCatalog(Array.isArray(list) ? list : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setCatalog(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshCatalog()
  }, [refreshCatalog])

  useEffect(() => {
    const unsub = window.app.onHarnessInstallProgress?.((event) => {
      setProgress((prev) => ({
        ...prev,
        [event.harnessId]: {
          received: event.received,
          total: event.total,
          phase: event.phase,
          message: event.message,
        },
      }))
      if (event.phase === 'done' || event.phase === 'error') {
        void refreshCatalog()
      }
    })
    return () => {
      unsub?.()
    }
  }, [refreshCatalog])

  // Deep links (MCP popup / sandbox → preferences) land with a config section;
  // keep the list selection aligned with settingsProvider.
  useEffect(() => {
    if (!harnessConfigSection) return
    if (settingsProvider === 'codex') setSelectedKey('codex')
    else setSelectedKey('claude')
  }, [harnessConfigSection, settingsProvider])

  const catalogById = useMemo(() => {
    const m = new Map<string, CatalogRow>()
    for (const row of catalog ?? []) m.set(row.id, row)
    return m
  }, [catalog])

  const items = useMemo((): ListItem[] => {
    const list: ListItem[] = [
      {
        key: 'claude',
        kind: 'catalog',
        catalogId: 'claude',
        label: t('settings.harnesses.ids.claude'),
        provider: 'claude',
        acpAgentId: null,
        experimental: false,
        description: t('settings.harnesses.desc.claude'),
        configProvider: 'claude',
      },
      {
        key: 'codex',
        kind: 'catalog',
        catalogId: 'codex',
        label: t('settings.harnesses.ids.codex'),
        provider: 'codex',
        acpAgentId: null,
        experimental: false,
        description: t('settings.harnesses.desc.codex'),
        configProvider: 'codex',
      },
      {
        key: 'opencode',
        kind: 'catalog',
        catalogId: 'opencode',
        label: t('settings.harnesses.ids.opencode'),
        provider: 'opencode',
        acpAgentId: null,
        experimental: true,
        description: t('settings.harnesses.desc.opencode'),
      },
    ]

    const agents = acpAgents.filter((a) => a.id !== 'opencode')
    const grok = agents.find((a) => isGrokAcpAgent(a.id))
    const rest = agents.filter((a) => !isGrokAcpAgent(a.id))

    list.push({
      key: 'acp-grok',
      kind: 'catalog',
      catalogId: 'acp-grok',
      label: grok?.name || t('settings.harnesses.ids.acp-grok'),
      provider: 'acp',
      acpAgentId: grok?.id ?? 'grok-build',
      experimental: false,
      description: t('settings.harnesses.desc.acpGrok'),
    })

    for (const agent of rest) {
      list.push({
        key: `acp:${agent.id}`,
        kind: 'experimental-acp',
        acpAgentId: agent.id,
        label: agent.name || acpAgentDisplayName(agent.id),
        provider: 'acp',
        experimental: true,
        description: t('settings.harnesses.desc.experimentalAcp'),
      })
    }
    return list
  }, [acpAgents, t])

  const isItemEnabled = useCallback(
    (item: ListItem): boolean => {
      if (item.kind === 'catalog') {
        return catalogIsOn(catalogById.get(item.catalogId))
      }
      if (legacyExperimentalAll) return true
      return enabledExperimentalAgents.includes(item.acpAgentId)
    },
    [catalogById, enabledExperimentalAgents, legacyExperimentalAll],
  )

  const enabledItems = items.filter(isItemEnabled)
  const disabledItems = items.filter((i) => !isItemEnabled(i))
  const selected = items.find((i) => i.key === selectedKey) ?? items[0] ?? null

  async function setExperimentalAgentEnabled(agentId: string, enabled: boolean): Promise<void> {
    const next = enabled
      ? [...new Set([...enabledExperimentalAgents, agentId])]
      : enabledExperimentalAgents.filter((id) => id !== agentId)
    const result = await window.app.saveAppSettings({
      enabledExperimentalAgents: next,
      experimentalAgentsEnabled: false,
    })
    setEnabledExperimentalAgents(result.enabledExperimentalAgents ?? next)
    setLegacyExperimentalAll(!!result.experimentalAgentsEnabled)
    useAppStore.getState().setExperimentalAgentsEnabled(result.experimentalAgentsEnabled)
  }

  async function setEnabled(item: ListItem, enabled: boolean): Promise<void> {
    if (isItemEnabled(item) === enabled) return
    setBusyKey(item.key)
    setError('')
    try {
      if (item.kind === 'catalog') {
        if (enabled) {
          await window.app.enableHarness({ harnessId: item.catalogId })
          toast.success(t('settings.harnesses.enabled', { id: item.label }))
        } else {
          await window.app.disableHarness(item.catalogId)
          toast.success(t('settings.harnesses.disabled', { id: item.label }))
        }
        await refreshCatalog()
      } else {
        await setExperimentalAgentEnabled(item.acpAgentId, enabled)
        toast.success(
          t(enabled ? 'settings.harnesses.enabled' : 'settings.harnesses.disabled', {
            id: item.label,
          }),
        )
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      toast.error(msg)
      await refreshCatalog()
    } finally {
      setBusyKey(null)
    }
  }

  function openConfig(provider: SettingsProvider, section: HarnessConfigSection): void {
    setSettingsProvider(provider)
    setHarnessConfigSection(section)
  }

  const renderRow = (item: ListItem) => {
    const Icon = resolveSessionIcon(
      item.provider,
      item.kind === 'catalog' ? item.acpAgentId : item.acpAgentId,
    )
    const isSelected = selectedKey === item.key
    return (
      <button
        key={item.key}
        type="button"
        onClick={() => {
          setSelectedKey(item.key)
          // Switching harness while a nested config is open returns to detail.
          if (harnessConfigSection) setHarnessConfigSection(null)
        }}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left transition-colors',
          isSelected ? 'bg-primary/10' : 'hover:bg-muted/50',
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          {Icon ? (
            <Icon status="default" size={20} renderLevel="compact" />
          ) : (
            <span className="size-5 rounded bg-muted" />
          )}
          <span className="truncate text-sm font-medium">{item.label}</span>
          {item.experimental ? (
            <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[9px] font-normal">
              {t('settings.harnesses.experimentalBadge')}
            </Badge>
          ) : null}
        </span>
      </button>
    )
  }

  return (
    <div className="flex h-full min-h-0 gap-4">
      <div className="flex w-72 shrink-0 flex-col gap-3 overflow-y-auto pr-1">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t('settings.harnesses.title')}</h2>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-muted-foreground"
            onClick={() => void refreshCatalog()}
            disabled={loading || busyKey !== null}
          >
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
          </Button>
        </div>

        {loading && !catalog ? (
          <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            {t('settings.harnesses.loading')}
          </div>
        ) : null}

        {enabledItems.length > 0 && (
          <div className="flex flex-col gap-1">
            <div className="px-1 pb-0.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {t('settings.harnesses.groupEnabled')}
            </div>
            {enabledItems.map(renderRow)}
          </div>
        )}

        {disabledItems.length > 0 && (
          <div className="flex flex-col gap-1">
            <div className="px-1 pb-0.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {t('settings.harnesses.groupDisabled')}
            </div>
            {disabledItems.map(renderRow)}
          </div>
        )}
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-1 py-1">
        {error ? <p className="mb-3 shrink-0 text-sm text-destructive break-words">{error}</p> : null}
        {harnessConfigSection ? (
          // Nested config occupies the detail pane only — list stays put.
          <HarnessConfigPane
            section={harnessConfigSection}
            provider={settingsProvider}
            onBack={() => setHarnessConfigSection(null)}
          />
        ) : selected ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <HarnessDetail
              item={selected}
              catalog={selected.kind === 'catalog' ? catalogById.get(selected.catalogId) : undefined}
              enabled={isItemEnabled(selected)}
              busy={busyKey === selected.key}
              progress={
                selected.kind === 'catalog' ? progress[selected.catalogId] : undefined
              }
              onEnabledChange={(v) => void setEnabled(selected, v)}
              onOpenConfig={
                selected.configProvider
                  ? (section) => openConfig(selected.configProvider!, section)
                  : undefined
              }
            />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted-foreground">{t('settings.harnesses.selectHint')}</p>
          </div>
        )}
      </div>
    </div>
  )
}

function HarnessConfigPane({
  section,
  provider,
  onBack,
}: {
  section: HarnessConfigSection
  provider: SettingsProvider
  onBack: () => void
}) {
  const { t } = useTranslation()
  const title = t(`settings.layout.tabs.${section}`)
  const providerLabel =
    provider === 'codex'
      ? t('settings.layout.providers.codex')
      : t('settings.layout.providers.claude')

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex shrink-0 items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 px-2"
          onClick={onBack}
        >
          <ArrowLeft className="size-4" />
          {t('common.back')}
        </Button>
        <p className="min-w-0 truncate text-sm font-medium text-foreground">
          {providerLabel}
          <span className="mx-1.5 text-muted-foreground">/</span>
          {title}
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {section === 'preferences' && <PreferencesPage />}
        {section === 'agents' && <AgentsPage />}
        {section === 'skills' && <SkillsPage />}
        {section === 'mcp' && <McpPage />}
        {section === 'hooks' && <HooksPage />}
        {section === 'plugins' && <PluginsPage />}
      </div>
    </div>
  )
}

function HarnessDetail({
  item,
  catalog,
  enabled,
  busy,
  progress,
  onEnabledChange,
  onOpenConfig,
}: {
  item: ListItem
  catalog?: CatalogRow
  enabled: boolean
  busy: boolean
  progress?: ProgressState
  onEnabledChange: (enabled: boolean) => void
  onOpenConfig?: (section: HarnessConfigSection) => void
}) {
  const { t } = useTranslation()
  const Icon = resolveSessionIcon(
    item.provider,
    item.kind === 'catalog' ? item.acpAgentId : item.acpAgentId,
  )
  const installing =
    catalog?.state === 'installing' || progress?.phase === 'download'
  const pct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.received / progress.total) * 100))
      : null

  const configEntries =
    item.configProvider === 'claude'
      ? CLAUDE_CONFIG
      : item.configProvider === 'codex'
        ? CODEX_CONFIG
        : null

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          {Icon ? (
            <Icon status="default" size={36} renderLevel="compact" />
          ) : (
            <span className="size-9 rounded-lg bg-muted" />
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold text-foreground">{item.label}</h3>
              {item.experimental ? (
                <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                  {t('settings.harnesses.experimentalBadge')}
                </Badge>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-1">
          {(busy || installing) && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
          <Switch
            checked={enabled}
            onCheckedChange={onEnabledChange}
            disabled={busy || installing}
          />
        </div>
      </div>

      {item.kind === 'catalog' && (catalog?.runtimeVersion || catalog?.command || catalog?.diagnostic) ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm">
          {catalog?.runtimeVersion ? (
            <DetailRow label={t('settings.harnesses.fields.version')} value={catalog.runtimeVersion} />
          ) : null}
          {catalog?.command ? (
            <DetailRow label={t('settings.harnesses.fields.command')} value={catalog.command} mono />
          ) : null}
          {catalog?.diagnostic?.message ? (
            <p className="text-xs text-muted-foreground break-words">{catalog.diagnostic.message}</p>
          ) : null}
          {catalog?.requiresAuth && catalog.state === 'needs_auth' ? (
            <p className="text-xs text-muted-foreground">{t('settings.harnesses.needsAuth')}</p>
          ) : null}
        </div>
      ) : null}

      {item.kind === 'experimental-acp' ? (
        <p className="text-xs text-muted-foreground">{t('settings.harnesses.experimentalAcpHint')}</p>
      ) : null}

      {installing || progress?.phase === 'download' ? (
        <div className="space-y-1.5">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-200"
              style={{ width: pct != null ? `${pct}%` : '30%' }}
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            {progress && progress.total > 0
              ? t('settings.harnesses.progress', {
                  received: formatBytes(progress.received),
                  total: formatBytes(progress.total),
                  pct: pct ?? 0,
                })
              : t('settings.harnesses.installing')}
          </p>
        </div>
      ) : null}

      {progress?.phase === 'error' && progress.message ? (
        <p className="text-xs text-destructive break-words">{progress.message}</p>
      ) : null}

      {configEntries && onOpenConfig ? (
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="border-b border-border px-3 py-2">
            <p className="text-xs font-medium text-muted-foreground">
              {t('settings.harnesses.configSection')}
            </p>
          </div>
          <ul>
            {configEntries.map((entry, i) => (
              <li key={entry.section}>
                <button
                  type="button"
                  onClick={() => onOpenConfig(entry.section)}
                  className={cn(
                    'flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted/50',
                    i > 0 && 'border-t border-border',
                  )}
                >
                  <entry.icon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 font-medium text-foreground">
                    {t(entry.labelKey)}
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span
        className={cn(
          'min-w-0 text-right text-xs text-foreground',
          mono && 'font-mono break-all text-left',
        )}
        title={value}
      >
        {value}
      </span>
    </div>
  )
}
