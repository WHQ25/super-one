import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderOpen, Loader2, Trash2 } from 'lucide-react'
import { Button } from '@superone/ui/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@superone/ui/components/ui/dialog'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { formatBytes } from '@superone/shared/format-bytes'
import type { StorageWorktree } from '@superone/shared/desktop-storage'
import { SettingsRow, SettingsSection } from './SettingsSection'
import { SpacePair } from './StorageSettingsComponents'

type State =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; worktrees: StorageWorktree[] }

function sumBytes(worktrees: StorageWorktree[]): number {
  return worktrees.reduce((sum, worktree) => sum + worktree.bytes, 0)
}

function worktreeName(worktree: StorageWorktree): string {
  return `${worktree.repo}/${worktree.path.split(/[\\/]/).pop() ?? ''}`
}

/**
 * Worktrees SuperOne created under `~/.worktrees`. Measuring them walks every
 * file, so the section loads on its own and stays out of one-click Optimize:
 * removal is always the user's explicit choice, and only for worktrees no
 * session uses.
 */
export function WorktreeStorageSection() {
  const { t } = useTranslation()
  const [state, setState] = useState<State>({ status: 'loading' })
  const [pending, setPending] = useState<StorageWorktree[] | null>(null)
  const [removing, setRemoving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setState({ status: 'ready', worktrees: await window.app.getStorageWorktrees() })
    } catch {
      setState({ status: 'error' })
    }
  }, [])

  useEffect(() => {
    let live = true
    void window.app.getStorageWorktrees().then(
      (worktrees) => { if (live) setState({ status: 'ready', worktrees }) },
      () => { if (live) setState({ status: 'error' }) },
    )
    return () => { live = false }
  }, [])

  async function remove(targets: StorageWorktree[]) {
    setPending(null)
    setRemoving(true)
    setNotice(null)
    try {
      const result = await window.app.removeStorageWorktrees(targets.map((worktree) => worktree.path))
      const freed = sumBytes(targets.filter((worktree) => result.removed.includes(worktree.path)))
      setNotice(result.failed.length > 0
        ? t('storageSettings.worktrees.removeFailed', { count: result.failed.length, bytes: formatBytes(freed) })
        : t('storageSettings.worktrees.removed', { count: result.removed.length, bytes: formatBytes(freed) }))
      await load()
    } catch {
      setState({ status: 'error' })
    } finally {
      setRemoving(false)
    }
  }

  const worktrees = state.status === 'ready' ? state.worktrees : []
  const inUse = worktrees.filter((worktree) => worktree.inUse)
  const unused = worktrees.filter((worktree) => !worktree.inUse)
  const clean = unused.filter((worktree) => !worktree.dirty)

  return (
    <SettingsSection
      title={t('storageSettings.worktrees.section')}
      actions={state.status === 'ready' && (
        <>
          <SpacePair testId="storage-worktrees-space" optimizable={sumBytes(unused)} occupied={sumBytes(worktrees)} />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7"
            data-testid="storage-worktrees-remove-unused"
            disabled={clean.length === 0 || removing}
            onClick={() => setPending(clean)}
          >
            {removing && <Loader2 className="size-3.5 animate-spin" />}
            {t('storageSettings.worktrees.removeUnused')}
          </Button>
        </>
      )}
    >
      {state.status === 'loading' && (
        <SettingsRow
          data-testid="storage-worktrees-loading"
          aria-busy="true"
          label={(
            <span className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              {t('storageSettings.worktrees.measuring')}
            </span>
          )}
        />
      )}
      {state.status === 'error' && (
        <SettingsRow
          data-testid="storage-worktrees-error"
          label={<span className="text-destructive">{t('storageSettings.worktrees.unreadable')}</span>}
        >
          <Button type="button" variant="outline" size="sm" className="h-7" onClick={() => { setState({ status: 'loading' }); void load() }}>
            {t('common.retry')}
          </Button>
        </SettingsRow>
      )}
      {notice && (
        <SettingsRow data-testid="storage-worktrees-notice" label={<span className="text-muted-foreground">{notice}</span>} />
      )}
      {state.status === 'ready' && worktrees.length === 0 && (
        <SettingsRow data-testid="storage-worktrees-empty" label={<span className="text-muted-foreground">{t('storageSettings.worktrees.empty')}</span>} />
      )}
      {inUse.length > 0 && (
        <SettingsRow
          data-testid="storage-worktrees-in-use"
          label={t('storageSettings.worktrees.inUse')}
          description={t('storageSettings.worktrees.inUseDescription', { count: inUse.length })}
        >
          <span className="text-xs tabular-nums text-muted-foreground">{formatBytes(sumBytes(inUse))}</span>
        </SettingsRow>
      )}
      {unused.map((worktree) => (
        <SettingsRow
          key={worktree.path}
          data-testid="storage-worktree"
          label={<span className="block truncate" title={worktree.path}>{worktreeName(worktree)}</span>}
          description={(
            <span>
              {worktree.branch ?? t('storageSettings.worktrees.detached')}
              {worktree.dirty && (
                <span className="text-destructive"> · {t('storageSettings.worktrees.uncommitted')}</span>
              )}
            </span>
          )}
        >
          <span className="text-xs tabular-nums text-muted-foreground">{formatBytes(worktree.bytes)}</span>
          <IconButton size="md" tooltip={t('storageSettings.reveal')} onClick={() => { void window.app.revealFile(worktree.path) }}>
            <FolderOpen />
          </IconButton>
          <IconButton
            size="md"
            variant="destructive"
            tooltip={t('storageSettings.worktrees.remove')}
            disabled={removing}
            onClick={() => setPending([worktree])}
          >
            <Trash2 />
          </IconButton>
        </SettingsRow>
      ))}

      <Dialog open={pending !== null} onOpenChange={(open) => { if (!open) setPending(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('storageSettings.worktrees.confirmTitle', { count: pending?.length ?? 0 })}</DialogTitle>
            <DialogDescription>
              {pending?.some((worktree) => worktree.dirty)
                ? t('storageSettings.worktrees.confirmDirty')
                : t('storageSettings.worktrees.confirm', { bytes: formatBytes(sumBytes(pending ?? [])) })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPending(null)}>{t('common.cancel')}</Button>
            <Button type="button" variant="destructive" data-testid="storage-worktrees-confirm" onClick={() => pending && void remove(pending)}>
              {t('common.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsSection>
  )
}
