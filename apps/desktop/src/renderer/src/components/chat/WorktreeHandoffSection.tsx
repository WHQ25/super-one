import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ArrowDownToLine, Loader2 } from 'lucide-react'
import type { GitDirtyStatus, WorktreeHandoffResult } from '@superone/shared/agent-types'
import { DiffStat, sameDirty } from './DiffStat'

interface WorktreeHandoffSectionProps {
  worktreePath: string
  /** Project key (local path or remote:<conn>:<path>) for remote handoff routing. */
  folderPath?: string
  /** Uncommitted stat already shown in the popover header — used to suppress a duplicate line. */
  dirty?: GitDirtyStatus
  onDone: () => void
}

type HandoffFailure = Extract<WorktreeHandoffResult, { ok: false }>

const HANDOFF_ERROR_KEY: Record<HandoffFailure['reason'], string> = {
  'no-changes': 'chat.worktree.handoffErrorNoChanges',
  'local-dirty': 'chat.worktree.handoffErrorLocalDirty',
  'conflict': 'chat.worktree.handoffErrorConflict',
  'not-worktree': 'chat.worktree.handoffErrorNotWorktree',
  'error': 'chat.worktree.handoffErrorGeneric',
}

/** One-click handoff section — non-destructive; renders nothing when there is nothing to hand off. */
export function WorktreeHandoffSection({ worktreePath, folderPath, dirty, onDone }: WorktreeHandoffSectionProps) {
  const { t } = useTranslation()
  const [stat, setStat] = useState<GitDirtyStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    window.app.getHandoffPreview(worktreePath, folderPath).then((s) => {
      if (cancelled) return
      setStat(s)
      setLoading(false)
    }).catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [worktreePath, folderPath])

  const submit = async () => {
    if (busy) return
    setBusy(true)
    try {
      const result = await window.app.handoffToLocal(worktreePath, folderPath)
      if (result.ok) {
        toast.success(t('chat.worktree.handoffSuccess'))
        onDone()
      } else {
        toast.error(t(HANDOFF_ERROR_KEY[result.reason]))
      }
      setBusy(false)
    } catch (e) {
      setBusy(false)
      throw e
    }
  }

  const hasChanges = !!stat && stat.files > 0
  // On a branch the handoff carries only uncommitted work, so this stat repeats the
  // header. Detached, base is the merge-base — worktree commits count too, and the
  // wider scope is worth spelling out.
  const showScope = hasChanges && !sameDirty(stat!, dirty)

  return (
    <div className="border-t p-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-xs uppercase text-muted-foreground">
        <ArrowDownToLine className="size-3" />
        {t('chat.worktree.handoffHeading')}
      </div>
      <p className="mb-2 text-xs text-muted-foreground">{t('chat.worktree.handoffInfo')}</p>
      {showScope && (
        <p className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          {t('chat.worktree.handoffCarries')} <DiffStat stat={stat!} />
        </p>
      )}
      <button
        type="button"
        onClick={submit}
        disabled={busy || loading || !hasChanges}
        className="flex w-full items-center justify-center gap-1.5 rounded-md border border-input px-2 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
      >
        {busy && <Loader2 className="size-3 animate-spin" />}
        {t('chat.worktree.handoffButton')}
      </button>
    </div>
  )
}
