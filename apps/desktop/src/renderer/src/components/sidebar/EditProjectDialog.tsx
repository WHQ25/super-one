import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Folder, FolderPlus, X } from 'lucide-react'
import { Button } from '@superone/ui/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@superone/ui/components/ui/dialog'
import { MAX_PROJECT_EXTRA_DIRS } from '@superone/shared/project-extra-dirs'
import type { RecentFolder } from '@superone/shared/agent-types'
import { getBrowseDirectoryPath, isBrowseablePathQuery } from '@/lib/path-browse'
import { homePath } from '@/lib/path-utils'
import { parseRemoteProjectKey } from '@/lib/remote-project-key'

export interface EditProjectDialogProps {
  /** Null closes the dialog — same nullable-target shape as RenameSessionDialog. */
  target: RecentFolder | null
  onClose: () => void
  onSaved: (saved: { path: string; name: string; extraDirs: string[] }) => void
}

const BROWSE_DEBOUNCE_MS = 100

export function EditProjectDialog({ target, onClose, onSaved }: EditProjectDialogProps) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [dirs, setDirs] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const remote = useMemo(() => (target ? parseRemoteProjectKey(target.path) : null), [target])
  const connectionId = remote?.connectionId ?? 'local'
  const hostPath = remote?.path ?? target?.path ?? ''

  useEffect(() => {
    if (!target) return
    setName(target.name)
    setDirs(target.extraDirs ?? [])
    setError(null)
  }, [target])

  const addDir = useCallback((dir: string) => {
    setDirs((prev) => (prev.includes(dir) || prev.length >= MAX_PROJECT_EXTRA_DIRS ? prev : [...prev, dir]))
  }, [])

  const submit = useCallback(async () => {
    if (!target || saving) return
    const trimmed = name.trim()
    if (!trimmed) return
    setSaving(true)
    setError(null)
    try {
      // One patch for whatever the user touched: each write can cost a running
      // Claude session a process rebuild, so per-folder writes are wrong here.
      await window.environment.updateProject(connectionId, {
        projectId: target.id,
        path: hostPath,
        name: trimmed,
        extraDirs: dirs,
      })
      onSaved({ path: target.path, name: trimmed, extraDirs: dirs })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }, [target, saving, name, connectionId, hostPath, dirs, onSaved, onClose])

  const removedAny = (target?.extraDirs ?? []).some((d) => !dirs.includes(d))
  const atLimit = dirs.length >= MAX_PROJECT_EXTRA_DIRS

  return (
    <Dialog open={!!target} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent showCloseButton={false} className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('sidebar.editProject.title')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            {t('sidebar.editProject.nameLabel')}
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return
              if (e.key === 'Enter') {
                e.preventDefault()
                void submit()
              }
            }}
            autoFocus
            className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-muted-foreground">
              {t('sidebar.editProject.foldersLabel')}
            </label>
            <span className="text-xs text-muted-foreground/60">
              {dirs.length}/{MAX_PROJECT_EXTRA_DIRS}
            </span>
          </div>

          {dirs.length === 0 ? (
            <div className="rounded-md border border-dashed px-3 py-4 text-center text-xs italic text-muted-foreground/60">
              {t('sidebar.editProject.emptyFolders')}
            </div>
          ) : (
            <div className="max-h-48 space-y-0.5 overflow-y-auto">
              {dirs.map((dir) => (
                <div
                  key={dir}
                  className="flex items-center justify-between gap-2 rounded px-1.5 py-1 text-xs hover:bg-muted/50"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Folder className="size-3.5 shrink-0 text-blue-500" />
                    <span className="truncate text-foreground" title={dir}>{homePath(dir)}</span>
                  </span>
                  <button
                    type="button"
                    aria-label={t('sidebar.editProject.removeFolder')}
                    onClick={() => setDirs((prev) => prev.filter((d) => d !== dir))}
                    className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <X className="size-2.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {connectionId === 'local' ? (
            <LocalFolderPicker disabled={atLimit} defaultPath={hostPath} onPick={addDir} />
          ) : (
            <HostFolderPicker
              disabled={atLimit}
              connectionId={connectionId}
              startPath={hostPath}
              onPick={addDir}
            />
          )}
        </div>

        {removedAny && (
          <p className="text-xs text-muted-foreground">
            {t('sidebar.editProject.restartNotice')}
          </p>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void submit()} disabled={!name.trim() || saving}>
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Native chooser — only correct for `local`, whose paths are on this machine. */
function LocalFolderPicker({
  disabled,
  defaultPath,
  onPick,
}: {
  disabled: boolean
  defaultPath: string
  onPick: (dir: string) => void
}) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={async () => {
        const folder = await window.app.selectFolder(defaultPath)
        if (folder) onPick(folder)
      }}
      className="flex items-center gap-1.5 rounded px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
    >
      <FolderPlus className="size-3.5" />
      {t('sidebar.editProject.addFolder')}
    </button>
  )
}

/**
 * Remote hosts get a typed path with live suggestions instead of the native
 * chooser: `dialog.showOpenDialog` can only ever return a path on this machine,
 * which would be meaningless on the node that has to resolve it.
 */
function HostFolderPicker({
  disabled,
  connectionId,
  startPath,
  onPick,
}: {
  disabled: boolean
  connectionId: string
  startPath: string
  onPick: (dir: string) => void
}) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [entries, setEntries] = useState<Array<{ name: string; path: string }>>([])
  const requestId = useRef(0)

  useEffect(() => {
    if (disabled) return
    const target = getBrowseDirectoryPath(query) || query || startPath
    if (!isBrowseablePathQuery(target)) {
      setEntries([])
      return
    }
    const id = ++requestId.current
    const timer = window.setTimeout(() => {
      void window.environment
        .browsePath(connectionId, target)
        .then((res) => {
          if (id !== requestId.current) return
          setEntries(res.entries.map((e) => ({ name: e.name, path: e.path })))
        })
        .catch(() => {
          if (id === requestId.current) setEntries([])
        })
    }, BROWSE_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [connectionId, query, startPath, disabled])

  const leaf = query.split('/').pop()?.toLowerCase() ?? ''
  const shown = entries
    .filter((e) => !leaf || e.name.toLowerCase().includes(leaf))
    .slice(0, 8)

  return (
    <div className="space-y-1">
      <input
        value={query}
        disabled={disabled}
        placeholder={t('sidebar.editProject.addFolderRemote')}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Enter' && query.trim()) {
            e.preventDefault()
            onPick(query.trim())
            setQuery('')
          }
        }}
        className="w-full rounded-md border bg-transparent px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
      />
      {shown.length > 0 && (
        <div className="max-h-32 overflow-y-auto rounded-md border">
          {shown.map((entry) => (
            <button
              key={entry.path}
              type="button"
              onClick={() => { onPick(entry.path); setQuery('') }}
              className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-xs hover:bg-muted/50"
            >
              <Folder className="size-3.5 shrink-0 text-blue-500" />
              <span className="truncate">{entry.path}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
