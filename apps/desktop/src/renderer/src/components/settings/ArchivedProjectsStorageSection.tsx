import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Folder, Loader2, Trash2 } from 'lucide-react'
import { Button } from '@superone/ui/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@superone/ui/components/ui/dialog'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import type { StorageArchivedProject } from '@superone/shared/desktop-storage'
import { SettingsRow } from './SettingsSection'

type State =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; projects: StorageArchivedProject[] }

export function ArchivedProjectsStorageRows({ locked = false, onPurged }: {
  locked?: boolean
  onPurged?: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [state, setState] = useState<State>({ status: 'loading' })
  const [pending, setPending] = useState<StorageArchivedProject[] | null>(null)
  const [purging, setPurging] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const loader = window.app.getStorageArchivedProjects
      const raw = loader ? await loader() : []
      setState({ status: 'ready', projects: Array.isArray(raw) ? raw : [] })
    } catch {
      setState({ status: 'error' })
    }
  }, [])

  useEffect(() => {
    let live = true
    const loader = window.app.getStorageArchivedProjects
    if (!loader) {
      setState({ status: 'ready', projects: [] })
      return
    }
    void loader().then(
      (raw) => { if (live) setState({ status: 'ready', projects: Array.isArray(raw) ? raw : [] }) },
      () => { if (live) setState({ status: 'error' }) },
    )
    return () => { live = false }
  }, [])

  async function purge(targets: StorageArchivedProject[]) {
    setPending(null)
    setPurging(true)
    setNotice(null)
    try {
      const targetIds = targets.map((p) => p.id)
      const result = await window.app.purgeStorageArchivedProjects(targetIds)
      const count = result.purgedCount || targets.length
      setNotice(t('storageSettings.archivedProjects.purged', { count }))
      const removedSet = new Set(targetIds)
      setState((prev) => prev.status === 'ready'
        ? { status: 'ready', projects: prev.projects.filter((p) => !removedSet.has(p.id)) }
        : prev)
      if (onPurged) await onPurged()
    } catch {
      setState({ status: 'error' })
    } finally {
      setPurging(false)
    }
  }

  const projects = state.status === 'ready' ? state.projects : []
  const disabled = locked || purging

  return (
    <>
      {state.status === 'loading' && (
        <SettingsRow
          data-testid="storage-archived-projects-loading"
          aria-busy="true"
          label={t('storageSettings.archivedProjects.section')}
          description={(
            <span className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              {t('storageSettings.archivedProjects.loading')}
            </span>
          )}
        />
      )}
      {state.status === 'error' && (
        <SettingsRow
          data-testid="storage-archived-projects-error"
          label={t('storageSettings.archivedProjects.section')}
          description={<span className="text-destructive">{t('storageSettings.archivedProjects.unreadable')}</span>}
        >
          <Button type="button" variant="outline" size="sm" className="h-7" onClick={() => { setState({ status: 'loading' }); void load() }}>
            {t('common.retry')}
          </Button>
        </SettingsRow>
      )}
      {state.status === 'ready' && projects.length === 0 && (
        <SettingsRow
          data-testid="storage-archived-projects-empty"
          label={t('storageSettings.archivedProjects.section')}
          description={notice ?? t('storageSettings.archivedProjects.empty')}
        />
      )}
      {state.status === 'ready' && projects.length > 0 && (
        <SettingsRow
          data-testid="storage-archived-projects-header"
          label={t('storageSettings.archivedProjects.section')}
          description={notice ?? undefined}
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7"
            data-testid="storage-archived-projects-purge-all"
            disabled={disabled}
            onClick={() => setPending(projects)}
          >
            {purging && <Loader2 className="size-3.5 animate-spin" />}
            {t('storageSettings.archivedProjects.purgeAll')}
          </Button>
        </SettingsRow>
      )}
      {projects.map((project) => (
        <SettingsRow
          key={project.id}
          data-testid="storage-archived-project"
          label={(
            <span className="flex items-center gap-2 pl-3 min-w-0">
              <Folder className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{project.name}</span>
            </span>
          )}
        >
          <span className="text-xs tabular-nums text-muted-foreground shrink-0">
            {t('storageSettings.archivedProjects.sessionsCount', { sessions: project.sessionCount, messages: project.messageCount })}
          </span>
          <IconButton
            size="md"
            variant="destructive"
            tooltip={t('storageSettings.archivedProjects.purgeOne')}
            disabled={disabled}
            onClick={() => setPending([project])}
          >
            <Trash2 />
          </IconButton>
        </SettingsRow>
      ))}

      <Dialog open={pending !== null} onOpenChange={(open) => { if (!open) setPending(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('storageSettings.archivedProjects.confirmTitle', { count: pending?.length ?? 0 })}</DialogTitle>
            <DialogDescription>
              {t('storageSettings.archivedProjects.confirm')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPending(null)}>{t('common.cancel')}</Button>
            <Button type="button" variant="destructive" data-testid="storage-archived-projects-confirm" onClick={() => pending && void purge(pending)}>
              {t('common.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
