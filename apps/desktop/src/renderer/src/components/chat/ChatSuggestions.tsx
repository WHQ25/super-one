import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { useAppStore, useHasRealProject } from '@/stores/app'
import { useActiveSession, useChatStore, type ChatProvider } from '@/stores/chat'
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
import { AcpSessionIcon } from '@superone/ui/components/harness/AcpSessionIcon'
import { ClaudeSessionIcon } from '@superone/ui/components/harness/ClaudeSessionIcon'
import { CodexSessionIcon } from '@superone/ui/components/harness/CodexSessionIcon'
import { cn } from '@superone/ui/lib/utils'
import { homePath } from '@/lib/path-utils'
import type { AcpAgentDescriptor } from '@superone/shared/agent-types'

const EMPTY_ACP_AGENTS: AcpAgentDescriptor[] = []

type AgentChoice =
  | { kind: 'claude' }
  | { kind: 'codex' }
  | { kind: 'acp'; agentId: string }

function ProviderIcon({ provider, size = 64 }: { provider: ChatProvider; size?: number }) {
  if (provider === 'codex') return <CodexSessionIcon status="default" size={size} />
  if (provider === 'acp') return <AcpSessionIcon status="default" size={size} />
  return <ClaudeSessionIcon status="default" size={size} />
}

function choiceKey(choice: AgentChoice): string {
  return choice.kind === 'acp' ? `acp:${choice.agentId}` : choice.kind
}

function ProviderSelector() {
  const { t } = useTranslation()
  const preferredProvider = useActiveSession((s) => s.preferredProvider)
  const acpAgentId = useActiveSession((s) => s.acpAgentId)
  const agents = useChatStore((s) => s.harnessResources.acp?.agents ?? EMPTY_ACP_AGENTS)
  const setPreferredProvider = useChatStore((s) => s.setPreferredProvider)
  const setAcpAgentId = useChatStore((s) => s.setAcpAgentId)
  const initializeHarness = useChatStore((s) => s.initializeHarness)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    void initializeHarness('acp')
  }, [initializeHarness])

  const selectedAcpAgent = useMemo(() => {
    if (agents.length === 0) return null
    return agents.find((a) => a.id === acpAgentId) ?? agents[0] ?? null
  }, [agents, acpAgentId])

  useEffect(() => {
    if (preferredProvider === 'acp' && !acpAgentId && selectedAcpAgent?.id) {
      setAcpAgentId(selectedAcpAgent.id)
    }
  }, [preferredProvider, acpAgentId, selectedAcpAgent?.id, setAcpAgentId])

  const selectedChoice: AgentChoice = preferredProvider === 'codex'
    ? { kind: 'codex' }
    : preferredProvider === 'acp'
      ? { kind: 'acp', agentId: selectedAcpAgent?.id ?? acpAgentId ?? 'grok-build' }
      : { kind: 'claude' }

  const selectedLabel = selectedChoice.kind === 'claude'
    ? 'Claude Code'
    : selectedChoice.kind === 'codex'
      ? 'Codex'
      : (selectedAcpAgent?.name ?? t('chat.suggestions.selectAgent'))

  const selectedKey = choiceKey(selectedChoice)

  const selectAgent = (choice: AgentChoice) => {
    if (choiceKey(choice) === selectedKey) return
    if (choice.kind === 'claude' || choice.kind === 'codex') {
      setPreferredProvider(choice.kind)
      return
    }
    // Set agent id first so provider switch / prewarm never races with stale grok defaults.
    setAcpAgentId(choice.agentId)
    if (preferredProvider !== 'acp') {
      setPreferredProvider('acp')
    }
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <AnimatePresence mode="wait">
        <motion.div
          key={selectedKey}
          initial={{ opacity: 0, y: 12, scale: 0.85 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -12, scale: 0.85 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        >
          <ProviderIcon provider={preferredProvider} />
        </motion.div>
      </AnimatePresence>
      {preferredProvider !== 'acp' && <ActiveProviderHint />}
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent">
            <span>{selectedLabel}</span>
            <ChevronDown className={cn('size-4 text-muted-foreground transition-transform duration-200', menuOpen && 'rotate-180')} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="min-w-48">
          <DropdownMenuItem
            onClick={() => selectAgent({ kind: 'claude' })}
            className="gap-2 focus-visible:shadow-none"
          >
            <span className="flex-1">Claude Code</span>
            {selectedChoice.kind === 'claude' && <Check className="size-4 shrink-0 text-primary" />}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => selectAgent({ kind: 'codex' })}
            className="gap-2 focus-visible:shadow-none"
          >
            <span className="flex-1">Codex</span>
            {selectedChoice.kind === 'codex' && <Check className="size-4 shrink-0 text-primary" />}
          </DropdownMenuItem>
          {agents.map((agent) => {
            const selected = selectedChoice.kind === 'acp' && selectedChoice.agentId === agent.id
            return (
              <DropdownMenuItem
                key={agent.id}
                onClick={() => selectAgent({ kind: 'acp', agentId: agent.id })}
                className="gap-2 focus-visible:shadow-none"
              >
                <span className="min-w-0 flex-1 truncate">{agent.name}</span>
                {!agent.installed && (
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {t('chat.suggestions.agentNotInstalled')}
                  </span>
                )}
                {selected && <Check className="size-4 shrink-0 text-primary" />}
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      {preferredProvider === 'acp' && selectedAcpAgent && !selectedAcpAgent.installed && (
        <p className="max-w-xs text-center text-[11px] text-muted-foreground">
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

  if (preferredProvider === 'acp') return null

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
        fallback={effective?.credential.name ?? defaultLabel}
        size={12}
      />
    </span>
  )
}

export function ChatSuggestions() {
  const { t } = useTranslation()
  const layoutMode = useAppStore((s) => s.layoutMode)
  const selectProject = useAppStore((s) => s.selectProject)
  const recentFolders = useAppStore((s) => s.recentFolders)
  const hasRealProject = useHasRealProject()

  const [addOpen, setAddOpen] = useState(false)

  const resetSession = useChatStore((s) => s.resetSession)

  const isCoding = layoutMode === 'coding'

  if (isCoding && !hasRealProject) {
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
      {isCoding && <ProjectSelector align="center" onOpened={() => void resetSession()} />}
    </div>
  )
}
