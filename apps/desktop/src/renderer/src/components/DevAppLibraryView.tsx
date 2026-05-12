import { useEffect, useState, useCallback } from 'react'
import { ArrowLeft, Check, FolderInput, FolderSearch, Plus, Trash2, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Button } from '@superone/ui/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@superone/ui/components/ui/dialog'
import { useAppStore } from '@/stores/app'
import { useMiniAppStore } from '@/stores/miniapp'
import { MiniAppIcon } from '@/components/miniapp/MiniAppIcon'
import { cn } from '@superone/ui/lib/utils'
import type { DevRegistryView } from '@superone/shared/miniapp-types'

interface DevAppLibraryViewProps {
  onClose: () => void
}

type Scope = 'user' | 'project'

export function DevAppLibraryView({ onClose }: DevAppLibraryViewProps) {
  const { t } = useTranslation()
  const currentFolder = useAppStore((s) => s.currentFolder)
  const refreshApps = useMiniAppStore((s) => s.refreshApps)

  const [entries, setEntries] = useState<DevRegistryView[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [scope, setScope] = useState<Scope>('user')
  const [installing, setInstalling] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [cascade, setCascade] = useState(false)

  const fetchEntries = useCallback(async () => {
    setLoading(true)
    try {
      const list = await window.miniapp.devRegistry.list()
      setEntries(list)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchEntries()
  }, [fetchEntries])

  const projectInstalled = (entry: DevRegistryView): boolean =>
    !!currentFolder && entry.installations.some((i) => i.scope === 'project' && i.projectDir === currentFolder)
  const userInstalled = (entry: DevRegistryView): boolean =>
    entry.installations.some((i) => i.scope === 'user')
  const isInstalledInScope = (entry: DevRegistryView): boolean =>
    scope === 'user' ? userInstalled(entry) : projectInstalled(entry)

  const toggle = (appId: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(appId)) next.delete(appId)
      else next.add(appId)
      return next
    })
  }

  const selectedEntries = entries.filter((e) => selected.has(e.appId))
  const installableEntries = selectedEntries.filter((e) => !isInstalledInScope(e) && e.status === 'ok')

  const handleAddNew = async () => {
    try {
      const entry = await window.miniapp.devRegistry.add()
      if (entry) {
        toast.success(t('resources.devAppLibrary.added', { name: entry.name }))
        await fetchEntries()
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('resources.devAppLibrary.addFailed'))
    }
  }

  const handleInstall = async () => {
    if (installableEntries.length === 0) return
    if (scope === 'project' && !currentFolder) {
      toast.error(t('resources.devAppLibrary.noProjectSelected'))
      return
    }
    setInstalling(true)
    let success = 0
    let failure = 0
    for (const entry of installableEntries) {
      try {
        await window.miniapp.devRegistry.install(
          entry.appId,
          scope,
          scope === 'project' ? currentFolder! : undefined,
        )
        success++
      } catch (err) {
        failure++
        toast.error(`${entry.name}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    setInstalling(false)
    setSelected(new Set())
    await fetchEntries()
    await refreshApps(currentFolder ?? undefined)
    if (success > 0) {
      toast.success(t('resources.devAppLibrary.installedCount', { count: success }))
    }
    if (failure === 0 && success > 0) {
      onClose()
    }
  }

  const handleDeleteConfirm = async () => {
    if (selectedEntries.length === 0) return
    setRemoving(true)
    try {
      for (const entry of selectedEntries) {
        await window.miniapp.devRegistry.remove(entry.appId, cascade)
      }
      setSelected(new Set())
      setDeleteConfirmOpen(false)
      setCascade(false)
      await fetchEntries()
      if (cascade) await refreshApps(currentFolder ?? undefined)
      toast.success(t('resources.devAppLibrary.removedCount', { count: selectedEntries.length }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setRemoving(false)
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <button onClick={onClose} className="rounded p-0.5 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" />
          </button>
          <h3 className="text-sm font-medium truncate">{t('resources.devAppLibrary.title')}</h3>
        </div>
        <Button size="sm" variant="outline" onClick={handleAddNew}>
          <Plus className="size-4" />
          {t('resources.devAppLibrary.addNew')}
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground text-center py-6">{t('resources.devAppLibrary.loading')}</p>
      ) : entries.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-sm text-muted-foreground">{t('resources.devAppLibrary.empty')}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('resources.devAppLibrary.emptyHint')}</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
            {entries.map((entry) => {
              const isSelected = selected.has(entry.appId)
              const installedHere = isInstalledInScope(entry)
              const isMissing = entry.status === 'missing'
              return (
                <div
                  key={entry.appId}
                  role="button"
                  tabIndex={0}
                  onClick={() => toggle(entry.appId)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      toggle(entry.appId)
                    }
                  }}
                  className={cn(
                    'relative flex items-center gap-3 rounded-lg border-2 p-3 transition-colors text-left cursor-pointer',
                    isSelected
                      ? 'border-primary bg-primary/5'
                      : installedHere
                        ? 'border-border bg-muted/40 hover:border-muted-foreground/30'
                        : 'border-border hover:border-muted-foreground/30',
                  )}
                >
                  {isSelected && (
                    <div className="absolute left-1.5 top-1.5 flex size-4 items-center justify-center rounded-full bg-primary">
                      <Check className="size-2.5 text-primary-foreground" />
                    </div>
                  )}
                  {installedHere && (
                    <span className="absolute right-1.5 top-1.5 text-[10px] text-muted-foreground">
                      {t('resources.devAppLibrary.installedHere')}
                    </span>
                  )}
                  {isMissing && (
                    <span className="absolute right-1.5 top-1.5 inline-flex items-center gap-0.5 rounded bg-amber-500/10 px-1 py-0.5 text-[10px] text-amber-600 dark:text-amber-400">
                      <AlertTriangle className="size-2.5" />
                      {t('resources.devAppLibrary.missingBadge')}
                    </span>
                  )}
                  <MiniAppIcon appId={entry.appId} className="size-9 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{entry.name}</p>
                    <p className="text-[11px] text-muted-foreground truncate" title={entry.sourceDir}>
                      {entry.sourceDir}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                      {userInstalled(entry) && (
                        <span className="rounded bg-muted px-1.5 py-0.5">{t('resources.devAppLibrary.installScopeUser')}</span>
                      )}
                      {entry.installations
                        .filter((i) => i.scope === 'project')
                        .map((i) => (
                          <span key={i.installDir} className="rounded bg-muted px-1.5 py-0.5">
                            {t('resources.devAppLibrary.installScopeProject', { name: i.projectDir?.split('/').pop() ?? 'project' })}
                          </span>
                        ))}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      window.miniapp.devRegistry.revealSource(entry.appId).catch(() => undefined)
                    }}
                    className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    title={t('resources.devAppLibrary.revealSource')}
                  >
                    <FolderSearch className="size-3.5" />
                  </button>
                </div>
              )
            })}
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{t('resources.devAppLibrary.installTo')}</span>
              {(['user', 'project'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setScope(s)}
                  disabled={s === 'project' && !currentFolder}
                  className={cn(
                    'rounded-md px-3 py-1 text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
                    scope === s ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground',
                  )}
                >
                  {s === 'user'
                    ? t('resources.devAppLibrary.scopeUser')
                    : currentFolder
                      ? t('resources.devAppLibrary.scopeProject', { name: currentFolder.split('/').pop() })
                      : t('resources.devAppLibrary.scopeProjectNone')}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="destructive"
                disabled={selectedEntries.length === 0 || installing || removing}
                onClick={() => setDeleteConfirmOpen(true)}
              >
                <Trash2 className="size-4" />
                {t('resources.devAppLibrary.removeButton', { count: selectedEntries.length })}
              </Button>
              <Button
                size="sm"
                disabled={installableEntries.length === 0 || installing || removing}
                onClick={handleInstall}
              >
                <FolderInput className="size-4" />
                {installing
                  ? t('resources.devAppLibrary.installing')
                  : t('resources.devAppLibrary.installCount', { count: installableEntries.length })}
              </Button>
            </div>
          </div>
        </>
      )}

      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent showCloseButton={false} className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('resources.devAppLibrary.removeTitle')}</DialogTitle>
            <DialogDescription>
              {t('resources.devAppLibrary.removeDescription', { count: selectedEntries.length })}
            </DialogDescription>
          </DialogHeader>
          <label className="flex items-start gap-2 rounded-md border border-border bg-muted/30 p-2 text-xs">
            <input
              type="checkbox"
              checked={cascade}
              onChange={(e) => setCascade(e.target.checked)}
              className="mt-0.5"
            />
            <span className="text-muted-foreground">{t('resources.devAppLibrary.removeCascadeLabel')}</span>
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)} disabled={removing}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" onClick={handleDeleteConfirm} disabled={removing || selectedEntries.length === 0}>
              {removing ? t('resources.devAppLibrary.removing') : t('resources.devAppLibrary.remove')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
