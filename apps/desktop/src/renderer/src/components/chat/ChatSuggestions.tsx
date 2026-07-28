import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { useAppStore, useHasRealProject } from '@/stores/app'
import { useActiveSession, useChatStore, useSessionScope, type ChatProvider } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'
import { ProviderLabel } from '@/components/ProviderLabel'
import { consumerForHarness, resolveEffective } from '@/lib/provider-resolve'
import { ProjectSelector } from '@/components/coding/ProjectSelector'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@superone/ui/components/ui/dropdown-menu'
import { Check, ChevronDown, Plus } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger } from '@superone/ui/components/ui/tabs'
import { AcpSessionIcon } from '@superone/ui/components/harness/AcpSessionIcon'
import { ClaudeSessionIcon } from '@superone/ui/components/harness/ClaudeSessionIcon'
import { CodexSessionIcon } from '@superone/ui/components/harness/CodexSessionIcon'
import { Grok, OpenCode } from '@lobehub/icons'
import { cn } from '@superone/ui/lib/utils'
import { homePath } from '@/lib/path-utils'
import { useMosaicStore } from '@/components/mosaic/mosaic-store'
import { isExperimentalAgentProvider } from '@/stores/chat-store/helpers/provider-routing'
import type { AcpAgentDescriptor } from '@superone/shared/agent-types'

const EMPTY_ACP_AGENTS: AcpAgentDescriptor[] = []
const DEFAULT_ACP_AGENT_ID = 'grok-build'

const tabsTriggerClass =
  'relative z-10 inline-flex flex-1 items-center justify-center gap-1 whitespace-nowrap rounded px-3 py-2 text-xs font-medium transition-colors text-muted-foreground hover:text-foreground data-[state=active]:text-foreground'

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
    if (!acpAgentId || acpAgentId === DEFAULT_ACP_AGENT_ID) {
      return <Grok size={size} className="text-foreground" />
    }
    return <AcpSessionIcon status="default" size={size} />
  }
  if (provider === 'opencode') return <OpenCode size={size} />
  return <ClaudeSessionIcon status="default" size={size} />
}

function ProviderSelector() {
  const { t } = useTranslation()
  const preferredProvider = useActiveSession((s) => s.preferredProvider)
  const acpAgentId = useActiveSession((s) => s.acpAgentId)
  const agents = useChatStore((s) => s.harnessResources.acp?.agents ?? EMPTY_ACP_AGENTS)
  const setPreferredProvider = useChatStore((s) => s.setPreferredProvider)
  const setAcpAgentId = useChatStore((s) => s.setAcpAgentId)
  const initializeHarness = useChatStore((s) => s.initializeHarness)
  const experimentalAgentsEnabled = useAppStore((s) => s.experimentalAgentsEnabled)
  const sessionScope = useSessionScope()
  const [agentMenuOpen, setAgentMenuOpen] = useState(false)
  const [lastAgentGroup, setLastAgentGroup] = useState<'codex' | 'acp' | 'opencode'>(
    preferredProvider === 'acp' || preferredProvider === 'opencode' ? preferredProvider : 'codex',
  )

  useEffect(() => {
    if (!experimentalAgentsEnabled) return
    void initializeHarness('acp')
  }, [experimentalAgentsEnabled, initializeHarness])

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

  useEffect(() => {
    if (!experimentalAgentsEnabled && isExperimentalAgentProvider(preferredProvider)) {
      setAgentMenuOpen(false)
      void selectProvider('claude')
    }
  }, [experimentalAgentsEnabled, preferredProvider, selectProvider])

  useEffect(() => {
    if (!experimentalAgentsEnabled) {
      setLastAgentGroup('codex')
      return
    }
    if (preferredProvider === 'codex') setLastAgentGroup('codex')
    else if (preferredProvider === 'acp') setLastAgentGroup('acp')
    else if (preferredProvider === 'opencode') setLastAgentGroup('opencode')
  }, [experimentalAgentsEnabled, preferredProvider])

  const selectedAcpAgent = useMemo(() => {
    if (agents.length === 0) return null
    return agents.find((a) => a.id === acpAgentId) ?? agents[0] ?? null
  }, [agents, acpAgentId])

  useEffect(() => {
    if (!experimentalAgentsEnabled) return
    if (preferredProvider === 'acp' && !acpAgentId && selectedAcpAgent?.id) {
      setAcpAgentId(selectedAcpAgent.id)
    }
  }, [experimentalAgentsEnabled, preferredProvider, acpAgentId, selectedAcpAgent?.id, setAcpAgentId])

  const effectiveAcpAgentId = selectedAcpAgent?.id ?? acpAgentId ?? DEFAULT_ACP_AGENT_ID
  const showAcpLabel = experimentalAgentsEnabled && (preferredProvider === 'acp'
    || (preferredProvider === 'claude' && lastAgentGroup === 'acp')
  )
  const agentTabLabel = showAcpLabel
    ? (selectedAcpAgent?.name
      ?? (effectiveAcpAgentId === DEFAULT_ACP_AGENT_ID ? 'Grok' : t('chat.suggestions.selectAgent')))
    : experimentalAgentsEnabled && (preferredProvider === 'opencode' || (preferredProvider === 'claude' && lastAgentGroup === 'opencode'))
      ? 'OpenCode'
      : 'Codex'
  const agentTabActive = preferredProvider === 'codex' || preferredProvider === 'acp' || preferredProvider === 'opencode'
  const iconKey = preferredProvider === 'acp' ? `acp:${effectiveAcpAgentId}` : preferredProvider
  const tabsValue = preferredProvider === 'claude'
    ? 'claude'
    : experimentalAgentsEnabled
      ? 'agent'
      : 'codex'

  const selectBuiltin = (provider: 'claude' | 'codex') => {
    setAgentMenuOpen(false)
    void selectProvider(provider)
  }

  const selectAcpAgent = (agentId: string) => {
    setAgentMenuOpen(false)
    void (async () => {
      if (sessionScope) {
        await useChatStore.getState().switchToSession(sessionScope.projectPath, sessionScope.sessionId)
      }
      setAcpAgentId(agentId)
      if (preferredProvider !== 'acp') await selectProvider('acp')
    })()
  }

  const restoreAgentTab = () => {
    if (!experimentalAgentsEnabled) {
      selectBuiltin('codex')
      return
    }
    if (lastAgentGroup === 'opencode') {
      void selectProvider('opencode')
      return
    }
    if (lastAgentGroup === 'acp') {
      selectAcpAgent(effectiveAcpAgentId)
      return
    }
    selectBuiltin('codex')
  }

  const onAgentTabActivate = (e: MouseEvent) => {
    if (agentTabActive) return
    e.preventDefault()
    e.stopPropagation()
    restoreAgentTab()
  }

  return (
    <div className="flex flex-col items-center gap-3">
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
      {preferredProvider !== 'acp' && <ActiveProviderHint />}
      <Tabs
        value={tabsValue}
        onValueChange={(v) => {
          if (v === 'claude') selectBuiltin('claude')
          else if (v === 'codex') selectBuiltin('codex')
        }}
      >
        <TabsList>
          <TabsTrigger value="claude" className="px-3 py-2">Claude Code</TabsTrigger>
          {experimentalAgentsEnabled ? (
            <DropdownMenu
              open={agentMenuOpen}
              onOpenChange={(open) => {
                if (open && !agentTabActive) return
                setAgentMenuOpen(open)
              }}
            >
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  role="tab"
                  data-slot="tabs-trigger"
                  data-state={agentTabActive ? 'active' : 'inactive'}
                  className={cn(tabsTriggerClass, 'max-w-[9.5rem]')}
                  onPointerDown={onAgentTabActivate}
                  onClick={onAgentTabActivate}
                >
                  <span className="min-w-0 truncate">{agentTabLabel}</span>
                  <ChevronDown className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform duration-200', agentMenuOpen && agentTabActive && 'rotate-180')} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center" className="min-w-48">
                <DropdownMenuItem onClick={() => selectBuiltin('codex')} className="gap-2 focus-visible:shadow-none">
                  <span className="min-w-0 flex-1 truncate">Codex</span>
                  {preferredProvider === 'codex' && <Check className="size-4 shrink-0 text-primary" />}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void selectProvider('opencode')} className="gap-2 focus-visible:shadow-none">
                  <span className="min-w-0 flex-1 truncate">OpenCode</span>
                  {preferredProvider === 'opencode' && <Check className="size-4 shrink-0 text-primary" />}
                </DropdownMenuItem>
                {agents.some((agent) => agent.id !== 'opencode') && <DropdownMenuSeparator />}
                {agents.filter((agent) => agent.id !== 'opencode').map((agent) => {
                  const selected = preferredProvider === 'acp' && effectiveAcpAgentId === agent.id
                  return (
                    <DropdownMenuItem key={agent.id} onClick={() => selectAcpAgent(agent.id)} className="gap-2 focus-visible:shadow-none">
                      <span className="min-w-0 flex-1 truncate">{agent.name}</span>
                      {!agent.installed && <span className="shrink-0 text-xs text-muted-foreground">{t('chat.suggestions.agentNotInstalled')}</span>}
                      {selected && <Check className="size-4 shrink-0 text-primary" />}
                    </DropdownMenuItem>
                  )
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <TabsTrigger value="codex" className="px-3 py-2">Codex</TabsTrigger>
          )}
        </TabsList>
      </Tabs>
      {experimentalAgentsEnabled && preferredProvider === 'acp' && selectedAcpAgent && !selectedAcpAgent.installed && (
        <p className="max-w-xs text-center text-xs text-muted-foreground">
          {t('chat.suggestions.agentInstallHint')}
        </p>
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
  const fetchProviderData = useSettingsStore((s) => s.fetchProviderData)

  useEffect(() => { fetchProviderData() }, [fetchProviderData])

  if (preferredProvider === 'acp' || preferredProvider === 'opencode') return null

  const effective = resolveEffective(platforms, credentials, bindings, consumerForHarness(preferredProvider), sessionApiProviderId)
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
        size={12}
        compactFallback
      />
    </span>
  )
}

export function ChatSuggestions() {
  const { t } = useTranslation()
  const selectProject = useAppStore((s) => s.selectProject)
  const recentFolders = useAppStore((s) => s.recentFolders)
  const hasRealProject = useHasRealProject()

  const [addOpen, setAddOpen] = useState(false)

  const resetSession = useChatStore((s) => s.resetSession)

  if (!hasRealProject) {
    const hasRecent = recentFolders.length > 0
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-4" style={{ animation: 'fade-in 400ms ease-out' }}>
        <ProviderSelector />
        <p className="text-sm text-muted-foreground">{t('chat.suggestions.openProject')}</p>
        {hasRecent ? (
          <DropdownMenu onOpenChange={setAddOpen}>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent">
                {t('chat.suggestions.addProject')}
                <ChevronDown className={cn('size-4 text-muted-foreground transition-transform duration-200', addOpen && 'rotate-180')} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center" className="max-h-80 w-64 overflow-y-auto">
              {recentFolders.map((folder) => (
                <DropdownMenuItem key={folder.path} onClick={() => selectProject(folder.path)} className="gap-2">
                  <span className="truncate">{folder.name}</span>
                  <span className="ml-auto truncate text-xs text-muted-foreground">
                    {homePath(folder.path)}
                  </span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => selectProject()} className="gap-2">
                <Plus className="size-4 shrink-0" />
                <span>{t('chat.suggestions.addProject')}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <button
            onClick={() => selectProject()}
            className="rounded-lg px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            {t('chat.suggestions.addProject')}
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-4" style={{ animation: 'fade-in 400ms ease-out' }}>
      <ProviderSelector />
      <ProjectSelector align="center" onOpened={() => void resetSession()} />
    </div>
  )
}
