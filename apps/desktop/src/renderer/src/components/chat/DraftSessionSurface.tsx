/**
 * Empty-pane chrome for a restored / carried draft.
 *
 * Intentionally not ChatSuggestions: that landing page auto-applies the
 * default harness (ACP/Grok) and resets the session when the project changes.
 * A draft already has harness / model / permission / worktree and must keep
 * the same session identity across those switches.
 */

import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/stores/app'
import { ProjectSelector } from '@/components/coding/ProjectSelector'
import { AddProjectDialog } from '@/components/sidebar/add-project/AddProjectDialog'
import { useHostProjects } from '@/hooks/use-host-projects'
import { remoteProjectKey } from '@/lib/remote-project-key'
import { withDraftCarry } from '@/lib/draft-surface-select'
import { ProviderSelector } from './ChatSuggestions'

export function DraftSessionSurface() {
  const { t } = useTranslation()
  const selectProject = useAppStore((s) => s.selectProject)
  const fetchRecentFolders = useAppStore((s) => s.fetchRecentFolders)
  const { connectionId, isLocal, refresh } = useHostProjects()
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [hostLabel, setHostLabel] = useState('')

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

  const startAddProject = useCallback(() => {
    if (isLocal) {
      void selectProject(undefined, withDraftCarry())
      return
    }
    setAddDialogOpen(true)
  }, [isLocal, selectProject])

  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-4 px-4"
      style={{ animation: 'fade-in 400ms ease-out' }}
      data-testid="draft-session-surface"
    >
      <ProviderSelector disableAutoApply />
      <ProjectSelector
        align="center"
        carryOpenDraft
        onAddProject={isLocal ? undefined : startAddProject}
      />
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
    </div>
  )
}
