import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GitFork, Loader2 } from 'lucide-react'
import { Checkbox } from '@superone/ui/components/ui/checkbox'
import type { GitDirtyStatus } from '@superone/shared/agent-types'
import { useChatStore } from '@/stores/chat'
import { DiffStat } from './DiffStat'

interface WorktreeForkSectionProps {
  /** SuperOne id of the session to fork. */
  sessionId: string
  /** Working directory of the source session — used to preview what gets copied. */
  cwd: string
  onForked: () => void
}

/**
 * One-click fork: branch the conversation into an independent session running
 * in a fresh worktree detached at the current commit. Local changes can be
 * included or excluded before creating the fork. Only shown for sessions
 * running in the main repo.
 */
export function WorktreeForkSection({ sessionId, cwd, onForked }: WorktreeForkSectionProps) {
  const { t } = useTranslation()
  const [dirty, setDirty] = useState<GitDirtyStatus | undefined>()
  const [carryLocalChanges, setCarryLocalChanges] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    window.app.getGitInfo(cwd).then((info) => {
      if (!cancelled) setDirty(info?.dirty)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [cwd])

  const submit = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    const result = await window.app.forkSession({
      sessionId,
      mode: 'worktree',
      carryLocalChanges,
    })
    if (result.ok) {
      await useChatStore.getState().switchSession(result.sessionId)
      onForked()
    } else {
      setError(result.error)
      setBusy(false)
    }
  }

  return (
    <div className="border-t p-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-xs uppercase text-muted-foreground">
        <GitFork className="size-3" />
        {t('chat.worktree.forkHeading')}
      </div>
      <p className="mb-2 text-xs text-muted-foreground">{t('chat.worktree.forkInfo')}</p>
      {dirty && dirty.files > 0 && (
        <label className="mb-2 flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <Checkbox
            checked={carryLocalChanges}
            onCheckedChange={(checked) => setCarryLocalChanges(checked === true)}
            disabled={busy}
            aria-label={t('chat.worktree.forkIncludesChanges')}
          />
          <span>{t('chat.worktree.forkIncludesChanges')}</span>
          <span className="ml-auto">
            <DiffStat stat={dirty} />
          </span>
        </label>
      )}
      {error && (
        <div className="mb-2 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-xs text-red-600 dark:text-red-400">
          {error}
        </div>
      )}
      <button
        type="button"
        onClick={submit}
        disabled={busy}
        className="flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-2 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {busy && <Loader2 className="size-3 animate-spin" />}
        {t('chat.worktree.forkButton')}
      </button>
    </div>
  )
}
