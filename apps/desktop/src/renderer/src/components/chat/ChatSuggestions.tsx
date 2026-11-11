import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/stores/app'
import { useActiveSession, useChatStore, useSessionScope, type ChatProvider } from '@/stores/chat'
import { useProjectHarnessCatalog } from '@/hooks/use-project-harness-catalog'
import { HARNESS_CONTROLS } from '@/harness-ui/controls'
import { apiKeyDefault } from '@/harness-ui/api-key-defaults'
import {
  orderSuggestionHarnesses,
  resolveAutoApplyHarness,
  resolveMenuTabOption,
  suggestionHarnessKey,
  type SuggestionHarnessOption,
} from '@superone/shared/suggestion-harness-order'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@superone/ui/components/ui/dropdown-menu'
import { Check, ChevronDown } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger } from '@superone/ui/components/ui/tabs'
import { cn } from '@superone/ui/lib/utils'
import { useMosaicStore } from '@/components/mosaic/mosaic-store'
import { useSessionPaneForeground } from '@/stores/chat-store/session-scope'
import { isSelectedSessionScope } from '@/stores/chat-store/selectors'
import type { AcpAgentDescriptor, SuggestionHarnessPreference } from '@superone/shared/agent-types'
import { acpAgentDisplayName, isGrokAcpAgent, isOpenCodeAcpAgent } from '@superone/shared/acp-brand'
import {
  catalogIdForSessionProvider,
  isCatalogHarnessEnabled,
  isPickerHarnessEnabled,
} from '@/lib/harness-visibility'
import { ActiveProviderHint } from './chat-suggestions/active-provider-hint'
import { ChatSuggestionsLanding } from './chat-suggestions/chat-suggestions-landing'
import {
  NoHarnessEnabledState,
  resetBootstrapHarnessMemoryForTests,
  useBootstrapHarnesses,
} from './chat-suggestions/use-bootstrap-harnesses'
import {
  resetSuggestionPreferencesMemoryForTests,
  useSuggestionPreferences,
} from './chat-suggestions/use-suggestion-preferences'

const EMPTY_ACP_AGENTS: AcpAgentDescriptor[] = []
const DEFAULT_ACP_AGENT_ID = 'grok-build'

export function resetProviderSelectorMemoryForTests(): void {
  resetBootstrapHarnessMemoryForTests()
  resetSuggestionPreferencesMemoryForTests()
}

/** Shared trigger chrome — flex-none so short labels (e.g. Codex) don't stretch. */
const tabTriggerLayoutClass =
  'relative z-10 inline-flex flex-none items-center justify-center gap-1 whitespace-nowrap rounded px-3 py-1.5 text-xs font-medium max-w-[9.5rem] transition-colors'

function optionLabel(option: SuggestionHarnessOption): string {
  if (option.provider === 'acp') {
    return option.label || acpAgentDisplayName(option.acpAgentId)
  }
  return option.label
}

export function ProviderSelector({
  disableAutoApply = false,
  hostConnectionId,
}: {
  /** Draft surface: show the tabs, never re-pin the empty-session default harness. */
  disableAutoApply?: boolean
  /** Empty landing follows the selected host even before its project opens. */
  hostConnectionId?: string
} = {}) {
  const { t } = useTranslation()
  const preferredProvider = useActiveSession((s) => s.preferredProvider)
  const acpAgentId = useActiveSession((s) => s.acpAgentId)
  const messageCount = useActiveSession((s) => s.messages.length)
  const harnessUserChosen = useActiveSession((s) => s.harnessUserChosen)
  const hostSessionOwned = useActiveSession((s) => s.hostSessionOwned)
  const agents = useChatStore((s) => s.harnessResources.acp?.agents ?? EMPTY_ACP_AGENTS)
  const setPreferredProvider = useChatStore((s) => s.setPreferredProvider)
  const setAcpAgentId = useChatStore((s) => s.setAcpAgentId)
  const initializeHarness = useChatStore((s) => s.initializeHarness)
  const experimentalAgentsEnabled = useAppStore((s) => s.experimentalAgentsEnabled)
  const enabledExperimentalAgents = useAppStore((s) => s.enabledExperimentalAgents)
  const localHarnessCatalog = useBootstrapHarnesses(initializeHarness)
  const sessionScope = useSessionScope()
  // Scoped panes stay on their session's machine. An unscoped landing follows
  // the host selector before that host has a project to bind to.
  const harnessCatalog = useProjectHarnessCatalog(localHarnessCatalog, sessionScope ? undefined : hostConnectionId)
  const foreground = useSessionPaneForeground()
  const selectedAndLoaded = useChatStore((s) => isSelectedSessionScope(s, sessionScope)
    && (!sessionScope || !!s.projectSessions[sessionScope.projectPath]?._sessions[sessionScope.sessionId]?._historyHydrated))
  // Hidden panes survive maximization and may outlive their evicted session.
  // Their default selector view is not an empty foreground draft to initialize.
  const canAutoSelect = foreground && selectedAndLoaded
  const [agentMenuOpen, setAgentMenuOpen] = useState(false)

  const prefsEqual = useCallback((
    a: SuggestionHarnessPreference | null | undefined,
    b: SuggestionHarnessPreference | null | undefined,
  ): boolean => {
    if (a == null || b == null) return a == null && b == null
    if (a.provider !== b.provider) return false
    if (a.provider !== 'acp') return true
    return (a.acpAgentId ?? null) === (b.acpAgentId ?? null)
  }, [])

  const {
    ranks,
    suggestionHarness,
    secondaryHarness,
    harnessOrder,
    suggestionMenuHarness,
    persistDefaultHarness,
    persistSecondaryHarness,
  } = useSuggestionPreferences(prefsEqual)

  const selectProvider = useCallback(async (provider: ChatProvider, userChosen = false) => {
    if (!userChosen && !canAutoSelect) return
    if (userChosen && sessionScope) {
      await useChatStore.getState().switchToSession(sessionScope.projectPath, sessionScope.sessionId)
    }
    if (!isSelectedSessionScope(useChatStore.getState(), sessionScope)) return
    setPreferredProvider(provider, { userChosen })
    if (!sessionScope) return
    const nextSessionId = useChatStore.getState().projectSessions[sessionScope.projectPath]?._activeSessionId
    if (nextSessionId && nextSessionId !== sessionScope.sessionId) {
      useMosaicStore.getState().replaceTileSession(sessionScope.projectPath, sessionScope.sessionId, nextSessionId)
    }
  }, [sessionScope, setPreferredProvider, canAutoSelect])

  const selectHarnessOption = useCallback(async (
    option: SuggestionHarnessOption,
    manual: boolean,
    source: 'fixed' | 'menu' = 'fixed',
  ) => {
    if (!manual && !canAutoSelect) return
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
      if (manual && sessionScope) {
        await useChatStore.getState().switchToSession(sessionScope.projectPath, sessionScope.sessionId)
      }
      if (!isSelectedSessionScope(useChatStore.getState(), sessionScope)) return
      if (option.acpAgentId) setAcpAgentId(option.acpAgentId, { userChosen: manual })
      if (preferredProvider !== 'acp') await selectProvider('acp', manual)
      return
    }
    await selectProvider(option.provider, manual)
  }, [
    persistDefaultHarness,
    persistSecondaryHarness,
    preferredProvider,
    selectProvider,
    sessionScope,
    setAcpAgentId,
    canAutoSelect,
  ])

  const isAgentAllowed = useCallback(
    (provider: ChatProvider, agentId?: string | null) => isPickerHarnessEnabled(harnessCatalog, provider, agentId, {
      enabledExperimentalAgents,
      legacyExperimentalAgentsEnabled: experimentalAgentsEnabled,
    }),
    [enabledExperimentalAgents, experimentalAgentsEnabled, harnessCatalog],
  )

  const normalizedAgents = useMemo(
    () => agents.map((agent) => {
      if (agent.installed) return agent
      const catalogId = catalogIdForSessionProvider('acp', agent.id)
      if (!catalogId) return agent
      const row = harnessCatalog?.find((r) => r.id === catalogId)
      if (row?.enabled && (row.state === 'ready' || row.state === 'needs_auth' || row.state === 'installing')) {
        return { ...agent, installed: true }
      }
      return agent
    }),
    [agents, harnessCatalog],
  )

  // OpenCode over ACP is offered as the OpenCode harness, not as an ACP agent.
  const visibleAcpAgents = useMemo(
    () => normalizedAgents.filter((agent) => !isOpenCodeAcpAgent(agent.id) && isAgentAllowed('acp', agent.id)),
    [normalizedAgents, isAgentAllowed],
  )

  useEffect(() => {
    if (!canAutoSelect) return
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
    canAutoSelect,
  ])

  const selectedAcpAgent = useMemo(() => {
    if (normalizedAgents.length === 0) return null
    return normalizedAgents.find((a) => a.id === acpAgentId)
      ?? visibleAcpAgents.find((a) => isGrokAcpAgent(a.id))
      ?? visibleAcpAgents[0]
      ?? normalizedAgents.find((a) => isGrokAcpAgent(a.id))
      ?? normalizedAgents[0]
      ?? null
  }, [normalizedAgents, acpAgentId, visibleAcpAgents])

  useEffect(() => {
    if (canAutoSelect && preferredProvider === 'acp' && !acpAgentId && selectedAcpAgent?.id) {
      setAcpAgentId(selectedAcpAgent.id)
    }
  }, [preferredProvider, acpAgentId, selectedAcpAgent?.id, setAcpAgentId, canAutoSelect])

  const orderedHarnesses = useMemo(
    () => orderSuggestionHarnesses({
      ranks,
      acpAgents: visibleAcpAgents.map((a) => ({ id: a.id, name: a.name })),
      includeClaude: isAgentAllowed('claude'),
      includeCodex: isAgentAllowed('codex'),
      includeOpenCode: isAgentAllowed('opencode'),
      includeCursor: isAgentAllowed('cursor'),
      includeDeepseek: isAgentAllowed('dsh'),
      harnessOrder,
      defaultHarness: suggestionHarness === undefined ? null : suggestionHarness,
      secondaryHarness,
    }),
    [
      ranks,
      visibleAcpAgents,
      isAgentAllowed,
      harnessOrder,
      suggestionHarness,
      secondaryHarness,
    ],
  )

  const fixedHarness = orderedHarnesses[0] ?? null
  const menuHarnesses = useMemo(() => orderedHarnesses.slice(1), [orderedHarnesses])
  const hasEnabledHarness = orderedHarnesses.length > 0

  const effectiveAcpAgentId = selectedAcpAgent?.id ?? acpAgentId ?? DEFAULT_ACP_AGENT_ID
  const { PickerIcon } = HARNESS_CONTROLS[preferredProvider]
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
    const decision = resolveAutoApplyHarness({
      disableAutoApply: disableAutoApply || !canAutoSelect,
      harnessUserChosen,
      hostSessionOwned,
      fixedHarness,
      suggestionHarness,
      orderedHarnesses,
      messageCount,
      lastAppliedKey: lastAutoAppliedKeyRef.current,
      activeKey,
    })
    if (decision.remember) lastAutoAppliedKeyRef.current = decision.remember.key
    // Auto path is neither a fixed-tab click nor a menu pick — don't rewrite
    // dropdown-slot memory / settings pins.
    if (decision.apply) void selectHarnessOption(decision.apply, false, 'fixed')
  }, [
    disableAutoApply,
    canAutoSelect,
    harnessUserChosen,
    hostSessionOwned,
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

  return (
    <div className="flex flex-col items-center gap-3">
      {hasEnabledHarness ? (
        <>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={iconKey}
              initial={{ opacity: 0, y: 12, scale: 0.85 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -12, scale: 0.85 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            >
              <PickerIcon size={72} acpAgentId={effectiveAcpAgentId} />
            </motion.div>
          </AnimatePresence>
          {apiKeyDefault(preferredProvider) && <ActiveProviderHint />}
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
        <NoHarnessEnabledState />
      )}
    </div>
  )
}

export function ChatSuggestions({ draft = false }: { draft?: boolean } = {}) {
  return <ChatSuggestionsLanding draft={draft} ProviderSelectorComponent={ProviderSelector} />
}
