import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ArrowDownToLine, Loader2 } from 'lucide-react'
import type { GitDirtyStatus, WorktreeHandoffResult } from '@superone/shared/agent-types'
import { DiffStat } from './DiffStat'

interface WorktreeHandoffSectionProps {
  worktreePath: string
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
export function WorktreeHandoffSection({ worktreePath, onDone }: WorktreeHandoffSectionProps) {
  const { t } = useTranslation()
  const [stat, setStat] = useState<GitDirtyStatus | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    window.app.getHandoffPreview(worktreePath).then((s) => {
      if (!cancelled) setStat(s)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [worktreePath])

  const submit = async () => {
    if (busy) return
    setBusy(true)
    try {
      const result = await window.app.handoffToLocal(worktreePath)
      if (result.ok) {
        toast.success(t('chat.worktree.handoffSuccess'))
        onDone()
      } else {
        toast.error(t(HANDOFF_ERROR_KEY[result.reason]))
      }
    } finally {
      setBusy(false)
    }
  }

  if (!stat || stat.files === 0) return null

  return (
    <div className="border-t p-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase text-muted-foreground">
        <ArrowDownToLine className="size-3" />
        {t('chat.worktree.handoffHeading')}
      </div>
      <p className="mb-2 text-[11px] text-muted-foreground">{t('chat.worktree.handoffInfo')}</p>
      <p className="mb-2 text-[10px] text-muted-foreground">
        <DiffStat stat={stat} />
      </p>
      <button
        type="button"
        onClick={submit}
        disabled={busy}
        className="flex w-full items-center justify-center gap-1.5 rounded-md border border-input px-2 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
      >
        {busy && <Loader2 className="size-3 animate-spin" />}
        {t('chat.worktree.handoffButton')}
      </button>
    </div>
  )
}
