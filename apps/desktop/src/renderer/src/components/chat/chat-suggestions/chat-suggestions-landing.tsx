import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Loader2, Plus } from 'lucide-react'
import type { RecentFolder } from '@superone/shared/agent-types'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@superone/ui/components/ui/dropdown-menu'
import { ScrollArea } from '@superone/ui/components/ui/scroll-area'
import { cn } from '@superone/ui/lib/utils'
import { ProjectSelector } from '@/components/coding/ProjectSelector'
import { AddProjectDialog } from '@/components/sidebar/add-project/AddProjectDialog'
import { useHostProjects } from '@/hooks/use-host-projects'
import { withDraftCarry } from '@/lib/draft-surface-select'
import { loadEnvironmentItems } from '@/lib/environment-list'
import { homePath } from '@/lib/path-utils'
import { displayHostPath, remoteProjectKey } from '@/lib/remote-project-key'
import { useAppStore, useHasRealProject } from '@/stores/app'
import { useChatStore, useIsRemoteLocked, useSessionScope } from '@/stores/chat'
import { isUnsentSession } from '@/stores/chat-store/helpers/session-liveness'
import { isSelectedSessionScope } from '@/stores/chat-store/selectors'
import { useSessionPaneForeground } from '@/stores/chat-store/session-scope'

export interface ProviderSelectorRenderProps {
  disableAutoApply?: boolean
  hostConnectionId?: string
}

export function ChatSuggestionsLanding({
  draft = false,
  ProviderSelectorComponent,
}: {
  draft?: boolean
  ProviderSelectorComponent: ComponentType<ProviderSelectorRenderProps>
}) {
  const foreground = useSessionPaneForeground()
  const scope = useSessionScope()
  const selected = useChatStore((s) => isSelectedSessionScope(s, scope))
  const { t } = useTranslation()
  const locked = useIsRemoteLocked()
  const selectProject = useAppStore((s) => s.selectProject)
  const fetchRecentFolders = useAppStore((s) => s.fetchRecentFolders)
  const isSwitchingHostProject = useAppStore((s) => s.isSwitchingHostProject)
  const hasRealProject = useHasRealProject()
  const { connectionId, isLocal, projects, loading, error, refresh } = useHostProjects()

  const [menuOpen, setMenuOpen] = useState(false)
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [hostLabel, setHostLabel] = useState('')
  const autoOpenAttemptRef = useRef<string | null>(null)

  const resetSession = useChatStore((s) => s.resetSession)

  useEffect(() => {
    if (isLocal) {
      setHostLabel(window.app.platform === 'darwin' ? t('sidebar.thisMac') : t('sidebar.thisPc'))
      return
    }
    let cancelled = false
    void loadEnvironmentItems().then((items) => {
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

  useEffect(() => {
    if (hasRealProject) {
      autoOpenAttemptRef.current = null
      return
    }
    if (!foreground || !selected || draft || isSwitchingHostProject || loading || error) return
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
    draft,
    hasRealProject,
    isSwitchingHostProject,
    loading,
    error,
    projects,
    connectionId,
    selectProject,
    foreground,
    selected,
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

  if (!hasRealProject && !draft) {
    const hasProjects = projects.length > 0
    const isProjectLoading = isSwitchingHostProject || loading
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-4" style={{ animation: 'fade-in 400ms ease-out' }}>
        <ProviderSelectorComponent hostConnectionId={connectionId} />
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
            <DropdownMenuContent align="center" className="w-64 overflow-hidden">
              <ScrollArea
                type="scroll"
                edgeFade
                className="max-h-80 min-h-0 [&_[data-slot=scroll-area-viewport]]:max-h-[inherit] [&_[data-slot=scroll-area-viewport]]:overscroll-contain [&_[data-slot=scroll-area-viewport]>div]:block!"
              >
                {projects.map((folder) => (
                  <DropdownMenuItem key={folder.path} onClick={() => openExisting(folder)} className="gap-2">
                    <span className="truncate">{folder.name}</span>
                    <span className="ml-auto truncate text-xs text-muted-foreground">
                      {homePath(displayHostPath(folder.path))}
                    </span>
                  </DropdownMenuItem>
                ))}
              </ScrollArea>
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
    <div
      className="flex h-full flex-col items-center justify-center gap-4 px-4"
      style={{ animation: 'fade-in 400ms ease-out' }}
      data-draft={draft || undefined}
      inert={locked}
    >
      <ProviderSelectorComponent disableAutoApply={draft} hostConnectionId={draft ? undefined : connectionId} />
      <ProjectSelector
        align="center"
        carryOpenDraft
        onOpened={() => {
          if (draft) return
          const store = useChatStore.getState()
          const path = store.activeProject
          const sid = path ? store.projectSessions[path]?._activeSessionId : null
          const sess = path && sid ? store.projectSessions[path]?._sessions[sid] : null
          if ((sess && isUnsentSession(sess)) || sess?.draftText.trim() || sess?.draftId) return
          void resetSession()
        }}
        onAddProject={isLocal ? undefined : startAddProject}
      />
      {addDialog}
    </div>
  )
}
