import { CONFIG_TAB_META, configTabsFor } from './harness-config-tabs'
/**
 * Settings → Harnesses — Provider-style Enabled/Disabled list + detail.
 * Claude/Codex/Cursor detail uses tabs (preferences / skills / MCP / …) and reuses
 * the existing settings page components under the active tab.
 */

import {
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import { Antigravity, Codex, Cursor, DeepSeek, Grok, OpenCode } from '@lobehub/icons'
import { toast } from 'sonner'
import {
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@superone/ui/components/ui/tabs'
import { isAntigravityAcpAgent, isGrokAcpAgent } from '@superone/shared/acp-brand'
import type { AcpAgentDescriptor, SettingsProvider } from '@superone/shared/agent-types'
import type { ExternalCliHarnessId } from '@superone/shared/environment/external-cli-install'
import { suggestionHarnessKey } from '@superone/shared/suggestion-harness-order'
import { refreshAcpResourcesAfterToggle } from '@/harness-ui/acp/refresh-after-toggle'
import { useChatStore } from '@/stores/chat'
import { useAppStore, type HarnessConfigSection } from '@/stores/app'
import { ClaudeCodeTextInline } from '@/components/harness/ClaudeCodeTextInline'
import { AgentsPage } from './AgentsPage'
import { SkillsPage } from './SkillsPage'
import { McpPage } from './McpPage'
import { HooksPage } from './HooksPage'
import { PluginsPage } from './PluginsPage'
import { DshPluginsPage } from './DshPluginsPage'
import { PreferencesPage } from './PreferencesPage'
import { AntigravityAuthSettings } from './AntigravityAuthSettings'
import { CursorAuthSettings, type CursorSettingsSection } from './CursorAuthSettings'
import { GrokAuthSettings } from './GrokAuthSettings'
import { HarnessPreferencesPage } from './preferences/SessionDefaultsSection'
import type { CliInstallUiState } from './harnesses-settings/ExternalCliInstallBlock'
import {
  buildHarnessListItems,
  HarnessDetailHeaderAndStatus,
  HarnessesSidebar,
  type CatalogRow,
  type ListItem,
  type ProgressState,
} from './harnesses-settings/HarnessesSettingsParts'
import {
  sortHarnessItemsByOrder,
  useHarnessesCatalogState,
} from './harnesses-settings/use-harnesses-catalog'

const EMPTY_ACP: AcpAgentDescriptor[] = []

/**
 * Catalog list key for a nested-config `settingsProvider`.
 * Grok is `acp` in the store and `acp-grok` in the list; every other
 * first-party harness uses the same id in both places.
 */
export function listKeyForSettingsProvider(provider: SettingsProvider): string {
  if (provider === 'acp') return 'acp-grok'
  return provider
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

/** Suggestion-key used for harnessOrder / ChatSuggestions ranking. */
function orderKeyForItem(item: ListItem): string {
  if (item.provider === 'acp') {
    const agentId = item.kind === 'catalog' ? item.acpAgentId : item.acpAgentId
    return suggestionHarnessKey('acp', agentId)
  }
  return item.provider
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
  if (provider === 'acp' && isAntigravityAcpAgent(acpAgentId)) {
    return wrap(<Antigravity.Text size={size} />)
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
  const {
    catalog,
    catalogById,
    loading,
    busyKey,
    setBusyKey,
    error,
    setError,
    progress,
    cliInstalls,
    authRefreshSeq,
    harnessOrder,
    setHarnessOrder,
    savingOrder,
    refreshCatalog,
    isItemEnabled,
    setExperimentalAgentEnabled,
    installExternalCli,
    persistEnabledOrder,
  } = useHarnessesCatalogState(orderKeyForItem)

  const [selectedKey, setSelectedKey] = useState<string | null>(() => {
    const { harnessListFocusKey: focusKey, settingsProvider: provider } = useAppStore.getState()
    return focusKey ?? listKeyForSettingsProvider(provider)
  })

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

  // Deep links (MCP popup / sandbox → preferences) land with a config section;
  // keep the list selection aligned with settingsProvider. Grok (`acp`) and
  // OpenCode must not fall through to Claude — that snapped their detail pane
  // back to the Claude Code page on every click.
  useEffect(() => {
    if (!harnessConfigSection) return
    setSelectedKey((prev) => {
      if (settingsProvider === 'acp' && (prev === 'acp-grok' || prev === 'acp-antigravity')) {
        return prev
      }
      return listKeyForSettingsProvider(settingsProvider)
    })
  }, [harnessConfigSection, settingsProvider])

  // Chat "Re-enable" (and similar) open this page with a specific row focused.
  useEffect(() => {
    if (!harnessListFocusKey) return
    setSelectedKey(harnessListFocusKey)
    useAppStore.setState({ harnessListFocusKey: null })
  }, [harnessListFocusKey])

  const items = useMemo((): ListItem[] => {
    const agents = acpAgents.filter((a) => a.id !== 'opencode')
    return buildHarnessListItems(acpAgents, agents, t)
  }, [acpAgents, t])

  const enabledItems = useMemo(
    () => sortHarnessItemsByOrder(items.filter(isItemEnabled), harnessOrder, orderKeyForItem),
    [items, isItemEnabled, harnessOrder],
  )
  const disabledItems = useMemo(
    () => items.filter((i) => !isItemEnabled(i)),
    [items, isItemEnabled],
  )
  const selected = items.find((i) => i.key === selectedKey) ?? items[0] ?? null
  const enabledOrderIds = useMemo(() => enabledItems.map((i) => i.key), [enabledItems])

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
        const refreshedAcp = await refreshAcpResourcesAfterToggle(item.provider, item.acpAgentId, enabled)
        if (!refreshedAcp && enabled) {
          void useChatStore.getState().initializeHarness(item.provider, { force: true })
        }
      } else {
        await setExperimentalAgentEnabled(item.acpAgentId, enabled)
        toast.success(
          t(enabled ? 'settings.harnesses.enabled' : 'settings.harnesses.disabled', {
            id: item.label,
          }),
        )
        if (enabled && item.acpAgentId) {
          void window.app.refreshAcpModels?.(item.acpAgentId)
            .then((fresh) => {
              if (fresh) useChatStore.getState().setHarnessResources('acp', fresh)
            })
            .catch(() => {
              /* best-effort */
            })
        }
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
    <div className="flex h-full min-h-0">
      <HarnessesSidebar
        loading={loading}
        hasCatalog={catalog !== null}
        busyKey={busyKey}
        savingOrder={savingOrder}
        selectedKey={selectedKey}
        enabledItems={enabledItems}
        disabledItems={disabledItems}
        enabledOrderIds={enabledOrderIds}
        sensors={sensors}
        onRefresh={() => void refreshCatalog()}
        onSelectItem={selectItem}
        onDragEnd={handleEnabledDragEnd}
      />

      {selected ? (
        // Stable gutter: User↔Project height changes must not toggle the scrollbar and jank width.
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
          <div className="px-7 pt-5 pb-8">
            <div className="mx-auto max-w-3xl">
              {error && selected.kind !== 'catalog' ? (
                <p className="mb-4 text-sm break-words text-error">{error}</p>
              ) : null}
              <HarnessDetail
                key={selected.key}
                item={selected}
                catalog={selected.kind === 'catalog' ? catalogById.get(selected.catalogId) : undefined}
                enabled={isItemEnabled(selected)}
                busy={busyKey === selected.key}
                progress={
                  selected.kind === 'catalog' ? progress[selected.catalogId] : undefined
                }
                cliInstall={
                  selected.kind === 'catalog' ? cliInstalls[selected.catalogId] : undefined
                }
                authRefreshSeq={authRefreshSeq}
                configSection={harnessConfigSection}
                onEnabledChange={(v) => void setEnabled(selected, v)}
                onInstallCli={(harnessId) => installExternalCli(selected, harnessId)}
                onConfigSectionChange={(section) => {
                  if (selected.configProvider) setSettingsProvider(selected.configProvider)
                  setHarnessConfigSection(section)
                }}
                onRefresh={() => void refreshCatalog()}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="flex min-w-0 flex-1 items-center justify-center">
          <p className="text-sm text-muted-foreground">{t('settings.harnesses.selectHint')}</p>
        </div>
      )}
    </div>
  )
}

function HarnessDetail({
  item,
  catalog,
  enabled,
  busy,
  progress,
  cliInstall,
  authRefreshSeq,
  configSection,
  onEnabledChange,
  onInstallCli,
  onConfigSectionChange,
  onRefresh,
}: {
  item: ListItem
  catalog?: CatalogRow
  enabled: boolean
  busy: boolean
  progress?: ProgressState
  cliInstall?: CliInstallUiState
  authRefreshSeq: number
  configSection: HarnessConfigSection | null
  onEnabledChange: (enabled: boolean) => void
  onInstallCli: (harnessId: ExternalCliHarnessId) => Promise<void>
  onConfigSectionChange: (section: HarnessConfigSection) => void
  onRefresh?: () => void
}) {
  const { t } = useTranslation()
  const acpAgentId = item.kind === 'catalog' ? item.acpAgentId : item.acpAgentId
  const configTabs = configTabsFor(item.configProvider)
  const activeTab =
    configTabs && configSection && configTabs.includes(configSection)
      ? configSection
      : (configTabs?.[0] ?? 'preferences')

  // SDK harnesses (claude/codex/opencode): runtime path is internal. ACP harnesses
  // (Grok, experimental agents): show launch command for verify/debug.
  const showCommand = !!catalog?.command && item.provider === 'acp'

  return (
    <div className="flex flex-col gap-5">
      <HarnessDetailHeaderAndStatus
        item={item}
        catalog={catalog}
        enabled={enabled}
        busy={busy}
        progress={progress}
        cliInstall={cliInstall}
        showCommand={showCommand}
        brandTitle={(
          <HarnessBrandTitle
            provider={item.provider}
            acpAgentId={acpAgentId}
            label={item.label}
            size={22}
          />
        )}
        onEnabledChange={onEnabledChange}
        onInstallCli={onInstallCli}
      />

      {configTabs ? (
        <Tabs
          value={activeTab}
          onValueChange={(v) => onConfigSectionChange(v as HarnessConfigSection)}
          className="flex min-h-0 flex-col gap-5"
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
            // Cursor keeps its own settings component; its session defaults are
            // composed above it rather than duplicated inside it.
            <div className="space-y-5">
              {activeTab === 'preferences' && <HarnessPreferencesPage harnessId="cursor" />}
              <CursorAuthSettings
                section={isCursorSettingsSection(activeTab) ? activeTab : 'account'}
                onAuthChanged={onRefresh}
              />
            </div>
          ) : (
            configTabs.map((section) => (
              <TabsContent key={section} value={section} className="mt-0 min-h-0 outline-none">
                {section === 'preferences' && (
                  <PreferencesPage provider={item.configProvider} acpAgentId={acpAgentId} />
                )}
                {section === 'account' && item.configProvider === 'acp' && (
                  isAntigravityAcpAgent(acpAgentId)
                    ? <AntigravityAuthSettings key={authRefreshSeq} onAuthChanged={onRefresh} />
                    : <GrokAuthSettings key={authRefreshSeq} onAuthChanged={onRefresh} />
                )}
                {section === 'agents' && <AgentsPage />}
                {section === 'skills' && <SkillsPage />}
                {section === 'mcp' && <McpPage />}
                {section === 'hooks' && <HooksPage />}
                {/* dsh's plugin surface is its own: third-party cordis plugins, not
                    the Claude/Codex marketplace this page otherwise shows. */}
                {section === 'plugins'
                  && (item.provider === 'dsh' ? <DshPluginsPage /> : <PluginsPage />)}
              </TabsContent>
            ))
          )}
        </Tabs>
      ) : null}
    </div>
  )
}
