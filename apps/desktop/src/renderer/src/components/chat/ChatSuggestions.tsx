import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { useAppStore, useHasRealProject } from '@/stores/app'
import { useActiveSession, useChatStore, type ChatProvider } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'
import { ProviderLabel } from '@/components/ProviderLabel'
import { selectEffectiveApiProvider } from '@/lib/effective-api-provider'
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
import { ClaudeSessionIcon } from '@superone/ui/components/harness/ClaudeSessionIcon'
import { CodexSessionIcon } from '@superone/ui/components/harness/CodexSessionIcon'
import { cn } from '@superone/ui/lib/utils'
import { homePath } from '@/lib/path-utils'

function ProviderSelector() {
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
          {preferredProvider === 'claude' ? (
            <ClaudeSessionIcon status="default" size={64} />
          ) : (
            <CodexSessionIcon status="default" size={64} />
          )}
        </motion.div>
      </AnimatePresence>
      <ActiveProviderHint />
      <Tabs value={preferredProvider} onValueChange={(v) => setPreferredProvider(v as ChatProvider)}>
        <TabsList className="rounded-lg p-1">
          <TabsTrigger value="claude" className="rounded-md px-3 py-1.5">Claude Code</TabsTrigger>
          <TabsTrigger value="codex" className="rounded-md px-3 py-1.5">Codex</TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  )
}

function ActiveProviderHint() {
  const { t } = useTranslation()
  const preferredProvider = useActiveSession((s) => s.preferredProvider)
  const sessionApiProviderId = useActiveSession((s) => s.apiProviderId)
  const providers = useSettingsStore((s) => s.providers)
  const fetchProviders = useSettingsStore((s) => s.fetchProviders)

  useEffect(() => { fetchProviders() }, [fetchProviders])

  const activeProvider = selectEffectiveApiProvider(providers, preferredProvider, sessionApiProviderId)

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground">{t('chat.suggestions.poweredBy')}</span>
      {activeProvider ? (
        <ProviderLabel provider={activeProvider} fallback={activeProvider.name} size={12} />
      ) : (
        <ProviderLabel
          presetKey={preferredProvider === 'codex' ? 'default-codex' : 'default-claude'}
          fallback={preferredProvider === 'codex'
            ? t('resources.providers.defaultLabelCodex')
            : t('resources.providers.defaultLabelClaude')}
          size={12}
        />
      )}
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
