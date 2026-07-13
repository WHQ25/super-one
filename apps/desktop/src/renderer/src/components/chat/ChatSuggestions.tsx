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
import { ChevronDown, Plus } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger } from '@superone/ui/components/ui/tabs'
import { AcpSessionIcon } from '@superone/ui/components/harness/AcpSessionIcon'
import { ClaudeSessionIcon } from '@superone/ui/components/harness/ClaudeSessionIcon'
import { CodexSessionIcon } from '@superone/ui/components/harness/CodexSessionIcon'
import { cn } from '@superone/ui/lib/utils'
import { homePath } from '@/lib/path-utils'
import type { AcpAgentDescriptor } from '@superone/shared/agent-types'

const EMPTY_ACP_AGENTS: AcpAgentDescriptor[] = []

function ProviderIcon({ provider }: { provider: ChatProvider }) {
  if (provider === 'codex') return <CodexSessionIcon status="default" size={64} />
  if (provider === 'acp') return <AcpSessionIcon status="default" size={64} />
  return <ClaudeSessionIcon status="default" size={64} />
}

function AcpAgentPicker() {
  const { t } = useTranslation()
  const agents = useChatStore((s) => s.harnessResources.acp?.agents ?? EMPTY_ACP_AGENTS)
  const acpAgentId = useActiveSession((s) => s.acpAgentId)
  const setAcpAgentId = useChatStore((s) => s.setAcpAgentId)
  const initializeHarness = useChatStore((s) => s.initializeHarness)

  useEffect(() => {
    void initializeHarness('acp')
  }, [initializeHarness])

  const selected = useMemo(() => {
    if (agents.length === 0) return null
    return agents.find((a) => a.id === acpAgentId) ?? agents[0] ?? null
  }, [agents, acpAgentId])

  useEffect(() => {
    if (!acpAgentId && selected?.id) setAcpAgentId(selected.id)
  }, [acpAgentId, selected?.id, setAcpAgentId])

  if (agents.length === 0) {
    return (
      <span className="text-xs text-muted-foreground">{t('chat.suggestions.acpLabel')}</span>
    )
  }

  return (
    <div className="flex flex-col items-center gap-1.5">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent">
            <span>{selected?.name ?? t('chat.suggestions.selectAgent')}</span>
            <ChevronDown className="size-3.5 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="min-w-48">
          {agents.map((agent) => (
            <DropdownMenuItem
              key={agent.id}
              onClick={() => setAcpAgentId(agent.id)}
              className="flex flex-col items-start gap-0.5"
            >
              <span className="flex w-full items-center justify-between gap-3">
                <span>{agent.name}</span>
                {!agent.installed && (
                  <span className="text-[10px] text-muted-foreground">{t('chat.suggestions.agentNotInstalled')}</span>
                )}
              </span>
              <span className="font-mono text-[10px] text-muted-foreground">{agent.commandPreview}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {selected && !selected.installed && (
        <p className="max-w-xs text-center text-[11px] text-muted-foreground">
          {t('chat.suggestions.agentInstallHint')}
        </p>
      )}
    </div>
  )
}

function ProviderSelector() {
  const { t } = useTranslation()
  const preferredProvider = useActiveSession((s) => s.preferredProvider)
  const setPreferredProvider = useChatStore((s) => s.setPreferredProvider)

  return (
    <div className="flex flex-col items-center gap-3">
      <AnimatePresence mode="wait">
        <motion.div
          key={preferredProvider}
          initial={{ opacity: 0, y: 12, scale: 0.85 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -12, scale: 0.85 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        >
          <ProviderIcon provider={preferredProvider} />
        </motion.div>
      </AnimatePresence>
      <ActiveProviderHint />
      <Tabs value={preferredProvider} onValueChange={(v) => setPreferredProvider(v as ChatProvider)}>
        <TabsList>
          <TabsTrigger value="claude" className="px-3 py-2">Claude Code</TabsTrigger>
          <TabsTrigger value="codex" className="px-3 py-2">Codex</TabsTrigger>
          <TabsTrigger value="acp" className="px-3 py-2">{t('chat.suggestions.others')}</TabsTrigger>
        </TabsList>
      </Tabs>
      {preferredProvider === 'acp' && <AcpAgentPicker />}
    </div>
  )
}

function ActiveProviderHint() {
  const { t } = useTranslation()
  const preferredProvider = useActiveSession((s) => s.preferredProvider)
  const sessionApiProviderId = useActiveSession((s) => s.apiProviderId)
  const acpAgentId = useActiveSession((s) => s.acpAgentId)
  const agents = useChatStore((s) => s.harnessResources.acp?.agents ?? EMPTY_ACP_AGENTS)
  const platforms = useSettingsStore((s) => s.platforms)
  const credentials = useSettingsStore((s) => s.credentials)
  const bindings = useSettingsStore((s) => s.bindings)
  const fetchProviderData = useSettingsStore((s) => s.fetchProviderData)

  useEffect(() => { fetchProviderData() }, [fetchProviderData])

  if (preferredProvider === 'acp') {
    const agent = agents.find((a) => a.id === acpAgentId)
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground">{t('chat.suggestions.poweredBy')}</span>
        <span className="text-xs font-medium text-foreground">
          {agent?.name ?? t('chat.suggestions.acpLabel')}
        </span>
      </span>
    )
  }

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
