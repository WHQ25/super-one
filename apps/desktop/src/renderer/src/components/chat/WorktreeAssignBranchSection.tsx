import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { GitBranch, Loader2 } from 'lucide-react'
import type { WorktreeAssignResult } from '@superone/shared/agent-types'

interface WorktreeAssignBranchSectionProps {
  folderPath: string
  worktreePath: string
  onAssigned: () => void
}

type AssignFailure = Extract<WorktreeAssignResult, { ok: false }>

const ASSIGN_ERROR_KEY: Record<AssignFailure['reason'], string> = {
  'name-required': 'chat.worktree.assignErrorGeneric',
  'not-detached': 'chat.worktree.assignErrorGeneric',
  'exists': 'chat.worktree.assignErrorExists',
  'checked-out': 'chat.worktree.assignErrorCheckedOut',
  'error': 'chat.worktree.assignErrorGeneric',
}

/** Promote a detached worktree into a named branch in place — shown only for detached worktrees. */
export function WorktreeAssignBranchSection({ folderPath, worktreePath, onAssigned }: WorktreeAssignBranchSectionProps) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [branches, setBranches] = useState<Set<string>>(new Set())
  const [checkedOut, setCheckedOut] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      window.app.getGitBranches(worktreePath).catch(() => [] as string[]),
      window.app.getCheckedOutBranches(worktreePath).catch(() => [] as string[]),
    ]).then(([br, co]) => {
      if (cancelled) return
      setBranches(new Set(br))
      setCheckedOut(new Set(co))
    })
    return () => { cancelled = true }
  }, [worktreePath])

  const trimmed = name.trim()
  const conflict = checkedOut.has(trimmed)
    ? t('chat.worktree.assignErrorCheckedOut', { name: trimmed })
    : branches.has(trimmed)
      ? t('chat.worktree.assignErrorExists', { name: trimmed })
      : null
  const canSubmit = trimmed.length > 0 && !conflict && !busy

  const submit = async () => {
    if (!canSubmit) return
    setBusy(true)
    try {
      const result = await window.app.assignBranch(folderPath, worktreePath, trimmed)
      if (result.ok) {
        toast.success(t('chat.worktree.assignSuccess', { name: result.branch }))
        onAssigned()
      } else {
        toast.error(t(ASSIGN_ERROR_KEY[result.reason], { name: trimmed }))
      }
      setBusy(false)
    } catch (e) {
      setBusy(false)
      throw e
    }
  }

  return (
    <div className="border-t p-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-xs uppercase text-muted-foreground">
        <GitBranch className="size-3" />
        {t('chat.worktree.assignHeading')}
      </div>
      <p className="mb-2 text-xs text-muted-foreground">{t('chat.worktree.assignInfo')}</p>
      <input
        type="text"
        placeholder={t('chat.worktree.assignPlaceholder')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void submit() }}
        className={`mb-2 w-full rounded-md border bg-background px-2 py-1.5 font-mono text-xs outline-none focus:ring-1 ${conflict ? 'border-red-500 focus:ring-red-500' : 'border-input focus:ring-ring'}`}
      />
      {conflict && (
        <div className="mb-2 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-xs text-red-600 dark:text-red-400">
          {conflict}
        </div>
      )}
      <button
        type="button"
        onClick={submit}
        disabled={!canSubmit}
        className="flex w-full items-center justify-center gap-1.5 rounded-md border border-input px-2 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
      >
        {busy && <Loader2 className="size-3 animate-spin" />}
        {t('chat.worktree.assignButton')}
      </button>
    </div>
  )
}
