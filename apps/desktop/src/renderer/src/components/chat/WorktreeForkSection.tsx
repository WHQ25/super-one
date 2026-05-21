import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GitFork, Loader2 } from 'lucide-react'
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
 * in a fresh worktree detached at the current commit. The source's full working
 * state — HEAD plus every uncommitted change — is always reproduced, so there
 * is nothing to choose. Only shown for sessions running in the main repo.
 */
export function WorktreeForkSection({ sessionId, cwd, onForked }: WorktreeForkSectionProps) {
  const { t } = useTranslation()
  const [dirty, setDirty] = useState<GitDirtyStatus | undefined>()
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
    const result = await window.app.forkSessionToWorktree({ sessionId })
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
      <div className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase text-muted-foreground">
        <GitFork className="size-3" />
        {t('chat.worktree.forkHeading')}
      </div>
      <p className="mb-2 text-[11px] text-muted-foreground">{t('chat.worktree.forkInfo')}</p>
      {dirty && dirty.files > 0 && (
        <p className="mb-2 text-[10px] text-muted-foreground">
          {t('chat.worktree.forkIncludesChanges')}{' '}
          <DiffStat stat={dirty} />
        </p>
      )}
      {error && (
        <div className="mb-2 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-600 dark:text-red-400">
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
