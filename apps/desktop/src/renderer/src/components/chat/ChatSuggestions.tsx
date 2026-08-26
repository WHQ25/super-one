import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { useAppStore, useHasRealProject } from '@/stores/app'
import { useActiveSession, useChatStore, useSessionScope, type ChatProvider } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'
import { ProviderLabel } from '@/components/ProviderLabel'
import { consumerForHarness, resolveEffective } from '@/lib/provider-resolve'
import {
  orderSuggestionHarnesses,
  resolveMenuTabOption,
  suggestionHarnessKey,
  type SuggestionHarnessOption,
} from '@/lib/suggestion-harness-order'
import { ProjectSelector } from '@/components/coding/ProjectSelector'
import { AddProjectDialog } from '@/components/sidebar/add-project/AddProjectDialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@superone/ui/components/ui/dropdown-menu'
import { Check, ChevronDown, Loader2, Plus } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger } from '@superone/ui/components/ui/tabs'
import { AcpSessionIcon } from '@superone/ui/components/harness/AcpSessionIcon'
import { ClaudeSessionIcon } from '@superone/ui/components/harness/ClaudeSessionIcon'
import { CodexSessionIcon } from '@superone/ui/components/harness/CodexSessionIcon'
import { DeepseekSessionIcon } from '@superone/ui/components/harness/DeepseekSessionIcon'
import { Grok, OpenCode, Cursor } from '@lobehub/icons'
import { cn } from '@superone/ui/lib/utils'
import { homePath } from '@/lib/path-utils'
import { withDraftCarry } from '@/lib/draft-surface-select'
import { displayHostPath, remoteProjectKey } from '@/lib/remote-project-key'
import { useHostProjects } from '@/hooks/use-host-projects'
import { useMosaicStore } from '@/components/mosaic/mosaic-store'
import { isExperimentalAgentProvider } from '@/stores/chat-store/helpers/provider-routing'
import type {
  AcpAgentDescriptor,
  HarnessSessionRank,
  RecentFolder,
  SuggestionHarnessPreference,
} from '@superone/shared/agent-types'
import { acpAgentDisplayName, isGrokAcpAgent } from '@superone/shared/acp-brand'
import {
  isCatalogHarnessEnabled,
  isExperimentalAcpAgentEnabled,
  type HarnessCatalogStatus,
} from '@/lib/harness-visibility'

const EMPTY_ACP_AGENTS: AcpAgentDescriptor[] = []
const EMPTY_RANKS: HarnessSessionRank[] = []
const DEFAULT_ACP_AGENT_ID = 'grok-build'
const HARNESS_RANK_DAYS = 7

/**
 * In-process cache for the dropdown-slot harness (separate from the active
 * suggestionHarness preference). Survives ProviderSelector remounts and cold
 * start until app-settings loads, so selecting the fixed slot does not reset
 * the menu tab label.
 */
let rememberedSuggestionMenuHarness: SuggestionHarnessPreference | null | undefined
/** Survives ProviderSelector remounts. connectCursor failure clears
 *  `initializedHarnesses`, and empty-session harness switches mint a new
 *  session id — without this latch that pair retries forever. */
let cursorHarnessBootstrapped = false
let deepseekHarnessBootstrapped = false

/** Shared trigger chrome — flex-none so short labels (e.g. Codex) don't stretch. */
const tabTriggerLayoutClass =
  'relative z-10 inline-flex flex-none items-center justify-center gap-1 whitespace-nowrap rounded px-3 py-1.5 text-xs font-medium max-w-[9.5rem] transition-colors'

function ProviderIcon({
  provider,
  acpAgentId,
  size = 72,
}: {
  provider: ChatProvider
  acpAgentId?: string | null
  size?: number
}) {
  if (provider === 'codex') return <CodexSessionIcon status="default" size={size} />
  if (provider === 'acp') {
    // Default / Grok Build → official Grok mark; other ACP agents keep the generic ACP glyph.
    if (!acpAgentId || isGrokAcpAgent(acpAgentId)) {
      return <Grok size={size} className="text-foreground" />
    }
    return <AcpSessionIcon status="default" size={size} />
  }
  if (provider === 'opencode') return <OpenCode size={size} />
  if (provider === 'cursor') return <Cursor size={size} />
  if (provider === 'dsh') return <DeepseekSessionIcon status="default" size={size} />
  return <ClaudeSessionIcon status="default" size={size} />
}

function optionLabel(option: SuggestionHarnessOption): string {
  if (option.provider === 'acp') {
    return option.label || acpAgentDisplayName(option.acpAgentId)
  }
  return option.label
}

export function ProviderSelector({
  disableAutoApply = false,
}: {
  /** Draft surface: show the tabs, never re-pin the empty-session default harness. */
  disableAutoApply?: boolean
} = {}) {
  const { t } = useTranslation()
  const preferredProvider = useActiveSession((s) => s.preferredProvider)
  const acpAgentId = useActiveSession((s) => s.acpAgentId)
  const messageCount = useActiveSession((s) => s.messages.length)
  const agents = useChatStore((s) => s.harnessResources.acp?.agents ?? EMPTY_ACP_AGENTS)
  const setPreferredProvider = useChatStore((s) => s.setPreferredProvider)
  const setAcpAgentId = useChatStore((s) => s.setAcpAgentId)
  const initializeHarness = useChatStore((s) => s.initializeHarness)
  const experimentalAgentsEnabled = useAppStore((s) => s.experimentalAgentsEnabled)
  const enabledExperimentalAgents = useAppStore((s) => s.enabledExperimentalAgents)
  const [harnessCatalog, setHarnessCatalog] = useState<HarnessCatalogStatus[] | null>(null)
  const sessionScope = useSessionScope()
  const [agentMenuOpen, setAgentMenuOpen] = useState(false)
  const [ranks, setRanks] = useState<HarnessSessionRank[]>(EMPTY_RANKS)
  const [suggestionHarness, setSuggestionHarness] = useState<SuggestionHarnessPreference | null | undefined>(
    undefined,
  )
  const [secondaryHarness, setSecondaryHarness] = useState<SuggestionHarnessPreference | null>(null)
  const [harnessOrder, setHarnessOrder] = useState<string[]>([])
  // Dropdown-slot memory: separate from active preference so selecting the fixed
  // (top-ranked) slot does not reset the menu tab label / re-activation target.
  // Survives ProviderSelector remounts that happen when empty-session harness
  // switches mint a new session id.
  const [suggestionMenuHarness, setSuggestionMenuHarness] = useState<
    SuggestionHarnessPreference | null | undefined
  >(() => rememberedSuggestionMenuHarness)

  useEffect(() => {
    void initializeHarness('acp')
  }, [initializeHarness])

  useEffect(() => {
    if (!isCatalogHarnessEnabled(harnessCatalog, 'cursor')) return
    if (cursorHarnessBootstrapped) return
    cursorHarnessBootstrapped = true
    void initializeHarness('cursor')
  }, [harnessCatalog, initializeHarness])

  useEffect(() => {
    if (!isCatalogHarnessEnabled(harnessCatalog, 'dsh')) return
    if (deepseekHarnessBootstrapped) return
    deepseekHarnessBootstrapped = true
    void initializeHarness('dsh')
  }, [harnessCatalog, initializeHarness])

  useEffect(() => {
    let cancelled = false
    window.app
      .listHarnesses?.()
      .then((list) => {
        if (cancelled) return
        setHarnessCatalog(
          Array.isArray(list)
            ? list.map((r) => ({ id: r.id, enabled: r.enabled, state: r.state }))
            : null,
        )
      })
      .catch(() => {
        if (!cancelled) setHarnessCatalog(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    const applySettings = (settings: {
      harnessOrder?: string[]
      suggestionHarness?: SuggestionHarnessPreference | null
      secondaryHarness?: SuggestionHarnessPreference | null
      suggestionMenuHarness?: SuggestionHarnessPreference | null
    } | null) => {
      if (cancelled) return
      setHarnessOrder(Array.isArray(settings?.harnessOrder) ? settings.harnessOrder : [])
      setSuggestionHarness(settings?.suggestionHarness ?? null)
      const nextSecondary = settings?.secondaryHarness ?? null
      setSecondaryHarness(nextSecondary)
      // Explicit secondary (or ordered #2) owns the menu slot — keep in-process
      // memory aligned so remounts don't resurrect a stale suggestionMenuHarness.
      if (nextSecondary != null) {
        rememberedSuggestionMenuHarness = nextSecondary
        setSuggestionMenuHarness(nextSecondary)
        return
      }
      // Prefer the in-process cache after a remount; fall back to disk on cold start.
      if (rememberedSuggestionMenuHarness !== undefined) {
        setSuggestionMenuHarness(rememberedSuggestionMenuHarness)
      } else {
        const fromDisk = settings?.suggestionMenuHarness ?? null
        rememberedSuggestionMenuHarness = fromDisk
        setSuggestionMenuHarness(fromDisk)
      }
    }

    void Promise.all([
      window.app.queryHarnessSessionRanks(HARNESS_RANK_DAYS).catch(() => EMPTY_RANKS),
      window.app.getAppSettings().catch(() => null),
    ]).then(([nextRanks, settings]) => {
      if (cancelled) return
      setRanks(Array.isArray(nextRanks) ? nextRanks : EMPTY_RANKS)
      applySettings(settings)
    })

    const unsub = window.app.onAppSettingsChange?.((settings) => {
      applySettings(settings)
    })

    return () => {
      cancelled = true
      unsub?.()
    }
  }, [])

  const selectProvider = useCallback(async (provider: ChatProvider) => {
    if (sessionScope) {
      await useChatStore.getState().switchToSession(sessionScope.projectPath, sessionScope.sessionId)
    }
    setPreferredProvider(provider)
    if (!sessionScope) return
    const nextSessionId = useChatStore.getState().projectSessions[sessionScope.projectPath]?._activeSessionId
    if (nextSessionId && nextSessionId !== sessionScope.sessionId) {
      useMosaicStore.getState().replaceTileSession(sessionScope.projectPath, sessionScope.sessionId, nextSessionId)
    }
  }, [sessionScope, setPreferredProvider])

  const prefsEqual = useCallback((
    a: SuggestionHarnessPreference | null | undefined,
    b: SuggestionHarnessPreference | null | undefined,
  ): boolean => {
    if (a == null || b == null) return a == null && b == null
    if (a.provider !== b.provider) return false
    if (a.provider !== 'acp') return true
    return (a.acpAgentId ?? null) === (b.acpAgentId ?? null)
  }, [])

  const persistDefaultHarness = useCallback((pref: SuggestionHarnessPreference) => {
    setSuggestionHarness(pref)
    // Default and secondary must stay distinct — clear secondary on collision.
    const clearsSecondary = prefsEqual(pref, secondaryHarness)
    if (clearsSecondary) {
      setSecondaryHarness(null)
      rememberedSuggestionMenuHarness = null
      setSuggestionMenuHarness(null)
    }
    void window.app.saveAppSettings({
      suggestionHarness: pref,
      ...(clearsSecondary ? { secondaryHarness: null, suggestionMenuHarness: null } : {}),
    }).catch(() => {
      /* best-effort; ranking UI still works without persistence */
    })
  }, [prefsEqual, secondaryHarness])

  const persistSecondaryHarness = useCallback((pref: SuggestionHarnessPreference) => {
    // Refuse to pin secondary to the same harness as default.
    if (prefsEqual(pref, suggestionHarness === undefined ? null : suggestionHarness)) return
    setSecondaryHarness(pref)
    rememberedSuggestionMenuHarness = pref
    setSuggestionMenuHarness(pref)
    // Pin secondary + keep menu-slot memory in sync so the tab label matches order.
    void window.app.saveAppSettings({
      secondaryHarness: pref,
      suggestionMenuHarness: pref,
    }).catch(() => {
      /* best-effort; ranking UI still works without persistence */
    })
  }, [prefsEqual, suggestionHarness])

  const selectHarnessOption = useCallback(async (
    option: SuggestionHarnessOption,
    manual: boolean,
    source: 'fixed' | 'menu' = 'fixed',
  ) => {
    if (manual) {
      const pref: SuggestionHarnessPreference = {
        provider: option.provider,
        acpAgentId: option.provider === 'acp' ? option.acpAgentId : null,
      }
      // Fixed tab pins default (#1); menu pins secondary (#2). Never promote a
      // menu pick to default — that was reordering tabs away from settings.
      // Activation always proceeds even when pin is a no-op (duplicate / already set).
      if (source === 'menu') persistSecondaryHarness(pref)
      else persistDefaultHarness(pref)
    }
    setAgentMenuOpen(false)
    if (option.provider === 'acp') {
      if (sessionScope) {
        await useChatStore.getState().switchToSession(sessionScope.projectPath, sessionScope.sessionId)
      }
      if (option.acpAgentId) setAcpAgentId(option.acpAgentId)
      if (preferredProvider !== 'acp') await selectProvider('acp')
      return
    }
    await selectProvider(option.provider)
  }, [
    persistDefaultHarness,
    persistSecondaryHarness,
    preferredProvider,
    selectProvider,
    sessionScope,
    setAcpAgentId,
  ])

  const visibleAcpAgents = useMemo(
    () =>
      agents.filter((agent) => {
        if (agent.id === 'opencode') return false
        if (isGrokAcpAgent(agent.id)) {
          return isCatalogHarnessEnabled(harnessCatalog, 'acp-grok')
        }
        return isExperimentalAcpAgentEnabled(agent.id, {
          enabledExperimentalAgents,
          legacyExperimentalAgentsEnabled: experimentalAgentsEnabled,
        })
      }),
    [agents, enabledExperimentalAgents, experimentalAgentsEnabled, harnessCatalog],
  )

  const isAgentAllowed = useCallback(
    (provider: string, agentId?: string | null) => {
      if (provider === 'claude') return isCatalogHarnessEnabled(harnessCatalog, 'claude')
      if (provider === 'codex') return isCatalogHarnessEnabled(harnessCatalog, 'codex')
      if (provider === 'opencode') {
        return (
          isCatalogHarnessEnabled(harnessCatalog, 'opencode') || experimentalAgentsEnabled
        )
      }
      if (provider === 'cursor') {
        return isCatalogHarnessEnabled(harnessCatalog, 'cursor')
      }
      if (provider === 'dsh') {
        return isCatalogHarnessEnabled(harnessCatalog, 'dsh')
      }
      if (provider === 'acp' && agentId) {
        if (isGrokAcpAgent(agentId)) {
          return isCatalogHarnessEnabled(harnessCatalog, 'acp-grok')
        }
        return isExperimentalAcpAgentEnabled(agentId, {
          enabledExperimentalAgents,
          legacyExperimentalAgentsEnabled: experimentalAgentsEnabled,
        })
      }
      // Non-experimental providers not listed above stay allowed.
      if (!isExperimentalAgentProvider(provider as 'opencode' | 'acp', agentId)) return true
      return false
    },
    [enabledExperimentalAgents, experimentalAgentsEnabled, harnessCatalog],
  )

  useEffect(() => {
    if (isAgentAllowed(preferredProvider, acpAgentId)) return
    setAgentMenuOpen(false)
    // Prefer first enabled SDK harness, then any remaining ordered option.
    if (isCatalogHarnessEnabled(harnessCatalog, 'claude')) {
      void selectProvider('claude')
      return
    }
    if (isCatalogHarnessEnabled(harnessCatalog, 'codex')) {
      void selectProvider('codex')
      return
    }
    if (preferredProvider === 'acp') {
      const next = visibleAcpAgents[0]
      if (next) {
        setAcpAgentId(next.id)
        return
      }
    }
  }, [
    isAgentAllowed,
    preferredProvider,
    acpAgentId,
    selectProvider,
    setAcpAgentId,
    harnessCatalog,
    visibleAcpAgents,
  ])

  const selectedAcpAgent = useMemo(() => {
    if (agents.length === 0) return null
    return agents.find((a) => a.id === acpAgentId)
      ?? agents.find((a) => isGrokAcpAgent(a.id))
      ?? agents[0]
      ?? null
  }, [agents, acpAgentId])

  useEffect(() => {
    if (preferredProvider === 'acp' && !acpAgentId && selectedAcpAgent?.id) {
      setAcpAgentId(selectedAcpAgent.id)
    }
  }, [preferredProvider, acpAgentId, selectedAcpAgent?.id, setAcpAgentId])

  const orderedHarnesses = useMemo(
    () => orderSuggestionHarnesses({
      ranks,
      acpAgents: visibleAcpAgents.map((a) => ({ id: a.id, name: a.name })),
      includeClaude: isCatalogHarnessEnabled(harnessCatalog, 'claude'),
      includeCodex: isCatalogHarnessEnabled(harnessCatalog, 'codex'),
      includeOpenCode:
        isCatalogHarnessEnabled(harnessCatalog, 'opencode') || experimentalAgentsEnabled,
      includeCursor: isCatalogHarnessEnabled(harnessCatalog, 'cursor'),
      includeDeepseek: isCatalogHarnessEnabled(harnessCatalog, 'dsh'),
      harnessOrder,
      defaultHarness: suggestionHarness === undefined ? null : suggestionHarness,
      secondaryHarness,
    }),
    [
      ranks,
      visibleAcpAgents,
      harnessCatalog,
      experimentalAgentsEnabled,
      harnessOrder,
      suggestionHarness,
      secondaryHarness,
    ],
  )

  const fixedHarness = orderedHarnesses[0] ?? null
  const menuHarnesses = useMemo(() => orderedHarnesses.slice(1), [orderedHarnesses])
  const hasEnabledHarness = orderedHarnesses.length > 0

  const effectiveAcpAgentId = selectedAcpAgent?.id ?? acpAgentId ?? DEFAULT_ACP_AGENT_ID
  const activeKey = preferredProvider === 'acp'
    ? suggestionHarnessKey('acp', effectiveAcpAgentId)
    : preferredProvider
  const fixedActive = fixedHarness != null && activeKey === fixedHarness.key
  const menuTabOption = useMemo(
    () => resolveMenuTabOption({
      menuHarnesses,
      activeKey,
      rememberedMenu: suggestionMenuHarness,
      // Explicit secondary / ordered list owns the menu tab; don't let stale
      // suggestionMenuHarness override ordered #2.
      secondaryPinned: secondaryHarness != null || harnessOrder.length >= 2,
    }),
    [menuHarnesses, activeKey, suggestionMenuHarness, secondaryHarness, harnessOrder.length],
  )
  const menuTabLabel = menuTabOption ? optionLabel(menuTabOption) : 'Codex'
  const menuTabActive = hasEnabledHarness && !fixedActive

  // Empty-session: apply default (or auto Top1) only when that *target* changes
  // (settings / ranks). Do NOT re-force when the user switches to the secondary
  // tab — that was snapping harness selection back to default immediately.
  const lastAutoAppliedKeyRef = useRef<string | null>(null)
  useEffect(() => {
    if (disableAutoApply) return
    if (!fixedHarness) return
    if (suggestionHarness === undefined) return
    if (messageCount > 0) return

    const target = suggestionHarness == null
      ? fixedHarness
      : orderedHarnesses.find((o) => (
        o.provider === suggestionHarness.provider
        && (o.provider !== 'acp' || o.acpAgentId === (suggestionHarness.acpAgentId ?? null))
      )) ?? fixedHarness

    if (lastAutoAppliedKeyRef.current === target.key) return
    lastAutoAppliedKeyRef.current = target.key
    if (activeKey === target.key) return
    // Auto path is neither a fixed-tab click nor a menu pick — don't rewrite
    // dropdown-slot memory / settings pins.
    void selectHarnessOption(target, false, 'fixed')
  }, [
    disableAutoApply,
    suggestionHarness,
    fixedHarness,
    orderedHarnesses,
    messageCount,
    activeKey,
    selectHarnessOption,
  ])

  const iconKey = hasEnabledHarness
    ? (preferredProvider === 'acp' ? `acp:${effectiveAcpAgentId}` : preferredProvider)
    : 'none'
  const tabsValue = fixedActive ? 'fixed' : 'menu'
  const selectedAcpForHint = preferredProvider === 'acp'
    ? (visibleAcpAgents.find((a) => a.id === effectiveAcpAgentId) ?? selectedAcpAgent)
    : null

  const onMenuTabActivate = (e: MouseEvent) => {
    if (menuTabActive) return
    e.preventDefault()
    e.stopPropagation()
    if (menuTabOption) void selectHarnessOption(menuTabOption, true, 'menu')
  }

  const onSelectMenuItem = (option: SuggestionHarnessOption) => {
    void selectHarnessOption(option, true, 'menu')
  }

  const openHarnessSettings = () => {
    useAppStore.getState().setSettingsTab('harnesses')
    useAppStore.getState().navigateTo('settings')
  }

  return (
    <div className="flex flex-col items-center gap-3">
      {hasEnabledHarness ? (
        <>
          <AnimatePresence mode="wait">
            <motion.div
              key={iconKey}
              initial={{ opacity: 0, y: 12, scale: 0.85 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -12, scale: 0.85 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            >
              <ProviderIcon
                provider={preferredProvider}
                acpAgentId={preferredProvider === 'acp' ? effectiveAcpAgentId : null}
              />
            </motion.div>
          </AnimatePresence>
          {preferredProvider !== 'acp' &&
            preferredProvider !== 'opencode' &&
            preferredProvider !== 'cursor' &&
            preferredProvider !== 'dsh' && <ActiveProviderHint />}
          {fixedHarness && orderedHarnesses.length > 1 ? (
            <Tabs
              value={tabsValue}
              onValueChange={(v) => {
                if (v === 'fixed' && fixedHarness) {
                  void selectHarnessOption(fixedHarness, true, 'fixed')
                  return
                }
                // Exactly two harnesses: second slot is a plain tab, not a menu.
                if (v === 'menu' && menuTabOption && menuHarnesses.length === 1) {
                  void selectHarnessOption(menuTabOption, true, 'menu')
                }
              }}
            >
              <TabsList>
                <TabsTrigger
                  value="fixed"
                  className={cn(tabTriggerLayoutClass, 'text-muted-foreground hover:text-foreground data-[state=active]:text-foreground')}
                >
                  <span className="truncate">{optionLabel(fixedHarness)}</span>
                </TabsTrigger>
                {menuHarnesses.length === 1 && menuTabOption ? (
                  <TabsTrigger
                    value="menu"
                    className={cn(tabTriggerLayoutClass, 'text-muted-foreground hover:text-foreground data-[state=active]:text-foreground')}
                  >
                    <span className="truncate">{optionLabel(menuTabOption)}</span>
                  </TabsTrigger>
                ) : menuHarnesses.length > 1 ? (
                  /*
                   * Outer shell owns tabs indicator measurement (`data-state=active`).
                   * DropdownMenuTrigger must keep its own data-state open/closed — if
                   * both live on the same node, Slot merge fights TabsList's
                   * `[data-state=active]` query and the sliding pill gets a stale or
                   * wrong box (oversized / clipped after Grok ↔ Codex switches).
                   */
                  <div
                    data-slot="tabs-trigger"
                    data-state={menuTabActive ? 'active' : 'inactive'}
                    className={cn(
                      tabTriggerLayoutClass,
                      'p-0',
                      menuTabActive ? 'text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    <DropdownMenu
                      open={agentMenuOpen}
                      onOpenChange={(open) => {
                        if (open && !menuTabActive) return
                        setAgentMenuOpen(open)
                      }}
                    >
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          role="tab"
                          aria-selected={menuTabActive}
                          className={cn(
                            'inline-flex min-w-0 max-w-[9.5rem] items-center justify-center gap-1 whitespace-nowrap rounded px-3 py-1.5 text-xs font-medium transition-colors',
                            'hover:text-foreground',
                            menuTabActive ? 'text-foreground' : 'text-muted-foreground',
                          )}
                          onPointerDown={onMenuTabActivate}
                          onClick={onMenuTabActivate}
                        >
                          <span className="min-w-0 truncate">{menuTabLabel}</span>
                          <ChevronDown className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform duration-200', agentMenuOpen && menuTabActive && 'rotate-180')} />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="center" className="min-w-48">
                        {menuHarnesses.map((option, index) => {
                          const prev = index > 0 ? menuHarnesses[index - 1] : null
                          const showSeparator = !!prev && (prev.provider === 'acp') !== (option.provider === 'acp')
                          const selected = activeKey === option.key
                          const agentMeta = option.provider === 'acp'
                            ? visibleAcpAgents.find((a) => a.id === option.acpAgentId)
                            : null
                          return (
                            <div key={option.key}>
                              {showSeparator && <DropdownMenuSeparator />}
                              <DropdownMenuItem
                                onClick={() => onSelectMenuItem(option)}
                                className="gap-2 focus-visible:shadow-none"
                              >
                                <span className="min-w-0 flex-1 truncate">{optionLabel(option)}</span>
                                {agentMeta && !agentMeta.installed && (
                                  <span className="shrink-0 text-xs text-muted-foreground">
                                    {t('chat.suggestions.agentNotInstalled')}
                                  </span>
                                )}
                                {selected && <Check className="size-4 shrink-0 text-primary" />}
                              </DropdownMenuItem>
                            </div>
                          )
                        })}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ) : null}
              </TabsList>
            </Tabs>
          ) : null}
          {preferredProvider === 'acp' && selectedAcpForHint && !selectedAcpForHint.installed && (
            <p className="max-w-xs text-center text-xs text-muted-foreground">
              {t('chat.suggestions.agentInstallHint')}
            </p>
          )}
        </>
      ) : (
        <div className="flex flex-col items-center gap-2 px-4">
          <p className="text-sm text-muted-foreground">{t('chat.suggestions.noHarnessEnabled')}</p>
          <button
            type="button"
            onClick={openHarnessSettings}
            className="text-xs font-medium text-primary hover:underline"
          >
            {t('chat.suggestions.enableHarnesses')}
          </button>
        </div>
      )}
    </div>
  )
}

function ActiveProviderHint() {
  const { t } = useTranslation()
  const preferredProvider = useActiveSession((s) => s.preferredProvider)
  const sessionApiProviderId = useActiveSession((s) => s.apiProviderId)
  const platforms = useSettingsStore((s) => s.platforms)
  const credentials = useSettingsStore((s) => s.credentials)
  const bindings = useSettingsStore((s) => s.bindings)
  const providerScope = useSettingsStore((s) => s.providerScope)
  const fetchProviderData = useSettingsStore((s) => s.fetchProviderData)
  const selectedHostConnectionId = useAppStore((s) => s.selectedHostConnectionId)
  const experimentalClaudeOpenAiChatEnabled = useAppStore((s) => s.experimentalClaudeOpenAiChatEnabled)

  useEffect(() => {
    const next =
      selectedHostConnectionId && selectedHostConnectionId !== 'local'
        ? selectedHostConnectionId
        : 'local'
    if (next !== providerScope) {
      useSettingsStore.getState().setProviderScope(next)
    }
  }, [selectedHostConnectionId, providerScope])

  useEffect(() => {
    void fetchProviderData()
  }, [fetchProviderData, providerScope])

  if (
    preferredProvider === 'acp' ||
    preferredProvider === 'opencode' ||
    preferredProvider === 'cursor' ||
    preferredProvider === 'dsh'
  ) return null

  const effective = resolveEffective(
    platforms,
    credentials,
    bindings,
    consumerForHarness(preferredProvider),
    sessionApiProviderId,
    { experimentalClaudeOpenAiChatEnabled },
  )
  const defaultBrand = preferredProvider === 'codex' ? 'openai' : 'claude'
  const defaultLabel = preferredProvider === 'codex'
    ? t('resources.providers.defaultLabelCodex')
    : t('resources.providers.defaultLabelClaude')

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground">{t('chat.suggestions.poweredBy')}</span>
      <ProviderLabel
        brandKey={effective?.brand ?? defaultBrand}
        fallback={effective?.platform.name ?? defaultLabel}
        icon={effective?.platform.icon}
        size={12}
        compactFallback
      />
    </span>
  )
}

export function ChatSuggestions() {
  const { t } = useTranslation()
  const selectProject = useAppStore((s) => s.selectProject)
  const fetchRecentFolders = useAppStore((s) => s.fetchRecentFolders)
  const isSwitchingHostProject = useAppStore((s) => s.isSwitchingHostProject)
  const hasRealProject = useHasRealProject()
  const { connectionId, isLocal, projects, loading, error, refresh } = useHostProjects()

  const [menuOpen, setMenuOpen] = useState(false)
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [hostLabel, setHostLabel] = useState('')
  /** Prevents re-entrant auto-open while selectProject is in flight for this host. */
  const autoOpenAttemptRef = useRef<string | null>(null)

  const resetSession = useChatStore((s) => s.resetSession)

  // Label for the add-project dialog (remote host name when available).
  useEffect(() => {
    if (isLocal) {
      setHostLabel(window.app.platform === 'darwin' ? t('sidebar.thisMac') : t('sidebar.thisPc'))
      return
    }
    let cancelled = false
    void window.environment.listItems().then((items) => {
      if (cancelled) return
      const host = items.find((h) => h.connectionId === connectionId)
      setHostLabel(host?.label ?? connectionId)
    }).catch(() => {
      if (!cancelled) setHostLabel(connectionId)
    })
    return () => {
      cancelled = true
    }
  }, [connectionId, isLocal, t])

  // Safety net for host default project: openDefaultProjectForHost already runs on
  // host switch, but ChatSuggestions can still land empty if that raced connect /
  // listProjects. Once the host project list is ready and nothing is open, pick
  // the first non-missing project so the selector shows a real default.
  useEffect(() => {
    if (hasRealProject) {
      autoOpenAttemptRef.current = null
      return
    }
    if (isSwitchingHostProject || loading || error) return
    const first = projects.find((folder) => !folder.missing)
    if (!first) return
    const attemptKey = `${connectionId}::${first.path}`
    if (autoOpenAttemptRef.current === attemptKey) return
    autoOpenAttemptRef.current = attemptKey
    void selectProject(first.path, {
      connectionId,
      projectId: first.id || undefined,
    })
  }, [
    hasRealProject,
    isSwitchingHostProject,
    loading,
    error,
    projects,
    connectionId,
    selectProject,
  ])

  const openExisting = useCallback(
    (folder: RecentFolder) => {
      void selectProject(folder.path, {
        connectionId,
        projectId: folder.id || undefined,
      })
    },
    [connectionId, selectProject],
  )

  const startAddProject = useCallback(() => {
    if (isLocal) {
      void selectProject()
      return
    }
    setAddDialogOpen(true)
  }, [isLocal, selectProject])

  const addDialog = (
    <AddProjectDialog
      open={addDialogOpen}
      onOpenChange={setAddDialogOpen}
      connectionId={connectionId}
      hostLabel={hostLabel}
      onOpened={(project) => {
        if (isLocal) {
          void fetchRecentFolders()
          void selectProject(project.path, withDraftCarry())
        } else {
          refresh()
          void selectProject(
            remoteProjectKey(connectionId, project.path),
            withDraftCarry({ connectionId, projectId: project.projectId }),
          )
        }
      }}
    />
  )

  if (!hasRealProject) {
    const hasProjects = projects.length > 0
    const isProjectLoading = isSwitchingHostProject || loading
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-4" style={{ animation: 'fade-in 400ms ease-out' }}>
        <ProviderSelector />
        {isProjectLoading ? (
          <div role="status" className="flex h-10 items-center gap-2 text-sm text-muted-foreground">
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            <span>{t('common.loading')}</span>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t('chat.suggestions.openProject')}</p>
        )}
        {!isProjectLoading && (error ? (
          <div className="flex flex-col items-center gap-2">
            <p className="max-w-xs text-center text-sm text-destructive">{error}</p>
            <button
              type="button"
              onClick={() => refresh({ force: true })}
              className="rounded-lg px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
            >
              {t('common.retry')}
            </button>
          </div>
        ) : hasProjects ? (
          <DropdownMenu onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent">
                {t('chat.suggestions.addProject')}
                <ChevronDown className={cn('size-4 text-muted-foreground transition-transform duration-200', menuOpen && 'rotate-180')} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center" className="max-h-80 w-64 overflow-y-auto">
              {projects.map((folder) => (
                <DropdownMenuItem key={folder.path} onClick={() => openExisting(folder)} className="gap-2">
                  <span className="truncate">{folder.name}</span>
                  <span className="ml-auto truncate text-xs text-muted-foreground">
                    {homePath(displayHostPath(folder.path))}
                  </span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={startAddProject} className="gap-2">
                <Plus className="size-4 shrink-0" />
                <span>{t('chat.suggestions.addProject')}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <button
            onClick={startAddProject}
            className="rounded-lg px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            {t('chat.suggestions.addProject')}
          </button>
        ))}
        {addDialog}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-4" style={{ animation: 'fade-in 400ms ease-out' }}>
      <ProviderSelector />
      <ProjectSelector
        align="center"
        carryOpenDraft
        onOpened={() => {
          const store = useChatStore.getState()
          const path = store.activeProject
          const sid = path ? store.projectSessions[path]?._activeSessionId : null
          const sess = path && sid ? store.projectSessions[path]?._sessions[sid] : null
          // Already composing / restored draft: keep that session. A fresh
          // empty landing still mints a new session on the chosen project.
          if (sess?.draftText.trim() || sess?.draftId) return
          void resetSession()
        }}
        onAddProject={isLocal ? undefined : () => setAddDialogOpen(true)}
      />
      {addDialog}
    </div>
  )
}
