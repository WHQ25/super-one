/**
 * Settings → Harnesses — Provider-style Enabled/Disabled list + detail.
 * Claude/Codex/Cursor detail uses tabs (preferences / skills / MCP / …) and reuses
 * the existing settings page components under the active tab.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import { Blocks, Bot, Cloud, Cpu, GripVertical, KeyRound, Loader2, Palette, Puzzle, RefreshCw, Server, Webhook } from 'lucide-react'
import { Codex, Cursor, DeepSeek, Grok, OpenCode } from '@lobehub/icons'
import { toast } from 'sonner'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Button } from '@superone/ui/components/ui/button'
import { Badge } from '@superone/ui/components/ui/badge'
import { Switch } from '@superone/ui/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@superone/ui/components/ui/tabs'
import { cn } from '@superone/ui/lib/utils'
import { acpAgentDisplayName, isGrokAcpAgent } from '@superone/shared/acp-brand'
import type { AcpAgentDescriptor, SettingsProvider } from '@superone/shared/agent-types'
import {
  NODE_HARNESS_IDS,
  type NodeHarnessId,
} from '@superone/shared/environment/harness-installation'
import type { HarnessId } from '@superone/shared/session-types'
import { suggestionHarnessKey } from '@/lib/suggestion-harness-order'
import { useChatStore } from '@/stores/chat'
import { useAppStore, type HarnessConfigSection } from '@/stores/app'
import { ClaudeCodeTextInline } from '@/components/harness/ClaudeCodeTextInline'
import { resolveSessionIcon } from '@/components/harness/resolve-session-icon'
import { AgentsPage } from './AgentsPage'
import { SkillsPage } from './SkillsPage'
import { McpPage } from './McpPage'
import { HooksPage } from './HooksPage'
import { PluginsPage } from './PluginsPage'
import { PreferencesPage } from './PreferencesPage'
import { CursorAuthSettings, type CursorSettingsSection } from './CursorAuthSettings'

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
      catalogId: NodeHarnessId
      label: string
      provider: HarnessId
      acpAgentId: string | null
      experimental: boolean
      description: string
      /** Opens nested harness settings when set. */
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

interface CatalogHarnessMeta {
  provider: HarnessId
  labelKey: string
  descriptionKey: string
  experimental: boolean
  configProvider?: SettingsProvider
}

/**
 * UI metadata for every first-party catalog harness. The exhaustive Record is
 * intentional: adding a NodeHarnessId must also add its settings entry.
 */
const CATALOG_HARNESS_META = {
  claude: {
    provider: 'claude',
    labelKey: 'settings.harnesses.ids.claude',
    descriptionKey: 'settings.harnesses.desc.claude',
    experimental: false,
    configProvider: 'claude',
  },
  codex: {
    provider: 'codex',
    labelKey: 'settings.harnesses.ids.codex',
    descriptionKey: 'settings.harnesses.desc.codex',
    experimental: false,
    configProvider: 'codex',
  },
  opencode: {
    provider: 'opencode',
    labelKey: 'settings.harnesses.ids.opencode',
    descriptionKey: 'settings.harnesses.desc.opencode',
    experimental: true,
  },
  cursor: {
    provider: 'cursor',
    labelKey: 'settings.harnesses.ids.cursor',
    descriptionKey: 'settings.harnesses.desc.cursor',
    experimental: true,
    configProvider: 'cursor',
  },
  'acp-grok': {
    provider: 'acp',
    labelKey: 'settings.harnesses.ids.acp-grok',
    descriptionKey: 'settings.harnesses.desc.acpGrok',
    experimental: false,
  },
  dsh: {
    provider: 'dsh',
    labelKey: 'settings.harnesses.ids.deepseek',
    descriptionKey: 'settings.harnesses.desc.deepseek',
    experimental: true,
  },
} satisfies Record<NodeHarnessId, CatalogHarnessMeta>

const CONFIG_TAB_META: Record<
  HarnessConfigSection,
  { labelKey: string; icon: ComponentType<{ className?: string }> }
> = {
  preferences: { labelKey: 'settings.layout.tabs.preferences', icon: Palette },
  account: { labelKey: 'settings.layout.tabs.account', icon: KeyRound },
  agents: { labelKey: 'settings.layout.tabs.agents', icon: Bot },
  skills: { labelKey: 'settings.layout.tabs.skills', icon: Puzzle },
  mcp: { labelKey: 'settings.layout.tabs.mcp', icon: Server },
  hooks: { labelKey: 'settings.layout.tabs.hooks', icon: Webhook },
  plugins: { labelKey: 'settings.layout.tabs.plugins', icon: Blocks },
  cloud: { labelKey: 'settings.layout.tabs.cloud', icon: Cloud },
  models: { labelKey: 'settings.layout.tabs.models', icon: Cpu },
}

const CLAUDE_CONFIG_TABS: HarnessConfigSection[] = [
  'preferences',
  'agents',
  'skills',
  'mcp',
  'hooks',
  'plugins',
]

const CODEX_CONFIG_TABS: HarnessConfigSection[] = [
  'preferences',
  'skills',
  'mcp',
  'hooks',
  'plugins',
]

const CURSOR_CONFIG_TABS: HarnessConfigSection[] = [
  'account',
  'preferences',
  'models',
  'cloud',
]

function configTabsFor(provider: SettingsProvider | undefined): HarnessConfigSection[] | null {
  if (provider === 'claude') return CLAUDE_CONFIG_TABS
  if (provider === 'codex') return CODEX_CONFIG_TABS
  if (provider === 'cursor') return CURSOR_CONFIG_TABS
  return null
}

/** True when the nested harness tab is one of Cursor's config pages. */
function isCursorSettingsSection(section: HarnessConfigSection): section is CursorSettingsSection {
  return (
    section === 'account'
    || section === 'preferences'
    || section === 'models'
    || section === 'cloud'
  )
}

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

/** Suggestion-key used for harnessOrder / ChatSuggestions ranking. */
function orderKeyForItem(item: ListItem): string {
  if (item.provider === 'acp') {
    const agentId = item.kind === 'catalog' ? item.acpAgentId : item.acpAgentId
    return suggestionHarnessKey('acp', agentId)
  }
  return item.provider
}

function sortItemsByOrder(items: ListItem[], order: string[]): ListItem[] {
  if (order.length === 0 || items.length <= 1) return items
  const index = new Map(order.map((key, i) => [key, i] as const))
  return [...items].sort((a, b) => {
    const ai = index.get(orderKeyForItem(a))
    const bi = index.get(orderKeyForItem(b))
    if (ai == null && bi == null) return 0
    if (ai == null) return 1
    if (bi == null) return -1
    return ai - bi
  })
}

/**
 * LobeHub brand Text wordmark for detail header (no icon).
 * All brands share the same `size` (SVG height). LobeHub Text icons use a
 * 24-tall viewBox; ClaudeCodeTextInline is normalized to the same canvas.
 */
function HarnessBrandTitle({
  provider,
  acpAgentId,
  label,
  size = 32,
}: {
  provider: ListItem['provider']
  acpAgentId?: string | null
  label: string
  size?: number
}) {
  const wrap = (node: ReactNode) => (
    <span className="inline-flex shrink-0 items-center text-foreground leading-none">
      {node}
    </span>
  )

  if (provider === 'claude') {
    return wrap(<ClaudeCodeTextInline size={size} />)
  }
  if (provider === 'codex') {
    return wrap(<Codex.Text size={size} />)
  }
  if (provider === 'opencode') {
    return wrap(<OpenCode.Text size={size} />)
  }
  if (provider === 'cursor') {
    return wrap(<Cursor.Text size={size} />)
  }
  if (provider === 'dsh') {
    return wrap(<DeepSeek.Text size={size} />)
  }
  if (provider === 'acp' && isGrokAcpAgent(acpAgentId)) {
    return wrap(<Grok.Text size={size} />)
  }
  return (
    <span
      className="truncate font-semibold leading-none text-foreground"
      style={{ fontSize: size * 0.75 }}
    >
      {label}
    </span>
  )
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
  const [harnessOrder, setHarnessOrder] = useState<string[]>([])
  const [savingOrder, setSavingOrder] = useState(false)

  const acpAgents = useChatStore((s) => s.harnessResources.acp?.agents ?? EMPTY_ACP)
  const initializeHarness = useChatStore((s) => s.initializeHarness)
  const settingsProvider = useAppStore((s) => s.settingsProvider)
  const setSettingsProvider = useAppStore((s) => s.setSettingsProvider)
  const harnessConfigSection = useAppStore((s) => s.harnessConfigSection)
  const setHarnessConfigSection = useAppStore((s) => s.setHarnessConfigSection)
  const harnessListFocusKey = useAppStore((s) => s.harnessListFocusKey)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  )

  useEffect(() => {
    void initializeHarness('acp')
  }, [initializeHarness])

  useEffect(() => {
    let mounted = true
    window.app.getAppSettings().then((s) => {
      if (!mounted) return
      setEnabledExperimentalAgents(s.enabledExperimentalAgents ?? [])
      setLegacyExperimentalAll(!!s.experimentalAgentsEnabled)
      setHarnessOrder(Array.isArray(s.harnessOrder) ? s.harnessOrder : [])
    })
    const unsub = window.app.onAppSettingsChange?.((s) => {
      if (!mounted) return
      setEnabledExperimentalAgents(s.enabledExperimentalAgents ?? [])
      setLegacyExperimentalAll(!!s.experimentalAgentsEnabled)
      setHarnessOrder(Array.isArray(s.harnessOrder) ? s.harnessOrder : [])
    })
    return () => {
      mounted = false
      unsub?.()
    }
  }, [])

  const refreshCatalog = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const list = (await window.app.listHarnesses()) as CatalogRow[]
      setCatalog(Array.isArray(list) ? list : [])
      // Keep the app-wide catalog in sync so open sessions flip to/from
      // read-only when the user enables or disables a harness here.
      await useAppStore.getState().refreshHarnessCatalog()
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
    else if (settingsProvider === 'cursor') setSelectedKey('cursor')
    else setSelectedKey('claude')
  }, [harnessConfigSection, settingsProvider])

  // Chat "Re-enable" (and similar) open this page with a specific row focused.
  useEffect(() => {
    if (!harnessListFocusKey) return
    setSelectedKey(harnessListFocusKey)
    useAppStore.setState({ harnessListFocusKey: null })
  }, [harnessListFocusKey])

  const catalogById = useMemo(() => {
    const m = new Map<string, CatalogRow>()
    for (const row of catalog ?? []) m.set(row.id, row)
    return m
  }, [catalog])

  const items = useMemo((): ListItem[] => {
    const agents = acpAgents.filter((a) => a.id !== 'opencode')
    const grok = agents.find((a) => isGrokAcpAgent(a.id))
    const rest = agents.filter((a) => !isGrokAcpAgent(a.id))
    const list: ListItem[] = NODE_HARNESS_IDS.map((catalogId) => {
      const meta: CatalogHarnessMeta = CATALOG_HARNESS_META[catalogId]
      return {
        key: catalogId,
        kind: 'catalog',
        catalogId,
        label:
          catalogId === 'acp-grok'
            ? (grok?.name || t(meta.labelKey))
            : t(meta.labelKey),
        provider: meta.provider,
        acpAgentId: catalogId === 'acp-grok' ? (grok?.id ?? 'grok-build') : null,
        experimental: meta.experimental,
        description: t(meta.descriptionKey),
        configProvider: meta.configProvider,
      }
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

  const enabledItems = useMemo(
    () => sortItemsByOrder(items.filter(isItemEnabled), harnessOrder),
    [items, isItemEnabled, harnessOrder],
  )
  const disabledItems = useMemo(
    () => items.filter((i) => !isItemEnabled(i)),
    [items, isItemEnabled],
  )
  const selected = items.find((i) => i.key === selectedKey) ?? items[0] ?? null
  const enabledOrderIds = useMemo(() => enabledItems.map((i) => i.key), [enabledItems])

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
      // Keep explicit order: newly enabled keys append; disabled keys stay so
      // re-enable restores rank. Only when the user has set a manual order.
      if (harnessOrder.length > 0) {
        const key = orderKeyForItem(item)
        if (enabled && !harnessOrder.includes(key)) {
          const nextOrder = [...harnessOrder, key]
          setHarnessOrder(nextOrder)
          const result = await window.app.saveAppSettings({ harnessOrder: nextOrder })
          setHarnessOrder(Array.isArray(result.harnessOrder) ? result.harnessOrder : nextOrder)
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // Catalog enable/disable already surfaces the message via install progress
      // + catalog diagnostic in the detail pane — only toast here to avoid triplicates.
      if (item.kind !== 'catalog') setError(msg)
      toast.error(msg)
      await refreshCatalog()
    } finally {
      setBusyKey(null)
    }
  }

  function selectItem(item: ListItem): void {
    setSelectedKey(item.key)
    if (item.configProvider) {
      setSettingsProvider(item.configProvider)
      const tabs = configTabsFor(item.configProvider) ?? []
      // Keep current tab when switching harnesses if it exists on both;
      // otherwise fall back to the first tab.
      const next =
        harnessConfigSection && tabs.includes(harnessConfigSection)
          ? harnessConfigSection
          : (tabs[0] ?? 'preferences')
      setHarnessConfigSection(next)
    } else {
      setHarnessConfigSection(null)
    }
  }

  async function persistEnabledOrder(nextEnabled: ListItem[]): Promise<void> {
    // Persist full order: reordered enabled keys first, then any prior keys
    // for currently-disabled harnesses so re-enable keeps their relative rank.
    const enabledKeys = nextEnabled.map(orderKeyForItem)
    const enabledSet = new Set(enabledKeys)
    const retained = harnessOrder.filter((k) => !enabledSet.has(k))
    const nextOrder = [...enabledKeys, ...retained]
    if (
      nextOrder.length === harnessOrder.length
      && nextOrder.every((k, i) => k === harnessOrder[i])
    ) {
      return
    }
    setHarnessOrder(nextOrder)
    setSavingOrder(true)
    try {
      const result = await window.app.saveAppSettings({ harnessOrder: nextOrder })
      setHarnessOrder(Array.isArray(result.harnessOrder) ? result.harnessOrder : nextOrder)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
      // Reload from disk on failure.
      const s = await window.app.getAppSettings().catch(() => null)
      if (s) setHarnessOrder(Array.isArray(s.harnessOrder) ? s.harnessOrder : [])
    } finally {
      setSavingOrder(false)
    }
  }

  function handleEnabledDragEnd(event: DragEndEvent): void {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = enabledItems.findIndex((i) => i.key === active.id)
    const newIndex = enabledItems.findIndex((i) => i.key === over.id)
    if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return
    const nextEnabled = arrayMove(enabledItems, oldIndex, newIndex)
    void persistEnabledOrder(nextEnabled)
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
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleEnabledDragEnd}
            >
              <SortableContext items={enabledOrderIds} strategy={verticalListSortingStrategy}>
                {enabledItems.map((item) => (
                  <SortableHarnessRow
                    key={item.key}
                    item={item}
                    selected={selectedKey === item.key}
                    disabled={savingOrder || busyKey !== null}
                    onSelect={() => selectItem(item)}
                  />
                ))}
              </SortableContext>
            </DndContext>
          </div>
        )}

        {disabledItems.length > 0 && (
          <div className="flex flex-col gap-1">
            <div className="px-1 pb-0.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {t('settings.harnesses.groupDisabled')}
            </div>
            {disabledItems.map((item) => (
              <HarnessListRow
                key={item.key}
                item={item}
                selected={selectedKey === item.key}
                onSelect={() => selectItem(item)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-1 py-1">
        {error && selected?.kind !== 'catalog' ? (
          <p className="mb-3 shrink-0 text-sm text-destructive break-words">{error}</p>
        ) : null}
        {selected ? (
          // Stable gutter: User↔Project height changes must not toggle the scrollbar and jank width.
          <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
            <HarnessDetail
              item={selected}
              catalog={selected.kind === 'catalog' ? catalogById.get(selected.catalogId) : undefined}
              enabled={isItemEnabled(selected)}
              busy={busyKey === selected.key}
              progress={
                selected.kind === 'catalog' ? progress[selected.catalogId] : undefined
              }
              configSection={harnessConfigSection}
              onEnabledChange={(v) => void setEnabled(selected, v)}
              onConfigSectionChange={(section) => {
                if (selected.configProvider) setSettingsProvider(selected.configProvider)
                setHarnessConfigSection(section)
              }}
              onRefresh={() => void refreshCatalog()}
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

function HarnessListRow({
  item,
  selected,
  onSelect,
  dragHandle,
  isDragging,
  style,
  setNodeRef,
  attributes,
  listeners,
}: {
  item: ListItem
  selected: boolean
  onSelect: () => void
  dragHandle?: boolean
  isDragging?: boolean
  style?: CSSProperties
  setNodeRef?: (node: HTMLElement | null) => void
  attributes?: ReturnType<typeof useSortable>['attributes']
  listeners?: ReturnType<typeof useSortable>['listeners']
}) {
  const { t } = useTranslation()
  const acpAgentId = item.kind === 'catalog' ? item.acpAgentId : item.acpAgentId
  const Icon = resolveSessionIcon(item.provider, acpAgentId)
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex w-full items-center gap-1 rounded-lg transition-colors',
        selected ? 'bg-primary/10' : 'hover:bg-muted/50',
        isDragging && 'z-10 opacity-80 shadow-sm',
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2.5 py-3 pl-3 text-left"
      >
        {Icon ? (
          <Icon status="default" size={30} renderLevel="compact" />
        ) : (
          <span className="shrink-0 rounded bg-muted" style={{ width: 30, height: 30 }} />
        )}
        <span className="truncate text-base font-medium">{item.label}</span>
        {item.experimental ? (
          <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[10px] font-normal">
            {t('settings.harnesses.experimentalBadge')}
          </Badge>
        ) : null}
      </button>
      {dragHandle ? (
        <button
          type="button"
          className="flex shrink-0 cursor-grab items-center px-1.5 py-3 text-muted-foreground active:cursor-grabbing"
          aria-label={t('settings.harnesses.dragHandle')}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-3.5" />
        </button>
      ) : (
        <span className="w-2 shrink-0" />
      )}
    </div>
  )
}

function SortableHarnessRow({
  item,
  selected,
  disabled,
  onSelect,
}: {
  item: ListItem
  selected: boolean
  disabled: boolean
  onSelect: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.key,
    disabled,
  })
  const style = {
    transform: CSS.Transform.toString(transform ? { ...transform, x: 0 } : null),
    transition,
  }
  return (
    <HarnessListRow
      item={item}
      selected={selected}
      onSelect={onSelect}
      dragHandle
      isDragging={isDragging}
      style={style}
      setNodeRef={setNodeRef}
      attributes={attributes}
      listeners={listeners}
    />
  )
}

function HarnessDetail({
  item,
  catalog,
  enabled,
  busy,
  progress,
  configSection,
  onEnabledChange,
  onConfigSectionChange,
  onRefresh,
}: {
  item: ListItem
  catalog?: CatalogRow
  enabled: boolean
  busy: boolean
  progress?: ProgressState
  configSection: HarnessConfigSection | null
  onEnabledChange: (enabled: boolean) => void
  onConfigSectionChange: (section: HarnessConfigSection) => void
  onRefresh?: () => void
}) {
  const { t } = useTranslation()
  const acpAgentId = item.kind === 'catalog' ? item.acpAgentId : item.acpAgentId
  const installing =
    catalog?.state === 'installing' || progress?.phase === 'download'
  const pct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.received / progress.total) * 100))
      : null

  const configTabs = configTabsFor(item.configProvider)
  const activeTab =
    configTabs && configSection && configTabs.includes(configSection)
      ? configSection
      : (configTabs?.[0] ?? 'preferences')

  // SDK harnesses (claude/codex/opencode): runtime path is internal. ACP harnesses
  // (Grok, experimental agents): show launch command for verify/debug.
  const showCommand = !!catalog?.command && item.provider === 'acp'

  // Single error surface — progress event and catalog diagnostic often carry the same text.
  const errorMessage =
    (progress?.phase === 'error' && progress.message) ||
    catalog?.diagnostic?.message ||
    null

  const hasMeta =
    item.kind === 'catalog' &&
    !!(catalog?.runtimeVersion || showCommand || (catalog?.requiresAuth && catalog.state === 'needs_auth'))

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <HarnessBrandTitle
              provider={item.provider}
              acpAgentId={acpAgentId}
              label={item.label}
              size={32}
            />
            {item.experimental ? (
              <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                {t('settings.harnesses.experimentalBadge')}
              </Badge>
            ) : null}
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">{item.description}</p>
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

      {hasMeta ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm">
          {catalog?.runtimeVersion ? (
            <DetailRow label={t('settings.harnesses.fields.version')} value={catalog.runtimeVersion} />
          ) : null}
          {showCommand && catalog?.command ? (
            <DetailRow label={t('settings.harnesses.fields.command')} value={catalog.command} mono />
          ) : null}
          {catalog?.requiresAuth && catalog.state === 'needs_auth' ? (
            <p className="text-xs text-muted-foreground">{t('settings.harnesses.needsAuth')}</p>
          ) : null}
        </div>
      ) : null}

      {errorMessage ? (
        <p className="text-xs text-destructive break-words">{errorMessage}</p>
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

      {configTabs ? (
        <Tabs
          value={activeTab}
          onValueChange={(v) => onConfigSectionChange(v as HarnessConfigSection)}
          className="flex min-h-0 flex-col gap-3"
        >
          <TabsList className="h-auto min-h-10 w-full flex-wrap justify-start gap-1 p-1">
            {configTabs.map((section) => {
              const meta = CONFIG_TAB_META[section]
              const TabIcon = meta.icon
              return (
                <TabsTrigger
                  key={section}
                  value={section}
                  className="gap-1.5 px-3 py-2 text-xs"
                >
                  <TabIcon className="size-3.5 shrink-0" />
                  {t(meta.labelKey)}
                </TabsTrigger>
              )
            })}
          </TabsList>
          {item.provider === 'cursor' ? (
            <CursorAuthSettings
              section={isCursorSettingsSection(activeTab) ? activeTab : 'account'}
              onAuthChanged={onRefresh}
            />
          ) : (
            configTabs.map((section) => (
              <TabsContent key={section} value={section} className="mt-0 min-h-0 outline-none">
                {section === 'preferences' && <PreferencesPage />}
                {section === 'agents' && <AgentsPage />}
                {section === 'skills' && <SkillsPage />}
                {section === 'mcp' && <McpPage />}
                {section === 'hooks' && <HooksPage />}
                {section === 'plugins' && <PluginsPage />}
              </TabsContent>
            ))
          )}
        </Tabs>
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
